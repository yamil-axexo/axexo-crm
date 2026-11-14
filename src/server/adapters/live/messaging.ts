import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { ConnectorError, http } from './http'

// ------------------------------------------------------------------ Slack (chat.postMessage con token de bot)
export const SLACK_HOSTS = ['slack.com'] as const
export async function slackPost(channel: string, text: string): Promise<{ ts: string }> {
  if (!/^[A-Z0-9#@][A-Za-z0-9._-]{1,79}$/.test(channel)) throw new ConnectorError('slack', 'bad_request')
  const res = await http({
    connector: 'slack', url: 'https://slack.com/api/chat.postMessage', allowHosts: SLACK_HOSTS, minIntervalMs: 1000,
    headers: { authorization: `Bearer ${process.env.SLACK_BOT_TOKEN ?? ''}`, 'content-type': 'application/json; charset=utf-8' },
    json: { channel, text: text.slice(0, 3900), unfurl_links: false, unfurl_media: false },
  })
  // Slack contesta 200 con ok:false para los errores de negocio.
  const j = res.json<{ ok: boolean; error?: string; ts?: string }>()
  if (!j.ok) throw new ConnectorError('slack', j.error === 'ratelimited' ? 'rate_limited' : j.error === 'invalid_auth' || j.error === 'not_authed' ? 'unauthorized' : 'bad_request', res.status)
  return { ts: j.ts ?? '' }
}
/** Con un correo, primero encuentra a la persona en Slack (users.lookupByEmail) y le escribe directo. */
export async function slackLookupAndPost(to: string, text: string): Promise<{ ts: string }> {
  if (!to.includes('@')) return slackPost(to, text)
  const res = await http({ connector: 'slack', url: `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(to)}`, allowHosts: SLACK_HOSTS, minIntervalMs: 1000, headers: { authorization: `Bearer ${process.env.SLACK_BOT_TOKEN ?? ''}` } })
  const j = res.json<{ ok: boolean; error?: string; user?: { id?: string } }>()
  if (!j.ok || !j.user?.id) throw new ConnectorError('slack', j.error === 'users_not_found' ? 'not_found' : 'bad_request', res.status)
  return slackPost(j.user.id, text)
}
export async function slackAuthTest(): Promise<string> {
  const res = await http({ connector: 'slack', url: 'https://slack.com/api/auth.test', method: 'POST', allowHosts: SLACK_HOSTS, headers: { authorization: `Bearer ${process.env.SLACK_BOT_TOKEN ?? ''}` } })
  const j = res.json<{ ok: boolean; team?: string }>()
  if (!j.ok) throw new ConnectorError('slack', 'unauthorized', res.status)
  return j.team ?? ''
}

// ------------------------------------------------------------------ WhatsApp Cloud API (solo plantillas aprobadas)
export const META_HOSTS = ['graph.facebook.com'] as const
const graph = () => `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || 'v21.0'}`
export type WaTemplate = { name: string; locale: string; params: string[] }
export async function whatsappSendTemplate(p: { phoneNumberId: string; to: string; template: WaTemplate }): Promise<{ id: string }> {
  if (!/^\+?[1-9][0-9]{6,14}$/.test(p.to)) throw new ConnectorError('whatsapp', 'bad_request')
  if (!/^[0-9]{5,20}$/.test(p.phoneNumberId)) throw new ConnectorError('whatsapp', 'bad_request')
  const res = await http({
    connector: 'whatsapp', url: `${graph()}/${p.phoneNumberId}/messages`, allowHosts: META_HOSTS, minIntervalMs: 20,
    headers: { authorization: `Bearer ${process.env.WHATSAPP_TOKEN ?? ''}` },
    json: {
      messaging_product: 'whatsapp', to: p.to.replace(/^\+/, ''), type: 'template',
      template: { name: p.template.name, language: { code: p.template.locale }, components: p.template.params.length ? [{ type: 'body', parameters: p.template.params.map((t) => ({ type: 'text', text: t.slice(0, 1000) })) }] : [] },
    },
  })
  return { id: res.json<{ messages?: { id: string }[] }>().messages?.[0]?.id ?? '' }
}
export async function whatsappProbe(phoneNumberId: string): Promise<string> {
  const res = await http({ connector: 'whatsapp', url: `${graph()}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number`, allowHosts: META_HOSTS, headers: { authorization: `Bearer ${process.env.WHATSAPP_TOKEN ?? ''}` } })
  return res.json<{ display_phone_number?: string }>().display_phone_number ?? ''
}

// ------------------------------------------------------------------ webhook entrante de WhatsApp: firma y mensajes
/** X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(cuerpo crudo, WHATSAPP_APP_SECRET). Comparación en tiempo constante. */
export function verifyMetaSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret || !header.startsWith('sha256=')) return false
  const want = Buffer.from(createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex'), 'utf8')
  const got = Buffer.from(header.slice(7), 'utf8')
  return want.length === got.length && timingSafeEqual(want, got)
}
export type InboundWa = { id: string; from: string; phoneNumberId: string; timestamp: string; type: string; text: string | null }
/** Solo lo necesario del mensaje: quién, cuándo, por qué número y el texto (que no se guarda completo). */
export function parseWhatsappWebhook(body: unknown): InboundWa[] {
  const out: InboundWa[] = []
  const entries = (body as { entry?: unknown[] })?.entry
  if (!Array.isArray(entries)) return out
  for (const e of entries) {
    for (const c of ((e as { changes?: unknown[] }).changes ?? []) as { value?: { metadata?: { phone_number_id?: string }; messages?: { id?: string; from?: string; timestamp?: string; type?: string; text?: { body?: string } }[] } }[]) {
      const pn = c.value?.metadata?.phone_number_id ?? ''
      for (const m of c.value?.messages ?? []) {
        if (!m.id || !m.from || !m.timestamp) continue
        out.push({ id: m.id, from: `+${m.from.replace(/^\+/, '')}`, phoneNumberId: pn, timestamp: new Date(Number(m.timestamp) * 1000).toISOString(), type: m.type ?? 'unknown', text: m.text?.body ?? null })
      }
    }
  }
  return out
}
