// Plain code, runs locally: positioned words from a PDF text layer (or OCR), grouped into lines.
// Used to cross-check extracted values (verify) and to suggest mask boxes (see masks.ts).
import { canonical, displayName } from './canonical'

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
// Digit grouping is read as one number: "7,400" and Indian "1,25,000" (a comma between other digits stays a separator).
const numbersIn = (s: string) => [...s.matchAll(/\d{1,3}(?:,\d{2,3})+(?:\.\d+)?(?!\d)|\d+(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, '')))
const has = (nums: number[], v: number) => nums.some((n) => Math.abs(n - v) < 1e-9)

// Finds the test's row on the page and the numbers printed to the right of its name, on the same row
// or within one row-height (values often sit a few points off the name's baseline).
// nth: which occurrence of a repeated name (WM15 prints "Neutrophils" as % and as an absolute count).
type RowText = { nums: number[]; bare: number[]; text: string; lines: string[][] }
function rowNumbers(name: string, lines: Line[], nth = 0, others: string[] = []): RowText | null {
  const full = norm(displayName(name).replace(/\([^)]*\)/g, ' ')).split(' ').filter(Boolean).slice(0, 4) // "Creatinine (Modified Jaffe)" -> "creatinine"
  // A name wrapped over two lines ("Glycosylated" / "Haemoglobin (HbA1c)") is found by its leading words; one word
  // alone only if it is distinctive (6+ letters, not "Total" or "Serum").
  for (let k = full.length; k >= 1; k--) {
    if (k === 1 && full.length > 1 && (full[0].length < 6 || GENERIC.has(full[0]))) break
    const r = rowWithName(full.slice(0, k).join(' '), lines, nth, namesOf(name, others))
    if (r) return r
  }
  return null
}
// Another test's name starting at word j of ws: how many words it takes (0 if none). A name counts if it is one of the
// report's other rows, or any name in the alias table that is not this test's own (so "PCV (Haematocrit)" is one name).
type Names = { own: string; others: string[] }
const namesOf = (name: string, others: string[]): Names => ({ own: canonical(displayName(name)), others: others.map((o) => norm(displayName(o).replace(/\([^)]*\)/g, ' '))).filter(Boolean) })
function nameAt(ws: string[], j: number, names: Names): number {
  for (let L = Math.min(4, ws.length - j); L >= 1; L--) {
    const text = ws.slice(j, j + L).join(' '), key = canonical(text)
    if (/^\d|^[<>≤≥]/.test(ws[j]) || key === names.own) continue
    if (!key.startsWith('?') || names.others.includes(norm(text))) return L
  }
  return 0
}
function rowWithName(want: string, lines: Line[], nth: number, names: Names): RowText | null {
  const at = (l: Line) => ` ${norm(l.text)} `.indexOf(` ${want} `) // word-bounded: "ldl" must not match "vldl"
  const numbersBeside = (line: Line) => {
    // x where the name ends: the word that completes the name's leading words
    const n = want.split(' ').length
    const first = line.words.findIndex((w) => want.startsWith(norm(w.text).split(' ')[0] || '\0'))
    let seen = 0, end = line.words[0].x1
    for (const w of line.words.slice(Math.max(0, first))) { if (seen >= n) break; seen += norm(w.text).split(' ').filter(Boolean).length; end = w.x1 }
    const start = line.words[Math.max(0, first)].x0
    const h = line.y1 - line.y0 // values often sit a little above or below the name's baseline
    const mid = (l: Line) => (l.y0 + l.y1) / 2 // centres, so the next line of a card (its value line) is not this row
    const row = lines.filter((l) => Math.abs(mid(l) - mid(line)) < h * 0.75).flatMap((l) => l.words)
    // Right of the name first; then left of it, for labs that print the result before the test name. Each side ends
    // at another test's name: in a table printed two to a line, the other half of the line is that test's row.
    const right = row.filter((w) => w.x0 > end).sort((a, b) => a.x0 - b.x0), leftOf = row.filter((w) => w.x1 < start).sort((a, b) => a.x0 - b.x0)
    const rt = right.map((w) => w.text), lt = leftOf.map((w) => w.text)
    const stop = rt.findIndex((_, j) => nameAt(rt, j, names) > 0)
    let from = 0
    for (let j = 0; j < lt.length; j++) { const L = nameAt(lt, j, names); if (L) { from = j + L; j += L - 1 } }
    // Left of the name: all of it when no other name is there (a lab that prints the result first). With another name
    // there and numbers right of this one, the left half of the line is the row of the test printed before this one.
    const mine = stop < 0 ? right : right.slice(0, stop)
    const words = from > 0 && mine.some((w) => /^[<>≤≥(↑↓]*\d/.test(w.text)) ? mine : [...mine, ...leftOf.slice(from)]
    const bare = words.filter((w) => /^(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d+)?$/.test(w.text)).map((w) => Number(w.text.replace(/,/g, '')))
    return { nums: words.flatMap((w) => numbersIn(w.text)), bare, text: words.map((w) => w.text).join(' '), lines: [words.map((w) => w.text)] }
  }
  // Rows that start with the name first; a name later in a line (e.g. inside "Non-HDL") is a fallback.
  // Headings such as "GLUCOSE, FASTING (F), PLASMA" have no numbers beside them and are skipped.
  const named = [...lines.filter((l) => at(l) === 0), ...lines.filter((l) => at(l) > 0)]
  // A number word, not a digit inside a name such as "HbA1c" printed beside this one.
  const numeric = (r: RowText) => /(^|\s)[<>≤≥(↑↓]*\d/.test(r.text)
  const rows = named.map(numbersBeside).filter(numeric)
  if (rows.length) return rows[nth] ?? rows[0]
  // No number on any line with the name: a card layout prints the value and range on the lines below it.
  const below = named.map((l) => windowBelow(want, l, lines, names)).filter(numeric)
  return below[nth] ?? below[0] ?? null
}

// The lines under a test's name, in the name's own column, while they stay in the same layout block: stops at a
// blank gap (a vertical gap taller than the name's line, or nothing in the column), at a line that holds another
// test's name (one of the report's other rows, or any name in the alias table), and after MAX_BELOW lines.
// The column runs from the name's left edge to the next word to its right on the name's line (the next card).
// So a value is never taken from the card beside it, from the card below it, or from the next test in a list.
const MAX_BELOW = 4
function windowBelow(want: string, line: Line, lines: Line[], names: Names) {
  const n = want.split(' ').length
  const first = Math.max(0, line.words.findIndex((w) => want.startsWith(norm(w.text).split(' ')[0] || '\0')))
  let seen = 0, k = first
  while (k < line.words.length && seen < n) seen += norm(line.words[k++].text).split(' ').filter(Boolean).length
  const left = line.words[first].x0 - 0.01, right = (line.words[k]?.x0 ?? 1.01) - 0.005
  const inColumn = (w: Word) => (w.x0 + w.x1) / 2 >= left && (w.x0 + w.x1) / 2 < right
  const otherNames = names.others.filter((o) => o !== want && !want.startsWith(o))
  const isName = (text: string) => {
    const t = norm(text), ws = t.split(' ')
    return otherNames.some((o) => ` ${t} `.includes(` ${o} `)) || [4, 3, 2, 1].some((j) => ws.length >= j && !canonical(ws.slice(0, j).join(' ')).startsWith('?'))
  }
  const taken: Word[][] = []
  let prev = line
  for (const next of lines.filter((l) => l.y0 > line.y0).slice(0, MAX_BELOW)) {
    if (next.y0 - prev.y1 > (line.y1 - line.y0) * 1.2) break
    const ws = next.words.filter(inColumn)
    if (!ws.length || isName(ws.map((w) => w.text).join(' '))) break
    taken.push(ws)
    prev = next
  }
  const words = taken.flat()
  const bare = words.filter((w) => /^(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d+)?$/.test(w.text)).map((w) => Number(w.text.replace(/,/g, '')))
  return { nums: words.flatMap((w) => numbersIn(w.text)), bare, text: words.map((w) => w.text).join(' '), lines: taken.map((ws) => ws.map((w) => w.text)) }
}
const GENERIC = new Set(['total', 'serum', 'plasma', 'blood', 'random', 'fasting', 'absolute', 'estimated', 'calculated'])

// Units compared loosely: "µg/dL" = "ug/dL", "m²" = "m2", case ignored.
const unitKey = (s: string) => s.toLowerCase().replace(/²/g, '2').replace(/µ|μ/g, 'u').replace(/[^a-z0-9%/.]/g, '')
// Unit-like tokens in the row text: anything with a slash, or a bare %.
const keys = (s: string) => s.split(/\s+/).map(unitKey).filter(Boolean).join(' ')
const unitsIn = (s: string) => s.split(/\s+/).map(unitKey).filter((w) => /[a-z%]/.test(w) && (w.includes('/') || w === '%'))

// A line that could be a result row: a number plus a unit, or a printed range like "8.80 - 10.60".
// ("110085 -110085" in an address has no space after the dash and does not count.)
export const looksLikeResult = (text: string) => /\d/.test(text) && (unitsIn(text).length > 0 || /\d\s+-\s+\d/.test(text))

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

// pdf_value: the first number printed beside the test name, offered to the user as a suggestion (never auto-accepted).
// pdf_flag: H or L when the PDF prints a flag beside this value (H/L/High/Low or an arrow, joined to the number or
// on the same row); null when no flag is printed there; undefined when the row was not found.
export type ValueCheck = { value: Check; range: Check; unit: Check; pdf_value: number | null; pdf_flag?: 'H' | 'L' | null }
const FLAG_WORD = /^(h|l|high|low|↑|↓)$/i
const flagOf = (w: string) => (/^(h|high|↑)$/i.test(w) ? 'H' : 'L')
export function flagBeside(value: number | null, lines: string[][]): 'H' | 'L' | null {
  if (value === null) return null
  for (const ws of lines)
    for (const w of ws) {
      const m = w.match(/^([↑↓])?(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)[*#†]*(H|L|[↑↓])?$/)
      if (!m || Number(m[2].replace(/,/g, '')) !== value) continue
      if (m[1] || m[3]) return flagOf(m[1] ?? m[3])
      // Otherwise a flag word on the value's own row: these words are the row beside the name, or one line of the
      // name's column in a card, so a flag printed for the test next to it is never in them.
      const f = ws.find((x) => FLAG_WORD.test(x))
      if (f) return flagOf(f)
    }
  return null
}
// others: the names of the report's other rows, so a card's search below its name stops at the next test.
export function verify(t: { name: string; value: number | null; unit?: string | null; ref_low: number | null; ref_high: number | null }, lines: Line[] | null, nth = 0, others: string[] = []): ValueCheck {
  const none: ValueCheck = { value: 'unverified', range: 'unverified', unit: 'unverified', pdf_value: null }
  if (!lines?.length) return none
  const row = rowNumbers(t.name, lines, nth, others)
  if (!row) return none
  const { nums, bare, text } = row
  const bounds = [t.ref_low, t.ref_high].filter((b): b is number => b !== null)
  const printed = unitsIn(text)
  return {
    pdf_value: bare[0] ?? null, // a number standing alone, not a digit inside a method name like "P5P"
    pdf_flag: flagBeside(t.value, row.lines),
    value: t.value === null ? 'unverified' : has(nums, t.value) ? 'verified' : 'mismatch',
    range: !bounds.length ? 'unverified' : bounds.every((b) => has(nums, b)) ? 'verified' : 'mismatch',
    // A missing unit is a mismatch only when the PDF prints one on that row.
    // Whole tokens only: "g/dL" must not verify against a printed "µg/dL".
    unit: t.unit ? (` ${keys(text)} `.includes(` ${keys(t.unit)} `) ? 'verified' : 'mismatch') : printed.length ? 'mismatch' : 'unverified',
  }
}
