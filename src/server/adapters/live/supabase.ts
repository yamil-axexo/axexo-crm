import 'server-only'
import { createHash } from 'node:crypto'
import { ConnectorError, http } from './http'

/**
 * Supabase (Storage y Auth admin) con la llave de servicio. Solo del lado del servidor; la llave nunca llega al navegador.
 * Variables: SUPABASE_URL (ya existe para el ingreso) y SUPABASE_SERVICE_ROLE_KEY.
 * El host permitido sale de SUPABASE_URL y tiene que ser *.supabase.co.
 */
export const SUPABASE_ADMIN = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const
function base(connector: string): { origin: string; hosts: string[]; headers: Record<string, string> } {
  let u: URL
  try {
    u = new URL(process.env.SUPABASE_URL ?? '')
  } catch {
    throw new ConnectorError(connector, 'refused')
  }
  if (!u.hostname.endsWith('.supabase.co')) throw new ConnectorError(connector, 'egress_blocked')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  return { origin: u.origin, hosts: [u.hostname], headers: { apikey: key, authorization: `Bearer ${key}` } }
}
const safePath = (connector: string, p: string) => {
  if (!/^[A-Za-z0-9][A-Za-z0-9/_.=-]{0,400}$/.test(p) || p.includes('..')) throw new ConnectorError(connector, 'bad_request')
  return p.split('/').map(encodeURIComponent).join('/')
}
const safeBucket = (connector: string, b: string) => {
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(b)) throw new ConnectorError(connector, 'refused')
  return b
}

export const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')

/** Sube un objeto a un bucket privado. No reemplaza uno existente (x-upsert: false). Devuelve su huella SHA-256. */
export async function storagePut(connector: string, bucket: string, path: string, data: string | Uint8Array, contentType: string): Promise<{ ref: string; sha256: string; bytes: number }> {
  const b = base(connector)
  await http({
    connector, url: `${b.origin}/storage/v1/object/${safeBucket(connector, bucket)}/${safePath(connector, path)}`, method: 'POST', allowHosts: b.hosts,
    headers: { ...b.headers, 'content-type': contentType, 'x-upsert': 'false', 'cache-control': 'no-store' }, body: data,
  })
  const bytes = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength
  return { ref: `${bucket}/${path}`, sha256: sha256(data), bytes }
}

/** Lee un objeto (texto) de un bucket privado. */
export async function storageGet(connector: string, bucket: string, path: string): Promise<string> {
  const b = base(connector)
  const res = await http({ connector, url: `${b.origin}/storage/v1/object/authenticated/${safeBucket(connector, bucket)}/${safePath(connector, path)}`, allowHosts: b.hosts, headers: { ...b.headers, accept: '*/*' }, timeoutMs: 60_000 })
  return res.text
}

/** Enlace firmado de vida corta (por defecto 60 segundos) para leer un objeto. */
export async function storageSign(connector: string, bucket: string, path: string, expiresIn = 60): Promise<string> {
  const b = base(connector)
  const res = await http({ connector, url: `${b.origin}/storage/v1/object/sign/${safeBucket(connector, bucket)}/${safePath(connector, path)}`, allowHosts: b.hosts, headers: b.headers, json: { expiresIn: Math.min(Math.max(10, expiresIn), 300) } })
  const rel = res.json<{ signedURL?: string; signedUrl?: string }>()
  const s = rel.signedURL ?? rel.signedUrl
  if (!s) throw new ConnectorError(connector, 'invalid_response', res.status)
  return s.startsWith('http') ? s : `${b.origin}/storage/v1${s.startsWith('/') ? '' : '/'}${s}`
}

/** Probar conexión: el bucket existe y la llave sirve (solo lee los metadatos del bucket). */
export async function storageBucketProbe(connector: string, bucket: string): Promise<string> {
  const b = base(connector)
  const res = await http({ connector, url: `${b.origin}/storage/v1/bucket/${safeBucket(connector, bucket)}`, allowHosts: b.hosts, headers: b.headers })
  const j = res.json<{ public?: boolean; name?: string }>()
  if (j.public) throw new ConnectorError(connector, 'refused')
  return j.name ?? bucket
}

/**
 * Archivos de S5 (Data y Reportería): S5 deja en su bucket un `manifest.json` con la lista de archivos y su huella.
 * CONTIGO lee el manifiesto, baja solo los que no ha cargado, revisa la huella y entrega el contenido.
 * Formato: { "files": [{ "kind": "merchant_metrics_daily", "path": "2026/11/13/metrics.json", "sha256": "...", "as_of": "2026-11-13" }] }
 */
export type ManifestFile = { kind: string; path: string; sha256: string; as_of: string }
export async function s5Manifest(connector: string): Promise<ManifestFile[]> {
  const raw = await storageGet(connector, process.env.S5_BUCKET ?? '', 'manifest.json')
  let j: { files?: unknown }
  try {
    j = JSON.parse(raw) as { files?: unknown }
  } catch {
    throw new ConnectorError(connector, 'invalid_response')
  }
  if (!Array.isArray(j.files)) throw new ConnectorError(connector, 'invalid_response')
  return (j.files as Record<string, unknown>[])
    .filter((f) => typeof f.kind === 'string' && typeof f.path === 'string' && typeof f.sha256 === 'string' && /^[0-9a-f]{64}$/.test(f.sha256 as string) && typeof f.as_of === 'string')
    .map((f) => ({ kind: f.kind as string, path: f.path as string, sha256: f.sha256 as string, as_of: f.as_of as string }))
}
export async function s5Read(connector: string, file: ManifestFile): Promise<unknown> {
  const raw = await storageGet(connector, process.env.S5_BUCKET ?? '', file.path)
  if (sha256(raw) !== file.sha256) throw new ConnectorError(connector, 'invalid_response')
  try {
    return JSON.parse(raw)
  } catch {
    throw new ConnectorError(connector, 'invalid_response')
  }
}

// ------------------------------------------------------------------ Auth: invitación por enlace a una persona externa
export async function inviteExternal(email: string, meta: Record<string, string>, redirectTo: string | null): Promise<{ userId: string }> {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ConnectorError('external_identity', 'bad_request')
  const b = base('external_identity')
  const res = await http({ connector: 'external_identity', url: `${b.origin}/auth/v1/invite`, allowHosts: b.hosts, headers: b.headers, json: { email: email.toLowerCase(), data: meta, ...(redirectTo ? { redirect_to: redirectTo } : {}) }, attempts: 2 })
  return { userId: res.json<{ id?: string }>().id ?? '' }
}
export async function authSettingsProbe(): Promise<string> {
  const b = base('external_identity')
  await http({ connector: 'external_identity', url: `${b.origin}/auth/v1/settings`, allowHosts: b.hosts, headers: b.headers })
  return 'ok'
}
