import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { deployedVersion, env, ssoEnabled } from '@/env'
import { getStatus, getConfig } from '@/dal/admin'
import { closeRuleChanges } from '@/dal/b2b'
import { marketAdapterStatus } from '@/server/adapters/markets'
import { pipedriveConfigured } from '@/server/adapters/pipedrive'
import { deliveryMode } from '@/server/adapters/event-delivery'
import { antibotMode } from '@/server/adapters/antibot'
import { REPORT_ADAPTERS, channelMode } from '@/server/adapters/report-channels'
import { adapterQueue } from '@/dal/reportes'
import { routesAdapter } from '@/server/adapters/routes'
import { auditArchiveMode, AUDIT_ARCHIVE_ENV } from '@/server/adapters/audit-archive'
import { directoryMode, DIRECTORY_ENV } from '@/server/adapters/directory'
import { fieldCryptoMode, FIELD_CRYPTO_ENV } from '@/server/adapters/field-crypto'
import { salesFileAdapter } from '@/server/adapters/sales-file'
import { adConversionsAdapter } from '@/server/adapters/ad-conversions'
import { supportDeskAdapter } from '@/server/adapters/support-desk'
import { readerTimeZone } from '@/server/timezone'
import { Badge, Card, CardTitle, PageHeader, Stat } from '@/ui/kit'
import { TimezoneSync } from '@/ui/admin'
import { day, dayTime, num } from '@/lib/format'
import { zoneLabel } from '@/lib/audit'
import { NOT_YET, UNDEFINED_ITEMS } from '@/content/status'
import { channelStatus } from '@/server/adapters/channels'
import { CHANNEL_LABEL } from '@/lib/notice-kinds'
import Link from 'next/link'
import { serviceBoard } from '@/dal/gobierno'
import { gobiernoAdapterStatus } from '@/server/gobierno-status'
import { tracesAdapter } from '@/server/adapters/traces'
import { billingAdapter } from '@/server/adapters/billing'
import { OBJECTIVE_LABEL, msText } from '@/lib/gobierno-labels'
import { partnersAdapterStatus } from '@/server/adapters/partners'
import { externalQueueCounts } from '@/dal/partners'

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
  // Cómo se gana cada embudo y quién cambió esa regla por última vez (queda en la bitácora con cuántos negocios abiertos tocó).
  const [config, ruleChanges] = await Promise.all([getConfig(ctx), closeRuleChanges(ctx)])
  const e = env()
  const routes = routesAdapter()
  // GOB-07: objetivos de servicio medidos, de los últimos 30 días. El detalle y los registros viven en Administración, Gobierno.
  const board = ctx.can('gov.read') ? await serviceBoard(ctx, 30) : null
  const salesFile = salesFileAdapter()
  const adConv = adConversionsAdapter()
  const desk = supportDeskAdapter()
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

  const reportQueue = await adapterQueue(ctx)
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
      state: !pipedriveConfigured() ? { tone: 'neutral', text: t('Sin conectar: falta el token', 'Not connected: the token is missing') }
        : s.pipedrive ? { tone: 'good', text: t('Conexión configurada', 'Connection configured') } : { tone: 'neutral', text: t('Conexión configurada, importación sin correr', 'Connection configured, import not run yet') },
      last: s.pipedrive
        ? [t(`Última importación: ${when(s.pipedrive.finished_at ?? s.pipedrive.started_at)}`, `Last import: ${when(s.pipedrive.finished_at ?? s.pipedrive.started_at)}`), mode[s.pipedrive.mode ?? ''] ? t(...mode[s.pipedrive.mode ?? '']!) : '', runState[s.pipedrive.status] ? t(...runState[s.pipedrive.status]!) : ''].filter(Boolean).join(', ')
        : t('Importación sin correr: todavía no se ha copiado nada de Pipedrive', 'Import not run: nothing has been copied from Pipedrive yet'),
    },
    {
      key: 's5',
      name: t('Datos de ventas', 'Sales data'),
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
      key: 'routes',
      name: t('Herramienta de rutas', 'Route tool'),
      what: t('Tiendas de cada persona para planear su ruta', 'Each person’s stores to plan their route'),
      state: routes.mode === 'off' ? { tone: 'neutral', text: t('Adaptador apagado', 'Adapter off') } : { tone: 'warn', text: t('Simulado (solo pruebas)', 'Simulated (tests only)') },
      last: t(`La lista de tiendas por persona ya se arma dentro de CONTIGO. Para encenderlo hace falta elegir la herramienta, su aprobación de tecnología y la variable ${routes.envVar}.`, `The store list per person is already built inside CONTIGO. Turning it on needs the tool chosen, its technology approval and the ${routes.envVar} variable.`),
    },
    {
      key: 'sales_file',
      name: t('Archivo de ventas: ir a buscarlo', 'Sales file: fetching it'),
      what: t('Primer fondeo y método, primera transacción, hábito y correcciones', 'First funding and method, first transaction, habit and corrections'),
      state: salesFile.mode === 'off' ? { tone: 'neutral', text: t('Adaptador apagado', 'Adapter off') } : { tone: 'warn', text: t('Simulado (solo pruebas)', 'Simulated (tests only)') },
      last: t(`Hoy el archivo entra cuando alguien lo entrega por la API. Para que CONTIGO vaya por él hace falta que Data y Reportería confirme el contrato con fondeo y método y dónde deja el archivo, la aprobación de tecnología y la variable ${salesFile.envVar}.`, `Today the file comes in when someone delivers it through the API. For CONTIGO to fetch it, Data and Reporting must confirm the contract with funding and method and where the file is left, plus technology approval and the ${salesFile.envVar} variable.`),
    },
    {
      key: 'ad_conversions',
      name: t('Conversiones a plataformas de anuncios', 'Conversions to ad platforms'),
      what: t('Lead calificado y primera transacción para Google, Meta, TikTok, LinkedIn y X', 'Qualified lead and first transaction for Google, Meta, TikTok, LinkedIn and X'),
      state: adConv.mode === 'off' ? { tone: 'neutral', text: t('Canal apagado', 'Channel off') } : { tone: 'warn', text: t('Simulado (solo pruebas)', 'Simulated (tests only)') },
      last: t(`Las conversiones se guardan en cola y no sale nada. Para encenderlo hace falta, por plataforma, la cuenta de anuncios y su credencial, la aprobación de tecnología y la variable ${adConv.envVar}.`, `Conversions are queued and nothing leaves. Turning it on needs, per platform, the ad account and its credential, technology approval and the ${adConv.envVar} variable.`),
    },
    {
      key: 'support_desk',
      name: t('Mesa de soporte (tickets)', 'Support desk (tickets)'),
      what: t('Tickets como referencia en el hilo del comercio', 'Tickets as a reference in the merchant thread'),
      state: desk.mode === 'off' ? { tone: 'neutral', text: t('Adaptador apagado', 'Adapter off') } : { tone: 'warn', text: t('Simulado (solo pruebas)', 'Simulated (tests only)') },
      last: t(`La referencia (número y asunto) la escribe una persona y el estado es el que ella pone. Para traer el estado y abrir el ticket desde aquí hace falta la dirección de la mesa de soporte, su aprobación de tecnología y la variable ${desk.envVar}.`, `The reference (number and subject) is typed by a person and the status is whatever they set. Fetching the status and opening the ticket from here needs the support desk address, its technology approval and the ${desk.envVar} variable.`),
    },
    {
      key: 'outbox',
      name: t('Eventos para otros sistemas', 'Events for other systems'),
      what: t('Lo que CONTIGO publica para que otros lo lean', 'What CONTIGO publishes for others to read'),
      state: deliveryMode() === 'simulated' ? { tone: 'warn', text: t('Simulado (pruebas)', 'Simulated (tests)') } : { tone: 'neutral', text: t('Canal apagado', 'Channel off') },
      last: t(`${num(s.outbox_pending, locale)} guardados, listos para publicar. Para encenderlo: aprobación del transporte, llave de firma y la variable CONTIGO_EVENT_DELIVERY`, `${num(s.outbox_pending, locale)} stored, ready to publish. To turn it on: transport approval, signing key and the CONTIGO_EVENT_DELIVERY variable`),
    },
    {
      key: 'antibot',
      name: t('Verificación anti-bot de formularios', 'Anti-bot check on forms'),
      what: t('Un desafío para distinguir personas de programas', 'A challenge to tell people from programs'),
      state: antibotMode() === 'simulated' ? { tone: 'warn', text: t('Simulado (pruebas)', 'Simulated (tests)') } : { tone: 'neutral', text: t('Canal apagado', 'Channel off') },
      last: t('Activos sin él: límite por dirección, tiempo mínimo y campo trampa. Para encenderlo: aprobar el servicio y la variable CONTIGO_ANTIBOT', 'On without it: per-address limit, minimum time and trap field. To turn it on: approve the service and set the CONTIGO_ANTIBOT variable'),
    },
    // Canales de avisos (paquete avisos): construidos y apagados. Cada uno dice qué falta para encenderlo.
    ...channelStatus().map((c) => ({
      key: `channel_${c.channel}`,
      name: t(`Avisos por ${CHANNEL_LABEL[c.channel][0]}`, `Notices by ${CHANNEL_LABEL[c.channel][1]}`),
      what: t('Canal de salida. Dentro de CONTIGO los avisos ya llegan.', 'Outgoing channel. Inside CONTIGO notices already arrive.'),
      state: c.mode === 'off' ? { tone: 'neutral' as Tone, text: t('Apagado', 'Off') } : { tone: 'warn' as Tone, text: t('Simulado (pruebas)', 'Simulated (tests)') },
      last: `${t(...c.needs)} ${t(`Se enciende con la variable ${c.envVar}, después de la aprobación.`, `It is turned on with the ${c.envVar} variable, after approval.`)}`,
    })),
    // Archivo de salida de Reportes: construido y apagado. El correo de reportes programados es el canal de correo de Avisos.
    ...REPORT_ADAPTERS.map((a) => {
      const q = reportQueue.find((x) => x.channel === a.key)
      return {
        key: a.key,
        name: t(a.name[0], a.name[1]),
        what: t(a.what[0], a.what[1]),
        state: channelMode(a.key) === 'simulated' ? { tone: 'neutral' as Tone, text: t('Simulado (solo pruebas)', 'Simulated (tests only)') } : { tone: 'neutral' as Tone, text: t('Canal apagado', 'Channel off') },
        last: t(`${num(q?.n ?? 0, locale)} en cola sin salir. Para encenderlo: ${a.needs[0]}`, `${num(q?.n ?? 0, locale)} queued, not sent. To turn it on: ${a.needs[1]}`),
      }
    }),
    // Adaptadores del paquete de mercados: construidos y apagados. Cada uno dice qué falta para encenderlo.
    ...marketAdapterStatus().map((a) => ({
      key: `adapter_${a.key}`,
      name: t(...a.name),
      what: t(...a.what),
      state: a.mode === 'ready' ? { tone: 'good' as const, text: t('Lista', 'Ready') } : a.mode === 'simulated' ? { tone: 'warn' as const, text: t('Simulado (pruebas)', 'Simulated (tests)') } : { tone: 'neutral' as const, text: a.mode === 'missing' ? t('Apagada: falta la llave', 'Off: the key is missing') : t('Apagado', 'Off') },
      last: a.mode === 'ready' ? t('La llave está en el ambiente.', 'The key is in the environment.') : `${t(...a.needs)} ${t(`Se enciende con la variable ${a.envVar}, después de la aprobación.`, `It is turned on with the ${a.envVar} variable, after approval.`)}`,
    })),
  ]
  // Seguridad (0027): tres salidas construidas y apagadas. Cada una dice qué hace CONTIGO mientras tanto y qué falta para encenderla.
  const offOr = (m: string): { tone: Tone; text: string } => (m === 'simulated' ? { tone: 'warn', text: t('Simulado (pruebas)', 'Simulated (tests)') } : { tone: 'neutral', text: t('Canal apagado', 'Channel off') })
  rows.push(
    {
      key: 'audit_archive',
      name: t('Copia de la bitácora fuera de la base', 'Audit log copy outside the database'),
      what: t('Lote diario con su huella', 'Daily batch with its fingerprint'),
      state: offOr(auditArchiveMode()),
      last: t(`Mientras tanto la bitácora vive en la base, en un esquema aparte que nadie edita, y cada lote queda en cola. Para encenderlo: un destino aprobado en la revisión técnica y la variable ${AUDIT_ARCHIVE_ENV}`, `Meanwhile the log lives in the database, in a separate schema nobody can edit, and each batch stays queued. To turn it on: a destination approved in the technology review and the ${AUDIT_ARCHIVE_ENV} variable`),
    },
    {
      key: 'directory',
      name: t('Directorio de Google', 'Google directory'),
      what: t('Quita el acceso cuando la cuenta deja de existir', 'Removes access when the account stops existing'),
      state: offOr(directoryMode()),
      last: t(`Mientras tanto: reporte de accesos sin uso y revisión periódica de accesos en Seguridad. Para encenderlo: una cuenta de servicio de solo lectura del directorio, su aprobación y la variable ${DIRECTORY_ENV}`, `Meanwhile: unused access report and periodic access review under Security. To turn it on: a read-only directory service account, its approval and the ${DIRECTORY_ENV} variable`),
    },
    {
      key: 'field_crypto',
      name: t('Cifrado de datos reservados con llaves gestionadas', 'Encryption of restricted data with managed keys'),
      what: t('Cifra cada dato reservado antes de guardarlo', 'Encrypts each restricted value before storing it'),
      state: offOr(fieldCryptoMode()),
      last: t(`Mientras tanto los datos reservados están en una tabla sin lectura directa, se muestran tapados y cada revelado queda registrado. Para encenderlo: el servicio de llaves aprobado y la variable ${FIELD_CRYPTO_ENV}`, `Meanwhile restricted data sits in a table with no direct read, is shown masked and every reveal is logged. To turn it on: the approved key service and the ${FIELD_CRYPTO_ENV} variable`),
    },
  )
  // Paquete partners-contratos: firma electrónica, entrada de externos y captura de correo, calendario y WhatsApp. Construidos y apagados.
  const partnerQueue = await externalQueueCounts(ctx)
  rows.push(...partnersAdapterStatus().map((a) => ({
    key: `partners_${a.key}`,
    name: t(...a.name),
    what: t(...a.what),
    state: offOr(a.mode),
    last: `${t(...a.needs)} ${t(`${num(partnerQueue[a.key] ?? 0, locale)} en cola sin salir. Se enciende con la variable ${a.envVar}, después de la aprobación.`, `${num(partnerQueue[a.key] ?? 0, locale)} queued, not sent. It is turned on with the ${a.envVar} variable, after approval.`)}`,
  })))
  // Tareas programadas: corren con la app en uso; el disparo externo por horario solo existe si el ambiente trae su secreto.
  rows.push({
    key: 'jobs',
    name: t('Tareas programadas', 'Scheduled jobs'),
    what: t('Disparo externo por horario', 'External scheduled trigger'),
    state: e.CRON_SECRET ? { tone: 'good', text: t('Encendido', 'On') } : { tone: 'neutral', text: t('Apagado: falta el secreto', 'Off: the secret is missing') },
    last: e.CRON_SECRET
      ? t('La plataforma llama a la ruta de tareas con el secreto configurado', 'The platform calls the jobs route with the configured secret')
      : t('Para encenderlo: configurar CRON_SECRET y que la plataforma llame a la ruta cada minuto. Mientras tanto corren con la app en uso', 'To turn it on: set CRON_SECRET and have the platform call the route every minute. Meanwhile they run while the app is in use'),
  })

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
          value={<span className="text-[18px] leading-7 md:text-[20px]">{version.commit ? version.commit.slice(0, 7) : t('Entorno local, sin versión', 'Local environment, no version')}</span>}
          hint={version.commit ? (version.ref ? t(`Rama ${version.ref}`, `Branch ${version.ref}`) : undefined) : t('El commit aparece aquí cuando el despliegue lo deja en el ambiente; en staging y producción la plataforma lo pone sola.', 'The commit shows here when the deployment leaves it in the environment; on staging and production the platform sets it on its own.')}
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
        {board && (
          <Card data-testid="status-slo">
            <CardTitle title={t('Objetivos de servicio, últimos 30 días', 'Service objectives, last 30 days')} hint={t('Medido por CONTIGO: pantallas abiertas, cambios guardados y llamadas a la API. El objetivo lo fija una persona; sin objetivo dice "Por definir".', 'Measured by CONTIGO: screens opened, changes saved and API calls. A person sets the objective; with none it says "To be defined".')}
              right={<Link href="/admin/gobierno" className="inline-flex min-h-11 items-center text-[14px] font-medium text-blue-text underline" data-testid="status-gov-link">{t('Abrir Gobierno', 'Open Governance')}</Link>} />
            <ul>
              {board.objectives.filter((o) => o.kind === 'slo').map((o) => {
                const m = o.key === 'latency_page' ? board.page : o.key === 'latency_action' ? board.action : board.api
                const value = o.key === 'availability' ? (board.availability === null ? t('Sin mediciones todavía', 'No measurements yet') : `${board.availability}%`) : msText(t, m.p95)
                const ok = o.target === null ? null : o.key === 'availability' ? (board.availability === null ? null : board.availability >= o.target) : m.p95 === null ? null : m.p95 <= o.target
                return (
                  <li key={o.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line py-3 first:border-t-0" data-testid={`status-slo-${o.key}`}>
                    <span className="min-w-0 flex-1 basis-48"><span className="block text-[14px] font-medium text-strong">{t(...OBJECTIVE_LABEL[o.key]!.label)}</span><span className="text-[12.5px] text-muted-2">{t(...OBJECTIVE_LABEL[o.key]!.hint)}</span></span>
                    <span className="flex flex-wrap items-center gap-2 text-[14px]"><span className="font-semibold text-strong" data-testid="status-slo-value">{value}</span>
                      {o.target === null ? <Badge tone="warn">{t('Objetivo por definir', 'Objective to be defined')}</Badge> : ok === null ? <Badge>{t('Sin mediciones', 'No measurements')}</Badge> : ok ? <Badge tone="good">{t('Se cumple', 'Met')}</Badge> : <Badge tone="bad">{t('No se cumple', 'Not met')}</Badge>}
                    </span>
                  </li>
                )
              })}
            </ul>
            <p className="mt-3 text-[13px] text-muted-2" data-testid="status-slo-errors">{t(`${num(board.errorCount, locale)} ${board.errorCount === 1 ? 'error inesperado' : 'errores inesperados'} en 30 días. Cada uno tiene su referencia en Gobierno.`, `${num(board.errorCount, locale)} unexpected ${board.errorCount === 1 ? 'error' : 'errors'} in 30 days. Each has its reference in Governance.`)}</p>
          </Card>
        )}
        <Card data-testid="status-gov-adapters">
          <CardTitle title={t('Conexiones de operación, apagadas', 'Operating connections, turned off')} hint={t('Están construidas y no llaman a nada. Cada una dice qué falta para encenderla.', 'They are built and call nothing. Each one says what is missing to turn it on.')} />
          <ul>
            {gobiernoAdapterStatus(tracesAdapter(), billingAdapter()).map((a) => (
              <li key={a.key} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-t border-line py-3 first:border-t-0" data-testid={`status-adapter-${a.key}`}>
                <span className="min-w-0 flex-1 basis-60"><span className="block text-[14px] font-medium text-strong">{t(...a.name)}</span><span className="text-[12.5px] text-muted-2">{t(...a.needs)}</span></span>
                <Badge>{a.mode === 'off' ? t('Apagado', 'Off') : t('Simulado (pruebas)', 'Simulated (tests)')}</Badge>
              </li>
            ))}
          </ul>
        </Card>
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

        <Card data-testid="status-close-rules">
          <CardTitle title={t('Cómo se gana cada embudo', 'How each pipeline is won')} hint={t('La regla de cierre vigente y los últimos cambios. Cambiarla aplica desde ese momento a los negocios abiertos.', 'The current closing rule and the latest changes. Changing it applies from that moment to open deals.')} />
          <ul>
            {config.pipelines.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line py-3 text-[14px] first:border-t-0" data-testid="status-close-rule">
                <span className="font-medium text-strong">{p.market_code} · {p.name}</span>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={p.close_by_transaction || p.txn_also_wins ? 'info' : 'neutral'}>{p.close_by_transaction ? t('Con la primera transacción', 'By the first transaction') : p.txn_also_wins ? t('Con contrato firmado o primera transacción', 'By signed contract or first transaction') : t('A mano', 'By hand')}</Badge>
                  <span className="text-[13px] text-muted-2">{t(`${num(p.open_deals, locale)} ${p.open_deals === 1 ? 'negocio abierto' : 'negocios abiertos'}`, `${num(p.open_deals, locale)} open ${p.open_deals === 1 ? 'deal' : 'deals'}`)}</span>
                </span>
              </li>
            ))}
          </ul>
          {ruleChanges.length > 0 ? (
            <ul className="mt-4 space-y-1.5 text-[13.5px] text-muted-2" data-testid="status-rule-changes">
              {ruleChanges.map((c, i) => (
                <li key={i} data-testid="status-rule-change">
                  {t(
                    `${when(c.at.toISOString())}: ${c.actor ?? 'Alguien'} cambió "${c.pipeline ?? 'un embudo'}" a ${c.by_transaction ? 'ganar con la primera transacción' : 'ganar a mano'}${c.open_deals !== null ? `; aplicó a ${c.open_deals === 1 ? '1 negocio abierto' : `${num(c.open_deals, locale)} negocios abiertos`}` : ''}.`,
                    `${when(c.at.toISOString())}: ${c.actor ?? 'Someone'} changed "${c.pipeline ?? 'a pipeline'}" to ${c.by_transaction ? 'won by the first transaction' : 'won by hand'}${c.open_deals !== null ? `; it applied to ${c.open_deals === 1 ? '1 open deal' : `${num(c.open_deals, locale)} open deals`}` : ''}.`,
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-[13.5px] text-muted-2">{t('Nadie ha cambiado una regla de cierre todavía.', 'Nobody has changed a closing rule yet.')}</p>
          )}
        </Card>

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
