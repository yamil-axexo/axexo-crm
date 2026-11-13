import 'server-only'
import type { Tx } from '@/server/db'

/**
 * PIPE-04: un código de motivo que llega de otro sistema y CONTIGO no conoce ya no desaparece en silencio: queda contado
 * (crm.unknown_reason_codes) y a la vista en Administración, para que el catálogo de los dos lados vuelva a coincidir.
 */
export async function noteUnknownReason(tx: Tx, source: string, code: string, market: string | null): Promise<void> {
  const c = code.trim().slice(0, 80)
  if (!c) return
  await tx`insert into crm.unknown_reason_codes (source, code, market_code) values (${source}, ${c}, ${market})
           on conflict (source, code) do update set hits = crm.unknown_reason_codes.hits + 1, last_seen = now()`
}

/** Versión vigente del catálogo de motivos: sube sola con cada cambio. Quien lo consume sabe si su copia está al día. */
export async function reasonCatalogVersion(tx: Tx): Promise<{ version: number; changed_at: Date }> {
  const rows = await tx<{ version: number; changed_at: Date }[]>`select version, changed_at from crm.catalog_versions where catalog = 'reason_codes'`
  return rows[0] ?? { version: 1, changed_at: new Date(0) }
}
