/** AUT-04: permisos de escritura general de la API v1 (una llave de un solo mercado, nunca de prueba). Sin dependencias de servidor: la pantalla de llaves los lista. */
export const WRITE_SCOPES = ['accounts:write', 'deals:write', 'leads:write', 'activities:write'] as const
export type WriteScope = (typeof WRITE_SCOPES)[number]
