import { num, type Locale, type T } from '@/lib/format'

// Cómo se dice en pantalla lo que alguien tiene sin dueño vigente. Lo usan Mi equipo y Administración: una sola redacción.
type Held = { owner_id: string | null; full_name: string | null; is_active: boolean | null; accounts: number; deals: number; leads: number }

const many = (t: T, locale: Locale, n: number, one: [string, string], other: [string, string]) => `${num(n, locale)} ${n === 1 ? t(one[0], one[1]) : t(other[0], other[1])}`

/** "26 comercios, 6 negocios abiertos y 5 leads abiertos" */
export function heldList(t: T, locale: Locale, h: Pick<Held, 'accounts' | 'deals' | 'leads'>): string {
  const parts = [
    h.accounts ? many(t, locale, h.accounts, ['comercio', 'merchant'], ['comercios', 'merchants']) : '',
    h.deals ? many(t, locale, h.deals, ['negocio abierto', 'open deal'], ['negocios abiertos', 'open deals']) : '',
    h.leads ? many(t, locale, h.leads, ['lead abierto', 'open lead'], ['leads abiertos', 'open leads']) : '',
  ].filter(Boolean)
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} ${t('y', 'and')} ${parts[parts.length - 1]}` : parts[0] ?? ''
}

/** "Tiene 951 comercios y 952 negocios abiertos sin dueño vigente." */
export const holdsText = (t: T, locale: Locale, h: Held): string =>
  h.owner_id ? t(`Tiene ${heldList(t, locale, h)} por repartir.`, `Holds ${heldList(t, locale, h)} with no current owner.`) : t(`Hay ${heldList(t, locale, h)} sin asignar.`, `There are ${heldList(t, locale, h)} with no owner.`)

/** Nombre de quien los tiene, con por qué no cuenta como dueño vigente. */
export const holderName = (t: T, h: Held): string =>
  h.owner_id ? `${h.full_name}${h.is_active === false ? t(' (inactiva)', ' (inactive)') : t(' (ya no vende ni opera en este mercado)', ' (no longer sells or runs operations in this market)')}` : t('Sin asignar', 'No owner')
