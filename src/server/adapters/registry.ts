import 'server-only'
import { gate, approvalVar, type ConnectorMode, type Gate, type GateSpec } from './live/gate'
import { GOOGLE_SA, SCOPES, directoryActiveEmails, geocode, googleToken } from './live/google'
import { slackAuthTest, whatsappProbe } from './live/messaging'
import { SUPABASE_ADMIN, authSettingsProbe, s5Manifest, storageBucketProbe } from './live/supabase'
import { AD_PLATFORM_VARS, aesOpen, aesSeal, anthropicAsk, contractHealth, dropboxSign, otlpExport, platformReady, turnstileVerify, vapidJwt, vercelCharges, zendeskProbe, zohoProbe } from './live/providers'
import { AI_GATE } from './ai'
import { ANTIBOT_GATE } from './antibot'
import { AUDIT_ARCHIVE_GATE } from './audit-archive'
import { BILLING_GATE } from './billing'
import { CARE_ADAPTERS } from './care'
import { CHANNEL_GATES } from './channel'
import { DIRECTORY_GATE } from './directory'
import { VAULT_GATE } from './document-vault'
import { EVENT_DELIVERY_GATE } from './event-delivery'
import { FIELD_CRYPTO_GATE } from './field-crypto'
import { FUNDING_GATE } from './funding-feed'
import { MARKET_GATES } from './markets'
import { PARTNER_GATES } from './partners'
import { REPORT_SLACK_GATE, SNAPSHOT_GATE } from './report-channels'
import { CAMPO2_GATES } from './campo2'
import { REALTIME_GATE } from './realtime'
import { ROUTES_GATE } from './routes'
import { SALES_FILE_GATE } from './sales-file'
import { SUPPORT_DESK_GATE } from './support-desk'
import { TRACES_GATE } from './traces'
import { ZOHO_GATE } from './zoho'
import { AD_GATE } from './ad-conversions'
import { WEB_PUSH_GATE } from './web-push'

/**
 * Registro único de conectores ("construido completo y apagado"). Cada uno: proveedor, variables (nombres, nunca valores),
 * quién lo enciende, permisos que pide en el proveedor, datos que salen, archivo del adaptador y la prueba de conexión.
 * Lo usan Estado de CONTIGO (/estado), "Probar conexión" y docs/adapters.md. Una prueba recorre TODOS los adaptadores
 * de src/server/adapters y falla si alguno no está aquí o no tiene `live`.
 */
type Pair = [es: string, en: string]
export type ConnectorDef = {
  key: string
  name: Pair
  provider: string
  /** Archivo del adaptador en src/server/adapters (sin extensión). */
  file: string
  gate: GateSpec
  /** Quién da el sign-off y quién lo enciende. */
  turnsOn: Pair
  /** Permisos que pide en el proveedor. */
  scopes: Pair
  /** Qué datos salen de CONTIGO. */
  dataOut: Pair
  /** Ítems del catálogo o requerimientos que destraba. */
  items: string[]
  /** La prueba de conexión: solo corre con el conector en `live`. Devuelve un texto corto sin secretos. */
  probe: (who: { email: string }) => Promise<string>
}

const TIR: Pair = ['Sign-off escrito de Dan Mulligan o Michael Essiet (Tech Implementation Review); lo enciende quien administra la plataforma con las variables.', 'Written sign-off from Dan Mulligan or Michael Essiet (Tech Implementation Review); whoever runs the platform turns it on with the variables.']
const tir = (extra: Pair): Pair => [`${TIR[0]} Además: ${extra[0]}`, `${TIR[1]} Also: ${extra[1]}`]
const s5Probe = async () => `${(await s5Manifest('s5_files')).length} archivos en el manifiesto`

export const CONNECTORS: ConnectorDef[] = [
  { key: 'email', name: ['Correo (avisos y documentos)', 'Email (notices and documents)'], provider: 'Gmail API (Google Workspace)', file: 'email', gate: CHANNEL_GATES.email,
    turnsOn: tir(['Operaciones define la dirección de salida (EMAIL_SENDER).', 'Operations defines the sender address (EMAIL_SENDER).']),
    scopes: ['Cuenta de servicio con delegación de dominio, alcance gmail.send sobre el buzón EMAIL_SENDER.', 'Service account with domain-wide delegation, gmail.send scope on the EMAIL_SENDER mailbox.'],
    dataOut: ['Destinatario, asunto y texto del aviso o documento.', 'Recipient, subject and text of the notice or document.'],
    items: ['E5.F9', 'E11.F4', 'E13.F3', 'E15.F6', 'E15.F9', 'GOB-06'],
    probe: async () => ((await googleToken('email', SCOPES.gmailSend, process.env.EMAIL_SENDER ?? null)) ? 'Token de Google emitido para el buzón de salida' : '') },
  { key: 'slack', name: ['Slack (avisos)', 'Slack (notices)'], provider: 'Slack Web API (chat.postMessage)', file: 'slack', gate: CHANNEL_GATES.slack, turnsOn: TIR,
    scopes: ['Bot token con chat:write y users:read.email.', 'Bot token with chat:write and users:read.email.'],
    dataOut: ['Correo de la persona (para encontrarla en Slack), asunto y texto del aviso.', 'The person’s email (to find them in Slack), subject and notice text.'],
    items: ['E15.F6', 'E15.F9'], probe: async () => `Espacio de trabajo: ${await slackAuthTest()}` },
  { key: 'whatsapp', name: ['WhatsApp (plantillas aprobadas)', 'WhatsApp (approved templates)'], provider: 'WhatsApp Cloud API (Meta)', file: 'whatsapp', gate: CHANNEL_GATES.whatsapp,
    turnsOn: tir(['Marketing y Legal definen la cuenta por mercado y Meta aprueba las plantillas; el límite diario y el costo se cargan en Administración, Mercados.', 'Marketing and Legal define the account per market and Meta approves the templates; daily limit and cost are loaded in Administration, Markets.']),
    scopes: ['Token de sistema con whatsapp_business_messaging sobre la cuenta de cada mercado.', 'System user token with whatsapp_business_messaging on each market’s account.'],
    dataOut: ['Teléfono del comercio, nombre de la plantilla y sus variables (nombre del comercio).', 'Merchant phone, template name and its variables (merchant name).'],
    items: ['MULTI-05', 'CS-03', 'GOB-06'], probe: async () => `Número: ${await whatsappProbe(process.env.WHATSAPP_PHONE_NUMBER_ID ?? '')}` },
  { key: 'gmail_capture', name: ['Captura de correos (Gmail)', 'Email capture (Gmail)'], provider: 'Gmail API (solo metadatos)', file: 'partners', gate: PARTNER_GATES.gmail, turnsOn: tir(['Cada persona enciende la captura de su buzón.', 'Each person turns on capture for their mailbox.']),
    scopes: ['gmail.metadata (nunca el cuerpo) sobre los buzones que cada persona encendió.', 'gmail.metadata (never the body) on mailboxes their owner turned on.'],
    dataOut: ['Nada sale: se leen remitente, destinatarios, asunto y fecha.', 'Nothing goes out: sender, recipients, subject and date are read.'],
    items: ['ACT-03'], probe: async (who) => ((await googleToken('gmail_capture', SCOPES.gmailMetadata, who.email)) ? 'Token de solo metadatos emitido para tu buzón' : '') },
  { key: 'calendar_capture', name: ['Captura de reuniones (Google Calendar)', 'Meeting capture (Google Calendar)'], provider: 'Google Calendar API (solo lectura)', file: 'partners', gate: PARTNER_GATES.calendar, turnsOn: tir(['Cada persona enciende la captura de su calendario.', 'Each person turns on capture for their calendar.']),
    scopes: ['calendar.events.readonly sobre los calendarios que cada persona encendió.', 'calendar.events.readonly on calendars their owner turned on.'],
    dataOut: ['Nada sale: se leen título, invitados y horario.', 'Nothing goes out: title, guests and time are read.'],
    items: ['ACT-03'], probe: async (who) => ((await googleToken('calendar_capture', SCOPES.calendarRead, who.email)) ? 'Token de solo lectura emitido para tu calendario' : '') },
  { key: 'whatsapp_capture', name: ['Captura de WhatsApp (webhook)', 'WhatsApp capture (webhook)'], provider: 'WhatsApp Cloud API (webhook entrante)', file: 'partners', gate: PARTNER_GATES.whatsapp_capture,
    turnsOn: tir(['En Meta se registra /api/webhooks/whatsapp con el token de verificación.', 'In Meta, /api/webhooks/whatsapp is registered with the verify token.']),
    scopes: ['Suscripción del webhook a "messages"; la firma X-Hub-Signature-256 se revisa con WHATSAPP_APP_SECRET.', 'Webhook subscription to "messages"; the X-Hub-Signature-256 signature is checked with WHATSAPP_APP_SECRET.'],
    dataOut: ['Nada sale. Entra: teléfono, hora y tipo de mensaje (el texto no se guarda).', 'Nothing goes out. In: phone, time and message type (the text is not stored).'],
    items: ['ACT-03'], probe: async () => 'Sin llamada: el webhook está listo en /api/webhooks/whatsapp' },
  { key: 'directory', name: ['Directorio de Google (baja automática)', 'Google directory (automatic removal)'], provider: 'Admin SDK Directory API', file: 'directory', gate: DIRECTORY_GATE, turnsOn: TIR,
    scopes: ['admin.directory.user.readonly, suplantando a GOOGLE_ADMIN_SUBJECT.', 'admin.directory.user.readonly, impersonating GOOGLE_ADMIN_SUBJECT.'],
    dataOut: ['Nada sale: se lee la lista de cuentas activas.', 'Nothing goes out: the list of active accounts is read.'],
    items: ['SEG-07'], probe: async () => `${(await directoryActiveEmails()).size} cuentas activas en el directorio` },
  { key: 'external_identity', name: ['Identidad de externos (invitación por enlace)', 'External identity (link invitation)'], provider: 'Supabase Auth (admin)', file: 'partners', gate: PARTNER_GATES.external_identity, turnsOn: TIR,
    scopes: ['Llave de servicio de Supabase (solo del lado del servidor).', 'Supabase service key (server side only).'],
    dataOut: ['Correo de la persona invitada y la cuenta a la que se le da acceso.', 'Invited person’s email and the account they get access to.'],
    items: ['CANAL-01', 'PIPE-08'], probe: async () => `Auth respondió: ${await authSettingsProbe()}` },
  { key: 'document_vault', name: ['Bóveda de documentos', 'Document vault'], provider: 'Supabase Storage (bucket privado)', file: 'document-vault', gate: VAULT_GATE,
    turnsOn: tir(['El comité decide una sola bóveda compartida con Sales Core y su retención.', 'The committee decides on a single vault shared with Sales Core and its retention.']),
    scopes: ['Llave de servicio; bucket privado CONTIGO_VAULT_BUCKET; enlaces firmados de 60 segundos.', 'Service key; private bucket CONTIGO_VAULT_BUCKET; 60-second signed links.'],
    dataOut: ['Documentos generados y del expediente de alta, con su huella SHA-256.', 'Generated and enrollment documents, with their SHA-256 fingerprint.'],
    items: ['E5.F9', 'CAMPO-06'], probe: async () => `Bucket privado: ${await storageBucketProbe('document_vault', process.env.CONTIGO_VAULT_BUCKET ?? '')}` },
  { key: 'audit_archive', name: ['Copia de la bitácora fuera de la base', 'Audit log copy outside the database'], provider: 'Supabase Storage (bucket privado)', file: 'audit-archive', gate: AUDIT_ARCHIVE_GATE, turnsOn: TIR,
    scopes: ['Llave de servicio; bucket privado AUDIT_ARCHIVE_BUCKET; sin reemplazo de objetos.', 'Service key; private bucket AUDIT_ARCHIVE_BUCKET; objects are never replaced.'],
    dataOut: ['Lotes de la bitácora (cambios de datos y de configuración) con su huella SHA-256.', 'Audit log batches (data and configuration changes) with their SHA-256 fingerprint.'],
    items: ['SEG-03'], probe: async () => `Bucket privado: ${await storageBucketProbe('audit_archive', process.env.AUDIT_ARCHIVE_BUCKET ?? '')}` },
  { key: 'esign', name: ['Firma electrónica', 'Electronic signature'], provider: 'Interfaz genérica; referencia Dropbox Sign (proveedor final [pendiente: Dan Mulligan o Michael Essiet])', file: 'partners', gate: PARTNER_GATES.esign,
    turnsOn: tir(['Elegir y comprar el proveedor final. Mientras ESIGN_TEST_MODE no sea 0, las solicitudes van en modo de prueba.', 'Choose and buy the final provider. Until ESIGN_TEST_MODE is 0, requests go in test mode.']),
    scopes: ['Llave de API de la cuenta de firma (Dropbox Sign: signature_request_send).', 'Signature account API key (Dropbox Sign: signature_request_send).'],
    dataOut: ['Nombre y correo de quien firma, título y enlace del documento.', 'Signer name and email, document title and link.'],
    items: ['E5.F7', 'PIPE-07'], probe: async () => `Cuenta: ${await dropboxSign.probe()}` },
  { key: 'geocoding', name: ['Geocodificación', 'Geocoding'], provider: 'Google Geocoding API', file: 'markets', gate: MARKET_GATES.geocoding, turnsOn: TIR,
    scopes: ['Llave de API restringida a Geocoding API.', 'API key restricted to the Geocoding API.'],
    dataOut: ['Dirección del comercio (calle, ciudad, estado, código postal, país).', 'Merchant address (street, city, state, postal code, country).'],
    items: ['MULTI-04'], probe: async () => ((await geocode('Mexico', 'MX')).status === 'found' ? 'Respondió con coordenadas' : 'Respondió sin resultado') },
  { key: 'ai', name: ['Modelo de IA', 'AI model'], provider: 'Anthropic Messages API', file: 'ai', gate: AI_GATE,
    turnsOn: tir(['Cada función pasa su evaluación (IA-08); Finanzas fija el precio por millón de tokens (AI_PRICE_*); api.anthropic.com en AI_EGRESS_ALLOWLIST.', 'Each feature passes its evaluation (catalog item 8 of the AI domain); Finance sets the price per million tokens (AI_PRICE_*); api.anthropic.com in AI_EGRESS_ALLOWLIST.']),
    scopes: ['Llave de API de la organización, sin herramientas.', 'Organization API key, no tools.'],
    dataOut: ['Datos citados de la función (texto del lead o de la pregunta) y la lista de opciones; el borrador de revisión usa solo cifras internas.', 'Quoted data of the feature (lead or question text) and the option list; the review draft uses internal figures only.'],
    items: ['IA-03', 'IA-04', 'IA-05', 'CS-05'], probe: async () => `Respondió (costo ${(await anthropicAsk({ system: 'Responde solo: ok', user: 'ok', maxTokens: 2 })).costUsd} USD)` },
  { key: 'traces', name: ['Trazas', 'Traces'], provider: 'OTLP/HTTP (cualquier destino compatible)', file: 'traces', gate: TRACES_GATE, turnsOn: TIR,
    scopes: ['Encabezados de OTEL_EXPORTER_OTLP_HEADERS si el destino pide llave.', 'OTEL_EXPORTER_OTLP_HEADERS headers if the destination needs a key.'],
    dataOut: ['Pantalla, tipo, duración, error y número de petición. Sin datos de personas.', 'Screen, kind, duration, error and request number. No personal data.'],
    items: ['GOB-07'], probe: async () => `${await otlpExport([{ traceId: '0'.repeat(31) + '1', spanId: '0'.repeat(15) + '1', name: 'probe', startMs: Date.now() - 1, endMs: Date.now(), error: false, attributes: { 'contigo.kind': 'probe' } }])} traza de prueba aceptada` },
  { key: 'billing', name: ['Facturación de la plataforma (lectura)', 'Platform billing (read)'], provider: 'Vercel billing API', file: 'billing', gate: BILLING_GATE, turnsOn: TIR,
    scopes: ['Token del equipo con lectura de facturación.', 'Team token with billing read.'],
    dataOut: ['Nada sale: se leen los cargos del mes.', 'Nothing goes out: the month’s charges are read.'],
    items: ['GOB-09'], probe: async () => `${(await vercelCharges(new Date().toISOString().slice(0, 7))).length} servicios con cargos este mes` },
  { key: 'zendesk_counts', name: ['Zendesk: conteos de solicitudes', 'Zendesk: request counts'], provider: 'Zendesk Support API', file: 'care', gate: { envVar: CARE_ADAPTERS.zendesk_counts.envVar, credentials: CARE_ADAPTERS.zendesk_counts.credentials },
    turnsOn: tir(['CS pone el id del comercio de CONTIGO como external_id de cada organización en Zendesk.', 'CS puts the CONTIGO merchant id as each Zendesk organization’s external_id.']),
    scopes: ['Token de API de un agente de solo lectura.', 'API token of a read-only agent.'],
    dataOut: ['El id del comercio (para buscar su organización).', 'The merchant id (to find its organization).'],
    items: ['CS-02'], probe: async () => `Rol del agente: ${await zendeskProbe()}` },
  { key: 'support_desk', name: ['Zendesk: enlace al ticket', 'Zendesk: ticket link'], provider: 'Zendesk (solo arma el enlace)', file: 'support-desk', gate: SUPPORT_DESK_GATE, turnsOn: TIR,
    scopes: ['Ninguno: solo el subdominio.', 'None: only the subdomain.'], dataOut: ['Nada sale.', 'Nothing goes out.'],
    items: ['ACT-01'], probe: async () => 'Sin llamada: solo arma enlaces al ticket' },
  { key: 'zoho', name: ['Zoho CRM (lectura para la conciliación)', 'Zoho CRM (read for reconciliation)'], provider: 'Zoho CRM API v2', file: 'zoho', gate: ZOHO_GATE, turnsOn: TIR,
    scopes: ['OAuth con ZohoCRM.modules.READ (solo lectura).', 'OAuth with ZohoCRM.modules.READ (read only).'], dataOut: ['Nada sale: se leen comercios, contactos y negocios.', 'Nothing goes out: merchants, contacts and deals are read.'],
    items: ['GOB-05'], probe: async () => await zohoProbe() },
  { key: 'kore_academy', name: ['Kore Academy (constancias)', 'Kore Academy (completions)'], provider: 'Contrato propio (docs/contracts/kore-academy-completions.md, propuesta)', file: 'care', gate: { envVar: CARE_ADAPTERS.kore_academy.envVar, credentials: CARE_ADAPTERS.kore_academy.credentials },
    turnsOn: tir(['Kore Academy implementa el contrato.', 'Kore Academy implements the contract.']), scopes: ['Token de lectura del contrato.', 'Contract read token.'],
    dataOut: ['Identificadores de comercio (merchant_ref).', 'Merchant identifiers (merchant_ref).'], items: ['CS-06'], probe: async () => await contractHealth('kore_academy', 'KORE_ACADEMY_URL', 'KORE_ACADEMY_TOKEN') },
  { key: 'care_signals', name: ['Datos y Reportería: saldo, comisión y productos', 'Data & Reporting: balance, commission and products'], provider: 'Supabase Storage (bucket de Datos y Reportería con manifiesto)', file: 'care', gate: { envVar: CARE_ADAPTERS.care_signals.envVar, credentials: CARE_ADAPTERS.care_signals.credentials },
    turnsOn: tir(['Datos y Reportería (Roxanna Quintero) publica el archivo "care_signals" en el manifiesto.', 'Data & Reporting (Roxanna Quintero) publishes the "care_signals" file in the manifest.']), scopes: ['Lectura del bucket S5_BUCKET.', 'Read on the S5_BUCKET bucket.'],
    dataOut: ['Nada sale.', 'Nothing goes out.'], items: ['CS-02', 'CS-03', 'CS-04'], probe: s5Probe },
  { key: 'sales_file', name: ['Datos y Reportería: archivo de ventas y cifras por tienda', 'Data & Reporting: sales file and store figures'], provider: 'Supabase Storage (bucket de Datos y Reportería con manifiesto)', file: 'sales-file', gate: SALES_FILE_GATE,
    turnsOn: tir(['Datos y Reportería (Roxanna Quintero) confirma el contrato y publica los archivos en el manifiesto.', 'Data & Reporting (Roxanna Quintero) confirms the contract and publishes the files in the manifest.']), scopes: ['Lectura del bucket S5_BUCKET.', 'Read on the S5_BUCKET bucket.'],
    dataOut: ['Nada sale.', 'Nothing goes out.'], items: ['PIPE-06', 'CS-01', 'CS-07', 'E5.F1', 'DAT-03'], probe: s5Probe },
  { key: 'funding_feed', name: ['Datos y Reportería: fondeo, saldo y límite', 'Data & Reporting: funding, balance and limit'], provider: 'Supabase Storage (bucket de Datos y Reportería con manifiesto)', file: 'funding-feed', gate: FUNDING_GATE,
    turnsOn: tir(['Datos y Reportería o el core publican el archivo "funding".', 'Data & Reporting or the core publish the "funding" file.']), scopes: ['Lectura del bucket S5_BUCKET.', 'Read on the S5_BUCKET bucket.'], dataOut: ['Nada sale.', 'Nothing goes out.'], items: ['CANAL-07'], probe: s5Probe },
  { key: 'fx_feed', name: ['Datos y Reportería: tasas de cambio', 'Data & Reporting: exchange rates'], provider: 'Supabase Storage (bucket de Datos y Reportería con manifiesto)', file: 'markets', gate: MARKET_GATES.fx_feed,
    turnsOn: tir(['Datos y Reportería publica tasas fechadas y Finanzas confirma la fuente.', 'Data & Reporting publishes dated rates and Finance confirms the source.']), scopes: ['Lectura del bucket S5_BUCKET.', 'Read on the S5_BUCKET bucket.'], dataOut: ['Nada sale.', 'Nothing goes out.'], items: ['MULTI-01'], probe: s5Probe },
  { key: 'snapshot_file', name: ['Datos y Reportería: archivo de la foto diaria', 'Data & Reporting: daily snapshot file'], provider: 'Supabase Storage (bucket de Datos y Reportería, carpeta from-contigo/)', file: 'report-channels', gate: SNAPSHOT_GATE, turnsOn: TIR,
    scopes: ['Escritura en S5_BUCKET/from-contigo/.', 'Write on S5_BUCKET/from-contigo/.'], dataOut: ['La foto diaria de negocios y cartera (CSV) con su huella.', 'The daily snapshot of deals and merchants (CSV) with its fingerprint.'], items: ['DAT-03'], probe: s5Probe },
  { key: 'tax_registry', name: ['Registro fiscal', 'Tax registry'], provider: 'Contrato genérico (docs/contracts/tax-registry.md); proveedor lo elige Compliance', file: 'markets', gate: MARKET_GATES.tax_registry, turnsOn: tir(['Compliance elige el proveedor.', 'Compliance chooses the provider.']),
    scopes: ['Token del proveedor.', 'Provider token.'], dataOut: ['Identificador fiscal completo (solo en la llamada; CONTIGO no lo guarda), razón social y código postal.', 'Full tax ID (only in the call; CONTIGO does not store it), legal name and postal code.'], items: ['MULTI-03'], probe: async () => await contractHealth('tax_registry', 'TAX_REGISTRY_URL', 'TAX_REGISTRY_TOKEN') },
  { key: 'protected_data', name: ['Resguardo del identificador completo', 'Vault for the full identifier'], provider: 'Supabase Storage + cifrado AES-256-GCM', file: 'markets', gate: MARKET_GATES.protected_data,
    turnsOn: tir(['Legal y Seguridad deciden si el valor completo se guarda (hoy el estándar lo prohíbe).', 'Legal and Security decide whether the full value is stored (today the standard forbids it).']), scopes: ['Escritura en PROTECTED_DATA_BUCKET.', 'Write on PROTECTED_DATA_BUCKET.'],
    dataOut: ['El identificador cifrado antes de salir.', 'The identifier, encrypted before it leaves.'], items: ['MULTI-03'], probe: async () => `Bucket privado: ${await storageBucketProbe('protected_data', process.env.PROTECTED_DATA_BUCKET ?? '')}` },
  { key: 'routes', name: ['Herramienta de rutas', 'Route tool'], provider: 'Contrato genérico (docs/contracts/route-tool.md); herramienta [pendiente: Ventas US]', file: 'routes', gate: ROUTES_GATE, turnsOn: tir(['Ventas US elige la herramienta.', 'US Sales chooses the tool.']),
    scopes: ['Token de la herramienta.', 'Tool token.'], dataOut: ['Tiendas de cada persona: nombre, dirección, teléfono, contacto, productos y actividad de 30 días.', 'Each person’s stores: name, address, phone, contact, products and 30-day activity.'], items: ['E5.F6', 'E12.F8', 'CAMPO-02'], probe: async () => await contractHealth('routes', 'ROUTE_TOOL_URL', 'ROUTE_TOOL_TOKEN') },
  { key: 'ad_conversions', name: ['Conversiones de anuncios', 'Ad conversions'], provider: 'Meta Conversions API, Google Ads, TikTok Events API, LinkedIn Conversions (X se queda en cola)', file: 'ad-conversions', gate: AD_GATE,
    turnsOn: tir(['MarTech da las cuentas de anuncios y confirma el nombre del evento por plataforma (AD_EVENT_*).', 'MarTech provides the ad accounts and confirms the event name per platform (AD_EVENT_*).']), scopes: ['Por plataforma: token de conversiones (ver variables).', 'Per platform: conversions token (see variables).'],
    dataOut: ['Identificador de clic, tipo de evento, fecha y llave de deduplicación. Sin datos de personas.', 'Click identifier, event type, date and dedupe key. No personal data.'], items: ['LEAD-02'],
    probe: async () => (Object.keys(AD_PLATFORM_VARS) as (keyof typeof AD_PLATFORM_VARS)[]).map((p) => `${p}: ${platformReady(p) ? 'lista' : 'sin credencial'}`).join(', ') },
  { key: 'field_crypto', name: ['Cifrado de campos', 'Field encryption'], provider: 'AES-256-GCM con llave por variable de entorno y versión (servicio de llaves final [pendiente: Dan Mulligan])', file: 'field-crypto', gate: FIELD_CRYPTO_GATE, turnsOn: TIR,
    scopes: ['Ninguno en un proveedor: las llaves viven en el ambiente.', 'None at a provider: keys live in the environment.'], dataOut: ['Nada sale.', 'Nothing goes out.'], items: ['SEG-02'],
    probe: async () => { const s = aesSeal('probe'); return aesOpen(s.cipher, s.payload) === 'probe' ? `Cifra y descifra con ${s.cipher}` : 'No descifró' } },
  { key: 'web_push', name: ['Push web', 'Web push'], provider: 'Web Push con VAPID (servicio de push del navegador)', file: 'web-push', gate: WEB_PUSH_GATE, turnsOn: TIR,
    scopes: ['Llaves VAPID propias; cada persona acepta en su navegador.', 'Own VAPID keys; each person accepts in their browser.'], dataOut: ['Título, texto y enlace del aviso, cifrados de punta a punta.', 'Notice title, text and link, end-to-end encrypted.'], items: ['AUT-05'],
    probe: async () => (vapidJwt('https://fcm.googleapis.com') ? 'Firma VAPID lista' : '') },
  { key: 'antibot', name: ['Verificación anti-bot', 'Anti-bot check'], provider: 'Cloudflare Turnstile (referencia)', file: 'antibot', gate: ANTIBOT_GATE, turnsOn: TIR,
    scopes: ['Llave secreta del sitio.', 'Site secret key.'], dataOut: ['El token del desafío del navegador.', 'The browser challenge token.'], items: ['SEG-10'], probe: async () => `Respondió (${(await turnstileVerify('probe')) ? 'aceptó' : 'rechazó'} un token de prueba)` },
  { key: 'event_delivery', name: ['Entrega de eventos a suscriptores', 'Event delivery to subscribers'], provider: 'HTTPS a la dirección de cada suscriptor, firmado', file: 'event-delivery', gate: EVENT_DELIVERY_GATE, turnsOn: TIR,
    scopes: ['Ninguno: cada suscriptor verifica la firma.', 'None: each subscriber verifies the signature.'], dataOut: ['El evento (qué cambió, nunca valores) firmado.', 'The signed event (what changed, never values).'], items: ['AUT-02', 'DAT-03'],
    probe: async () => 'Sin llamada: la llave de firma está lista; cada suscriptor se prueba desde Integraciones' },
  // Integración ola 7: los adaptadores que agregó la ola 6 (reportes2 y campo2) siguen la misma regla de encendido.
  { key: 'report_slack', name: ['Reportes programados a Slack', 'Scheduled reports to Slack'], provider: 'Slack (chat.postMessage, el mismo bot de los avisos)', file: 'report-channels', gate: REPORT_SLACK_GATE,
    turnsOn: tir(['El equipo dice en qué canal quiere los reportes (REPORT_SLACK_CHANNEL).', 'The team says which channel it wants the reports in (REPORT_SLACK_CHANNEL).']), scopes: ['chat:write del bot de Slack.', 'Slack bot chat:write.'],
    dataOut: ['Nombre y resumen de cada reporte programado.', 'Name and summary of each scheduled report.'], items: ['REP-01'], probe: async () => await slackAuthTest() },
  { key: 'feedback_to_pt', name: ['Resumen semanal de comentarios hacia P&T', 'Weekly feedback digest to P&T'], provider: 'Endpoint HTTP de P&T (propuesta)', file: 'campo2', gate: CAMPO2_GATES.feedback_to_pt,
    turnsOn: tir(['P&T dice dónde lo recibe (FEEDBACK_TO_PT_URL).', 'P&T says where it receives it (FEEDBACK_TO_PT_URL).']), scopes: ['Token de escritura del endpoint de P&T.', 'Write token for the P&T endpoint.'],
    dataOut: ['Conteos por tema y mercado, sin datos de personas.', 'Counts by topic and market, no personal data.'], items: ['CS-08'], probe: async () => `${new URL(process.env.FEEDBACK_TO_PT_URL ?? '').host} configurado` },
  { key: 'academy_progress', name: ['Kore Academy: avance de aliados', 'Kore Academy: partner progress'], provider: 'Contrato propio de Kore Academy (GET /v1/progress, propuesta)', file: 'campo2', gate: CAMPO2_GATES.academy_progress,
    turnsOn: tir(['Kore Academy expone el avance por aliado y material.', 'Kore Academy exposes progress per partner and material.']), scopes: ['Token de lectura del contrato.', 'Contract read token.'],
    dataOut: ['Identificadores de aliado y de material.', 'Partner and material identifiers.'], items: ['CANAL-06'], probe: async () => await contractHealth('academy_progress', 'KORE_ACADEMY_URL', 'KORE_ACADEMY_TOKEN') },
  { key: 'lakehouse_crossmatch', name: ['Datos y Reportería: cruce de bases de aliados', 'Data & Reporting: partner base cross-match'], provider: 'Supabase Storage (bucket de Datos y Reportería con manifiesto)', file: 'campo2', gate: CAMPO2_GATES.lakehouse_crossmatch,
    turnsOn: tir(['Datos y Reportería publica el archivo "partner_crossmatch" en el manifiesto.', 'Data & Reporting publishes the "partner_crossmatch" file in the manifest.']), scopes: ['Lectura del bucket S5_BUCKET.', 'Read on the S5_BUCKET bucket.'],
    dataOut: ['Nada sale.', 'Nothing goes out.'], items: ['CANAL-06'], probe: s5Probe },
  // Integración ola 7: pantallas en vivo por Broadcast (plataforma, AUT-02) con la misma regla de encendido.
  { key: 'realtime', name: ['Pantallas en vivo (Supabase Realtime Broadcast)', 'Live screens (Supabase Realtime Broadcast)'], provider: 'Supabase Realtime (Broadcast, canales privados)', file: 'realtime', gate: REALTIME_GATE, turnsOn: TIR,
    scopes: ['Llave de servicio de Supabase para publicar en Broadcast.', 'Supabase service key to publish on Broadcast.'], dataOut: ['Solo tema, tipo de evento y hora; nunca datos de registros.', 'Only topic, event type and time; never record data.'], items: ['AUT-02'], probe: async () => await authSettingsProbe() },
]

export const connector = (key: string) => CONNECTORS.find((c) => c.key === key)
/** Archivos de src/server/adapters que no son conectores nuevos, con su motivo (la prueba los acepta). */
export const NOT_CONNECTORS: Record<string, string> = {
  channel: 'Base común de correo, Slack y WhatsApp.',
  channels: 'Selector de canal para avisos.',
  identity: 'Ingreso con Google por Supabase Auth: ya está encendido en staging y producción.',
  pipedrive: 'Importación de Pipedrive: ya está conectada con su token.',
  registry: 'Este registro.',
}

export type ConnectorStatus = { def: ConnectorDef; mode: ConnectorMode; missing: string[]; approval: string | null; requested: Gate['requested']; approvalVar: string }
export function connectorStatus(): ConnectorStatus[] {
  return CONNECTORS.map((def) => {
    const g = gate(def.gate)
    return { def, mode: g.mode, missing: g.missing, approval: g.approval, requested: g.requested, approvalVar: approvalVar(def.gate.envVar) }
  })
}
export { GOOGLE_SA, SUPABASE_ADMIN }
