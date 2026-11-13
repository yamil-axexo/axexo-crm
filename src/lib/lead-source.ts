/** Orígenes de un lead que llegó por un formulario web: el formulario de siempre o uno de campaña (E15.F2). */
export const WEB_SOURCES = ['web_form', 'web_campaign'] as const
export type WebSource = (typeof WEB_SOURCES)[number]
export const isWebSource = (source: string | null | undefined): source is WebSource => source === 'web_form' || source === 'web_campaign'
