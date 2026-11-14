// Dueños de valores propuestos escritos en español (en la base o en el código), dichos en inglés.
const OWNER_EN: Record<string, string> = {
  Ventas: 'Sales', 'Ventas y canales': 'Sales and channels', 'Ventas y Finanzas': 'Sales and Finance', 'Finanzas y Ventas': 'Finance and Sales',
  'Mesa de control': 'Control desk', Operaciones: 'Operations', Finanzas: 'Finance', Liderazgo: 'Leadership', 'Liderazgo comercial': 'Sales leadership',
  'Ventas US': 'US Sales', 'por definir': 'to be defined',
}
// Dueños escritos en español en la base o en el código: se traducen por partes para que la versión en inglés no
// muestre "Legal y Seguridad" ni "Yamil (C1) con ventas".
const OWNER_WORDS: [RegExp, string][] = [
  [/\bquienes lideran los mercados\b/g, 'the market leads'], [/\bquien lidera el mercado\b/g, 'the market lead'], [/\bquien lidera\b/g, 'the lead'],
  [/\bcon ventas\b/g, 'with sales'], [/\bSeguridad\b/g, 'Security'], [/\bVentas\b/g, 'Sales'], [/\bFinanzas\b/g, 'Finance'],
  [/\bOperaciones\b/g, 'Operations'], [/\bLiderazgo\b/g, 'Leadership'], [/\bAdministración\b/g, 'Administration'], [/\bpor definir\b/g, 'to be defined'],
  [/ y /g, ' and '], [/ o /g, ' or '],
]
export const ownerEn = (o: string) => OWNER_EN[o] ?? OWNER_WORDS.reduce((s, [re, en]) => s.replace(re, en), o)
