// Etiquetas del origen de un texto no confiable (IA-07). Sin dependencias de servidor: las usa la interfaz.
export const UNTRUSTED_ORIGINS = ['web_form', 'api_form', 'sales_app', 'csv_import', 'route_tool'] as const
export type UntrustedOrigin = (typeof UNTRUSTED_ORIGINS)[number]
export const ORIGIN_LABEL: Record<UntrustedOrigin, [es: string, en: string]> = {
  web_form: ['un formulario web', 'a web form'],
  api_form: ['el formulario del sitio (API)', 'the website form (API)'],
  sales_app: ['la Sales App', 'the Sales App'],
  csv_import: ['un archivo importado', 'an imported file'],
  route_tool: ['la herramienta de rutas', 'the route tool'],
}
