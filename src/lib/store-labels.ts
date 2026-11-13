import type { T } from '@/lib/format'

/** E9.F5: origen del comercio. */
export const ORIGIN: Record<string, [es: string, en: string]> = {
  new_acquisition: ['Alta nueva', 'New acquisition'],
  emida_conversion: ['Conversión de EMIDA', 'EMIDA conversion'],
}

/** E9.F12: quién reclutó la tienda, en palabras. */
export const recruiterText = (t: T, kind: string | null, agency: string | null): string | null =>
  kind === 'field_team' ? t('Equipo de campo de axexo', 'axexo field team')
    : kind === 'agency' ? t(`Agencia: ${agency ?? 's/d'}`, `Agency: ${agency ?? 'n/a'}`)
      : kind === 'partner' ? t(`Socio: ${agency ?? 's/d'}`, `Partner: ${agency ?? 'n/a'}`) : null
