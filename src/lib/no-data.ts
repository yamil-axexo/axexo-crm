/**
 * Marca de "sin dato" en una celda o en un valor: "s/d" en español y "n/a" en inglés. Nunca un guion largo.
 * En pantalla va con su explicación ("Sin dato" / "No data"): el componente NoData de src/ui/kit.tsx la pone.
 * Vive aparte de format.ts para que un componente cliente la use sin cargar el formateo de teléfonos.
 */
export const noData = (locale: 'es' | 'en') => (locale === 'en' ? 'n/a' : 's/d')
export const noDataLabel = (locale: 'es' | 'en') => (locale === 'en' ? 'No data' : 'Sin dato')
