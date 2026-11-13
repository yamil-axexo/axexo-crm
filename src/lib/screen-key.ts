/**
 * GOB-07: de una ruta a la pantalla que se mide. Los identificadores se quitan (un comercio no es una pantalla distinta)
 * y lo que venga después del "?" nunca entra: la medición no guarda qué registro ni qué búsqueda.
 */
export function screenKey(raw: string | null | undefined): string {
  let path = (raw ?? '').trim()
  try {
    if (/^https?:\/\//i.test(path)) path = new URL(path).pathname
  } catch {
    return 'otra'
  }
  path = (path.split(/[?#]/)[0] ?? '').toLowerCase()
  if (!path.startsWith('/') || path.startsWith('//')) return 'otra'
  const parts = path.split('/').filter(Boolean).slice(0, 5).map((p) => (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(p) || /^\d+$/.test(p) ? '[id]' : p))
  // Un formulario público se mide como una sola pantalla, sea cual sea su nombre.
  if (parts[0] === 'f' && parts.length > 1) parts[1] = '[formulario]'
  const key = `/${parts.join('/')}`
  return /^\/[a-z0-9/_[\]-]{0,79}$/.test(key) ? key : 'otra'
}
