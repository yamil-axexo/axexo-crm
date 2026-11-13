import 'server-only'
import { createSign } from 'node:crypto'
import { ConnectorError, http } from './http'

/**
 * Google Workspace con cuenta de servicio y delegación de dominio (JWT RS256 firmado con node:crypto, sin dependencias).
 * Variables: GOOGLE_SERVICE_ACCOUNT_EMAIL y GOOGLE_SERVICE_ACCOUNT_KEY (llave privada PEM; los "\n" escritos se aceptan).
 * Cada conector pide SOLO su alcance (scope) y la persona a la que suplanta (`subject`).
 */
export const GOOGLE_SA = ['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_KEY'] as const
export const GOOGLE_HOSTS = ['googleapis.com'] as const
export const SCOPES = {
  gmailSend: 'https://www.googleapis.com/auth/gmail.send',
  gmailMetadata: 'https://www.googleapis.com/auth/gmail.metadata',
  calendarRead: 'https://www.googleapis.com/auth/calendar.events.readonly',
  directoryRead: 'https://www.googleapis.com/auth/admin.directory.user.readonly',
} as const

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const cache = new Map<string, { token: string; exp: number }>()

export function signJwt(claims: Record<string, unknown>, pem: string): string {
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(claims))
  const s = createSign('RSA-SHA256')
  s.update(`${head}.${body}`)
  return `${head}.${body}.${b64url(s.sign(pem.replace(/\\n/g, '\n')))}`
}

export async function googleToken(connector: string, scope: string, subject: string | null): Promise<string> {
  const key = `${scope}|${subject ?? ''}`
  const hit = cache.get(key)
  if (hit && hit.exp > Date.now() + 60_000) return hit.token
  const iss = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? ''
  const pem = process.env.GOOGLE_SERVICE_ACCOUNT_KEY ?? ''
  if (!iss || !pem) throw new ConnectorError(connector, 'refused')
  const now = Math.floor(Date.now() / 1000)
  let assertion: string
  try {
    assertion = signJwt({ iss, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600, ...(subject ? { sub: subject } : {}) }, pem)
  } catch {
    throw new ConnectorError(connector, 'unauthorized')
  }
  const res = await http({
    connector, url: 'https://oauth2.googleapis.com/token', method: 'POST', allowHosts: GOOGLE_HOSTS,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
  })
  const j = res.json<{ access_token?: string; expires_in?: number }>()
  if (!j.access_token) throw new ConnectorError(connector, 'invalid_response', res.status)
  cache.set(key, { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 })
  return j.access_token
}

/** Solo pruebas: olvidar los tokens guardados. */
export const resetGoogleTokens = () => cache.clear()

// ------------------------------------------------------------------ correo saliente (Gmail API, users.messages.send)
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`)
const cleanHeader = (s: string) => s.replace(/[\r\n]+/g, ' ').trim()

export function rfc822(p: { from: string; to: string; subject: string; body: string }): string {
  return [
    `From: ${cleanHeader(p.from)}`,
    `To: ${cleanHeader(p.to)}`,
    `Subject: ${encodeHeader(cleanHeader(p.subject))}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(p.body, 'utf8').toString('base64'),
  ].join('\r\n')
}

export async function gmailSend(p: { to: string; subject: string; body: string }): Promise<{ id: string }> {
  const sender = process.env.EMAIL_SENDER ?? ''
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.to)) throw new ConnectorError('email', 'bad_request')
  const token = await googleToken('email', SCOPES.gmailSend, sender)
  const res = await http({
    connector: 'email', url: `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(sender)}/messages/send`, allowHosts: GOOGLE_HOSTS,
    headers: { authorization: `Bearer ${token}` }, json: { raw: b64url(rfc822({ from: sender, ...p })) }, minIntervalMs: 50,
  })
  return { id: res.json<{ id?: string }>().id ?? '' }
}

// ------------------------------------------------------------------ captura de correo (solo metadatos: nunca el cuerpo)
export type MailMeta = { id: string; threadId: string; from: string[]; to: string[]; subject: string; date: string }
const addresses = (v: string | undefined) => (v ?? '').split(',').map((x) => (x.match(/<([^>]+)>/)?.[1] ?? x).trim().toLowerCase()).filter((x) => x.includes('@'))

export async function gmailMetadata(mailbox: string, sinceEpochSeconds: number, max = 100): Promise<MailMeta[]> {
  const token = await googleToken('gmail_capture', SCOPES.gmailMetadata, mailbox)
  const auth = { authorization: `Bearer ${token}` }
  const base = `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(mailbox)}/messages`
  const out: MailMeta[] = []
  let pageToken: string | undefined
  do {
    const q = new URLSearchParams({ q: `after:${sinceEpochSeconds}`, maxResults: String(Math.min(100, max)) })
    if (pageToken) q.set('pageToken', pageToken)
    const list = (await http({ connector: 'gmail_capture', url: `${base}?${q}`, allowHosts: GOOGLE_HOSTS, headers: auth, minIntervalMs: 20 })).json<{ messages?: { id: string }[]; nextPageToken?: string }>()
    for (const m of list.messages ?? []) {
      if (out.length >= max) break
      const meta = (await http({ connector: 'gmail_capture', url: `${base}/${encodeURIComponent(m.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`, allowHosts: GOOGLE_HOSTS, headers: auth, minIntervalMs: 20 }))
        .json<{ id: string; threadId: string; internalDate?: string; payload?: { headers?: { name: string; value: string }[] } }>()
      const h = (n: string) => meta.payload?.headers?.find((x) => x.name.toLowerCase() === n)?.value
      out.push({ id: meta.id, threadId: meta.threadId, from: addresses(h('from')), to: [...addresses(h('to')), ...addresses(h('cc'))], subject: (h('subject') ?? '').slice(0, 200), date: new Date(Number(meta.internalDate ?? Date.now())).toISOString() })
    }
    pageToken = out.length < max ? list.nextPageToken : undefined
  } while (pageToken)
  return out
}

// ------------------------------------------------------------------ captura de reuniones (Google Calendar, solo lectura)
export type CalendarMeta = { id: string; summary: string; start: string; end: string | null; attendees: string[] }
export async function calendarEvents(mailbox: string, sinceIso: string, untilIso: string): Promise<CalendarMeta[]> {
  const token = await googleToken('calendar_capture', SCOPES.calendarRead, mailbox)
  const out: CalendarMeta[] = []
  let pageToken: string | undefined
  do {
    const q = new URLSearchParams({ timeMin: sinceIso, timeMax: untilIso, singleEvents: 'true', maxResults: '250', fields: 'items(id,summary,start,end,attendees(email),status),nextPageToken' })
    if (pageToken) q.set('pageToken', pageToken)
    const j = (await http({ connector: 'calendar_capture', url: `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(mailbox)}/events?${q}`, allowHosts: GOOGLE_HOSTS, headers: { authorization: `Bearer ${token}` } }))
      .json<{ items?: { id: string; summary?: string; status?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; attendees?: { email?: string }[] }[]; nextPageToken?: string }>()
    for (const e of j.items ?? []) {
      if (e.status === 'cancelled') continue
      const start = e.start?.dateTime ?? e.start?.date
      if (!start) continue
      out.push({ id: e.id, summary: (e.summary ?? '').slice(0, 200), start: new Date(start).toISOString(), end: e.end?.dateTime ?? e.end?.date ? new Date((e.end?.dateTime ?? e.end?.date)!).toISOString() : null, attendees: (e.attendees ?? []).map((a) => (a.email ?? '').toLowerCase()).filter(Boolean) })
    }
    pageToken = j.nextPageToken
  } while (pageToken)
  return out
}

// ------------------------------------------------------------------ directorio (Admin SDK, solo lectura)
/** Correos activos (no suspendidos) del directorio. Nunca devuelve una lista vacía: eso sería quitarle el acceso a todos. */
export async function directoryActiveEmails(): Promise<Set<string>> {
  const token = await googleToken('directory', SCOPES.directoryRead, process.env.GOOGLE_ADMIN_SUBJECT ?? null)
  const active = new Set<string>()
  let pageToken: string | undefined
  do {
    const q = new URLSearchParams({ customer: process.env.GOOGLE_CUSTOMER_ID || 'my_customer', maxResults: '500', projection: 'basic', fields: 'users(primaryEmail,suspended,archived,emails(address)),nextPageToken' })
    if (pageToken) q.set('pageToken', pageToken)
    const j = (await http({ connector: 'directory', url: `https://admin.googleapis.com/admin/directory/v1/users?${q}`, allowHosts: GOOGLE_HOSTS, headers: { authorization: `Bearer ${token}` } }))
      .json<{ users?: { primaryEmail: string; suspended?: boolean; archived?: boolean; emails?: { address?: string }[] }[]; nextPageToken?: string }>()
    for (const u of j.users ?? []) {
      if (u.suspended || u.archived) continue
      active.add(u.primaryEmail.toLowerCase())
      for (const e of u.emails ?? []) if (e.address) active.add(e.address.toLowerCase())
    }
    pageToken = j.nextPageToken
  } while (pageToken)
  if (active.size === 0) throw new ConnectorError('directory', 'invalid_response')
  return active
}

// ------------------------------------------------------------------ geocodificación (Geocoding API)
export async function geocode(address: string, country: string): Promise<{ status: 'found'; latitude: number; longitude: number } | { status: 'not_found' }> {
  const key = process.env.GOOGLE_MAPS_API_KEY ?? ''
  const q = new URLSearchParams({ address, components: `country:${country}`, key })
  const j = (await http({ connector: 'geocoding', url: `https://maps.googleapis.com/maps/api/geocode/json?${q}`, allowHosts: GOOGLE_HOSTS, minIntervalMs: 25 }))
    .json<{ status: string; results?: { geometry?: { location?: { lat: number; lng: number } } }[] }>()
  if (j.status === 'OVER_QUERY_LIMIT') throw new ConnectorError('geocoding', 'rate_limited', 200, 1)
  if (j.status === 'REQUEST_DENIED') throw new ConnectorError('geocoding', 'unauthorized', 200)
  const loc = j.results?.[0]?.geometry?.location
  if (j.status !== 'OK' || !loc) return { status: 'not_found' }
  return { status: 'found', latitude: loc.lat, longitude: loc.lng }
}
