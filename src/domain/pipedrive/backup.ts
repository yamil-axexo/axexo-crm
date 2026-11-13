import 'server-only'
import { createHash } from 'node:crypto'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { audit } from '@/domain/common'
import { scrub } from './mapping'

/**
 * E6.F4: respaldo fuera de línea de lo importado de Pipedrive. Todo lo que hay en la copia cruda (crm.import_raw) sale en
 * un solo archivo JSON con formato documentado (docs/pipedrive-migration.md, "Respaldo"): encabezado con fecha, quién lo
 * bajó y conteo por objeto, y un registro por objeto de Pipedrive con su carga útil tal como llegó. Cada descarga queda en
 * la bitácora y en crm.pipedrive_backups con su huella. Dueño del respaldo: [pendiente: Yamil].
 */
export const BACKUP_FORMAT = 'contigo-pipedrive-backup/v1'

const clean = (v: unknown): unknown =>
  typeof v === 'string' ? scrub(v) : Array.isArray(v) ? v.map(clean) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)])) : v

export type Backup = { json: string; fileName: string; rows: number; sha256: string }

export async function pipedriveBackup(ctx: Ctx): Promise<Backup> {
  ctx.assert('pipedrive.backup')
  return withUser(ctx.user.id, async (tx) => {
    const rows = await tx<{ object: string; external_id: string; parent_ref: string | null; fetched_at: Date; loaded_at: Date | null; payload: unknown }[]>`
      select object, external_id, parent_ref, fetched_at, loaded_at, payload from crm.import_raw where source = 'pipedrive' order by object, external_id`
    const counts: Record<string, number> = {}
    for (const r of rows) counts[r.object] = (counts[r.object] ?? 0) + 1
    const generatedAt = new Date().toISOString()
    const json = JSON.stringify({
      format: BACKUP_FORMAT, source: 'pipedrive', generated_at: generatedAt, generated_by: ctx.user.email, rows: rows.length, counts,
      records: rows.map((r) => ({ object: r.object, external_id: r.external_id, parent_ref: r.parent_ref, fetched_at: r.fetched_at, loaded_at: r.loaded_at, payload: clean(r.payload) })),
    })
    const sha256 = createHash('sha256').update(json).digest('hex')
    await tx`insert into crm.pipedrive_backups (created_by, rows, objects, sha256) values (${ctx.user.id}, ${rows.length}, ${tx.json(counts)}, ${sha256})`
    await audit(tx, ctx, 'pipedrive.backup_downloaded', 'import_run', null, null, null, { rows: rows.length, sha256, format: BACKUP_FORMAT })
    return { json, fileName: `contigo-respaldo-pipedrive-${generatedAt.slice(0, 10)}.json`, rows: rows.length, sha256 }
  })
}
