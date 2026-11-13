import type { Ctx } from '@/server/context'
import { withUser } from '@/server/db'
import { Badge, Card, CardTitle } from '@/ui/kit'
import { p95 } from '@/dal/gobierno'
import { msText } from '@/lib/gobierno-labels'
import { num } from '@/lib/format'
import { consumerLag } from '@/domain/plataforma/outbox'
import type { RealtimeMode } from '@/server/adapters/realtime'
import { allowedHosts, blockedEgress } from '@/server/net/egress'
import { mcpMode } from '@/server/adapters/ai'

const row = 'flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-t border-line py-3 first:border-t-0'

/** Lo que el paquete plataforma muestra en Estado de CONTIGO: velocidad medida, valores pendientes con su dueño, cola y conexiones. */
export async function StagingBanner({ ctx }: { ctx: Ctx }) {
  const { t } = ctx
  // GOB-08: mientras el ambiente de pruebas tenga datos reales, se dice arriba de todo.
  const rows = await withUser(ctx.user.id, (tx) => tx<{ value: unknown }[]>`select value from crm.platform_values where key = 'staging_has_real_data'`)
  if (rows[0]?.value !== true) return null
  return (
    <p role="status" className="mb-6 rounded-[14px] bg-warn-bg px-5 py-4 text-[14px] font-medium text-amber-text" data-testid="status-real-data">
      {t('Este ambiente de pruebas tiene datos reales. No compartas capturas ni lo uses para demostraciones hasta que pase a datos sintéticos (docs/runbooks/staging-a-datos-sinteticos.md).', 'This test environment holds real data. Do not share screenshots or use it for demos until it moves to synthetic data (docs/runbooks/staging-a-datos-sinteticos.md).')}
    </p>
  )
}

export async function PlatformCard({ ctx, realtime: rt }: { ctx: Ctx; realtime: { mode: RealtimeMode; missing: string[] } }) {
  const { t, locale } = ctx
  const { speed, pending, recovery, lag } = await withUser(ctx.user.id, async (tx) => {
    const speed = await tx<{ screen: string; n: number; buckets: number[] }[]>`
      select screen, sum(n)::int as n,
             array[sum(buckets[1]), sum(buckets[2]), sum(buckets[3]), sum(buckets[4]), sum(buckets[5]), sum(buckets[6])]::int[] as buckets
        from crm.request_metrics where screen in ('buscar', 'telefono') and day > (now() at time zone 'UTC')::date - 30 group by screen`
    const pending = await tx<{ key: string; label_es: string; label_en: string; owner_label: string }[]>`select key, label_es, label_en, owner_label from crm.platform_values where proposed order by key`
    const recovery = await tx<{ key: string; target: string | null }[]>`select key, target::text from crm.service_objectives where kind = 'recovery' order by position`
    const lag = await consumerLag(tx)
    return { speed, pending, recovery, lag }
  })
  const sp = (k: string) => speed.find((s) => s.screen === k)
  const realtime = rt.mode
  const blocked = blockedEgress().length
  return (
    <Card data-testid="status-platform">
      <CardTitle title={t('Velocidad, pendientes y cola de eventos', 'Speed, pending values and event queue')} hint={t('Medido por CONTIGO en el servidor y en el navegador, últimos 30 días. Lo que todavía es propuesta dice quién lo decide.', 'Measured by CONTIGO on the server and in the browser, last 30 days. What is still a proposal says who decides it.')} />
      <ul>
        <li className={row} data-testid="status-p95-search">
          <span className="min-w-0 flex-1 basis-60"><span className="block text-[14px] font-medium text-strong">{t('Búsqueda, en el servidor (p95)', 'Search, on the server (p95)')}</span><span className="text-[12.5px] text-muted-2">{t(`${num(sp('buscar')?.n ?? 0, locale)} búsquedas medidas`, `${num(sp('buscar')?.n ?? 0, locale)} searches measured`)}</span></span>
          <Badge tone={sp('buscar') ? 'info' : 'neutral'}>{msText(t, sp('buscar') ? p95(sp('buscar')!.buckets) : null)}</Badge>
        </li>
        <li className={row} data-testid="status-p95-phone">
          <span className="min-w-0 flex-1 basis-60"><span className="block text-[14px] font-medium text-strong">{t('Abrir una pantalla en teléfono (p95)', 'Opening a screen on a phone (p95)')}</span><span className="text-[12.5px] text-muted-2">{t('Medido en el teléfono de cada persona. La meta en Android de gama baja la fija C1 en el piloto.', 'Measured on each person’s phone. The target on low-end Android is set by C1 in the pilot.')}</span></span>
          <Badge tone={sp('telefono') ? 'info' : 'neutral'}>{msText(t, sp('telefono') ? p95(sp('telefono')!.buckets) : null)}</Badge>
        </li>
        {recovery.filter((r) => r.target === null).map((r) => (
          <li key={r.key} className={row} data-testid="status-pending-value">
            <span className="min-w-0 flex-1 basis-60 text-[14px] font-medium text-strong">{r.key === 'rpo_minutes' ? t('Pérdida de datos aceptable (RPO)', 'Acceptable data loss (RPO)') : r.key === 'rto_minutes' ? t('Tiempo para volver (RTO)', 'Time to recover (RTO)') : t('Cada cuánto se prueba restaurar', 'How often restore is tested')}</span>
            <Badge tone="warn">{t('Pendiente: Dan Mulligan', 'Pending: Dan Mulligan')}</Badge>
          </li>
        ))}
        {pending.map((p) => (
          <li key={p.key} className={row} data-testid="status-pending-value">
            <span className="min-w-0 flex-1 basis-60 text-[14px] font-medium text-strong">{t(p.label_es, p.label_en)}</span>
            <Badge tone="warn">{t(`Valor propuesto, pendiente: ${p.owner_label}`, `Proposed value, pending: ${p.owner_label}`)}</Badge>
          </li>
        ))}
        <li className={row} data-testid="status-realtime">
          <span className="min-w-0 flex-1 basis-60"><span className="block text-[14px] font-medium text-strong">{t('Pantallas en vivo por Broadcast', 'Live screens over Broadcast')}</span><span className="text-[12.5px] text-muted-2">{realtime === 'live' ? t('Encendido.', 'On.') : t(`Las pantallas se actualizan solas leyendo la cola dentro de CONTIGO. Para Broadcast falta: ${rt.missing.join(', ')} (sign-off de Dan Mulligan o Michael Essiet).`, `Screens refresh by reading the queue inside CONTIGO. Broadcast needs: ${rt.missing.join(', ')} (sign-off from Dan Mulligan or Michael Essiet).`)}</span></span>
          <Badge tone={realtime === 'live' ? 'good' : 'neutral'}>{realtime === 'live' ? t('Encendido', 'On') : realtime === 'simulated' ? t('Simulado (pruebas)', 'Simulated (tests)') : t('Apagado', 'Off')}</Badge>
        </li>
        <li className={row} data-testid="status-egress">
          <span className="min-w-0 flex-1 basis-60"><span className="block text-[14px] font-medium text-strong">{t('Lista de salida a internet', 'Internet egress list')}</span><span className="text-[12.5px] text-muted-2">{t(`Todo lo que sale pasa por un solo cliente que solo deja ir a ${allowedHosts().length} hosts de proveedores. Falta el mismo control en la red de la plataforma (Dan Mulligan o Michael Essiet).`, `Everything that goes out passes through a single client that only allows ${allowedHosts().length} provider hosts. The same control on the platform network is pending (Dan Mulligan or Michael Essiet).`)}</span></span>
          <Badge tone={blocked > 0 ? 'warn' : 'good'}>{blocked > 0 ? t(`${blocked} intentos bloqueados`, `${blocked} attempts blocked`) : t('Sin bloqueos', 'No blocks')}</Badge>
        </li>
        <li className={row} data-testid="status-mcp-oauth">
          <span className="min-w-0 flex-1 basis-60"><span className="block text-[14px] font-medium text-strong">{t('Agentes que leen como una persona (OAuth con PKCE)', 'Agents that read as a person (OAuth with PKCE)')}</span><span className="text-[12.5px] text-muted-2">{t('Construido. Se enciende con el servidor MCP (MCP_SERVER) y la revisión de tecnología.', 'Built. It turns on with the MCP server (MCP_SERVER) and the technology review.')}</span></span>
          <Badge tone={mcpMode() === 'off' ? 'neutral' : 'info'}>{mcpMode() === 'off' ? t('Apagado', 'Off') : t('Simulado (pruebas)', 'Simulated (tests)')}</Badge>
        </li>
        {lag.map((c) => (
          <li key={c.consumer} className={row} data-testid={`status-consumer-${c.consumer}`}>
            <span className="min-w-0 flex-1 basis-60 text-[14px] font-medium text-strong">{c.consumer === 'automations' ? t('Cola: automatizaciones por evento', 'Queue: event automations') : c.consumer === 'notices' ? t('Cola: avisos por evento', 'Queue: event notices') : t('Cola: pantallas en vivo', 'Queue: live screens')}</span>
            <Badge tone={c.pending > 500 ? 'warn' : 'neutral'}>{t(`${num(c.pending, locale)} por leer`, `${num(c.pending, locale)} to read`)}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  )
}
