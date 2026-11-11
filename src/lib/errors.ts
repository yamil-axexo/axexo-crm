// Errores de dominio con mensaje en los dos idiomas. Nunca llevan datos personales (OBS-01).
export class DomainError extends Error {
  constructor(
    public code: string,
    public es: string,
    public en: string,
    public status = 422,
  ) {
    super(en)
    this.name = 'DomainError'
  }
}

export const forbidden = () => new DomainError('forbidden', 'No tienes permiso para hacer esto.', 'You do not have permission to do this.', 403)
export const notFound = (es = 'No encontramos ese registro.', en = 'We could not find that record.') =>
  new DomainError('not_found', es, en, 404)
export const invalid = (es: string, en: string) => new DomainError('invalid', es, en, 422)

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string; code: string }
