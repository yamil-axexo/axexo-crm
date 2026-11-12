import 'server-only'
import type { ReportOptions } from '@/dal/reports'
import { isUuid } from '@/lib/ids'

export type ReportParams = { periodo?: string; desde?: string; hasta?: string; mercado?: string; embudo?: string; equipo?: string; persona?: string; resultado?: string; por?: string }

/** Filtros de la URL, ya validados contra lo que la persona puede elegir: un valor fuera de su alcance se ignora. */
export function reportFilters(sp: ReportParams, o: ReportOptions) {
  const market = o.markets.some((m) => m.code === sp.mercado) ? sp.mercado : undefined
  const inMarket = <X extends { market_code: string }>(x: X) => !market || x.market_code === market
  const pipeline = o.pipelines.some((p) => p.id === sp.embudo && inMarket(p)) ? sp.embudo : undefined
  const team = sp.equipo === 'none' ? 'none' : o.teams.some((t) => t.id === sp.equipo && inMarket(t)) ? sp.equipo : undefined
  // Cualquier persona se acepta: el reporte ya está acotado al alcance de quien mira, y un negocio cerrado puede ser de alguien que ya no vende.
  const owner = sp.persona === 'none' ? 'none' : isUuid(sp.persona) ? sp.persona : undefined
  const result = sp.resultado === 'won' || sp.resultado === 'lost' ? sp.resultado : undefined
  return { market, pipeline, team, owner, result }
}

/** Las opciones de cada selector, acotadas al mercado (y al equipo) ya elegidos. */
export function reportSelects(t: (es: string, en: string) => string, o: ReportOptions, f: { market?: string; team?: string; owner?: string }) {
  const multi = o.markets.length > 1
  const inMarket = <X extends { market_code: string }>(x: X) => !f.market || x.market_code === f.market
  const tag = (code: string) => (multi && !f.market ? `${code} · ` : '')
  const people = new Map<string, string>()
  for (const p of o.people.filter(inMarket)) if (!f.team || (f.team === 'none' ? !p.team_id : p.team_id === f.team)) people.set(p.id, p.full_name)
  if (isUuid(f.owner) && !people.has(f.owner)) people.set(f.owner, o.people.find((p) => p.id === f.owner)?.full_name ?? t('La persona elegida', 'The chosen person'))
  return {
    market: { name: 'mercado', label: t('Mercado', 'Market'), all: t('Todos los mercados', 'All markets'), options: multi ? o.markets.map((m) => ({ value: m.code, label: m.name })) : [] },
    pipeline: { name: 'embudo', label: t('Embudo', 'Pipeline'), all: t('Todos los embudos', 'All pipelines'), options: o.pipelines.filter(inMarket).map((p) => ({ value: p.id, label: `${tag(p.market_code)}${p.name}` })) },
    team: { name: 'equipo', label: t('Equipo', 'Team'), all: t('Todos los equipos', 'All teams'), options: [...o.teams.filter(inMarket).map((x) => ({ value: x.id, label: `${tag(x.market_code)}${x.name}` })), ...(o.teams.length ? [{ value: 'none', label: t('Sin equipo', 'No team') }] : [])] },
    owner: { name: 'persona', label: t('Persona', 'Person'), all: t('Todas las personas', 'Everyone'), options: [...[...people].map(([value, label]) => ({ value, label })), { value: 'none', label: t('Sin asignar', 'No owner') }] },
    result: { name: 'resultado', label: t('Resultado', 'Result'), all: t('Ganados y perdidos', 'Won and lost'), options: [{ value: 'won', label: t('Ganados', 'Won') }, { value: 'lost', label: t('Perdidos', 'Lost') }] },
  }
}
