import 'server-only'
import { createCipheriv, createDecipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign as cryptoSign } from 'node:crypto'
import { ConnectorError, http } from './http'

const hostOf = (connector: string, raw: string | undefined): { origin: string; host: string } => {
  try {
    const u = new URL(raw ?? '')
    if (u.protocol !== 'https:') throw new Error('https')
    return { origin: `${u.origin}${u.pathname.replace(/\/$/, '')}`, host: u.hostname }
  } catch {
    throw new ConnectorError(connector, 'refused')
  }
}
const num = (v: string | undefined) => (v && Number.isFinite(Number(v)) ? Number(v) : NaN)

// ------------------------------------------------------------------ modelo de AI: Anthropic Messages API
export const ANTHROPIC_HOST = 'api.anthropic.com'
export async function anthropicAsk(p: { system: string; user: string; maxTokens?: number }): Promise<{ text: string; inputTokens: number; outputTokens: number; costUsd: number }> {
  const res = await http({
    connector: 'ai', url: `https://${ANTHROPIC_HOST}/v1/messages`, allowHosts: [ANTHROPIC_HOST], timeoutMs: 60_000, minIntervalMs: 100,
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY ?? '', 'anthropic-version': '2023-06-01' },
    json: { model: process.env.AI_MODEL, max_tokens: p.maxTokens ?? 64, system: p.system, messages: [{ role: 'user', content: p.user }] },
  })
  const j = res.json<{ content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } }>()
  const inputTokens = j.usage?.input_tokens ?? 0
  const outputTokens = j.usage?.output_tokens ?? 0
  // El precio por millón de tokens lo fija el ambiente (AI_PRICE_*): no hay un precio escrito en el código.
  const costUsd = (inputTokens * num(process.env.AI_PRICE_INPUT_USD_PER_MTOK) + outputTokens * num(process.env.AI_PRICE_OUTPUT_USD_PER_MTOK)) / 1_000_000
  return { text: (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('').trim(), inputTokens, outputTokens, costUsd: Number.isFinite(costUsd) ? Number(costUsd.toFixed(6)) : 0 }
}

// ------------------------------------------------------------------ trazas: OTLP/HTTP con JSON
export type OtlpSpan = { traceId: string; spanId: string; name: string; startMs: number; endMs: number; error: boolean; attributes: Record<string, string | number> }
export async function otlpExport(spans: OtlpSpan[]): Promise<number> {
  const ep = hostOf('traces', process.env.OTEL_EXPORTER_OTLP_ENDPOINT)
  const headers: Record<string, string> = {}
  for (const pair of (process.env.OTEL_EXPORTER_OTLP_HEADERS ?? '').split(',')) {
    const i = pair.indexOf('=')
    if (i > 0) headers[pair.slice(0, i).trim().toLowerCase()] = pair.slice(i + 1).trim()
  }
  const attr = (k: string, v: string | number) => ({ key: k, value: typeof v === 'number' ? { intValue: Math.round(v) } : { stringValue: v } })
  await http({
    connector: 'traces', url: `${ep.origin}/v1/traces`, allowHosts: [ep.host], headers, attempts: 2, timeoutMs: 10_000,
    json: { resourceSpans: [{ resource: { attributes: [attr('service.name', process.env.OTEL_SERVICE_NAME || 'contigo')] }, scopeSpans: [{ scope: { name: 'contigo' }, spans: spans.map((s) => ({
      traceId: s.traceId, spanId: s.spanId, name: s.name, kind: 2, startTimeUnixNano: String(BigInt(Math.round(s.startMs)) * 1_000_000n), endTimeUnixNano: String(BigInt(Math.round(s.endMs)) * 1_000_000n),
      attributes: Object.entries(s.attributes).map(([k, v]) => attr(k, v)), status: { code: s.error ? 2 : 1 },
    })) }] }] },
  })
  return spans.length
}

// ------------------------------------------------------------------ facturación de la plataforma (Vercel, solo lectura)
export async function vercelCharges(month: string): Promise<{ label: string; amountUsd: number }[]> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new ConnectorError('billing', 'bad_request')
  const [y, m] = month.split('-').map(Number) as [number, number]
  const from = new Date(Date.UTC(y, m - 1, 1)).toISOString()
  const to = new Date(Date.UTC(y, m, 1)).toISOString()
  const q = new URLSearchParams({ from, to, teamId: process.env.VERCEL_TEAM_ID ?? '' })
  const res = await http({ connector: 'billing', url: `https://api.vercel.com/v1/billing/charges?${q}`, allowHosts: ['api.vercel.com'], headers: { authorization: `Bearer ${process.env.VERCEL_BILLING_TOKEN ?? ''}`, accept: 'application/jsonl, application/json' }, timeoutMs: 60_000 })
  // Respuesta en líneas JSON (formato FOCUS): un renglón por cargo. Se suma por servicio.
  const sums = new Map<string, number>()
  for (const line of res.text.split('\n')) {
    if (!line.trim()) continue
    let r: Record<string, unknown>
    try {
      r = JSON.parse(line) as Record<string, unknown>
    } catch {
      throw new ConnectorError('billing', 'invalid_response', res.status)
    }
    const label = String(r.ServiceName ?? r.ServiceCategory ?? 'Vercel').slice(0, 80)
    const cost = Number(r.BilledCost ?? 0)
    if (Number.isFinite(cost)) sums.set(label, (sums.get(label) ?? 0) + cost)
  }
  return [...sums].map(([label, amountUsd]) => ({ label, amountUsd: Number(amountUsd.toFixed(2)) }))
}

// ------------------------------------------------------------------ Zendesk (conteos y tickets, solo lectura)
function zendesk(): { origin: string; auth: string } {
  const sub = process.env.ZENDESK_SUBDOMAIN ?? ''
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(sub)) throw new ConnectorError('zendesk', 'refused')
  return { origin: `https://${sub}.zendesk.com`, auth: `Basic ${Buffer.from(`${process.env.ZENDESK_EMAIL ?? ''}/token:${process.env.ZENDESK_API_TOKEN ?? ''}`).toString('base64')}` }
}
export const zendeskTicketUrl = (ref: string): string | null => {
  const sub = process.env.ZENDESK_SUBDOMAIN ?? ''
  const n = ref.replace(/^#/, '')
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(sub) && /^[0-9]{1,12}$/.test(n) ? `https://${sub}.zendesk.com/agent/tickets/${n}` : null
}
/** Conteo de solicitudes abiertas y urgentes de la organización de Zendesk cuyo external_id es el comercio de CONTIGO. */
export async function zendeskCounts(accountId: string): Promise<{ open: number; urgent: number } | null> {
  const z = zendesk()
  const h = { authorization: z.auth }
  const orgs = (await http({ connector: 'zendesk', url: `${z.origin}/api/v2/organizations/search.json?external_id=${encodeURIComponent(accountId)}`, allowHosts: ['zendesk.com'], headers: h, minIntervalMs: 200 })).json<{ organizations?: { id: number }[] }>()
  const org = orgs.organizations?.[0]
  if (!org) return null
  const count = async (extra: string) => (await http({ connector: 'zendesk', url: `${z.origin}/api/v2/search/count.json?query=${encodeURIComponent(`type:ticket status<solved organization:${org.id}${extra}`)}`, allowHosts: ['zendesk.com'], headers: h, minIntervalMs: 200 })).json<{ count?: number }>().count ?? 0
  return { open: await count(''), urgent: await count(' priority:urgent') }
}
export async function zendeskProbe(): Promise<string> {
  const z = zendesk()
  const j = (await http({ connector: 'zendesk', url: `${z.origin}/api/v2/users/me.json`, allowHosts: ['zendesk.com'], headers: { authorization: z.auth } })).json<{ user?: { role?: string } }>()
  return j.user?.role ?? ''
}

// ------------------------------------------------------------------ Zoho CRM (solo lectura, OAuth con token de renovación)
const ZOHO_HOSTS = ['zoho.com', 'zohoapis.com'] as const
let zohoToken: { token: string; exp: number } | null = null
async function zohoAccess(): Promise<string> {
  if (zohoToken && zohoToken.exp > Date.now() + 60_000) return zohoToken.token
  const q = new URLSearchParams({ refresh_token: process.env.ZOHO_REFRESH_TOKEN ?? '', client_id: process.env.ZOHO_CLIENT_ID ?? '', client_secret: process.env.ZOHO_CLIENT_SECRET ?? '', grant_type: 'refresh_token' })
  const j = (await http({ connector: 'zoho', url: `https://${process.env.ZOHO_ACCOUNTS_DOMAIN || 'accounts.zoho.com'}/oauth/v2/token`, method: 'POST', allowHosts: ZOHO_HOSTS, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: q.toString() })).json<{ access_token?: string; expires_in?: number }>()
  if (!j.access_token) throw new ConnectorError('zoho', 'unauthorized')
  zohoToken = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 }
  return j.access_token
}
export const resetZohoToken = () => (zohoToken = null)
export const zohoProbe = async () => ((await zohoAccess()) ? 'token ok' : '')
export async function zohoList(module: string, maxPages = 50): Promise<Record<string, unknown>[]> {
  const token = await zohoAccess()
  const out: Record<string, unknown>[] = []
  for (let page = 1; page <= maxPages; page++) {
    const res = await http({ connector: 'zoho', url: `https://${process.env.ZOHO_API_DOMAIN || 'www.zohoapis.com'}/crm/v2/${encodeURIComponent(module)}?page=${page}&per_page=200`, allowHosts: ZOHO_HOSTS, headers: { authorization: `Zoho-oauthtoken ${token}` }, acceptStatus: [204], minIntervalMs: 100 })
    if (res.status === 204 || !res.text) break
    const j = res.json<{ data?: Record<string, unknown>[]; info?: { more_records?: boolean } }>()
    out.push(...(j.data ?? []))
    if (!j.info?.more_records) break
  }
  return out
}

// ------------------------------------------------------------------ Kore Academy (contrato propio: docs/contracts/kore-academy-completions.md)
export type KoreCompletion = { externalId: string; merchantRef: string; personName: string; courseKey: string; courseTitle: string; completedOn: string }
export async function koreCompletions(merchantRefs: string[], since: string): Promise<KoreCompletion[]> {
  const k = hostOf('kore_academy', process.env.KORE_ACADEMY_URL)
  const out: KoreCompletion[] = []
  for (let i = 0; i < merchantRefs.length; i += 100) {
    const q = new URLSearchParams({ since, merchant_refs: merchantRefs.slice(i, i + 100).join(',') })
    const j = (await http({ connector: 'kore_academy', url: `${k.origin}/v1/completions?${q}`, allowHosts: [k.host], headers: { authorization: `Bearer ${process.env.KORE_ACADEMY_TOKEN ?? ''}` } }))
      .json<{ completions?: { id?: string; merchant_ref?: string; person_name?: string; course_key?: string; course_title?: string; completed_on?: string }[] }>()
    for (const c of j.completions ?? []) {
      if (!c.id || !c.merchant_ref || !c.course_key || !c.completed_on || !/^\d{4}-\d{2}-\d{2}$/.test(c.completed_on)) continue
      out.push({ externalId: c.id.slice(0, 120), merchantRef: c.merchant_ref, personName: (c.person_name ?? '').slice(0, 120), courseKey: c.course_key.slice(0, 80), courseTitle: (c.course_title ?? c.course_key).slice(0, 200), completedOn: c.completed_on })
    }
  }
  return out
}

/** Salud de un servicio con contrato propio (Kore Academy, registro fiscal, herramienta de rutas): GET /v1/health. */
export async function contractHealth(connector: string, urlVar: string, tokenVar: string): Promise<string> {
  const k = hostOf(connector, process.env[urlVar])
  const j = (await http({ connector, url: `${k.origin}/v1/health`, allowHosts: [k.host], headers: { authorization: `Bearer ${process.env[tokenVar] ?? ''}` }, attempts: 1 })).json<{ status?: string }>()
  return j.status === 'ok' ? 'ok' : 'respuesta sin status ok'
}

// ------------------------------------------------------------------ registro fiscal (contrato genérico: docs/contracts/tax-registry.md)
export async function taxRegistryVerify(p: { type: string; country: string; id: string; legalName: string | null; postalCode: string | null }): Promise<{ status: 'match' | 'mismatch'; provider: string }> {
  const t = hostOf('tax_registry', process.env.TAX_REGISTRY_URL)
  const j = (await http({ connector: 'tax_registry', url: `${t.origin}/v1/verify`, allowHosts: [t.host], headers: { authorization: `Bearer ${process.env.TAX_REGISTRY_TOKEN ?? ''}` }, json: { type: p.type, country: p.country, id: p.id, legal_name: p.legalName, postal_code: p.postalCode } }))
    .json<{ result?: string; provider?: string }>()
  if (j.result !== 'match' && j.result !== 'mismatch') throw new ConnectorError('tax_registry', 'invalid_response')
  return { status: j.result, provider: (j.provider ?? 'tax_registry').slice(0, 60) }
}

// ------------------------------------------------------------------ herramienta de rutas (contrato genérico: docs/contracts/route-tool.md)
export async function routeToolPush(body: unknown): Promise<void> {
  const r = hostOf('routes', process.env.ROUTE_TOOL_URL)
  await http({ connector: 'routes', url: `${r.origin}/v1/stores`, method: 'PUT', allowHosts: [r.host], headers: { authorization: `Bearer ${process.env.ROUTE_TOOL_TOKEN ?? ''}` }, json: body })
}

// ------------------------------------------------------------------ firma electrónica: interfaz genérica + Dropbox Sign
export type EsignRequest = { contractId: string; title: string; signerEmail: string; signerName: string; documentUrl: string }
export interface EsignProvider { key: string; send(r: EsignRequest): Promise<{ requestId: string }>; probe(): Promise<string> }
const dsAuth = () => `Basic ${Buffer.from(`${process.env.DROPBOX_SIGN_API_KEY ?? ''}:`).toString('base64')}`
export const dropboxSign: EsignProvider = {
  key: 'dropbox_sign',
  async send(r) {
    const j = (await http({
      connector: 'esign', url: 'https://api.hellosign.com/v3/signature_request/send', allowHosts: ['api.hellosign.com'], headers: { authorization: dsAuth() }, attempts: 2,
      json: { title: r.title.slice(0, 200), subject: r.title.slice(0, 200), signers: [{ email_address: r.signerEmail, name: r.signerName, order: 0 }], file_urls: [r.documentUrl], metadata: { contract_id: r.contractId }, test_mode: process.env.ESIGN_TEST_MODE === '0' ? 0 : 1 },
    })).json<{ signature_request?: { signature_request_id?: string } }>()
    const id = j.signature_request?.signature_request_id
    if (!id) throw new ConnectorError('esign', 'invalid_response')
    return { requestId: id }
  },
  async probe() {
    const j = (await http({ connector: 'esign', url: 'https://api.hellosign.com/v3/account', allowHosts: ['api.hellosign.com'], headers: { authorization: dsAuth() } })).json<{ account?: { email_address?: string } }>()
    return j.account?.email_address ? 'ok' : ''
  },
}
/** El proveedor final lo decide la revisión de tecnología; hoy solo existe el de referencia. */
export const esignProvider = (): EsignProvider => dropboxSign

// ------------------------------------------------------------------ anti-bot: Cloudflare Turnstile (referencia)
export async function turnstileVerify(token: string): Promise<boolean> {
  const j = (await http({ connector: 'antibot', url: 'https://challenges.cloudflare.com/turnstile/v0/siteverify', method: 'POST', allowHosts: ['challenges.cloudflare.com'], headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY ?? '', response: token }).toString(), attempts: 2, timeoutMs: 8000 }))
    .json<{ success?: boolean }>()
  return j.success === true
}

// ------------------------------------------------------------------ entrega de eventos a suscriptores (HTTPS a la dirección registrada)
export function publicHttpsHost(dest: string): string | null {
  try {
    const u = new URL(dest)
    const h = u.hostname.toLowerCase()
    if (u.protocol !== 'https:' || h === 'localhost' || /^[0-9.]+$/.test(h) || h.includes(':') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.')) return null
    return h
  } catch {
    return null
  }
}
export async function deliverEvent(dest: string, body: string, headers: Record<string, string>): Promise<number> {
  const host = publicHttpsHost(dest)
  if (!host) throw new ConnectorError('event_delivery', 'egress_blocked')
  const res = await http({ connector: 'event_delivery', url: dest, allowHosts: [host], headers: { ...headers, 'content-type': 'application/json' }, body, attempts: 2, timeoutMs: 10_000 })
  return res.status
}

// ------------------------------------------------------------------ conversiones a plataformas de anuncios
export type ConversionOut = { platform: 'google' | 'meta' | 'tiktok' | 'linkedin' | 'x'; event: 'qualified_lead' | 'purchase'; click_id: string; dedupe_key: string; occurred_at: string }
export const AD_PLATFORM_VARS: Record<ConversionOut['platform'], string[]> = {
  google: ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_ADS_ACTION_QUALIFIED_LEAD', 'GOOGLE_ADS_ACTION_PURCHASE'],
  meta: ['META_PIXEL_ID', 'META_CAPI_TOKEN'],
  tiktok: ['TIKTOK_PIXEL_CODE', 'TIKTOK_ACCESS_TOKEN'],
  linkedin: ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_CONVERSION_QUALIFIED_LEAD', 'LINKEDIN_CONVERSION_PURCHASE'],
  // X pide OAuth 1.0a por cuenta de anuncios: no hay conector escrito; sus conversiones se quedan en la cola.
  x: [],
}
export const platformReady = (p: ConversionOut['platform']) => AD_PLATFORM_VARS[p].length > 0 && AD_PLATFORM_VARS[p].every((v) => (process.env[v] ?? '').trim() !== '')
const EVENT_NAME: Record<ConversionOut['event'], Record<'meta' | 'tiktok', string>> = {
  // Nombres estándar de cada plataforma. MarTech puede cambiarlos con AD_EVENT_<PLATAFORMA>_<EVENTO>.
  qualified_lead: { meta: 'Lead', tiktok: 'SubmitForm' },
  purchase: { meta: 'Purchase', tiktok: 'CompletePayment' },
}
const eventName = (p: 'meta' | 'tiktok', e: ConversionOut['event']) => process.env[`AD_EVENT_${p.toUpperCase()}_${e.toUpperCase()}`] || EVENT_NAME[e][p]
let gadsToken: { token: string; exp: number } | null = null
async function googleAdsToken(): Promise<string> {
  if (gadsToken && gadsToken.exp > Date.now() + 60_000) return gadsToken.token
  const j = (await http({ connector: 'ad_conversions', url: 'https://oauth2.googleapis.com/token', method: 'POST', allowHosts: ['googleapis.com'], headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: process.env.GOOGLE_ADS_CLIENT_ID ?? '', client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET ?? '', refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN ?? '' }).toString() })).json<{ access_token?: string; expires_in?: number }>()
  if (!j.access_token) throw new ConnectorError('ad_conversions', 'unauthorized')
  gadsToken = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 }
  return j.access_token
}
export const resetAdTokens = () => (gadsToken = null)
const secs = (iso: string) => Math.floor(new Date(iso).getTime() / 1000)
/** Manda un lote de UNA plataforma. Devuelve cuántas aceptó. */
export async function sendConversions(platform: ConversionOut['platform'], batch: ConversionOut[]): Promise<number> {
  if (batch.length === 0) return 0
  if (!platformReady(platform)) throw new ConnectorError('ad_conversions', 'refused')
  const v = process.env.META_GRAPH_VERSION || 'v21.0'
  if (platform === 'meta') {
    await http({ connector: 'ad_conversions', url: `https://graph.facebook.com/${v}/${encodeURIComponent(process.env.META_PIXEL_ID ?? '')}/events`, allowHosts: ['graph.facebook.com'],
      json: { access_token: process.env.META_CAPI_TOKEN, data: batch.map((c) => ({ event_name: eventName('meta', c.event), event_time: secs(c.occurred_at), event_id: c.dedupe_key, action_source: 'system_generated', user_data: { fbc: `fb.1.${new Date(c.occurred_at).getTime()}.${c.click_id}` } })) } })
    return batch.length
  }
  if (platform === 'tiktok') {
    await http({ connector: 'ad_conversions', url: 'https://business-api.tiktok.com/open_api/v1.3/event/track/', allowHosts: ['business-api.tiktok.com'], headers: { 'Access-Token': process.env.TIKTOK_ACCESS_TOKEN ?? '' },
      json: { event_source: 'web', event_source_id: process.env.TIKTOK_PIXEL_CODE, data: batch.map((c) => ({ event: eventName('tiktok', c.event), event_time: secs(c.occurred_at), event_id: c.dedupe_key, user: { ttclid: c.click_id } })) } })
    return batch.length
  }
  if (platform === 'linkedin') {
    for (const c of batch) {
      const conv = c.event === 'purchase' ? process.env.LINKEDIN_CONVERSION_PURCHASE : process.env.LINKEDIN_CONVERSION_QUALIFIED_LEAD
      await http({ connector: 'ad_conversions', url: 'https://api.linkedin.com/rest/conversionEvents', allowHosts: ['api.linkedin.com'], minIntervalMs: 50,
        headers: { authorization: `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN ?? ''}`, 'LinkedIn-Version': process.env.LINKEDIN_API_VERSION || '202405', 'X-Restli-Protocol-Version': '2.0.0' },
        json: { conversion: `urn:lla:llaPartnerConversion:${conv}`, conversionHappenedAt: new Date(c.occurred_at).getTime(), eventId: c.dedupe_key, user: { userIds: [{ idType: 'LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID', idValue: c.click_id }] } } })
    }
    return batch.length
  }
  // google
  const customer = (process.env.GOOGLE_ADS_CUSTOMER_ID ?? '').replace(/-/g, '')
  const token = await googleAdsToken()
  const action = (e: ConversionOut['event']) => `customers/${customer}/conversionActions/${e === 'purchase' ? process.env.GOOGLE_ADS_ACTION_PURCHASE : process.env.GOOGLE_ADS_ACTION_QUALIFIED_LEAD}`
  const when = (iso: string) => new Date(iso).toISOString().replace('T', ' ').slice(0, 19) + '+00:00'
  const j = (await http({ connector: 'ad_conversions', url: `https://googleads.googleapis.com/${process.env.GOOGLE_ADS_API_VERSION || 'v17'}/customers/${customer}:uploadClickConversions`, allowHosts: ['googleapis.com'],
    headers: { authorization: `Bearer ${token}`, 'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '' },
    json: { partialFailure: true, conversions: batch.map((c) => ({ gclid: c.click_id, conversionAction: action(c.event), conversionDateTime: when(c.occurred_at), orderId: c.dedupe_key })) } })).json<{ partialFailureError?: unknown }>()
  if (j.partialFailureError) throw new ConnectorError('ad_conversions', 'bad_request', 200)
  return batch.length
}

// ------------------------------------------------------------------ cifrado de campos: AES-256-GCM con llave versionada
/** FIELD_CRYPTO_KEYS = "v1:<32 bytes en base64>,v2:<...>"; FIELD_CRYPTO_ACTIVE = "v2". Se cifra con la activa y se lee con cualquiera. */
export function cryptoKeys(): Map<string, Buffer> {
  const out = new Map<string, Buffer>()
  for (const part of (process.env.FIELD_CRYPTO_KEYS ?? '').split(',')) {
    const [v, k] = part.split(':').map((s) => s?.trim())
    if (!v || !k || !/^v[0-9]{1,4}$/.test(v)) continue
    const buf = Buffer.from(k, 'base64')
    if (buf.length === 32) out.set(v, buf)
  }
  return out
}
export const activeKeyVersion = (): string | null => {
  const v = process.env.FIELD_CRYPTO_ACTIVE ?? ''
  return cryptoKeys().has(v) ? v : null
}
export function aesSeal(plain: string): { cipher: string; payload: string } {
  const v = activeKeyVersion()
  const key = v ? cryptoKeys().get(v) : undefined
  if (!v || !key) throw new ConnectorError('field_crypto', 'refused')
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return { cipher: `aes256gcm:${v}`, payload: Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64') }
}
export function aesOpen(cipher: string, payload: string): string {
  const v = cipher.split(':')[1] ?? ''
  const key = cryptoKeys().get(v)
  if (!key) throw new ConnectorError('field_crypto', 'refused')
  const raw = Buffer.from(payload, 'base64')
  const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
  d.setAuthTag(raw.subarray(12, 28))
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8')
}

// ------------------------------------------------------------------ push web: Web Push con VAPID (RFC 8291 y 8292)
export const PUSH_HOSTS = ['fcm.googleapis.com', 'push.services.mozilla.com', 'web.push.apple.com', 'notify.windows.com'] as const
const b64u = (b: Buffer) => b.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const fromB64u = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
export type PushSubscription = { endpoint: string; p256dh: string; auth: string }

/** Cifra el contenido para la suscripción (aes128gcm, un solo registro). */
export function encryptPush(sub: PushSubscription, payload: string): Buffer {
  const uaPublic = fromB64u(sub.p256dh)
  const authSecret = fromB64u(sub.auth)
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new ConnectorError('web_push', 'bad_request')
  const ecdh = createECDH('prime256v1')
  const asPublic = ecdh.generateKeys()
  const shared = ecdh.computeSecret(uaPublic)
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32))
  const salt = randomBytes(16)
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))
  const c = createCipheriv('aes-128-gcm', cek, nonce)
  const ct = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload, 'utf8'), Buffer.from([2])])), c.final(), c.getAuthTag()])
  const rs = Buffer.alloc(4)
  rs.writeUInt32BE(4096)
  return Buffer.concat([salt, rs, Buffer.from([65]), asPublic, ct])
}
export function vapidJwt(audience: string): string {
  const pub = fromB64u(process.env.VAPID_PUBLIC_KEY ?? '')
  const d = process.env.VAPID_PRIVATE_KEY ?? ''
  if (pub.length !== 65) throw new ConnectorError('web_push', 'refused')
  const key = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' })
  const head = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const body = b64u(Buffer.from(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: process.env.VAPID_SUBJECT })))
  const sig = cryptoSign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' })
  return `${head}.${body}.${b64u(sig)}`
}
/** Manda un aviso a una suscripción. 404 y 410: la suscripción ya no existe (quien llama la borra). */
export async function sendPush(sub: PushSubscription, payload: { title: string; body: string; link: string | null }): Promise<'sent' | 'gone'> {
  let u: URL
  try {
    u = new URL(sub.endpoint)
  } catch {
    throw new ConnectorError('web_push', 'bad_request')
  }
  const res = await http({
    connector: 'web_push', url: sub.endpoint, method: 'POST', allowHosts: PUSH_HOSTS, acceptStatus: [404, 410], attempts: 2,
    headers: { authorization: `vapid t=${vapidJwt(u.origin)}, k=${process.env.VAPID_PUBLIC_KEY}`, ttl: '86400', 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', urgency: 'normal' },
    body: encryptPush(sub, JSON.stringify({ title: payload.title.slice(0, 120), body: payload.body.slice(0, 300), link: payload.link })),
  })
  return res.status === 404 || res.status === 410 ? 'gone' : 'sent'
}
