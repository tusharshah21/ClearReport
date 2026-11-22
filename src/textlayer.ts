// Plain code, runs locally: positioned words from a PDF text layer (or OCR), grouped into lines.
// Used to cross-check extracted values (verify) and to suggest mask boxes (see masks.ts).
import { displayName } from './canonical'

// Coordinates are fractions of the page (0..1), y from the top.
export type Word = { text: string; x0: number; y0: number; x1: number; y1: number }
export type Line = { words: Word[]; text: string; y0: number; y1: number }
export type Check = 'verified' | 'mismatch' | 'unverified'

type PdfItem = { str: string; transform: number[]; width: number; height: number }
type PdfPage = { getViewport(o: { scale: number }): { width: number; height: number }; getTextContent(): Promise<{ items: unknown[] }> }

export async function pageWords(page: PdfPage): Promise<Word[]> {
  const { width: W, height: H } = page.getViewport({ scale: 1 })
  const words: Word[] = []
  for (const raw of (await page.getTextContent()).items) {
    const it = raw as PdfItem
    if (!it.str?.trim()) continue
    const h = Math.abs(it.transform[3]) || it.height || 10
    const x = it.transform[4], base = H - it.transform[5]
    // Split items like "Urea Nitrogen  Blood" into words, sharing the width by character count.
    let pos = 0
    for (const part of it.str.split(/(\s+)/)) {
      const w = (part.length / it.str.length) * it.width
      if (part.trim()) words.push({ text: part, x0: (x + pos) / W, x1: (x + pos + w) / W, y0: (base - h) / H, y1: base / H })
      pos += w
    }
  }
  return words
}

// Words whose vertical centres are close form a line. Touching fragments ("2" "50" ".70") are joined into one word.
export function toLines(words: Word[]): Line[] {
  const sorted = [...words].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0)
  const lines: Word[][] = []
  for (const w of sorted) {
    const c = (w.y0 + w.y1) / 2, h = w.y1 - w.y0
    const line = lines.find((l) => Math.abs((l[0].y0 + l[0].y1) / 2 - c) < h * 0.45)
    if (line) line.push(w)
    else lines.push([w])
  }
  return lines.map((ws) => {
    ws.sort((a, b) => a.x0 - b.x0)
    const merged: Word[] = []
    for (const w of ws) {
      const prev = merged.at(-1)
      if (prev && w.x0 - prev.x1 < (w.y1 - w.y0) * 0.12) merged[merged.length - 1] = { text: prev.text + w.text, x0: prev.x0, x1: w.x1, y0: Math.min(prev.y0, w.y0), y1: Math.max(prev.y1, w.y1) }
      else merged.push({ ...w })
    }
    return { words: merged, text: merged.map((w) => w.text).join(' '), y0: Math.min(...merged.map((w) => w.y0)), y1: Math.max(...merged.map((w) => w.y1)) }
  }).sort((a, b) => a.y0 - b.y0)
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const numbersIn = (s: string) => [...s.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]))
const has = (nums: number[], v: number) => nums.some((n) => Math.abs(n - v) < 1e-9)

// Finds the test's row on the page and the numbers printed to the right of its name, on the same row
// or within one row-height (values often sit a few points off the name's baseline).
// nth: which occurrence of a repeated name (WM15 prints "Neutrophils" as % and as an absolute count).
function rowNumbers(name: string, lines: Line[], nth = 0): { nums: number[]; text: string } | null {
  const want = norm(displayName(name).replace(/\([^)]*\)/g, ' ')).split(' ').slice(0, 4).join(' ') // "Creatinine (Modified Jaffe)" -> "creatinine"
  if (!want) return null
  const at = (l: Line) => ` ${norm(l.text)} `.indexOf(` ${want} `) // word-bounded: "ldl" must not match "vldl"
  const numbersBeside = (line: Line) => {
    // x where the name ends: the word that completes the name's leading words
    const n = want.split(' ').length
    let seen = 0, end = line.words[0].x1
    for (const w of line.words) { if (seen >= n) break; seen += norm(w.text).split(' ').filter(Boolean).length; end = w.x1 }
    const h = line.y1 - line.y0 // values often sit a little above or below the name's baseline
    const words = lines.filter((l) => l.y1 > line.y0 - h * 0.5 && l.y0 < line.y1 + h * 0.5).flatMap((l) => l.words.filter((w) => w.x0 > end))
    return { nums: words.flatMap((w) => numbersIn(w.text)), text: words.map((w) => w.text).join(' ') }
  }
  // Rows that start with the name first; a name later in a line (e.g. inside "Non-HDL") is a fallback.
  // Headings such as "GLUCOSE, FASTING (F), PLASMA" have no numbers beside them and are skipped.
  const rows = [...lines.filter((l) => at(l) === 0), ...lines.filter((l) => at(l) > 0)].map(numbersBeside).filter((r) => r.nums.length)
  return rows[nth] ?? rows[0] ?? null
}

// Units compared loosely: "µg/dL" = "ug/dL", "m²" = "m2", case ignored.
const unitKey = (s: string) => s.toLowerCase().replace(/²/g, '2').replace(/µ|μ/g, 'u').replace(/[^a-z0-9%/.]/g, '')
// Unit-like tokens in the row text: anything with a slash, or a bare %.
const keys = (s: string) => s.split(/\s+/).map(unitKey).filter(Boolean).join(' ')
const unitsIn = (s: string) => s.split(/\s+/).map(unitKey).filter((w) => /[a-z%]/.test(w) && (w.includes('/') || w === '%'))

// A line that could be a result row: a number plus a unit, or a printed range like "8.80 - 10.60".
// ("110085 -110085" in an address has no space after the dash and does not count.)
const looksLikeResult = (text: string) => /\d/.test(text) && (unitsIn(text).length > 0 || /\d\s+-\s+\d/.test(text))

// Cheap local check before any model call: which pages can hold results? A page counts as "no results" only if
// it has a real text layer, no result-like line, and no large image that could be a scanned table.
// A large image of the same size on EVERY page, in a document whose results are in its text, is a letterhead
// (Dr Lal draws a 1240x1753 background on each page) and does not count.
// images[i]: "WxH" of each image page i draws.
export function pagesWithResults(pages: { words: Word[]; images: string[] }[]): boolean[] {
  const big = (d: string) => d.split('x').reduce((a, b) => a * Number(b), 1) >= 1e6
  const text = pages.map((p) => p.words.length >= 20 && toLines(p.words).some((l) => looksLikeResult(l.text)))
  const template = new Set(text.some(Boolean) ? pages[0]?.images.filter((d) => big(d) && pages.every((p) => p.images.includes(d))) : [])
  return pages.map((p, i) => p.words.length < 20 || text[i] || p.images.some((d) => big(d) && !template.has(d)))
}

export type ValueCheck = { value: Check; range: Check; unit: Check }
export function verify(t: { name: string; value: number | null; unit?: string | null; ref_low: number | null; ref_high: number | null }, lines: Line[] | null, nth = 0): ValueCheck {
  const none: ValueCheck = { value: 'unverified', range: 'unverified', unit: 'unverified' }
  if (!lines?.length) return none
  const row = rowNumbers(t.name, lines, nth)
  if (!row) return none
  const { nums, text } = row
  const bounds = [t.ref_low, t.ref_high].filter((b): b is number => b !== null)
  const printed = unitsIn(text)
  return {
    value: t.value === null ? 'unverified' : has(nums, t.value) ? 'verified' : 'mismatch',
    range: !bounds.length ? 'unverified' : bounds.every((b) => has(nums, b)) ? 'verified' : 'mismatch',
    // A missing unit is a mismatch only when the PDF prints one on that row.
    // Whole tokens only: "g/dL" must not verify against a printed "µg/dL".
    unit: t.unit ? (` ${keys(text)} `.includes(` ${keys(t.unit)} `) ? 'verified' : 'mismatch') : printed.length ? 'mismatch' : 'unverified',
  }
}
