type Pair = [es: string, en: string]

export const ALERT_KIND: Record<string, Pair> = {
  exports_per_day: ['Muchas exportaciones en un día', 'Many exports in one day'],
  export_rows_per_day: ['Muchas filas exportadas en un día', 'Many rows exported in one day'],
  searches_per_hour: ['Muchas búsquedas en una hora', 'Many searches in one hour'],
  list_rows_per_day: ['Muchas filas vistas en listas en un día', 'Many rows viewed in lists in one day'],
  reveals_per_day: ['Muchos datos reservados revelados en un día', 'Many restricted values revealed in one day'],
  api_calls_per_hour: ['Muchas llamadas con una llave en una hora', 'Many calls with one key in an hour'],
  api_rows_per_day: ['Muchas filas leídas con una llave en un día', 'Many rows read with one key in one day'],
  key_expiring: ['Llave por vencer', 'Key about to expire'],
  key_unused: ['Llave sin uso', 'Unused key'],
  secret_rotation_due: ['Rotación de un secreto vencida', 'Secret rotation overdue'],
  direct_sql_change: ['Datos cambiados por fuera de la aplicación', 'Data changed outside the application'],
}

export const THRESHOLD_LABEL: Record<string, Pair> = {
  exports_per_day: ['Exportaciones por persona al día', 'Exports per person per day'],
  export_rows_per_day: ['Filas exportadas por persona al día', 'Rows exported per person per day'],
  searches_per_hour: ['Búsquedas por persona por hora', 'Searches per person per hour'],
  reveals_per_day: ['Datos reservados revelados por persona al día', 'Restricted values revealed per person per day'],
  api_calls_per_hour: ['Llamadas por llave por hora', 'Calls per key per hour'],
  api_rows_per_day: ['Filas leídas por llave al día', 'Rows read per key per day'],
  key_unused_days: ['Días sin uso para avisar de una llave', 'Days unused before flagging a key'],
  key_expiring_days: ['Días antes del vencimiento para avisar', 'Days before expiry to flag'],
  list_rows_per_day: ['Filas vistas en listas por persona al día', 'Rows viewed in lists per person per day'],
}

export const VIA_LABEL: Record<string, Pair> = {
  screen: ['Pantalla', 'Screen'],
  api: ['API', 'API'],
  form: ['Formulario web', 'Web form'],
  import: ['Importación', 'Import'],
  job: ['Tarea programada', 'Scheduled job'],
  system: ['Integración o sistema', 'Integration or system'],
  sql: ['SQL directo', 'Direct SQL'],
}

export const REQUEST_KIND: Record<string, Pair> = {
  access: ['Ver sus datos', 'See their data'],
  rectification: ['Corregir sus datos', 'Correct their data'],
  erasure: ['Eliminar sus datos', 'Erase their data'],
}

export const REQUEST_STATUS: Record<string, Pair> = {
  received: ['Recibida', 'Received'],
  in_progress: ['En curso', 'In progress'],
  done: ['Atendida', 'Done'],
  rejected: ['No procede', 'Does not apply'],
}

export const CHANNEL_LABEL: Record<string, Pair> = {
  email: ['Correo', 'Email'],
  phone: ['Llamada', 'Phone call'],
  sms: ['SMS', 'SMS'],
  whatsapp: ['WhatsApp', 'WhatsApp'],
  all: ['Todos los canales', 'All channels'],
}

export const TEAM_FUNCTION: Record<string, Pair> = {
  support: ['Apoyo de ventas', 'Sales support'],
  specialist: ['Especialista', 'Specialist'],
  operations: ['Operaciones', 'Operations'],
  executive: ['Patrocinio ejecutivo', 'Executive sponsor'],
  other: ['Otro', 'Other'],
}

export const CONSENT_CATEGORY: Record<string, Pair> = {
  service: ['Sobre su cuenta y servicio', 'About their account and service'],
  marketing: ['Promociones y novedades', 'Promotions and news'],
}

export const CONSENT_SOURCE: Record<string, Pair> = {
  verbal: ['Lo dijo de palabra', 'Said it verbally'],
  written: ['Lo firmó o lo escribió', 'Signed or wrote it'],
  web_form: ['Formulario web', 'Web form'],
  import: ['Venía de otro sistema', 'Came from another system'],
}
