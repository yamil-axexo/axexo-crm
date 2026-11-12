type Pair = [es: string, en: string]

/**
 * Definición exacta de cada cifra del Panel del LT. Vive en un solo lugar: la pantalla la muestra a un toque
 * ("Cómo se calcula") y Ayuda la puede citar sin volver a escribirla. `num` y `den` solo existen cuando la cifra es un porcentaje.
 */
export type MetricDef = { label: Pair; what: Pair; num?: Pair; den?: Pair; window: Pair; source: Pair }

const PERIOD: Pair = ['El periodo elegido arriba, con días de calendario en la zona horaria de cada mercado.', 'The period chosen above, in calendar days in each market’s time zone.']
const TODAY: Pair = ['Foto de este momento. No cambia con el periodo.', 'A snapshot of right now. It does not change with the period.']
const CONTIGO: Pair = ['CONTIGO', 'CONTIGO']

export const METRICS = {
  won: {
    label: ['Negocios ganados', 'Deals won'],
    what: ['Negocios que se ganaron con fecha de cierre dentro del periodo. Un negocio se gana cuando llega la primera transacción del comercio en el archivo diario de ventas, o a mano si el embudo está configurado así.', 'Deals won with a close date inside the period. A deal is won when the merchant’s first transaction arrives in the daily sales file, or by hand if the pipeline is set up that way.'],
    window: PERIOD, source: ['CONTIGO (la primera transacción llega en el archivo diario de ventas)', 'CONTIGO (the first transaction comes in the daily sales file)'],
  },
  lost: {
    label: ['Negocios perdidos', 'Deals lost'],
    what: ['Negocios que se cerraron como perdidos con fecha de cierre dentro del periodo. El motivo es obligatorio.', 'Deals closed as lost with a close date inside the period. A reason is required.'],
    window: PERIOD, source: CONTIGO,
  },
  leads: {
    label: ['Leads', 'Leads'],
    what: ['Leads creados dentro del periodo, por cualquier vía (formulario web, captura manual, importación, referido o Sales App).', 'Leads created inside the period, from any source (web form, manual entry, import, referral or Sales App).'],
    window: PERIOD, source: CONTIGO,
  },
  qualified: {
    label: ['Leads calificados', 'Qualified leads'],
    what: ['De los leads creados en el periodo, los que hoy están calificados o ya se convirtieron en comercio.', 'Of the leads created in the period, the ones that are qualified or already converted into a merchant today.'],
    window: PERIOD, source: CONTIGO,
  },
  attempt: {
    label: ['Primer intento a tiempo', 'First attempt on time'],
    what: ['Qué parte de los leads recibió su primer intento de contacto antes de que venciera su plazo. Un intento no es un contacto logrado.', 'The share of leads that got a first contact attempt before their deadline. An attempt is not a completed contact.'],
    num: ['Leads creados en el periodo cuyo primer intento ocurrió antes de vencer el plazo.', 'Leads created in the period whose first attempt happened before the deadline.'],
    den: ['Leads creados en el periodo que ya se pueden juzgar: tienen un primer intento, o su plazo ya venció. Los que llegaron sin plazo (importación) no entran.', 'Leads created in the period that can already be judged: they have a first attempt, or their deadline has passed. Leads that came in without a deadline (import) are left out.'],
    window: PERIOD, source: CONTIGO,
  },
  reached: {
    label: ['Contacto logrado', 'Reached'],
    what: ['Qué parte de los leads juzgados terminó en una conversación con la persona.', 'The share of judged leads that ended in a conversation with the person.'],
    num: ['Leads juzgados que hoy están contactados, calificados o convertidos, o que tienen una actividad con resultado "se logró hablar".', 'Judged leads that are contacted, qualified or converted today, or that have an activity with the result "reached".'],
    den: ['El mismo de "Primer intento a tiempo": leads del periodo que ya se pueden juzgar.', 'The same as "First attempt on time": leads from the period that can already be judged.'],
    window: PERIOD, source: CONTIGO,
  },
  days: {
    label: ['Días a la primera venta', 'Days to first sale'],
    what: ['Promedio de días entre que se creó el negocio y que se ganó por primera transacción, para los negocios ganados en el periodo. Si ninguno se ganó así, no hay dato.', 'Average days from creating the deal to winning it by first transaction, for deals won in the period. If none was won that way, there is no figure.'],
    window: PERIOD, source: ['CONTIGO (la primera transacción llega en el archivo diario de ventas)', 'CONTIGO (the first transaction comes in the daily sales file)'],
  },
  open: {
    label: ['Negocios abiertos', 'Open deals'],
    what: ['Negocios que hoy no están ganados ni perdidos, en cualquier etapa.', 'Deals that are neither won nor lost today, in any stage.'],
    window: TODAY, source: CONTIGO,
  },
  awaiting: {
    label: ['Esperando primera venta', 'Awaiting first sale'],
    what: ['Negocios abiertos que hoy están en la etapa que espera la primera transacción. "Llevan más de 7 días" cuenta los que entraron a esa etapa hace más de 7 días.', 'Open deals that sit today in the stage that waits for the first transaction. "Past 7 days" counts the ones that entered that stage more than 7 days ago.'],
    window: TODAY, source: CONTIGO,
  },
  revisits: {
    label: ['Revisitas pendientes', 'Pending revisits'],
    what: ['Negocios abiertos marcados hoy con revisita al decisor pendiente.', 'Open deals flagged today with a pending revisit to the decision-maker.'],
    window: TODAY, source: ['CONTIGO y Sales App', 'CONTIGO and Sales App'],
  },
  active: {
    label: ['Comercios activos', 'Active merchants'],
    what: ['Comercios sin archivar cuyo estado hoy es "Activo". El estado lo mueve el archivo diario de ventas: pasa a activo con la primera transacción.', 'Unarchived merchants whose status today is "Active". The daily sales file moves the status: a merchant becomes active with its first transaction.'],
    window: TODAY, source: ['Estado en CONTIGO, calculado con el archivo diario de ventas', 'Status in CONTIGO, computed from the daily sales file'],
  },
  risk: {
    label: ['En riesgo / inactivos', 'At risk / inactive'],
    what: ['Comercios sin archivar cuyo estado hoy es "En riesgo" (vendieron pocos días en los últimos 30) o "Inactivo" (sin ventas en los últimos 30 días).', 'Unarchived merchants whose status today is "At risk" (sold on few days in the last 30) or "Inactive" (no sales in the last 30 days).'],
    window: TODAY, source: ['Estado en CONTIGO, calculado con el archivo diario de ventas', 'Status in CONTIGO, computed from the daily sales file'],
  },
  volume: {
    label: ['Volumen, 30 días', 'Volume, 30 days'],
    what: ['Suma del volumen de ventas de los últimos 30 días de cada comercio, tal como viene en su archivo diario de ventas más reciente. CONTIGO no recalcula ventas.', 'Sum of each merchant’s sales volume for the last 30 days, as it comes in its most recent daily sales file. CONTIGO does not recompute sales.'],
    window: ['Los 30 días que terminan en la fecha de corte del archivo diario de ventas. No cambia con el periodo.', 'The 30 days ending on the daily sales file’s cutoff date. It does not change with the period.'],
    source: ['Archivo diario de ventas', 'Daily sales file'],
  },
  volumeUsd: {
    label: ['Volumen consolidado (USD)', 'Consolidated volume (USD)'],
    what: ['El volumen de 30 días de cada mercado, convertido a USD con la tasa cargada por administración y sumado. Si a una moneda le falta tasa, no se consolida.', 'Each market’s 30-day volume, converted to USD at the rate loaded by administration, then added up. If a currency has no rate, nothing is consolidated.'],
    window: ['Los 30 días que terminan en la fecha de corte del archivo diario de ventas. La tasa es la de fecha más reciente.', 'The 30 days ending on the daily sales file’s cutoff date. The rate is the most recently dated one.'],
    source: ['Archivo diario de ventas y tasa de cambio de Administración', 'Daily sales file and the exchange rate in Administration'],
  },
  lossReasons: {
    label: ['Por qué se pierden los negocios', 'Why deals are lost'],
    what: ['Negocios perdidos en el periodo, contados por el motivo que se eligió al cerrarlos.', 'Deals lost in the period, counted by the reason chosen when closing them.'],
    window: PERIOD, source: CONTIGO,
  },
  noSale: {
    label: ['Por qué una visita no termina en venta', 'Why a visit ends with no sale'],
    what: ['Visitas de la Sales App sin venta dentro del periodo, contadas por el motivo que capturó quien visitó.', 'Sales App visits with no sale inside the period, counted by the reason the visitor captured.'],
    window: PERIOD, source: ['Sales App', 'Sales App'],
  },
} as const satisfies Record<string, MetricDef>

export type MetricKey = keyof typeof METRICS
