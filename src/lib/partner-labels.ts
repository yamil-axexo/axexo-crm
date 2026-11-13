type Pair = [string, string]
/** Estados de una carga de red adquirida (DAT-06). */
export const LOAD_STATUS: Record<string, { label: Pair; tone: 'neutral' | 'info' | 'good' | 'warn' }> = {
  staged: { label: ['En espacio aparte', 'In separate space'], tone: 'info' },
  released: { label: ['Liberada', 'Released'], tone: 'warn' },
  done: { label: ['En la cartera', 'In the portfolio'], tone: 'good' },
  rolled_back: { label: ['Regresada', 'Rolled back'], tone: 'neutral' },
}
export const SYSTEM_LABEL: Record<string, Pair> = { emida: ['EMIDA', 'EMIDA'], sky: ['Sky', 'Sky'], movilway: ['Movilway', 'Movilway'], other: ['Otro sistema', 'Other system'] }
export const ROW_STATUS: Record<string, { label: Pair; tone: 'neutral' | 'info' | 'good' | 'warn' | 'bad' }> = {
  ready: { label: ['Lista', 'Ready'], tone: 'info' },
  error: { label: ['Con problemas', 'With issues'], tone: 'bad' },
  duplicate: { label: ['Repetida', 'Duplicate'], tone: 'warn' },
  promoted: { label: ['En la cartera', 'In the portfolio'], tone: 'good' },
  kept: { label: ['Se quedó (ya trabajada)', 'Stayed (already worked)'], tone: 'good' },
  rolled_back: { label: ['Regresada', 'Rolled back'], tone: 'neutral' },
}
/** Problemas de calidad de una fila y llaves de repetido. */
export const ISSUE_LABEL: Record<string, Pair> = {
  missing_id: ['Sin ID', 'No ID'],
  repeated_id: ['ID repetido en el archivo', 'ID repeated in the file'],
  missing_name: ['Sin nombre', 'No name'],
  bad_phone: ['Teléfono que no se entiende', 'Unreadable phone'],
  bad_kind: ['Tipo que no se entiende', 'Unreadable type'],
  prohibited: ['Traía un dato que no se guarda (tarjeta, cuenta o identificación)', 'Had data that is not stored (card, account or ID)'],
  dup_alias: ['Ya existe con el mismo ID del sistema', 'Already exists with the same system ID'],
  dup_phone: ['Ya existe con el mismo teléfono', 'Already exists with the same phone'],
  dup_name: ['Ya existe con el mismo nombre y ciudad', 'Already exists with the same name and city'],
  dup_in_file: ['Mismo teléfono que otra fila del archivo', 'Same phone as another row in the file'],
}
