import 'server-only'

/**
 * ACT-01: tickets de soporte en el hilo del comercio. La mesa de soporte (Zendesk) es un sistema externo: CONTIGO guarda
 * la referencia al ticket (número y asunto, escritos por una persona) y la muestra en el hilo; nunca copia el ticket.
 * `off` (por defecto): no consulta nada; la referencia se muestra sin enlace y con el estado que la persona le puso.
 * `simulated` (solo con APP_ENV=test y SUPPORT_DESK=simulated): arma el enlace con una dirección de prueba.
 * No hay implementación real: falta la dirección de la mesa de soporte y la aprobación para consultarla.
 */
export type SupportDeskAdapter = {
  mode: 'off' | 'simulated'
  envVar: 'SUPPORT_DESK'
  /** Dirección para abrir el ticket en la mesa de soporte; null con el adaptador apagado. */
  ticketUrl: (system: string, ref: string) => string | null
}

export function supportDeskAdapter(): SupportDeskAdapter {
  const simulated = process.env.APP_ENV === 'test' && process.env.SUPPORT_DESK === 'simulated'
  return {
    envVar: 'SUPPORT_DESK',
    mode: simulated ? 'simulated' : 'off',
    ticketUrl: (system, ref) => (simulated ? `https://support.invalid/${encodeURIComponent(system)}/tickets/${encodeURIComponent(ref.replace(/^#/, ''))}` : null),
  }
}
