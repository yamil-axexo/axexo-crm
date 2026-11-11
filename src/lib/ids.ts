const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Un id que llega de la URL o de un formulario solo se usa en una consulta si tiene forma de UUID. */
export const isUuid = (v: string | null | undefined): v is string => !!v && UUID.test(v)
