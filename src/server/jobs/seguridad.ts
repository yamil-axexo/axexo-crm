import type { Job } from './types'
import { archiveBatchStatus, auditArchiveMode } from '@/server/adapters/audit-archive'
import { directoryGone, directoryMode } from '@/server/adapters/directory'
import { notifyMany } from '@/domain/notify'
import type { Tx } from '@/server/db'

const ALERT_TEXT: Record<string, [string, string]> = {
  exports_per_day: ['muchas exportaciones en un día', 'many exports in one day'],
  export_rows_per_day: ['muchas filas exportadas en un día', 'many rows exported in one day'],
  searches_per_hour: ['muchas búsquedas en una hora', 'many searches in one hour'],
  reveals_per_day: ['muchos datos reservados revelados en un día', 'many restricted values revealed in one day'],
  api_calls_per_hour: ['muchas llamadas con una llave en una hora', 'many calls with one key in an hour'],
  api_rows_per_day: ['muchas filas leídas con una llave en un día', 'many rows read with one key in one day'],
  key_expiring: ['una llave está por vencer', 'a key is about to expire'],
  key_unused: ['una llave lleva mucho sin uso', 'a key has gone unused for long'],
  secret_rotation_due: ['la rotación de una conexión está vencida', 'a connection’s rotation is overdue'],
  direct_sql_change: ['datos cambiados por fuera de la aplicación', 'data changed outside the application'],
}

/** Avisa de las alertas nuevas a quien lleva la bitácora (administración completa o su parte Bitácora), una sola vez por alerta. */
async function notifyNewAlerts(tx: Tx): Promise<number> {
  const fresh = await tx<{ id: string; kind: string }[]>`
    update crm.security_alerts set notified_at = now() where status = 'open' and notified_at is null returning id, kind`
  if (fresh.length === 0) return 0
  const people = await tx<{ user_id: string }[]>`
    select distinct m.user_id from crm.memberships m join crm.users u on u.id = m.user_id and u.is_active and not u.is_system
     where m.role = 'admin' and (m.admin_areas is null or 'audit' = any(m.admin_areas)) and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now())`
  const actor = (await tx<{ id: string }[]>`select app.system_user_id() as id`)[0]!
  const kinds = [...new Set(fresh.map((f) => f.kind))]
  const list = (i: 0 | 1) => kinds.map((k) => ALERT_TEXT[k]?.[i] ?? k).join('; ')
  await notifyMany(tx, { user: { id: actor.id } }, people.map((p) => p.user_id), {
    kind: 'security_alert', market: null, link: '/admin/seguridad?s=alertas',
    title: [fresh.length === 1 ? 'Hay una alerta de seguridad sin revisar' : `Hay ${fresh.length} alertas de seguridad sin revisar`, fresh.length === 1 ? 'There is a security alert to review' : `There are ${fresh.length} security alerts to review`],
    body: [`Revisa en Seguridad: ${list(0)}.`, `Review under Security: ${list(1)}.`],
  })
  return fresh.length
}

// 0031 seguridad: lo que corre por horario. Cada job se puede correr dos veces sin daño.
export const seguridadJobs: Job[] = [
  {
    key: 'seguridad.alertas',
    everyMinutes: 60,
    description: { es: 'Revisa exportaciones, búsquedas, revelados y uso de llaves contra los umbrales y abre alertas.', en: 'Checks exports, searches, reveals and key use against the thresholds and opens alerts.' },
    run: async (tx) => {
      const done = (await tx<{ n: number }[]>`select app.security_scan() as n`)[0]?.n ?? 0
      const notified = await notifyNewAlerts(tx)
      return { done, note: notified ? `${notified} alertas avisadas` : undefined }
    },
  },
  {
    key: 'seguridad.copia_bitacora',
    everyMinutes: 24 * 60,
    description: { es: 'Arma el lote diario de la bitácora con su huella. Con el destino apagado, el lote queda en la cola.', en: 'Builds the daily audit log batch with its fingerprint. With the destination off, the batch stays queued.' },
    run: async (tx) => {
      const n = (await tx<{ n: number }[]>`select app.audit_archive_prepare(${archiveBatchStatus()}) as n`)[0]?.n ?? 0
      return { done: n, note: auditArchiveMode() === 'off' ? 'Canal apagado: lotes en cola' : 'Simulado' }
    },
  },
  {
    key: 'seguridad.retencion',
    everyMinutes: 24 * 60,
    description: { es: 'Aplica las reglas de retención que estén encendidas (anonimizar o archivar).', en: 'Applies the retention rules that are turned on (anonymize or archive).' },
    run: async (tx) => {
      const rules = await tx<{ key: string }[]>`select key from crm.retention_rules where is_active and after_days is not null`
      let done = 0
      for (const r of rules) done += (await tx<{ n: number }[]>`select app.retention_apply(${r.key}) as n`)[0]?.n ?? 0
      return { done, note: `${rules.length} reglas encendidas` }
    },
  },
  {
    key: 'seguridad.directorio',
    everyMinutes: 60,
    description: { es: 'Quita el acceso a quien ya no tiene cuenta en el directorio de Google. Apagado hasta su revisión técnica.', en: 'Removes access from people who no longer have an account in the Google directory. Off until its technical review.' },
    run: async (tx) => {
      const gone = await directoryGone()
      if (gone === null) return { done: 0, note: 'Canal apagado' }
      if (gone.length === 0) return { done: 0, note: directoryMode() }
      const rows = await tx<{ user_id: string }[]>`
        update crm.memberships m set valid_to = now() from crm.users u
         where u.id = m.user_id and lower(u.email::text) = any(${gone}::text[]) and not u.is_system and (m.valid_to is null or m.valid_to > now())
           and not (m.role = 'admin' and m.admin_areas is null and not exists (
                 select 1 from crm.memberships o join crm.users ou on ou.id = o.user_id and ou.is_active and not ou.is_system
                  where o.role = 'admin' and o.admin_areas is null and o.valid_to is null and o.id <> m.id and lower(ou.email::text) <> all(${gone}::text[])))
        returning m.user_id`
      const users = [...new Set(rows.map((r) => r.user_id))]
      for (const id of users) {
        await tx`insert into crm.audit_events (actor_id, action, object, object_id, after)
                 values (app.current_user_id(), 'membership.ended_by_directory', 'user', ${id}, ${tx.json({ reason: 'account_not_in_directory' })})`
      }
      return { done: users.length, note: directoryMode() }
    },
  },
]
