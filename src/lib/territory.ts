export type Territory = { id: string; code: string; name: string }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * El territorio con el que nace un comercio al convertir un lead.
 *
 * - Si quien lo lleva tiene un solo territorio en ese mercado, es ese.
 * - Si tiene varios, se busca cuál coincide con la plaza del lead (la ciudad que la persona escribió); si no tiene
 *   ninguno, se busca entre los del mercado.
 * - Si tiene dos o más y la plaza no dice cuál, no se adivina: la hoja de conversión lo pregunta (`ask`).
 */
export function territoryFor(own: Territory[], all: Territory[], locality: string | null | undefined): { id: string | null; ask: boolean } {
  if (own.length === 1) return { id: own[0]!.id, ask: false }
  const place = norm(locality ?? '')
  const pool = own.length > 0 ? own : all
  const hits = place.length >= 3
    ? pool.filter((t) => {
        const name = norm(t.name)
        return (name.length >= 3 && (place.includes(name) || name.includes(place))) || norm(t.code) === place
      })
    : []
  if (hits.length === 1) return { id: hits[0]!.id, ask: false }
  return { id: null, ask: own.length >= 2 }
}
