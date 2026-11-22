// Plain code, runs locally: suggests mask boxes over identity fields from positioned words
// (PDF text layer, or Tesseract OCR for photos). Suggestions only; the user checks every box.
import { toLines, type Line, type Word } from './textlayer'

export type Suggestion = { x: number; y: number; w: number; h: number; field: string } // fractions of the page

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
  if (i > 0 && ws[i].x0 - ws[i - 1].x1 < 0.03) return null
  for (const [field, parts] of LABELS) {
    let j = i, k = 0
    while (k < parts.length && j < ws.length) {
      const t = tok(ws[j].text)
      if (t === '') { j++; continue }
      if (t !== parts[k]) break
      j++; k++
    }
    if (k === parts.length) return { field, end: j }
  }
  return null
}
const endsLabel = (w: Word) => /:$/.test(w.text)

// Barcode text: Code 39 "*WM15SPF*" / "181277574*", or long runs in a barcode font ("AHEEEHAPMK...").
const BARCODE = /\*[A-Z0-9]{5,}\*|^\d{6,}\*$|^[A-Z]{25,}$/

export function suggestMasks(words: Word[]): Suggestion[] {
  const lines = toLines(words)
  const out: Suggestion[] = []
  const add = (ws: Word[], field: string) => {
    if (!ws.length) return
    const x0 = Math.min(...ws.map((w) => w.x0)), x1 = Math.max(...ws.map((w) => w.x1))
    const y0 = Math.min(...ws.map((w) => w.y0)), y1 = Math.max(...ws.map((w) => w.y1))
    const p = 0.003 // small fixed margin: barcode text is tall, and a padding relative to it would cover the row above
    out.push({ x: Math.max(0, x0 - p), y: Math.max(0, y0 - p), w: x1 - x0 + 2 * p, h: y1 - y0 + 2 * p, field })
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
export async function ocrWords(img: Blob): Promise<Word[]> {
  const { createWorker, PSM } = await import('tesseract.js')
  // Small text OCRs badly (r1 at 900 px lost the name row): scale up so the long side is at least 2000 px.
  const bmp = await createImageBitmap(img)
  const s = Math.max(1, 2000 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  const [w, h] = [(c.width = Math.round(bmp.width * s)), (c.height = Math.round(bmp.height * s))]
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
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
