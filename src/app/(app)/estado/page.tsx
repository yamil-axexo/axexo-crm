import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { deployedVersion, env, ssoEnabled } from '@/env'
import { getStatus } from '@/dal/admin'
import { pipedriveConfigured } from '@/server/adapters/pipedrive'
import { readerTimeZone } from '@/server/timezone'
import { Badge, Card, CardTitle, PageHeader, Stat } from '@/ui/kit'
import { TimezoneSync } from '@/ui/admin'
import { day, dayTime, num } from '@/lib/format'
import { zoneLabel } from '@/lib/audit'
import { NOT_YET, UNDEFINED_ITEMS } from '@/content/status'

export const dynamic = 'force-dynamic'

type Tone = 'good' | 'warn' | 'neutral'

/**
 * Página de estado: qué corre, qué tan al día están los datos, qué está conectado y qué falta.
 * La ven administración y leadership. Todo sale de la propia herramienta al abrir la página; lo que nadie ha
 * definido se muestra como "Por definir".
 */
export default async function StatusPage() {
  const ctx = await requireCtx()
  if (!ctx.can('status.read')) notFound()
  const { t, locale } = ctx
  const [s, tz] = [await getStatus(ctx), await readerTimeZone(ctx)]
  const e = env()
  const version = deployedVersion()
  const when = (d: string | null | undefined) => (d ? dayTime(d, locale, tz) : null)
  const envName: Record<string, [string, string]> = {
    production: ['Producción', 'Production'],
    staging: ['Staging', 'Staging'],
    test: ['Pruebas automáticas', 'Automated tests'],
    development: ['Desarrollo', 'Development'],
  }
  const lastMigration = s.migrations[s.migrations.length - 1]
  const mode: Record<string, [string, string]> = { full: ['completa', 'full'], delta: ['solo lo que cambió', 'only what changed'], remap: ['mapeo aplicado de nuevo', 'mapping re-applied'] }
  const runState: Record<string, [string, string]> = { done: ['terminó bien', 'finished'], running: ['en curso', 'running'], failed: ['falló', 'failed'], cancelled: ['se detuvo', 'stopped'] }
  const test = t(' (fue una prueba desde Administración)', ' (it was a test from Administration)')

  // Una integración que recibe datos está conectada cuando hay una llave vigente para ella y ya llegó algo que no fue una prueba.
  const inbound = (keys: number, last: { simulated: boolean } | null): { tone: Tone; text: string } =>
    keys === 0
      ? { tone: 'neutral', text: t('Sin conectar', 'Not connected') }
      : last && !last.simulated
        ? { tone: 'good', text: t('Conectada', 'Connected') }
        : { tone: 'warn', text: t('Llave creada, sin datos reales todavía', 'Key created, no real data yet') }

  const rows: { key: string; name: string; what: string; state: { tone: Tone; text: string }; last: string }[] = [
    {
      key: 'google',
      name: t('Ingreso con Google', 'Google sign-in'),
      what: t('Cómo entra cada persona', 'How each person signs in'),
      state: ssoEnabled() ? { tone: 'good', text: t('Conectado', 'Connected') } : { tone: 'neutral', text: t('Sin conectar', 'Not connected') },
      last: ssoEnabled() ? t('Solo cuentas de la organización', 'Organization accounts only') : t('Este ambiente entra con personas de prueba', 'This environment signs in with test personas'),
    },
    {
      key: 'pipedrive',
      name: 'Pipedrive',
      what: t('Importación a mano, solo lectura', 'Manual import, read-only'),
      state: pipedriveConfigured() ? { tone: 'good', text: t('Conectado', 'Connected') } : { tone: 'neutral', text: t('Sin conectar: falta el token', 'Not connected: the token is missing') },
      last: s.pipedrive
        ? [t(`Última importación: ${when(s.pipedrive.finished_at ?? s.pipedrive.started_at)}`, `Last import: ${when(s.pipedrive.finished_at ?? s.pipedrive.started_at)}`), mode[s.pipedrive.mode ?? ''] ? t(...mode[s.pipedrive.mode ?? '']!) : '', runState[s.pipedrive.status] ? t(...runState[s.pipedrive.status]!) : ''].filter(Boolean).join(', ')
        : t('Nunca se ha importado', 'Never imported'),
    },
    {
      key: 's5',
      name: 'S5',
      what: t('Archivo diario de ventas por comercio', 'Daily sales file per merchant'),
      state: inbound(s.keys['metrics:write'] ?? 0, s.s5),
      last: s.s5 ? t(`Último archivo: corte del ${day(s.s5.as_of, locale)}, cargado el ${when(s.s5.loaded_at)}${s.s5.simulated ? test : ''}`, `Last file: as of ${day(s.s5.as_of, locale)}, loaded ${when(s.s5.loaded_at)}${s.s5.simulated ? test : ''}`) : t('No ha llegado ningún archivo', 'No file has arrived'),
    },
    {
      key: 'sales_app',
      name: 'Sales App',
      what: t('Visitas y puntos de venta nuevos', 'Visits and new stores'),
      state: inbound(s.keys['events:write'] ?? 0, s.sales_app),
      last: s.sales_app ? t(`Último evento: ${when(s.sales_app.received_at)}${s.sales_app.simulated ? test : ''}`, `Last event: ${when(s.sales_app.received_at)}${s.sales_app.simulated ? test : ''}`) : t('No ha llegado ningún evento', 'No event has arrived'),
    },
    {
      key: 'web_forms',
      name: t('Formularios web', 'Web forms'),
      what: t(`${s.forms} ${s.forms === 1 ? 'formulario activo' : 'formularios activos'}`, `${s.forms} active ${s.forms === 1 ? 'form' : 'forms'}`),
      state: s.forms > 0 ? { tone: 'good', text: (s.keys['forms:write'] ?? 0) > 0 ? t('Página y API listas', 'Page and API ready') : t('Página lista; API sin llave', 'Page ready; API has no key') } : { tone: 'neutral', text: t('Sin formularios', 'No forms') },
      last: s.web_forms ? t(`Último lead web: ${when(s.web_forms.received_at)}`, `Last web lead: ${when(s.web_forms.received_at)}`) : t('No ha llegado ningún lead web', 'No web lead has arrived'),
    },
    {
      key: 'outbox',
      name: t('Avisos a otros sistemas', 'Notices to other systems'),
      what: t('Lo que CONTIGO publica para que otros lo lean', 'What CONTIGO publishes for others to read'),
      state: { tone: 'neutral', text: t('Sin conectar', 'Not connected') },
      last: t(`${num(s.outbox_pending, locale)} guardados; nadie los recoge todavía`, `${num(s.outbox_pending, locale)} stored; nobody picks them up yet`),
    },
  ]

  return (
    <>
      <TimezoneSync current={tz} />
      <PageHeader
        title={t('Estado de CONTIGO', 'CONTIGO status')}
        desc={t('Qué está corriendo, qué tan al día están los datos y qué falta. Se arma con datos de la propia herramienta cada vez que abres esta página.', 'What is running, how fresh the data is and what is missing. It is built from the tool’s own data every time you open this page.')}
      />
      <div className="grid grid-cols-2 gap-4 desk:grid-cols-4" data-testid="status-top">
        <Stat testId="status-env" label={t('Ambiente', 'Environment')} value={<span className="text-[18px] leading-7 md:text-[20px]">{t(...(envName[e.APP_ENV] ?? [e.APP_ENV, e.APP_ENV]))}</span>} />
        <Stat
          testId="status-version"
          label={t('Versión desplegada', 'Deployed version')}
          value={<span className="text-[18px] leading-7 md:text-[20px]">{version.commit ? version.commit.slice(0, 7) : t('Sin dato', 'No data')}</span>}
          hint={version.commit ? (version.ref ? t(`Rama ${version.ref}`, `Branch ${version.ref}`) : undefined) : t('Este despliegue no dejó su versión en el ambiente.', 'This deployment did not leave its version in the environment.')}
        />
        <Stat
          testId="status-db"
          label={t('Base de datos', 'Database')}
          value={<span className="text-[18px] leading-7 md:text-[20px]">{t(`${s.migrations.length} migraciones`, `${s.migrations.length} migrations`)}</span>}
          hint={lastMigration ? t(`Última: ${lastMigration.name}, aplicada el ${when(lastMigration.applied_at)}`, `Latest: ${lastMigration.name}, applied ${when(lastMigration.applied_at)}`) : undefined}
        />
        <Stat
          testId="status-people"
          label={t('Personas con acceso', 'People with access')}
          value={<span className="text-[18px] leading-7 md:text-[20px]">{num(s.people.with_access, locale)}</span>}
          hint={t(`${num(s.people.active_14d, locale)} entraron en los últimos 14 días`, `${num(s.people.active_14d, locale)} signed in during the last 14 days`)}
        />
      </div>
      <p className="mt-3 text-[13px] text-muted-2" data-testid="status-zone">{t(`Las horas están en ${zoneLabel(tz, locale)}.`, `Times are in ${zoneLabel(tz, locale)}.`)}</p>

      <div className="mt-8 space-y-8">
        <Card pad={false} data-testid="status-integrations">
          <div className="px-5 pt-6 md:px-7 md:pt-7"><CardTitle title={t('Datos e integraciones', 'Data and integrations')} hint={t('De dónde llegan los datos, si la conexión está viva y cuándo llegó lo último.', 'Where the data comes from, whether the connection is live and when the latest arrived.')} /></div>
          <ul className="border-t border-line">
            {rows.map((r) => (
              <li key={r.key} className="grid grid-cols-1 gap-x-6 gap-y-2 border-b border-line px-5 py-4 last:border-b-0 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.6fr)] md:items-center md:px-7" data-testid={`status-row-${r.key}`}>
                <span className="min-w-0"><span className="block text-[15px] font-semibold text-strong">{r.name}</span><span className="text-[12.5px] text-muted-2">{r.what}</span></span>
                <span data-testid="status-state"><span className={`inline-block rounded-[10px] px-2.5 py-1 text-[13px] font-medium ${r.state.tone === 'good' ? 'bg-green-100 text-brand-text' : r.state.tone === 'warn' ? 'bg-warn-bg text-amber-text' : 'bg-surface-3 text-muted-2'}`}>{r.state.text}</span></span>
                <span className="min-w-0 text-[13.5px] text-muted-2 [overflow-wrap:anywhere]" data-testid="status-last">{r.last}</span>
              </li>
            ))}
          </ul>
        </Card>

        <div className="grid grid-cols-1 items-start gap-8 desk:grid-cols-2">
          <Card data-testid="status-admins">
            <CardTitle title={t('Quién administra', 'Who administers')} hint={t('Las personas que pueden dar accesos, crear llaves de API y cambiar la configuración.', 'The people who can grant access, create API keys and change the configuration.')} />
            <ul className="space-y-2.5">
              {s.admins.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-[14px]" data-testid="status-admin">
                  <span className="font-medium text-strong">{a.full_name}</span>
                  {a.expires ? <Badge tone="warn">{t(`vence el ${day(a.expires, locale)}`, `expires ${day(a.expires, locale)}`)}</Badge> : <Badge>{t('sin vencimiento', 'no expiry')}</Badge>}
                </li>
              ))}
            </ul>
          </Card>
          <Card data-testid="status-undefined">
            <CardTitle title={t('Por definir', 'To be defined')} hint={t('Datos de operación que nadie ha fijado todavía. Aquí no se inventa un valor.', 'Operating facts nobody has set yet. No value is made up here.')} />
            <ul>
              {UNDEFINED_ITEMS.map((u) => (
                <li key={u.key} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-t border-line py-3 first:border-t-0" data-testid="status-undefined-row">
                  <span className="min-w-0 flex-1 basis-48"><span className="block text-[14px] font-medium text-strong">{t(...u.label)}</span><span className="text-[12.5px] text-muted-2">{t(...u.why)}</span></span>
                  <Badge tone="warn">{t('Por definir', 'To be defined')}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <Card data-testid="status-not-yet">
          <CardTitle title={t('Lo que todavía no está', 'What is not there yet')} hint={t('Para responderle al equipo sin prometer de más.', 'So you can answer the team without overpromising.')} />
          <div className="grid grid-cols-1 gap-x-10 gap-y-6 desk:grid-cols-2">
            {NOT_YET.map((g) => (
              <section key={g.group[1]}>
                <h3 className="text-[14px] font-semibold text-strong">{t(...g.group)}</h3>
                <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[13.5px] text-muted-2">
                  {g.items.map((i) => <li key={i[1]}>{t(...i)}</li>)}
                </ul>
              </section>
            ))}
          </div>
        </Card>

        <Card data-testid="status-migrations">
          <details>
            <summary className="flex min-h-11 cursor-pointer items-center text-[15px] font-semibold text-strong">{t(`Migraciones aplicadas a la base (${s.migrations.length})`, `Migrations applied to the database (${s.migrations.length})`)}</summary>
            <ul className="mt-3 space-y-1.5 text-[13.5px]">
              {s.migrations.map((m) => <li key={m.name} className="flex flex-wrap justify-between gap-x-4" data-testid="status-migration"><code className="text-[12.5px] text-strong">{m.name}</code><span className="text-muted-2">{when(m.applied_at)}</span></li>)}
            </ul>
          </details>
        </Card>
      </div>
    </>
  )
}
