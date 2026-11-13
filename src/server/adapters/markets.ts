import 'server-only'
import { createHmac } from 'node:crypto'
import type { TaxIdType } from '@/lib/tax-id'

/**
 * Adaptadores del paquete de mercados. Cada uno tiene dos implementaciones:
 * `off` (por defecto): no llama a nada; la operación queda anotada como "Canal apagado".
 * `simulated` (solo con APP_ENV=test y la variable en "simulated"): responde algo fijo y anota lo que habría salido.
 * No hay implementación real: conectar un proveedor pasa primero por la revisión de tecnología.
 */
type Mode = 'off' | 'simulated'
const modeOf = (envVar: string): Mode => (process.env.APP_ENV === 'test' && process.env[envVar] === 'simulated' ? 'simulated' : 'off')

const g = globalThis as unknown as { __contigoMarketSims?: { adapter: string; payload: Record<string, unknown> }[] }
/** Lo que los adaptadores simulados habrían mandado en este proceso (solo pruebas). Nunca guarda el identificador completo. */
export const simulatedMarketCalls = () => (g.__contigoMarketSims ??= [])

// ------------------------------------------------------------------ registro fiscal y listas de riesgo (MULTI-03, capas 2 y 3)
export type RegistryResult = { status: 'queued_off' } | { status: 'match' | 'mismatch'; provider: string }
export type TaxRegistryAdapter = {
  mode: Mode
  envVar: string
  /** Consulta el registro oficial del país y las listas de riesgo. Apagado: no sale nada. */
  verify: (input: { type: TaxIdType; country: string; normalized: string; legalName: string | null; postalCode: string | null }) => Promise<RegistryResult>
}
export function taxRegistryAdapter(): TaxRegistryAdapter {
  const envVar = 'TAX_REGISTRY_ADAPTER'
  const mode = modeOf(envVar)
  return {
    mode,
    envVar,
    verify: async (input) => {
      if (mode === 'off') return { status: 'queued_off' }
      simulatedMarketCalls().push({ adapter: 'tax_registry', payload: { type: input.type, country: input.country, last4: input.normalized.slice(-4) } })
      // En la simulación, un identificador que termina en 0 no coincide con el registro.
      return { status: input.normalized.endsWith('0') ? 'mismatch' : 'match', provider: 'simulated' }
    },
  }
}

// ------------------------------------------------------------------ resguardo del valor completo (dato protegido)
export type ProtectedDataAdapter = {
  mode: Mode
  envVar: string
  /** Guarda el valor completo de un dato protegido fuera de CONTIGO. Apagado: el valor se descarta al terminar la validación. */
  store: (input: { kind: 'tax_id'; accountId: string; value: string }) => Promise<{ stored: boolean }>
}
export function protectedDataAdapter(): ProtectedDataAdapter {
  const envVar = 'PROTECTED_DATA_ADAPTER'
  const mode = modeOf(envVar)
  return {
    mode,
    envVar,
    store: async (input) => {
      if (mode === 'off') return { stored: false }
      simulatedMarketCalls().push({ adapter: 'protected_data', payload: { kind: input.kind, accountId: input.accountId, length: input.value.length } })
      return { stored: true }
    },
  }
}

// ------------------------------------------------------------------ geocodificación y mapa (MULTI-04)
export type GeocodingAdapter = {
  mode: Mode
  envVar: string
  /** Convierte una dirección en coordenadas. Apagado: las coordenadas se capturan a mano o desde el teléfono. */
  geocode: (address: { line: string; locality: string | null; region: string | null; postalCode: string | null; country: string }) => Promise<{ status: 'off' } | { status: 'found'; latitude: number; longitude: number }>
}
export function geocodingAdapter(): GeocodingAdapter {
  const envVar = 'GEOCODING_ADAPTER'
  const mode = modeOf(envVar)
  return {
    mode,
    envVar,
    geocode: async (address) => {
      if (mode === 'off') return { status: 'off' }
      simulatedMarketCalls().push({ adapter: 'geocoding', payload: { country: address.country, postalCode: address.postalCode } })
      return { status: 'found', latitude: 19.4326, longitude: -99.1332 }
    },
  }
}

// ------------------------------------------------------------------ tasas de cambio desde el lakehouse (MULTI-01)
export type FxFeedAdapter = {
  mode: Mode
  envVar: string
  /** Trae las tasas fechadas del día. Apagado: administración las carga a mano, con fecha y fuente. */
  fetch: (currencies: string[]) => Promise<{ status: 'off' } | { status: 'ok'; rates: { currency: string; asOf: string; usdRate: number; source: string }[] }>
}
export function fxFeedAdapter(): FxFeedAdapter {
  const envVar = 'FX_FEED_ADAPTER'
  const mode = modeOf(envVar)
  return {
    mode,
    envVar,
    fetch: async (currencies) => {
      if (mode === 'off') return { status: 'off' }
      simulatedMarketCalls().push({ adapter: 'fx_feed', payload: { currencies } })
      const today = new Date().toISOString().slice(0, 10)
      return { status: 'ok', rates: currencies.filter((c) => c !== 'USD').map((c) => ({ currency: c, asOf: today, usdRate: 0.05, source: 'simulated feed' })) }
    },
  }
}

// ------------------------------------------------------------------ WhatsApp por mercado (MULTI-05)
/** El mismo interruptor que el canal de avisos por WhatsApp: una sola variable enciende el canal. */
export const whatsappMarketMode = (): { mode: Mode; envVar: string } => ({ mode: modeOf('WHATSAPP_ADAPTER'), envVar: 'WHATSAPP_ADAPTER' })

// ------------------------------------------------------------------ huella del identificador fiscal
const DEV_KEY = 'contigo-dev-only-blind-index-key'
/**
 * Llave de la huella. En desarrollo y pruebas hay una fija; en staging y producción tiene que venir del ambiente
 * (BLIND_INDEX_KEY, 32 caracteres o más). Sin llave no se calcula huella: no se guarda una huella débil.
 */
function blindKey(): string | null {
  const key = process.env.BLIND_INDEX_KEY
  if (key && key.length >= 32) return key
  const env = process.env.APP_ENV ?? 'development'
  return env === 'test' || env === 'development' ? DEV_KEY : null
}
export const blindIndexReady = () => blindKey() !== null
/** Huella del identificador normalizado: sirve para encontrar el mismo identificador en otro comercio, no para leerlo. */
export function blindIndex(type: TaxIdType, normalized: string): string | null {
  const key = blindKey()
  return key ? createHmac('sha256', key).update(`${type}:${normalized}`).digest('hex') : null
}

type Pair = [es: string, en: string]
/** Para "Estado de CONTIGO": cada adaptador, si está apagado y qué falta para encenderlo. */
export function marketAdapterStatus(): { key: string; name: Pair; what: Pair; mode: Mode | 'ready' | 'missing'; envVar: string; needs: Pair }[] {
  const wa = whatsappMarketMode()
  const [tax, vault, geo, fx] = [taxRegistryAdapter(), protectedDataAdapter(), geocodingAdapter(), fxFeedAdapter()]
  return [
    { key: 'tax_registry', name: ['Verificación fiscal y listas de riesgo', 'Tax verification and risk lists'], what: ['Confirma el identificador fiscal contra el registro oficial del país. Dentro de CONTIGO ya se valida el formato y lo revisa una persona.', 'Confirms the tax ID against the country’s official registry. Inside CONTIGO the format is already validated and a person reviews it.'], mode: tax.mode, envVar: tax.envVar,
      needs: ['Falta: proveedor elegido por Compliance y aprobado en la revisión de tecnología.', 'Missing: a provider chosen by Compliance and approved in the technology review.'] },
    { key: 'protected_data', name: ['Resguardo del identificador completo', 'Vault for the full identifier'], what: ['CONTIGO guarda solo los últimos 4 y una huella. El valor completo se descarta después de validarlo.', 'CONTIGO keeps only the last 4 and a fingerprint. The full value is discarded after validation.'], mode: vault.mode, envVar: vault.envVar,
      needs: ['Falta: que Legal y Seguridad decidan si el valor completo se guarda y dónde (hoy el estándar lo prohíbe), y un servicio de cifrado aprobado.', 'Missing: Legal and Security deciding whether the full value is stored and where (today the standard forbids it), and an approved encryption service.'] },
    { key: 'blind_index', name: ['Huella para detectar identificadores repetidos', 'Fingerprint to detect repeated identifiers'], what: ['Avisa cuando el mismo identificador fiscal ya está en otro comercio.', 'Warns when the same tax ID is already on another merchant.'], mode: blindIndexReady() ? 'ready' : 'missing', envVar: 'BLIND_INDEX_KEY',
      needs: ['Falta: una llave de 32 caracteres o más en el ambiente. Sin ella se guardan los últimos 4 y el estado, pero no se detectan repetidos.', 'Missing: a key of 32 characters or more in the environment. Without it the last 4 and the status are saved, but repeats are not detected.'] },
    { key: 'geocoding', name: ['Mapa y geocodificación', 'Map and geocoding'], what: ['Convierte direcciones en coordenadas y dibuja el mapa. Dentro de CONTIGO las coordenadas se capturan a mano o desde el teléfono, y la distancia se calcula sin proveedor.', 'Turns addresses into coordinates and draws the map. Inside CONTIGO coordinates are captured by hand or from the phone, and distance is calculated with no provider.'], mode: geo.mode, envVar: geo.envVar,
      needs: ['Falta: proveedor de mapas aprobado en la revisión de tecnología.', 'Missing: a maps provider approved in the technology review.'] },
    { key: 'fx_feed', name: ['Tasas de cambio desde los datos de ventas', 'Exchange rates from the sales data'], what: ['Trae la tasa de cada día sin que nadie la escriba. Hoy administración la carga a mano, con fecha y fuente.', 'Brings each day’s rate with nobody typing it. Today administration loads it by hand, with date and source.'], mode: fx.mode, envVar: fx.envVar,
      needs: ['Falta: que el equipo de datos publique las tasas fechadas y que Finanzas confirme la fuente.', 'Missing: the data team publishing dated rates and Finance confirming the source.'] },
    { key: 'whatsapp_market', name: ['WhatsApp por mercado', 'WhatsApp per market'], what: ['Número, plantillas y costos por mercado y entidad. La configuración ya se guarda; no sale ningún mensaje.', 'Number, templates and costs per market and entity. The setup is already stored; no message goes out.'], mode: wa.mode, envVar: wa.envVar,
      needs: ['Falta: cuenta de WhatsApp Business por mercado [pendiente: Marketing y Legal], plantillas aprobadas por Meta y la revisión de tecnología.', 'Missing: a WhatsApp Business account per market [pending: Marketing and Legal], templates approved by Meta and the technology review.'] },
  ]
}
