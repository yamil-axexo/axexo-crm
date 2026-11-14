import 'server-only'
import { withUser } from '@/server/db'
import type { Ctx } from '@/server/context'
import { consumerLag, type ConsumerLag } from '@/domain/plataforma/outbox'

export type NoticeRule = { id: string; event_type: string; notice_kind: string; audience: 'owner' | 'market_leads' | 'admins'; title_es: string; title_en: string; is_active: boolean; updated_at: Date | null }
export type SecretRow = { key: string; label_es: string; label_en: string; system_name: string; owner: string | null; backup_owner_id: string | null; backup: string | null; rotate_every_days: number | null; last_rotated_on: string | null; overdue: boolean }

export async function platformAdmin(ctx: Ctx): Promise<{ rules: NoticeRule[]; secrets: SecretRow[]; people: { id: string; full_name: string }[]; lag: ConsumerLag[] }> {
  return withUser(ctx.user.id, async (tx) => {
    const rules = await tx<NoticeRule[]>`select id, event_type, notice_kind, audience, title_es, title_en, is_active, updated_at from crm.event_notice_rules order by event_type, audience`
    const secrets = ctx.can('security.read')
      ? await tx<SecretRow[]>`
          select s.key, s.label_es, s.label_en, s.system_name, o.full_name as owner, s.backup_owner_id, b.full_name as backup, s.rotate_every_days,
                 to_char(s.last_rotated_on, 'YYYY-MM-DD') as last_rotated_on,
                 coalesce(s.last_rotated_on + s.rotate_every_days <= (now() at time zone 'UTC')::date, false) as overdue
            from crm.secret_inventory s left join crm.users o on o.id = s.owner_id left join crm.users b on b.id = s.backup_owner_id order by s.key`
      : []
    const people = ctx.can('security.manage') ? await tx<{ id: string; full_name: string }[]>`select id, full_name from crm.users where is_active and not is_system order by full_name limit 300` : []
    const lag = await consumerLag(tx)
    return { rules: [...rules], secrets: [...secrets], people: [...people], lag }
  })
}
