/**
 * E5.F9: un PDF de texto armado en el navegador, sin librerías ni red. Página carta, Helvetica, márgenes de 1 pulgada,
 * con salto de línea por ancho aproximado y salto de página. Acentos y ñ salen con WinAnsiEncoding (Latin-1); un carácter
 * fuera de Latin-1 se cambia por "?" para que el archivo siempre abra.
 */
const W = 612
const H = 792
const M = 72

const latin1 = (s: string) => s.normalize('NFC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[^\x0a\x20-\x7e\xa0-\xff]/g, '?')
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')

/** Parte un párrafo en líneas que caben en el ancho (Helvetica: ~0.5 del tamaño por carácter en promedio). */
export function wrap(text: string, size: number, width = W - 2 * M): string[] {
  const max = Math.max(10, Math.floor(width / (size * 0.5)))
  const out: string[] = []
  for (const para of text.split('\n')) {
    if (para.trim() === '') { out.push(''); continue }
    let line = ''
    for (const word of para.split(/\s+/)) {
      if (!word) continue
      if ((line ? line.length + 1 : 0) + word.length > max) {
        if (line) out.push(line)
        let w = word
        while (w.length > max) { out.push(w.slice(0, max)); w = w.slice(max) }
        line = w
      } else line = line ? `${line} ${word}` : word
    }
    out.push(line)
  }
  return out
}

/** Devuelve los bytes del PDF: título en 16 pt y el cuerpo en 11 pt. */
export function textPdf(title: string, body: string, footer?: string): Uint8Array {
  const lines: { text: string; size: number }[] = [
    ...wrap(latin1(title), 16).map((t) => ({ text: t, size: 16 })),
    { text: '', size: 11 },
    ...wrap(latin1(body), 11).map((t) => ({ text: t, size: 11 })),
    ...(footer ? [{ text: '', size: 11 }, ...wrap(latin1(footer), 9).map((t) => ({ text: t, size: 9 }))] : []),
  ]
  const pages: string[] = []
  let y = H - M
  let ops: string[] = []
  for (const l of lines) {
    const lead = l.size * 1.4
    if (y - lead < M) { pages.push(ops.join('\n')); ops = []; y = H - M }
    y -= lead
    if (l.text) ops.push(`BT /F1 ${l.size} Tf ${M} ${y.toFixed(1)} Td (${esc(l.text)}) Tj ET`)
  }
  pages.push(ops.join('\n'))

  const objs: string[] = []
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  const kids: string[] = []
  pages.forEach((content, i) => {
    const pageNo = 4 + i * 2
    kids.push(`${pageNo} 0 R`)
    objs[pageNo] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageNo + 1} 0 R >>`
    objs[pageNo + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  })
  objs[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`

  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = out.length
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`
  }
  const xref = out.length
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  // Latin-1: un byte por carácter, así los desplazamientos de arriba coinciden con los bytes.
  const bytes = new Uint8Array(out.length)
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff
  return bytes
}
