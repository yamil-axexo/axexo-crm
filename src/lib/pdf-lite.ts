/**
 * E11.F3 (reportes2): un PDF hecho por la app, sin dependencias ni red. Texto en Helvetica (fuente base de PDF, sin incrustar),
 * rectángulos de color y varias páginas. Alcanza para un pedido: encabezado de marca, datos, tabla y totales.
 * Solo caracteres Latin-1 (español completo); lo demás sale como "?".
 */
export type PdfOp =
  | { kind: 'text'; x: number; y: number; size: number; text: string; bold?: boolean; color?: [number, number, number] }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; color: [number, number, number] }

export const A4 = { w: 595.28, h: 841.89 }

function esc(s: string): string {
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch
    else if (c >= 32 && c < 127) out += ch
    else if (c >= 160 && c <= 255) out += '\\' + c.toString(8).padStart(3, '0')
    else if (ch === '’' || ch === '‘') out += "'"
    else out += '?'
  }
  return out
}

const rgb = (c: [number, number, number]) => c.map((v) => (v / 255).toFixed(3)).join(' ')

/** Ancho aproximado de Helvetica (promedio por carácter), para cortar líneas y alinear a la derecha. */
export const textWidth = (s: string, size: number, bold = false) => s.length * size * (bold ? 0.56 : 0.52)

export function buildPdf(pages: PdfOp[][], meta: { title: string }): Buffer {
  const objs: string[] = []
  const add = (body: string) => { objs.push(body); return objs.length }
  const catalog = add('') // se llena al final
  const pagesObj = add('')
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  const fontB = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  const kids: number[] = []
  for (const ops of pages) {
    const stream = ops.map((o) => o.kind === 'rect'
      ? `${rgb(o.color)} rg ${o.x.toFixed(2)} ${o.y.toFixed(2)} ${o.w.toFixed(2)} ${o.h.toFixed(2)} re f`
      : `BT ${rgb(o.color ?? [0, 0, 0])} rg /${o.bold ? 'F2' : 'F1'} ${o.size} Tf ${o.x.toFixed(2)} ${o.y.toFixed(2)} Td (${esc(o.text)}) Tj ET`).join('\n')
    const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`)
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /Font << /F1 ${font} 0 R /F2 ${fontB} 0 R >> >> /Contents ${content} 0 R >>`))
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`
  const info = add(`<< /Title (${esc(meta.title)}) /Producer (axexo CONTIGO) >>`)
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'))
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}
