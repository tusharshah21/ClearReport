// Plain code, runs locally: suggests mask boxes over identity fields from positioned words
// (PDF text layer, or Tesseract OCR for photos). Suggestions only; the user checks every box.
import { canonical } from './canonical'
import { toLines, type Line, type Word } from './textlayer'

// method: which local method suggested the box (label rules, or the on-device model in Path 2). Fractions of the page.
export type Suggestion = { x: number; y: number; w: number; h: number; field: string; method?: 'rule' | 'ai' }

// Longest first. "agesex" covers "AGE/SEX" read as one word.
const LABELS: [string, string[]][] = [
  ['name', ['patient', 'name']], ['id', ['patient', 'id']], ['id', ['lab', 'no', 'uhid']], ['id', ['lab', 'no']], ['id', ['reg', 'no']], ['id', ['uhid']],
  ['phone', ['mobile']], ['phone', ['phone']], ['phone', ['contact']], ['phone', ['ph']],
  ['doctor', ['referred', 'by']], ['doctor', ['ref', 'by']], ['doctor', ['ref', 'dr']], ['doctor', ['doctor']],
  ['age/sex', ['age', 'gender']], ['age/sex', ['age', 'sex']], ['age/sex', ['agesex']], ['age/sex', ['agegender']],
  ['age', ['age']], ['sex', ['gender']], ['sex', ['sex']],
  ['name', ['name']], ['name', ['patient']],
]
const tok = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

// Index just past the label starting at word i, or -1. Punctuation-only words ("/", ":") are skipped inside a label.
function labelAt(ws: Word[], i: number): { field: string; end: number } | null {
  if (i > 0 && tok(ws[i - 1].text) === 'test') return null // "Test Name" is a table header
  // A field label starts a line or a column (gap before it); "age" or "contact" inside a sentence is not one.
  // A label ending in ":" ("Age/Sex:") also counts after a small gap, as in "Reg No: X  Age/Sex: 58/M".
  const close = i > 0 && ws[i].x0 - ws[i - 1].x1 < 0.03
  for (const [field, parts] of LABELS) {
    let j = i, k = 0
    while (k < parts.length && j < ws.length) {
      const t = tok(ws[j].text)
      if (t === '') { j++; continue }
      if (t !== parts[k]) break
      j++; k++
    }
    if (k === parts.length && (!close || /:$/.test(ws[j - 1].text) || ws[j]?.text === ':')) return { field, end: j }
  }
  return null
}
const endsLabel = (w: Word) => /:$/.test(w.text)

// Barcode text: Code 39 "*WM15SPF*" / "181277574*", or long runs in a barcode font ("AHEEEHAPMK...").
const BARCODE = /\*[A-Z0-9]{5,}\*|^\d{6,}\*$|^[A-Z]{25,}$/

const boxOf = (ws: Word[], field: string, method: 'rule' | 'ai'): Suggestion => {
  const x0 = Math.min(...ws.map((w) => w.x0)), x1 = Math.max(...ws.map((w) => w.x1))
  const y0 = Math.min(...ws.map((w) => w.y0)), y1 = Math.max(...ws.map((w) => w.y1))
  const p = 0.003 // small fixed margin: barcode text is tall, and a padding relative to it would cover the row above
  return { x: Math.max(0, x0 - p), y: Math.max(0, y0 - p), w: x1 - x0 + 2 * p, h: y1 - y0 + 2 * p, field, method }
}

// An OCR line that looks like a test result: a number with a unit, a printed range ("13.0 - 17.0", or "70-100"
// with OCR dropping the spaces), a decimal or a percentage. Photo OCR garbles units, so the decimal and the range
// count on their own. A unit needs a real denominator ("mg/dL", "lakhs/cumm"): "45Y/M", "STY/FDMALE" (age/sex)
// and dates ("17/11/2026", "17-11-2026") are not results.
const RANGE = /(?<![\d/.-])\d{1,4}(?:\.\d+)?\s*[-–~]\s*\d{1,4}(?:\.\d+)?(?![\d/-])/
const UNIT = /[a-zµμ]\/(?:d?l|ml|[uµμ]l|cumm|cmm|mm3|hpf|min|hrs?|kg|m2|day)\b/i
export const resultLine = (t: string) => /\d/.test(t) && (UNIT.test(t) || RANGE.test(t) || /\d\.\d/.test(t) || /\d\s*%/.test(t))

// Photo OCR garbles some result rows past recognition ("212 mg/dL" read as "pete"), so the guard is also by
// position: with 3+ result-like lines, everything from the first to the last of them is the results block.
// Personal details sit above or below it. ponytail: a report printing identity beside the table would lose those boxes.
// A line that is only a known test name ("Total Cholesterol", its values OCR'd on a line of their own) also marks the block.
function outsideResults(lines: Line[]): (l: Line) => boolean {
  const res = lines.filter((l) => resultLine(l.text) || !canonical(l.text).startsWith('?'))
  if (res.length < 3) return (l) => !resultLine(l.text)
  const top = res[0].y0, bottom = res[res.length - 1].y1
  return (l) => !resultLine(l.text) && ((l.y0 + l.y1) / 2 < top || (l.y0 + l.y1) / 2 > bottom)
}

// Lines that are not result rows (header, footer, signature): the only text the on-device model sees in Path 2.
// OCR noise from a photo ("EER", "0h wae") is dropped: a line needs a 4+ letter word or a long digit run.
const readable = (s: string) => /[a-z]{4,}/i.test(s) || (s.match(/\d/g)?.length ?? 0) >= 6
export const nonResultLines = (words: Word[]): Line[] => {
  const lines = toLines(words)
  return lines.filter(outsideResults(lines)).filter((l) => readable(l.text))
}

// A finding must look like its kind; the model sometimes labels noise ("212 89/4 200" as a birth date).
const digits = (s: string) => s.match(/\d/g)?.length ?? 0
const FITS: Record<string, (s: string) => boolean> = {
  patient_name: (s) => /[a-z]{3,}/i.test(s), doctor_name: (s) => /[a-z]{3,}/i.test(s), address: (s) => /[a-z]{3,}/i.test(s),
  phone: (s) => digits(s) >= 8, patient_id: (s) => digits(s) >= 3,
  date_of_birth: (s) => /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/.test(s),
}

// Boxes for what the on-device model pointed out: the words of that line that match its text, one box per run of
// neighbouring words. A box whose centre is already inside a rule box is dropped (the rule found it first).
export function aiBoxes(lines: Line[], found: { line: number; text: string; kind: string }[], rules: Suggestion[]): Suggestion[] {
  const out: Suggestion[] = []
  const inBox = (b: Suggestion) => [...rules, ...out].some((r) => b.x + b.w / 2 >= r.x && b.x + b.w / 2 <= r.x + r.w && b.y + b.h / 2 >= r.y && b.y + b.h / 2 <= r.y + r.h)
  for (const f of found) {
    if (!(FITS[f.kind]?.(String(f.text)) ?? false)) continue
    const ws = lines[f.line - 1]?.words ?? []
    const want = new Set(String(f.text).split(/\s+/).map(tok).filter((t) => t.length >= 2))
    let run: Word[] = []
    const flush = () => { if (run.length) { const b = boxOf(run, f.kind, 'ai'); if (!inBox(b)) out.push(b) } run = [] }
    for (const w of ws) (want.has(tok(w.text)) ? run.push(w) : flush())
    flush()
  }
  return out
}

// ocr: words from a photo or scanned page. No box is ever suggested on a line that looks like a test result
// (OCR reads "pH 6.0" as a "Ph:" phone label); covering a result would hide it from the reading step.
export function suggestMasks(words: Word[], ocr = false): Suggestion[] {
  const all = toLines(words)
  const lines = ocr ? all.filter(outsideResults(all)) : all
  const out: Suggestion[] = []
  const add = (ws: Word[], field: string) => {
    if (!ws.length) return
    out.push(boxOf(ws, field, 'rule'))
  }
  lines.forEach((line: Line, li) => {
    const ws = line.words
    for (let i = 0; i < ws.length; i++) {
      if (BARCODE.test(ws[i].text)) { add([ws[i]], 'barcode'); continue }
      const lab = labelAt(ws, i)
      if (!lab) continue
      let s = lab.end
      while (s < ws.length && tok(ws[s].text) === '') s++ // the ":" after the label
      // The value runs until the next label, a "Something:" label, or a wide gap.
      let e = s
      while (e < ws.length && !labelAt(ws, e) && !(e > s && endsLabel(ws[e - 1])) && !(e > s && ws[e].x0 - ws[e - 1].x1 > 0.1)) e++
      if (e > s && endsLabel(ws[e - 1]) && e - 1 > s) e-- // "Reported:" belongs to the next field
      const xFrom = s > 0 ? ws[s - 1].x1 : line.words[0].x0
      const xTo = e < ws.length ? ws[e].x0 : 1
      let value = ws.slice(s, e)
      // Empty slot: the value may have shifted down (WM14 page 5 prints "SELF" two rows lower, inside "A/c Status").
      // ponytail: covers whatever sits in that column on the next two rows, which over-masks a little.
      if (!value.length) value = lines.slice(li + 1, li + 3).flatMap((l) => l.words.filter((w) => w.x0 >= xFrom - 0.002 && w.x0 < xTo && tok(w.text) !== ''))
      add(value, lab.field)
      i = Math.max(i, e - 1)
    }
  })
  return out
}

// Local OCR for photos. Worker, engine and English data are served from this site (/ocr/, copied by
// scripts/copy-ocr.mjs); the image never leaves the device. Loaded only when a photo needs it.
// enhance: grayscale + strong contrast. Helps dim photos (straightened r6-photo: 0 -> 3 fields) but hurts clean scans (r3: 5 -> 2), so callers use it only as a fallback.
export async function ocrWords(img: Blob, enhance = false): Promise<Word[]> {
  const { createWorker, PSM } = await import('tesseract.js')
  // Small text OCRs badly (r1 at 900 px lost the name row): scale up so the long side is at least 2000 px.
  const bmp = await createImageBitmap(img)
  const s = Math.max(1, 2000 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  const [w, h] = [(c.width = Math.round(bmp.width * s)), (c.height = Math.round(bmp.height * s))]
  const g = c.getContext('2d')!
  if (enhance) g.filter = 'grayscale(1) contrast(2.5) brightness(1.1)'
  g.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const base = `${location.origin}/ocr/`
  const worker = await createWorker('eng', 1, { workerPath: `${base}worker.min.js`, corePath: base, langPath: base.slice(0, -1) })
  try {
    // Sparse text: find words anywhere, no layout analysis (the default lost r1's first row, which touches a box border).
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })
    const { data } = await worker.recognize(c, {}, { blocks: true })
    return (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)))
      .filter((x) => x.text.trim())
      .map((x) => ({ text: x.text, x0: x.bbox.x0 / w, x1: x.bbox.x1 / w, y0: x.bbox.y0 / h, y1: x.bbox.y1 / h }))
  } finally {
    await worker.terminate()
  }
}
