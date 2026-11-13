import type { Job } from './types'
import { calendarCaptureAdapter, gmailCaptureAdapter, type RawCapture } from '@/server/adapters/partners'
import { auditArchiveMode, uploadArchiveBatch } from '@/server/adapters/audit-archive'
import { activeCipher, open, seal } from '@/server/adapters/field-crypto'
import { ingestMailAndMeetings } from '@/domain/conectores/capture'
import { errorCode } from '@/server/adapters/live/http'

/**
 * Paquete conectores: lo que corre por horario cuando un conector está encendido. Apagados, no hacen nada y lo dicen.
 * Las tres se pueden correr dos veces: la captura no repite (fuente + referencia), la copia solo sube lotes en cola y la
 * rotación solo toca lo que no tiene la llave activa.
 */
export const conectoresJobs: Job[] = [
  {
    key: 'conectores.captura',
    everyMinutes: 15,
    description: {
      es: 'Lee los metadatos de correo y calendario de quien encendió su captura y liga a los comercios solo lo que es con contactos conocidos. Apagada, no lee nada.',
      en: 'Reads email and calendar metadata from people who turned on their capture and links to merchants only what involves known contacts. Off, it reads nothing.',
    },
    run: async (tx) => {
      const gm = gmailCaptureAdapter()
      const cal = calendarCaptureAdapter()
      if (gm.mode === 'off' && cal.mode === 'off') return { done: 0, note: 'Canal apagado' }
      const sys = (await tx<{ id: string }[]>`select app.system_user_id() as id`)[0]!.id
      const owners = await tx<{ user_id: string; email: string; gmail: boolean; calendar: boolean; last_pull: Date | null }[]>`select * from app.capture_owners()`
      const items: RawCapture[] = []
      const errors: string[] = []
      for (const o of owners) {
        const since = o.last_pull ?? new Date(Date.now() - 86_400_000)
        try {
          if (o.gmail && gm.mode !== 'off') items.push(...(await gm.pull([o.email], since)))
          if (o.calendar && cal.mode !== 'off') items.push(...(await cal.pull([o.email], since)))
          await tx`update crm.capture_mailboxes set last_pull = now() where user_id = ${o.user_id}`
        } catch (e) {
          errors.push(errorCode(e))
        }
      }
      // Simulada (pruebas): lo que la prueba dejó preparado, sin buzones.
      if (owners.length === 0 && (gm.mode === 'simulated' || cal.mode === 'simulated')) items.push(...(await gm.pull()), ...(await cal.pull()))
      const r = await ingestMailAndMeetings(tx, sys, items, new Map(owners.map((o) => [o.email, o.user_id])))
      if (r.linked > 0) await tx`insert into crm.audit_events (actor_id, action, object, after) values (${sys}, 'capture.ingested', 'capture', ${tx.json({ linked: r.linked, discarded: r.discarded, duplicates: r.duplicates })})`
      return { done: r.linked, note: `ligadas ${r.linked}, descartadas ${r.discarded}, repetidas ${r.duplicates}${errors.length ? `, errores: ${[...new Set(errors)].join(' ')}` : ''}` }
    },
  },
  {
    key: 'conectores.copia_bitacora',
    everyMinutes: 60,
    description: {
      es: 'Con la copia de la bitácora encendida, sube los lotes en cola al bucket privado y guarda la huella del archivo. Apagada, los lotes siguen en cola.',
      en: 'With the audit log copy on, uploads queued batches to the private bucket and stores the file fingerprint. Off, batches stay queued.',
    },
    run: async (tx) => {
      if (auditArchiveMode() !== 'live') return { done: 0, note: 'Canal apagado' }
      const queue = await tx<{ id: number; log_name: string }[]>`select id::int as id, log_name from app.audit_archive_queue()`
      let done = 0
      for (const b of queue) {
        const content = (await tx<{ c: string }[]>`select app.audit_archive_content(${b.id}) as c`)[0]?.c ?? ''
        try {
          const up = await uploadArchiveBatch({ id: b.id, log_name: b.log_name, content })
          await tx`select app.audit_archive_sent(${b.id}, ${up.ref}, ${up.sha256})`
          done++
        } catch (e) {
          return { done, note: `Falló: ${errorCode(e)}` }
        }
      }
      return { done, note: `${done} lotes subidos` }
    },
  },
  {
    key: 'conectores.rotar_llaves',
    everyMinutes: 60,
    description: {
      es: 'Con el cifrado de campos encendido, vuelve a cifrar con la llave activa los datos reservados que tienen una llave vieja o ninguna.',
      en: 'With field encryption on, re-encrypts with the active key the restricted values that have an old key or none.',
    },
    run: async (tx) => {
      const active = activeCipher()
      if (!active) return { done: 0, note: 'Cifrado apagado' }
      const rows = await tx<{ account_id: string; field_key: string; value: string; cipher: string }[]>`select * from app.sensitive_rotation_batch(${active}, 200)`
      let done = 0
      for (const r of rows) {
        const sealed = seal(open(r.cipher, r.value))
        const ok = (await tx<{ ok: boolean }[]>`select app.sensitive_rotate(${r.account_id}, ${r.field_key}, ${r.cipher}, ${sealed.payload}, ${sealed.cipher}) as ok`)[0]?.ok
        if (ok) done++
      }
      return { done, note: `con ${active}` }
    },
  },
]
