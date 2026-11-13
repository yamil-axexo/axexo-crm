import 'server-only'
import { withSystem, type Tx } from '@/server/db'
import { notify, peopleWithRole } from '@/domain/notify'

/**
 * E5.F3 / E5.F4 / E5.F5: cargas visibles. Toda carga (Pipedrive, datos de ventas, cifras por tienda, Sales App,
 * importaciones de hojas) pasa por aquí:
 *  - deja inicio y fin en crm.load_runs;
 *  - no corre dentro de la ventana de mantenimiento de ninguno de sus mercados;
 *  - nunca corre junto con otra carga (la base admite una sola fila "running"; una carga colgada más de 2 horas se da por caída);
 *  - si falla, avisa a su responsable (o a administración si no tiene) por el servicio de avisos;
 *  - al terminar con algo hecho, publica qué hizo (aviso a su responsable y "Estado de CONTIGO").
 * La revisión de las que no llegaron a su hora la hace la tarea `integraciones2.load_watch`. La Sales App no corre por lotes:
 * sus eventos entran sueltos por la API; cuenta como llegada si hoy entró al menos uno, y su detalle está en Integraciones.
 */
export const LOAD_KEYS = ['pipedrive', 'sales_file', 'store_sales', 'sales_app', 'imports'] as const
export type LoadKey = (typeof LOAD_KEYS)[number]
export type LoadTrigger = 'cron' | 'visit' | 'manual' | 'api' | 'watch'
export const STALE_RUNNING_MINUTES = 180

export type LoadStart = { status: 'started'; runId: string } | { status: 'busy'; running: string } | { status: 'paused'; markets: string[] }

/** Mercados de la carga que hoy están en su ventana de mantenimiento. */
export async function pausedMarkets(tx: Tx, key: string): Promise<string[]> {
  const rows = await tx<{ code: string }[]>`
    select m.code from crm.markets m, crm.data_loads l
     where l.key = ${key} and (cardinality(l.markets) = 0 or m.code = any(l.markets)) and app.in_maintenance(m.code)
     order by m.code`
  return rows.map((r) => r.code)
}

/** Abre la carga. Si está en ventana queda anotada como "en pausa"; si otra corre, no abre nada. */
export async function startLoad(tx: Tx, key: LoadKey, trigger: LoadTrigger, actorId: string | null): Promise<LoadStart> {
  const paused = await pausedMarkets(tx, key)
  if (paused.length) {
    // Una sola fila de pausa por hora y carga: la bitácora no se llena de intentos.
    await tx`insert into crm.load_runs (load_key, trigger, status, finished_at, note, actor_id)
             select ${key}, ${trigger}, 'paused', now(), ${'maintenance_window:' + paused.join(',')}, ${actorId}
              where not exists (select 1 from crm.load_runs where load_key = ${key} and status = 'paused' and started_at > now() - interval '1 hour')`
    return { status: 'paused', markets: paused }
  }
  await tx`update crm.load_runs set status = 'failed', finished_at = now(), error = 'abandoned'
            where status = 'running' and started_at < now() - make_interval(mins => ${STALE_RUNNING_MINUTES})`
  const sp = await tx.savepoint(async (s) => {
    const r = await s<{ id: string }[]>`insert into crm.load_runs (load_key, trigger, actor_id) values (${key}, ${trigger}, ${actorId}) returning id`
    return r[0]!.id
  }).catch(() => null)
  if (sp) return { status: 'started', runId: sp }
  const running = await tx<{ load_key: string }[]>`select load_key from crm.load_runs where status = 'running' limit 1`
  return { status: 'busy', running: running[0]?.load_key ?? 'unknown' }
}

type Label = { label_es: string; label_en: string; owner_id: string | null }
async function loadInfo(tx: Tx, key: string): Promise<Label> {
  return (await tx<Label[]>`select label_es, label_en, owner_id from crm.data_loads where key = ${key}`)[0] ?? { label_es: key, label_en: key, owner_id: null }
}
/** El responsable de la carga; sin responsable, administración. */
async function owners(tx: Tx, info: Label): Promise<string[]> {
  if (info.owner_id) return [info.owner_id]
  return (await peopleWithRole(tx, null, ['admin'])).slice(0, 5)
}

/** Cierra la carga, deja lo que hizo y avisa: siempre si falló; si salió bien, solo cuando hizo algo. */
export async function finishLoad(tx: Tx, runId: string, out: { ok: true; done: number; note?: string } | { ok: false; error: string }, actorId: string): Promise<void> {
  const rows = await tx<{ load_key: string }[]>`
    update crm.load_runs set status = ${out.ok ? 'ok' : 'failed'}, finished_at = now(), done = ${out.ok ? out.done : 0},
           note = ${out.ok ? (out.note?.slice(0, 500) ?? null) : null}, error = ${out.ok ? null : out.error.slice(0, 80)}
     where id = ${runId} and status = 'running' returning load_key`
  const key = rows[0]?.load_key
  if (!key) return
  if (out.ok && out.done === 0) return
  const info = await loadInfo(tx, key)
  for (const to of await owners(tx, info)) {
    await notify(tx, { user: { id: actorId } }, out.ok
      ? { to, kind: 'data_load', market: null, link: '/estado', needsAction: false,
          title: [`${info.label_es}: terminó`, `${info.label_en}: finished`],
          body: [`Registros procesados: ${out.done}.${out.note ? ` ${out.note}` : ''}`, `Records processed: ${out.done}.${out.note ? ` ${out.note}` : ''}`] }
      : { to, kind: 'data_load', market: null, link: '/estado', needsAction: true,
          title: [`${info.label_es}: falló`, `${info.label_en}: failed`],
          body: [`La carga se detuvo y no dejó nada a medias. Código: ${out.error}. Revísala en Estado de CONTIGO.`, `The load stopped and left nothing half done. Code: ${out.error}. Check it in CONTIGO status.`] })
  }
}

/** Cierra la carga abierta de esa llave, si la hay (cargas por pasos, como la de Pipedrive). */
export async function finishOpenLoad(tx: Tx, key: LoadKey, out: { ok: true; done: number; note?: string } | { ok: false; error: string }, actorId: string): Promise<void> {
  const open = await tx<{ id: string }[]>`select id from crm.load_runs where load_key = ${key} and status = 'running'`
  if (open[0]) await finishLoad(tx, open[0].id, out, actorId)
}

/** Para una carga que se abre desde la pantalla: el motivo en palabras si no puede empezar. */
export function loadBlocked(start: LoadStart): [es: string, en: string] | null {
  if (start.status === 'busy') return ['Otra carga de datos está corriendo. Espera a que termine e inténtalo de nuevo.', 'Another data load is running. Wait for it to finish and try again.']
  if (start.status === 'paused') return [`${start.markets.join(', ')} está en su ventana de mantenimiento: no corre ninguna carga. Inténtalo al terminar la ventana.`, `${start.markets.join(', ')} is in its maintenance window: no load runs. Try again after the window.`]
  return null
}

/** Corre una carga completa fuera del corredor (Pipedrive, importaciones): abre, corre, cierra y avisa. */
export async function withLoad<T extends { done: number; note?: string }>(key: LoadKey, trigger: LoadTrigger, actorId: string | null, fn: () => Promise<T>): Promise<T | LoadStart> {
  const start = await withSystem((tx) => startLoad(tx, key, trigger, actorId))
  if (start.status !== 'started') return start
  try {
    const out = await fn()
    await withSystem((tx, sys) => finishLoad(tx, start.runId, { ok: true, done: out.done, note: out.note }, sys))
    return out
  } catch (e) {
    const x = e as { code?: unknown; name?: unknown }
    const error = String(x?.code ?? x?.name ?? 'error').replace(/[^\w.:-]/g, '').slice(0, 80) || 'error'
    await withSystem((tx, sys) => finishLoad(tx, start.runId, { ok: false, error }, sys)).catch(() => undefined)
    throw e
  }
}

/**
 * E5.F3: cargas que no llegaron a su hora. Una carga con hora esperada que hoy (en el reloj de su mercado) ya pasó esa hora
 * sin una corrida buena queda anotada como "no llegó" y su responsable recibe un aviso, una sola vez al día.
 */
export async function watchLateLoads(tx: Tx, actorId: string): Promise<number> {
  const late = await tx<{ key: string; label_es: string; label_en: string; owner_id: string | null; expected: string }[]>`
    select l.key, l.label_es, l.label_en, l.owner_id, to_char(l.expected_by, 'HH24:MI') as expected
      from crm.data_loads l join crm.markets m on m.code = l.clock_market
     where l.expected_by is not null
       and (now() at time zone m.timezone)::time > l.expected_by
       and not exists (select 1 from crm.load_runs r where r.load_key = l.key and r.status in ('ok','late')
                          and (r.started_at at time zone m.timezone)::date = (now() at time zone m.timezone)::date)
       -- La Sales App manda eventos sueltos todo el día: llegó si hoy entró al menos uno.
       and not (l.key = 'sales_app' and exists (select 1 from crm.inbound_events e where e.source = 'sales_app'
                  and (e.received_at at time zone m.timezone)::date = (now() at time zone m.timezone)::date))`
  for (const l of late) {
    await tx`insert into crm.load_runs (load_key, trigger, status, finished_at, note) values (${l.key}, 'watch', 'late', now(), ${'expected_by:' + l.expected})`
    for (const to of await owners(tx, l))
      await notify(tx, { user: { id: actorId } }, {
        to, kind: 'data_load', market: null, link: '/estado', needsAction: true,
        title: [`${l.label_es}: no llegó a su hora`, `${l.label_en}: did not arrive on time`],
        body: [`Debía terminar a las ${l.expected} y hoy no hay una carga buena. Revisa con quien la envía.`, `It was due by ${l.expected} and there is no good load today. Check with whoever sends it.`],
      })
  }
  return late.length
}
