type Pair = [es: string, en: string]

/**
 * Definición exacta de cada cifra del Panel del LT. Vive en un solo lugar: la pantalla la muestra a un toque
 * ("Cómo se calcula") y Ayuda la puede citar sin volver a escribirla. `num` y `den` solo existen cuando la cifra es un porcentaje.
 */
export type MetricDef = { label: Pair; what: Pair; num?: Pair; den?: Pair; window: Pair; source: Pair; owner: Pair }

/**
 * Quién responde por cada número. Es el dueño por defecto, por área: administración lo cambia en Reportes, "Indicadores y
 * dueños" (queda en crm.metric_owners y en la bitácora). Una cifra, una definición, un dueño (REP-01, REP-04).
 */
const SALES: Pair = ['Ventas', 'Sales']
const MARKET: Pair = ['Quien lidera el mercado', 'Market lead']
const OPS: Pair = ['Operaciones', 'Operations']
const DATA: Pair = ['Data y Reportería', 'Data & Reporting']
const FINANCE: Pair = ['Finanzas', 'Finance']
const C1: Pair = ['Operaciones Globales de IA', 'Global AI Operations']
const FILE: Pair = ['Archivo diario de ventas', 'Daily sales file']
const FILE_WINDOW: Pair = ['La fecha de corte del archivo diario de ventas más reciente.', 'The cutoff date of the most recent daily sales file.']

const PERIOD: Pair = ['El periodo elegido arriba, con días de calendario en la zona horaria de cada mercado.', 'The period chosen above, in calendar days in each market’s time zone.']
const TODAY: Pair = ['Foto de este momento. No cambia con el periodo.', 'A snapshot of right now. It does not change with the period.']
const CONTIGO: Pair = ['CONTIGO', 'CONTIGO']

export const METRICS = {
  won: {
    label: ['Negocios ganados', 'Deals won'],
    what: ['Negocios que se ganaron con fecha de cierre dentro del periodo. Un negocio se gana cuando llega la primera transacción del comercio en el archivo diario de ventas, o a mano si el embudo está configurado así.', 'Deals won with a close date inside the period. A deal is won when the merchant’s first transaction arrives in the daily sales file, or by hand if the pipeline is set up that way.'],
    owner: SALES,
    window: PERIOD, source: ['CONTIGO (la primera transacción llega en el archivo diario de ventas)', 'CONTIGO (the first transaction comes in the daily sales file)'],
  },
  lost: {
    label: ['Negocios perdidos', 'Deals lost'],
    what: ['Negocios que se cerraron como perdidos con fecha de cierre dentro del periodo. El motivo es obligatorio.', 'Deals closed as lost with a close date inside the period. A reason is required.'],
    owner: SALES,
    window: PERIOD, source: CONTIGO,
  },
  leads: {
    label: ['Leads', 'Leads'],
    what: ['Leads creados dentro del periodo, por cualquier vía (formulario web, captura manual, importación, referido o Sales App).', 'Leads created inside the period, from any source (web form, manual entry, import, referral or Sales App).'],
    owner: MARKET,
    window: PERIOD, source: CONTIGO,
  },
  qualified: {
    label: ['Leads calificados', 'Qualified leads'],
    what: ['De los leads creados en el periodo, los que hoy están calificados o ya se convirtieron en comercio.', 'Of the leads created in the period, the ones that are qualified or already converted into a merchant today.'],
    owner: SALES,
    window: PERIOD, source: CONTIGO,
  },
  attempt: {
    label: ['Primer intento a tiempo', 'First attempt on time'],
    what: ['Qué parte de los leads recibió su primer intento de contacto antes de que venciera su plazo. Un intento no es un contacto logrado.', 'The share of leads that got a first contact attempt before their deadline. An attempt is not a completed contact.'],
    num: ['Leads creados en el periodo cuyo primer intento ocurrió antes de vencer el plazo.', 'Leads created in the period whose first attempt happened before the deadline.'],
    den: ['Leads creados en el periodo que ya se pueden juzgar: tienen un primer intento, o su plazo ya venció. Los que llegaron sin plazo (importación) no entran.', 'Leads created in the period that can already be judged: they have a first attempt, or their deadline has passed. Leads that came in without a deadline (import) are left out.'],
    owner: SALES,
    window: PERIOD, source: CONTIGO,
  },
  reached: {
    label: ['Contacto logrado', 'Reached'],
    what: ['Qué parte de los leads juzgados terminó en una conversación con la persona.', 'The share of judged leads that ended in a conversation with the person.'],
    num: ['Leads juzgados que hoy están contactados, calificados o convertidos, o que tienen una actividad con resultado "se logró hablar".', 'Judged leads that are contacted, qualified or converted today, or that have an activity with the result "reached".'],
    den: ['El mismo de "Primer intento a tiempo": leads del periodo que ya se pueden juzgar.', 'The same as "First attempt on time": leads from the period that can already be judged.'],
    owner: SALES,
    window: PERIOD, source: CONTIGO,
  },
  days: {
    label: ['Días a la primera venta', 'Days to first sale'],
    what: ['Promedio de días entre que se creó el negocio y que se ganó por primera transacción, para los negocios ganados en el periodo. Si ninguno se ganó así, no hay dato.', 'Average days from creating the deal to winning it by first transaction, for deals won in the period. If none was won that way, there is no figure.'],
    owner: DATA,
    window: PERIOD, source: ['CONTIGO (la primera transacción llega en el archivo diario de ventas)', 'CONTIGO (the first transaction comes in the daily sales file)'],
  },
  open: {
    label: ['Negocios abiertos', 'Open deals'],
    what: ['Negocios que hoy no están ganados ni perdidos, en cualquier etapa.', 'Deals that are neither won nor lost today, in any stage.'],
    owner: SALES,
    window: TODAY, source: CONTIGO,
  },
  awaiting: {
    label: ['Esperando primera venta', 'Awaiting first sale'],
    what: ['Negocios abiertos que hoy están en la etapa que espera la primera transacción. "Llevan más de 7 días" cuenta los que entraron a esa etapa hace más de 7 días.', 'Open deals that sit today in the stage that waits for the first transaction. "Past 7 days" counts the ones that entered that stage more than 7 days ago.'],
    owner: OPS,
    window: TODAY, source: CONTIGO,
  },
  revisits: {
    label: ['Revisitas pendientes', 'Pending revisits'],
    what: ['Negocios abiertos marcados hoy con revisita pendiente a quien decide.', 'Open deals flagged today with a pending revisit to the decision-maker.'],
    owner: SALES,
    window: TODAY, source: ['CONTIGO y Sales App', 'CONTIGO and Sales App'],
  },
  active: {
    label: ['Comercios activos', 'Active merchants'],
    what: ['Comercios sin archivar cuyo estado hoy es "Activo". El estado lo manda el archivo diario de ventas; CONTIGO no lo decide con una regla propia. Solo cuando el archivo llega sin estado se usa la regla de respaldo (vendió 5 días o más en los últimos 30).', 'Unarchived merchants whose status today is "Active". The daily sales file sends the status; CONTIGO does not decide it with a rule of its own. Only when the file comes without a status does the fallback rule apply (sold on 5 or more days in the last 30).'],
    owner: DATA,
    window: TODAY, source: ['Estado que manda el archivo diario de ventas', 'Status sent in the daily sales file'],
  },
  risk: {
    label: ['En riesgo / inactivos', 'At risk / inactive'],
    what: ['Comercios sin archivar cuyo estado hoy es "En riesgo" o "Inactivo". El estado lo manda el archivo diario de ventas. Solo cuando el archivo llega sin estado se usa la regla de respaldo: en riesgo si vendió menos de 5 días en los últimos 30, inactivo si no vendió.', 'Unarchived merchants whose status today is "At risk" or "Inactive". The daily sales file sends the status. Only when the file comes without a status does the fallback rule apply: at risk if it sold on fewer than 5 days in the last 30, inactive if it did not sell.'],
    owner: DATA,
    window: TODAY, source: ['Estado que manda el archivo diario de ventas', 'Status sent in the daily sales file'],
  },
  volume: {
    label: ['Volumen, 30 días', 'Volume, 30 days'],
    what: ['Suma del volumen de ventas de los últimos 30 días de cada comercio, tal como viene en su archivo diario de ventas más reciente. CONTIGO no recalcula ventas.', 'Sum of each merchant’s sales volume for the last 30 days, as it comes in its most recent daily sales file. CONTIGO does not recompute sales.'],
    owner: DATA,
    window: ['Los 30 días que terminan en la fecha de corte del archivo diario de ventas. No cambia con el periodo.', 'The 30 days ending on the daily sales file’s cutoff date. It does not change with the period.'],
    source: ['Archivo diario de ventas', 'Daily sales file'],
  },
  volumeUsd: {
    label: ['Volumen consolidado (USD)', 'Consolidated volume (USD)'],
    what: ['El volumen de 30 días de cada mercado, convertido a USD con la tasa cargada por administración y sumado. Si a una moneda le falta tasa, no se consolida.', 'Each market’s 30-day volume, converted to USD at the rate loaded by administration, then added up. If a currency has no rate, nothing is consolidated.'],
    owner: FINANCE,
    window: ['Los 30 días que terminan en la fecha de corte del archivo diario de ventas. La tasa es la vigente en esa fecha de corte.', 'The 30 days ending on the daily sales file’s cutoff date. The rate is the one in force on that cutoff date.'],
    source: ['Archivo diario de ventas y tasa de cambio de Administración', 'Daily sales file and the exchange rate in Administration'],
  },
  lossReasons: {
    label: ['Por qué se pierden los negocios', 'Why deals are lost'],
    what: ['Negocios perdidos en el periodo, contados por el motivo que se eligió al cerrarlos.', 'Deals lost in the period, counted by the reason chosen when closing them.'],
    owner: SALES,
    window: PERIOD, source: CONTIGO,
  },
  noSale: {
    label: ['Por qué una visita no termina en venta', 'Why a visit ends with no sale'],
    what: ['Visitas de la Sales App sin venta dentro del periodo, contadas por el motivo que capturó quien visitó.', 'Sales App visits with no sale inside the period, counted by the reason the visitor captured.'],
    owner: SALES,
    window: PERIOD, source: ['Sales App', 'Sales App'],
  },

  // ---------------------------------------------------------------- reportes (E8)
  leadsConverted: {
    label: ['Leads convertidos', 'Leads converted'],
    what: ['De los leads creados en el periodo, los que hoy ya son un comercio con negocio.', 'Of the leads created in the period, the ones that are already a merchant with a deal today.'],
    owner: SALES, window: PERIOD, source: CONTIGO,
  },
  conversion: {
    label: ['Tasa de conversión', 'Conversion rate'],
    what: ['Qué parte de los leads del periodo se convirtió en negocio.', 'The share of leads from the period that became a deal.'],
    num: ['Leads creados en el periodo que hoy están convertidos.', 'Leads created in the period that are converted today.'],
    den: ['Todos los leads creados en el periodo.', 'All leads created in the period.'],
    owner: MARKET, window: PERIOD, source: CONTIGO,
  },
  stageTime: {
    label: ['Días en la etapa', 'Days in stage'],
    what: ['Para los negocios abiertos de cada etapa, cuántos días llevan ahí desde que entraron. Se muestra la mediana y el más antiguo.', 'For the open deals in each stage, how many days they have been there since they entered. The median and the oldest are shown.'],
    owner: SALES, window: TODAY, source: CONTIGO,
  },
  noNextStep: {
    label: ['Sin próximo paso', 'No next step'],
    what: ['Negocios abiertos que hoy no tienen próximo paso, o lo tienen sin fecha. Es la misma cuenta del filtro "Sin próximo paso" del tablero de Negocios.', 'Open deals that have no next step today, or have one with no date. It is the same count as the "No next step" filter on the Deals board.'],
    owner: SALES, window: TODAY, source: CONTIGO,
  },
  agency: {
    label: ['Agencia y equipo interno', 'Agency and in-house team'],
    what: ['Negocios creados en el periodo, separados por quién trajo el comercio. Cuenta como agencia el comercio cuyo origen está registrado a nombre de un aliado; todo lo demás es equipo interno.', 'Deals created in the period, split by who brought the merchant in. A merchant counts as agency when its origin is recorded under a partner; everything else is the in-house team.'],
    owner: MARKET, window: PERIOD, source: ['CONTIGO (origen del comercio)', 'CONTIGO (merchant origin)'],
  },
  financeWon: {
    label: ['Ganados con monto', 'Won with an amount'],
    what: ['Negocios ganados en el periodo y la suma de sus montos, por moneda. Los negocios sin monto capturado se cuentan aparte.', 'Deals won in the period and the sum of their amounts, by currency. Deals with no amount entered are counted separately.'],
    owner: FINANCE, window: PERIOD, source: CONTIGO,
  },
  financeUsd: {
    label: ['Consolidado en USD', 'Consolidated in USD'],
    what: ['Los montos ganados de cada moneda, convertidos a USD con la tasa del día en que se ganó cada negocio (queda guardada en el negocio) y sumados. Las tasas y sus fechas van a la vista. Si a un negocio le falta la tasa de su fecha, no se consolida.', 'The amounts won in each currency, converted to USD at the rate of the day each deal was won (it stays stored on the deal), then added up. The rates and their dates are shown. If a deal has no rate for its date, nothing is consolidated.'],
    owner: FINANCE, window: PERIOD, source: ['CONTIGO y tasa de cambio de Administración', 'CONTIGO and the exchange rate in Administration'],
  },
  nodeRollup: {
    label: ['Por cadena, ISO o distribuidor', 'By chain, ISO or distributor'],
    what: ['Cada cadena, ISO o distribuidor con la suma de todas las tiendas que cuelgan de él, a cualquier profundidad.', 'Each chain, ISO or distributor with the sum of every store under it, at any depth.'],
    owner: SALES, window: TODAY, source: ['CONTIGO y archivo diario de ventas', 'CONTIGO and the daily sales file'],
  },
  longStage: {
    label: ['Etapas largas', 'Long stages'],
    what: ['Negocios abiertos que llevan en su etapa más días de los que esa etapa permite sin movimiento.', 'Open deals that have sat in their stage longer than that stage allows without movement.'],
    owner: SALES, window: TODAY, source: CONTIGO,
  },
  // ---------------------------------------------------------------- histórico (REP-02)
  snapshot: {
    label: ['Foto diaria', 'Daily snapshot'],
    what: ['Cuántos negocios abiertos había en cada etapa y cuántos comercios en cada estado, al cierre de cada día. La foto la toma CONTIGO por su cuenta y cuenta todo el mercado, no lo que ve una persona.', 'How many open deals sat in each stage and how many merchants in each status, at the close of each day. CONTIGO takes the snapshot on its own and counts the whole market, not what one person sees.'],
    owner: DATA, window: ['Un punto por día, en la zona horaria del mercado.', 'One point per day, in the market’s time zone.'], source: CONTIGO,
  },
  cohortLeads: {
    label: ['Leads del mes convertidos a 30, 60 y 90 días', 'Leads of the month converted within 30, 60 and 90 days'],
    what: ['De los leads creados en cada mes, cuántos se convirtieron en negocio dentro de los 30, 60 y 90 días siguientes a su creación.', 'Of the leads created each month, how many became a deal within 30, 60 and 90 days of being created.'],
    num: ['Leads del mes cuyo negocio se creó dentro del plazo.', 'Leads of the month whose deal was created within the window.'],
    den: ['Leads creados en el mes.', 'Leads created in the month.'],
    owner: MARKET, window: ['Por mes de creación del lead. Un plazo que todavía no se cumple se marca como parcial.', 'By the month the lead was created. A window that has not fully passed yet is marked as partial.'], source: CONTIGO,
  },
  cohortStores: {
    label: ['Altas con primera venta', 'Enrolled stores with a first sale'],
    what: ['De las tiendas dadas de alta en cada mes, cuántas ya tienen su primera venta en el archivo diario de ventas.', 'Of the stores enrolled each month, how many already have a first sale in the daily sales file.'],
    owner: SALES, window: ['Por mes de alta de la tienda.', 'By the month the store was enrolled.'], source: FILE,
  },
  velocity: {
    label: ['Velocidad por etapa', 'Stage velocity'],
    what: ['Cuántos días tardan los negocios en salir de cada etapa: la mediana (la mitad tarda eso o menos) y el percentil 90 (9 de cada 10 tardan eso o menos).', 'How many days deals take to leave each stage: the median (half take that long or less) and the 90th percentile (9 in 10 take that long or less).'],
    owner: SALES, window: ['Salidas de etapa de los últimos 180 días.', 'Stage exits from the last 180 days.'], source: ['CONTIGO (cada cambio de etapa queda guardado)', 'CONTIGO (every stage change is kept)'],
  },
  // ---------------------------------------------------------------- conciliación (REP-04)
  reconcile: {
    label: ['Conciliación con el archivo de ventas', 'Reconciliation with the sales file'],
    what: ['Compara los negocios ganados por primera venta en CONTIGO con las primeras ventas que trae el archivo diario. Una diferencia es un ganado sin primera venta en el archivo, una primera venta con el negocio todavía abierto, o una fecha distinta.', 'Compares deals won by first sale in CONTIGO with the first sales in the daily file. A difference is a win with no first sale in the file, a first sale whose deal is still open, or a different date.'],
    num: ['Diferencias encontradas.', 'Differences found.'],
    den: ['El mayor entre ganados por primera venta y comercios con primera venta en el archivo.', 'The larger of deals won by first sale and merchants with a first sale in the file.'],
    owner: DATA, window: FILE_WINDOW, source: ['CONTIGO y archivo diario de ventas', 'CONTIGO and the daily sales file'],
  },
  // ---------------------------------------------------------------- lo que llevo (CANAL-05)
  carryStores: {
    label: ['Altas', 'Enrolled stores'],
    what: ['Tiendas de tu cartera dadas de alta dentro del periodo.', 'Stores in your book enrolled inside the period.'],
    owner: SALES, window: PERIOD, source: CONTIGO,
  },
  carryFirstSales: {
    label: ['Primeras ventas', 'First sales'],
    what: ['Tiendas de tu cartera cuya primera venta, según el archivo diario de ventas, cae dentro del periodo.', 'Stores in your book whose first sale, per the daily sales file, falls inside the period.'],
    owner: DATA, window: PERIOD, source: FILE,
  },
  carryActive: {
    label: ['Activos a 30, 60 y 90 días', 'Active at 30, 60 and 90 days'],
    what: ['De las tiendas de tu cartera con primera venta en el periodo, cuántas seguían vendiendo 30, 60 y 90 días después. "Seguía vendiendo" lo dice el archivo diario de ventas más cercano a esa fecha: tuvo ventas en sus últimos 30 días. Si todavía no hay archivo de esa fecha, la tienda no entra en la cuenta.', 'Of the stores in your book with a first sale in the period, how many were still selling 30, 60 and 90 days later. "Still selling" comes from the daily sales file closest to that date: it had sales in its trailing 30 days. If there is no file for that date yet, the store is left out of the count.'],
    num: ['Tiendas que seguían vendiendo en esa fecha.', 'Stores still selling on that date.'],
    den: ['Tiendas con primera venta en el periodo que ya tienen archivo de esa fecha (7 días de margen).', 'Stores with a first sale in the period that already have a file for that date (7 days of slack).'],
    owner: DATA, window: PERIOD, source: FILE,
  },
  // ---------------------------------------------------------------- campo (CAMPO-05)
  fieldPerDay: {
    label: ['Visitas por día', 'Visits per day'],
    what: ['Visitas del periodo divididas entre los días hábiles del periodo en el mercado.', 'Visits in the period divided by the market’s working days in the period.'],
    owner: SALES, window: PERIOD, source: ['CONTIGO (visitas registradas a mano) y Sales App', 'CONTIGO (visits logged by hand) and Sales App'],
  },
  fieldCoverage: {
    label: ['Cobertura de cartera', 'Book coverage'],
    what: ['Qué parte de las tiendas de la cartera recibió al menos una visita en el periodo.', 'The share of stores in the book that got at least one visit in the period.'],
    num: ['Tiendas de la cartera con una visita o más en el periodo.', 'Stores in the book with one visit or more in the period.'],
    den: ['Tiendas sin archivar de la cartera.', 'Unarchived stores in the book.'],
    owner: SALES, window: PERIOD, source: ['CONTIGO y Sales App', 'CONTIGO and Sales App'],
  },
  fieldEffect: {
    label: ['Efectividad', 'Effectiveness'],
    what: ['Qué parte de las visitas terminó en venta.', 'The share of visits that ended in a sale.'],
    num: ['Visitas con venta.', 'Visits with a sale.'],
    den: ['Todas las visitas del periodo.', 'All visits in the period.'],
    owner: SALES, window: PERIOD, source: ['CONTIGO y Sales App', 'CONTIGO and Sales App'],
  },
  fieldPerStore: {
    label: ['Visitas por alta', 'Visits per enrolled store'],
    what: ['Cuántas visitas hicieron falta por cada tienda dada de alta en el periodo.', 'How many visits it took for each store enrolled in the period.'],
    owner: SALES, window: PERIOD, source: ['CONTIGO y Sales App', 'CONTIGO and Sales App'],
  },
  fieldTrust: {
    label: ['Visitas confirmadas', 'Confirmed visits'],
    what: ['Qué parte de las visitas viene confirmada por la Sales App. Una visita registrada a mano cuenta, pero no está confirmada: nadie más que quien la escribió la respalda. Cuando la Sales App mande su señal de confianza, las de señal baja dejan de contar.', 'The share of visits confirmed by the Sales App. A visit logged by hand counts, but it is not confirmed: no one but the person who wrote it backs it up. Once the Sales App sends its trust signal, visits with a low signal stop counting.'],
    num: ['Visitas que llegaron de la Sales App, sin señal baja.', 'Visits that came from the Sales App, with no low signal.'],
    den: ['Todas las visitas del periodo.', 'All visits in the period.'],
    owner: SALES, window: PERIOD, source: ['Sales App', 'Sales App'],
  },
  // ---------------------------------------------------------------- pronóstico (REP-03)
  forecast: {
    label: ['Pronóstico de ganados', 'Forecast of wins'],
    what: ['Cuántos de los negocios abiertos de hoy se esperan ganar. Cada etapa aporta sus negocios abiertos por la parte de negocios que, habiendo pasado por esa etapa, terminó ganada. Es un rango, no una promesa: se muestra el esperado con su mínimo y su máximo.', 'How many of today’s open deals are expected to be won. Each stage contributes its open deals times the share of deals that, having passed through that stage, ended up won. It is a range, not a promise: the expected figure is shown with its low and high.'],
    num: ['Negocios que pasaron por la etapa y se ganaron.', 'Deals that passed through the stage and were won.'],
    den: ['Negocios que pasaron por la etapa y ya cerraron (ganados o perdidos).', 'Deals that passed through the stage and have closed (won or lost).'],
    owner: MARKET, window: ['Negocios abiertos de hoy; tasa histórica de los últimos 365 días.', 'Today’s open deals; historical rate from the last 365 days.'], source: CONTIGO,
  },
  // ---------------------------------------------------------------- adopción (GOB-03)
  useActivities: {
    label: ['Actividades registradas', 'Activities logged'],
    what: ['Visitas, llamadas, notas y tareas que la persona registró en la semana. No cuenta entrar a CONTIGO: cuenta dejar registro del trabajo.', 'Visits, calls, notes and tasks the person logged in the week. Signing in to CONTIGO does not count: leaving a record of the work does.'],
    owner: C1, window: ['Por semana, de lunes a domingo, en la zona horaria del mercado.', 'By week, Monday to Sunday, in the market’s time zone.'], source: CONTIGO,
  },
  useNextStep: {
    label: ['Próximo paso al día', 'Next step up to date'],
    what: ['Qué parte de los negocios abiertos de la persona tiene hoy un próximo paso con fecha vigente.', 'The share of the person’s open deals that have a dated next step that is not overdue today.'],
    num: ['Negocios abiertos con próximo paso de hoy en adelante.', 'Open deals with a next step dated today or later.'],
    den: ['Negocios abiertos de la persona.', 'The person’s open deals.'],
    owner: C1, window: TODAY, source: CONTIGO,
  },
  useLeads: {
    label: ['Leads atendidos a tiempo', 'Leads handled on time'],
    what: ['Qué parte de los leads de la persona recibió su primer intento antes de vencer el plazo.', 'The share of the person’s leads that got a first attempt before the deadline.'],
    num: ['Leads con primer intento antes del plazo.', 'Leads with a first attempt before the deadline.'],
    den: ['Leads del periodo que ya se pueden juzgar: tienen primer intento o su plazo venció.', 'Leads from the period that can already be judged: they have a first attempt or their deadline has passed.'],
    owner: C1, window: ['Leads creados en las últimas 8 semanas.', 'Leads created in the last 8 weeks.'], source: CONTIGO,
  },
  rollout: {
    label: ['Listo para ampliar', 'Ready to expand'],
    what: ['Señal para decidir si un equipo pasa a la siguiente etapa del despliegue: quien supervisa usa CONTIGO (revisó el tablero de su equipo esta semana) y el equipo tiene un resultado (visitas por alta o comercios activos). Es una señal para conversar, no una calificación.', 'A signal to decide whether a team moves to the next rollout stage: the supervisor uses CONTIGO (opened the team board this week) and the team has an outcome (visits per enrolled store or active merchants). It is a prompt for a conversation, not a grade.'],
    owner: C1, window: ['Esta semana y los últimos 30 días.', 'This week and the last 30 days.'], source: CONTIGO,
  },
  // ------------------------------------------------------------------ reportes2 (REP-01): tableros por rol. La lista de cada rol vive en
  // crm.role_boards (Administración la cambia); aquí vive la definición de cada cifra, una sola vez.
  kamAccounts: {
    label: ['Cuentas clave que llevo', 'Key accounts I own'],
    what: ['Cadenas, distribuidores y organizaciones a nombre de la persona KAM, sin archivar.', 'Chains, distributors and organizations owned by the KAM, not archived.'],
    owner: SALES, window: TODAY, source: CONTIGO,
  },
  kamStoresActive: {
    label: ['Tiendas activas en mis cuentas', 'Active stores in my accounts'],
    what: ['Tiendas que cuelgan de las cuentas clave de la persona (a cualquier profundidad) con estado activo. El estado lo manda el archivo diario de ventas cuando lo trae.', 'Stores under the person’s key accounts (at any depth) whose status is active. The status comes from the daily sales file when it carries it.'],
    owner: DATA, window: FILE_WINDOW, source: FILE,
  },
  kamOpen: {
    label: ['Oportunidades abiertas', 'Open opportunities'],
    what: ['Negocios abiertos de la persona sobre sus cuentas clave.', 'The person’s open deals on their key accounts.'],
    owner: SALES, window: TODAY, source: CONTIGO,
  },
  kamCommit: {
    label: ['Comprometido', 'Commit'],
    what: ['Oportunidades abiertas en categoría Comprometido. Si quien dirige ajustó la categoría, cuenta el ajuste.', 'Open opportunities in the Commit category. If the manager adjusted the category, the adjustment counts.'],
    owner: SALES, window: TODAY, source: CONTIGO,
  },
  kamNoNextStep: {
    label: ['Sin próximo paso', 'No next step'],
    what: ['Oportunidades abiertas de la persona sin próximo paso o con la fecha vencida.', 'The person’s open opportunities with no next step or an overdue date.'],
    owner: SALES, window: TODAY, source: CONTIGO,
  },
  kamWon90: {
    label: ['Ganadas en 90 días', 'Won in 90 days'],
    what: ['Negocios de la persona ganados en los últimos 90 días.', 'The person’s deals won in the last 90 days.'],
    owner: SALES, window: ['Los últimos 90 días.', 'The last 90 days.'], source: CONTIGO,
  },
  partnerPoints: {
    label: ['Puntos de venta en mi red', 'Points of sale in my network'],
    what: ['Tiendas que cuelgan del partner, a cualquier profundidad, sin archivar.', 'Stores under the partner, at any depth, not archived.'],
    owner: MARKET, window: TODAY, source: CONTIGO,
  },
  partnerActive: {
    label: ['Puntos activos', 'Active points'],
    what: ['Puntos de venta de la red con estado activo. El estado lo manda el archivo diario de ventas cuando lo trae.', 'Points of sale in the network whose status is active. The status comes from the daily sales file when it carries it.'],
    owner: DATA, window: FILE_WINDOW, source: FILE,
  },
  partnerActiveRate: {
    label: ['Porcentaje activo', 'Active share'],
    what: ['Qué parte de los puntos de venta de la red está activa.', 'The share of the network’s points of sale that are active.'],
    num: ['Puntos activos.', 'Active points.'], den: ['Puntos de venta de la red.', 'Points of sale in the network.'],
    owner: DATA, window: FILE_WINDOW, source: FILE,
  },
  partnerFirstSale30: {
    label: ['Primera venta en 30 días', 'First sale in 30 days'],
    what: ['Puntos de la red cuya primera transacción llegó en los últimos 30 días.', 'Points in the network whose first transaction arrived in the last 30 days.'],
    owner: DATA, window: ['Los últimos 30 días.', 'The last 30 days.'], source: FILE,
  },
  partnerAtRisk: {
    label: ['Puntos en riesgo', 'Points at risk'],
    what: ['Puntos de venta de la red en riesgo o inactivos.', 'Points of sale in the network that are at risk or inactive.'],
    owner: DATA, window: FILE_WINDOW, source: FILE,
  },
  partnerTier: {
    label: ['Nivel del partner', 'Partner tier'],
    what: ['El nivel vigente del partner según los criterios publicados por el mercado.', 'The partner’s current tier under the criteria the market published.'],
    owner: MARKET, window: TODAY, source: CONTIGO,
  },
  opsQueue: {
    label: ['En mi cola', 'In my queue'],
    what: ['Negocios abiertos en etapas de Operaciones y expedientes de alta por revisar, en los mercados de la persona.', 'Open deals in Operations stages and enrollment files to review, in the person’s markets.'],
    owner: OPS, window: TODAY, source: CONTIGO,
  },
  opsOverdue: {
    label: ['Expedientes vencidos', 'Overdue files'],
    what: ['Expedientes de alta enviados o en revisión cuya fecha límite ya pasó.', 'Submitted or in-review enrollment files whose due date has passed.'],
    owner: OPS, window: TODAY, source: CONTIGO,
  },
  opsReturned: {
    label: ['Devueltos a Ventas', 'Returned to Sales'],
    what: ['Expedientes de alta devueltos a Ventas que siguen sin corregirse.', 'Enrollment files returned to Sales that are still not fixed.'],
    owner: OPS, window: TODAY, source: CONTIGO,
  },
  opsPullThrough: {
    label: ['Aprobados en mesa de control', 'Approved at the control desk'],
    what: ['De los expedientes que se decidieron en los últimos 30 días, qué parte se aprobó.', 'Of the enrollment files decided in the last 30 days, the share that was approved.'],
    num: ['Expedientes aprobados.', 'Approved files.'], den: ['Expedientes aprobados más devueltos.', 'Approved plus returned files.'],
    owner: OPS, window: ['Los últimos 30 días.', 'The last 30 days.'], source: CONTIGO,
  },
  opsAwaitingFirstSale: {
    label: ['Esperando primera venta', 'Awaiting first sale'],
    what: ['Negocios abiertos en la etapa de espera de la primera transacción.', 'Open deals in the stage that waits for the first transaction.'],
    owner: OPS, window: TODAY, source: CONTIGO,
  },
  opsHandoffsOpen: {
    label: ['Entregas sin acuse', 'Handoffs not acknowledged'],
    what: ['Entregas de Ventas a Operaciones que todavía no tienen acuse.', 'Handoffs from Sales to Operations that are not acknowledged yet.'],
    owner: OPS, window: TODAY, source: CONTIGO,
  },
  financeCostMonth: {
    label: ['Costo de CONTIGO del mes', 'CONTIGO cost this month'],
    what: ['Suma de los costos cargados para el mes (plataforma, base, terceros, IA, soporte y otros), sin los anulados.', 'Sum of the costs loaded for the month (platform, database, third parties, AI, support and other), without voided ones.'],
    owner: FINANCE, window: ['El mes más reciente con costos cargados.', 'The most recent month with costs loaded.'], source: ['Costos cargados en Gobierno', 'Costs loaded in Governance'],
  },
  financeCostPerPerson: {
    label: ['Costo por persona activa', 'Cost per active person'],
    what: ['Costo del mes entre las personas que entraron a CONTIGO ese mes.', 'The month’s cost divided by the people who signed in to CONTIGO that month.'],
    num: ['Costo del mes.', 'The month’s cost.'], den: ['Personas que entraron en el mes.', 'People who signed in during the month.'],
    owner: FINANCE, window: ['El mes más reciente con costos cargados.', 'The most recent month with costs loaded.'], source: ['Costos cargados en Gobierno y la bitácora', 'Costs loaded in Governance and the audit log'],
  },
  financeCostPerAi: {
    label: ['Costo por acción de IA', 'Cost per AI action'],
    what: ['Lo que costó la IA en el mes (lo registrado en cada llamada más lo cargado a mano en el componente IA) entre las acciones de IA del mes. Las corridas de evaluación no cuentan como acción.', 'What AI cost in the month (recorded on each call plus what was loaded by hand under AI) divided by the month’s AI actions. Evaluation runs do not count as actions.'],
    num: ['Costo de IA del mes.', 'The month’s AI cost.'], den: ['Acciones de IA del mes.', 'AI actions in the month.'],
    owner: FINANCE, window: ['El mes en curso.', 'The current month.'], source: ['Registro de llamadas de IA y costos cargados', 'AI call log and loaded costs'],
  },
} as const satisfies Record<string, MetricDef>

export type MetricKey = keyof typeof METRICS

export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[]
export const isMetricKey = (k: string): k is MetricKey => k in METRICS

/** El dueño que se muestra: el que cargó administración, o el dueño por defecto de la definición. */
export const metricOwner = (k: MetricKey, overrides: Record<string, string> | undefined, t: (es: string, en: string) => string): string =>
  overrides?.[k] ?? t(METRICS[k].owner[0], METRICS[k].owner[1])
