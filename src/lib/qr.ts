/**
 * LEAD-05: código QR propio, sin dependencias. Modo byte, corrección de errores nivel L, versiones 1 a 5 (un solo bloque),
 * suficiente para un enlace de hasta 106 caracteres. Devuelve la matriz (true = módulo oscuro) o el SVG listo para imprimir.
 * Sigue ISO/IEC 18004: patrones de posición, sincronía y alineación, información de formato con BCH y la máscara de menor castigo.
 */
const VERSIONS = [
  { v: 1, data: 19, ec: 7 },
  { v: 2, data: 34, ec: 10 },
  { v: 3, data: 55, ec: 15 },
  { v: 4, data: 80, ec: 20 },
  { v: 5, data: 108, ec: 26 },
] as const

const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!
}
const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!)

function reedSolomon(data: number[], ecLen: number): number[] {
  // Polinomio generador: producto de (x - α^i), i = 0..ecLen-1.
  let gen = [1]
  for (let i = 0; i < ecLen; i++) {
    const next = new Array<number>(gen.length + 1).fill(0)
    for (let j = 0; j < gen.length; j++) {
      next[j] = next[j]! ^ gen[j]!
      next[j + 1] = next[j + 1]! ^ mul(gen[j]!, EXP[i]!)
    }
    gen = next
  }
  const rem = new Array<number>(ecLen).fill(0)
  for (const d of data) {
    const factor = d ^ rem.shift()!
    rem.push(0)
    for (let j = 0; j < ecLen; j++) rem[j] = rem[j]! ^ mul(gen[j + 1]!, factor)
  }
  return rem
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

function penalty(m: boolean[][]): number {
  const n = m.length
  let score = 0
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < n; a++) {
      let run = 1
      for (let b = 1; b < n; b++) {
        const cur = pass === 0 ? m[a]![b]! : m[b]![a]!
        const prev = pass === 0 ? m[a]![b - 1]! : m[b - 1]![a]!
        if (cur === prev) run++
        else {
          if (run >= 5) score += run - 2
          run = 1
        }
      }
      if (run >= 5) score += run - 2
    }
  }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) if (m[y]![x] === m[y]![x + 1] && m[y]![x] === m[y + 1]![x] && m[y]![x] === m[y + 1]![x + 1]) score += 3
  let dark = 0
  for (const row of m) for (const c of row) if (c) dark++
  score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10
  return score
}

/** La matriz del código. Lanza si el texto no cabe (más de 106 bytes). */
export function qrMatrix(text: string): boolean[][] {
  const bytes = [...new TextEncoder().encode(text)]
  const ver = VERSIONS.find((c) => bytes.length <= c.data - 2)
  if (!ver) throw new Error('qr: text too long')
  const bits: number[] = []
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1)
  }
  push(0b0100, 4)
  push(bytes.length, 8)
  for (const b of bytes) push(b, 8)
  const cap = ver.data * 8
  for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0)
  while (bits.length % 8 !== 0) bits.push(0)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))
  for (let pad = 0xec; data.length < ver.data; pad ^= 0xec ^ 0x11) data.push(pad)
  const codewords = [...data, ...reedSolomon(data, ver.ec)]

  const n = 17 + 4 * ver.v
  const mod: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false))
  const fn: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false))
  const set = (x: number, y: number, dark: boolean) => {
    if (x < 0 || y < 0 || x >= n || y >= n) return
    mod[y]![x] = dark
    fn[y]![x] = true
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy))
      set(cx + dx, cy + dy, d !== 2 && d !== 4)
    }
  }
  finder(3, 3)
  finder(n - 4, 3)
  finder(3, n - 4)
  for (let i = 0; i < n; i++) {
    if (!fn[6]![i]) set(i, 6, i % 2 === 0)
    if (!fn[i]![6]) set(6, i, i % 2 === 0)
  }
  if (ver.v >= 2) {
    const c = 4 * ver.v + 10
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  }
  const drawFormat = (mask: number) => {
    const d = (1 << 3) | mask // nivel L
    let rem = d
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const f = ((d << 10) | rem) ^ 0x5412
    const bit = (i: number) => ((f >>> i) & 1) === 1
    for (let i = 0; i <= 5; i++) set(8, i, bit(i))
    set(8, 7, bit(6))
    set(8, 8, bit(7))
    set(7, 8, bit(8))
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i))
    for (let i = 0; i < 8; i++) set(n - 1 - i, 8, bit(i))
    for (let i = 8; i < 15; i++) set(8, n - 15 + i, bit(i))
    set(8, n - 8, true)
  }
  drawFormat(0)
  let i = 0
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < n; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? n - 1 - vert : vert
        if (!fn[y]![x] && i < codewords.length * 8) {
          mod[y]![x] = ((codewords[i >>> 3]! >>> (7 - (i & 7))) & 1) === 1
          i++
        }
      }
    }
  }
  let best: boolean[][] | null = null
  let bestScore = Infinity
  for (let mask = 0; mask < 8; mask++) {
    drawFormat(mask)
    const trial = mod.map((row, y) => row.map((c, x) => (fn[y]![x] ? c : c !== MASKS[mask]!(x, y))))
    const score = penalty(trial)
    if (score < bestScore) {
      bestScore = score
      best = trial
    }
  }
  return best!
}

/** El código como SVG (negro sobre blanco, con su margen), para verlo en pantalla o imprimirlo. */
export function qrSvg(text: string, label: string): string {
  const m = qrMatrix(text)
  const q = 4
  const size = m.length + q * 2
  let d = ''
  m.forEach((row, y) => row.forEach((c, x) => {
    if (c) d += `M${x + q} ${y + q}h1v1h-1z`
  }))
  const esc = label.replace(/[<>&"]/g, '')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`
}
