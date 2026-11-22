// Plain code, runs locally: turns a PDF's text layer into short batches of table-row text for the on-device model
// (Path 1). Identity fields are found by position (masks.ts) and removed HERE, before any model sees the text:
// every line holding an identity field is dropped, those words are removed wherever else they appear, and the
// privacy patterns (phone, email, long IDs) are scrubbed from what is left. Age and sex are read locally.
import { suggestMasks } from './masks'
import { PATTERNS } from './privacy'
import { looksLikeResult, toLines, type Word } from './textlayer'

export type Batch = { page: number; text: string }
export type Rows = { batches: Batch[]; age: string | null; sex: string | null; dropped_lines: number }

const tok = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const inside = (w: Word, b: { x: number; y: number; w: number; h: number }) => {
  const cx = (w.x0 + w.x1) / 2, cy = (w.y0 + w.y1) / 2
  return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h
}
// Columns: a gap wider than 1.5% of the page width becomes " | ".
const rowText = (ws: Word[]) => ws.map((w, i) => (i && w.x0 - ws[i - 1].x1 > 0.015 ? ' | ' : i ? ' ' : '') + w.text).join('')

export function rowsForModel(pages: Word[][], perBatch = 10): Rows {
  let age: string | null = null, sex: string | null = null, dropped = 0
  const identity = new Set<string>() // letter-bearing identity tokens (names, IDs), removed from every other line too
  const kept: { page: number; text: string }[] = []
  pages.forEach((words, page) => {
    const boxes = suggestMasks(words)
    const idWords = words.filter((w) => boxes.some((b) => inside(w, b)))
    for (const b of boxes) {
      const ws = words.filter((w) => inside(w, b)).map((w) => w.text).join(' ')
      if (b.field.includes('age')) age ??= ws.match(/\d+/)?.[0] ?? null
      if (b.field.includes('sex') || b.field === 'age/sex') sex ??= ws.match(/\b(male|female|m|f)\b/i)?.[0] ?? null
    }
    for (const w of idWords) if (/[a-z]/i.test(w.text) && tok(w.text).length >= 3) identity.add(tok(w.text))
    for (const line of toLines(words)) {
      if (line.words.some((w) => idWords.includes(w) || boxes.some((b) => inside(w, b)))) { dropped++; continue }
      kept.push({ page, text: rowText(line.words) })
    }
  })
  const batches: Batch[] = []
  for (let p = 0; p < pages.length; p++) {
    const rows = kept
      .filter((k) => k.page === p)
      .map((k) => k.text.split(' ').filter((w) => !identity.has(tok(w)) || !tok(w)).join(' '))
      .map((t) => PATTERNS.reduce((s, [, re]) => s.replace(re, '[removed]'), t))
      .filter((t) => looksLikeResult(t) && isResultRow(t)) // headings, comments and footers never reach the model
    for (let i = 0; i < rows.length; i += perBatch) batches.push({ page: p, text: rows.slice(i, i + perBatch).join('\n') })
  }
  return { batches, age, sex, dropped_lines: dropped }
}

// A result row: a first column with letters (the test name) and a later column starting with a number or < >.
// Numbered notes ("1. | TSH levels ...") and wrapped comment lines fail this.
const cols = (row: string) => row.split(' | ').map((c) => c.trim())
export const isResultRow = (row: string) => {
  const c = cols(row)
  return /[a-z]/i.test(c[0]) && c.slice(1).some((x) => /^[<>≤≥]?\s*\d/.test(x))
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
// The row a model's test name came from: same first column, or one contains the other ("VLDL Cholesterol,Calculated").
export const rowFor = (name: string, rows: string[]) => {
  const n = key(name)
  return rows.find((r) => key(cols(r)[0]) === n) ?? rows.find((r) => n && (key(cols(r)[0]).includes(n) || n.includes(key(cols(r)[0]))))
}

// "0.67 - 1.17" -> [0.67, 1.17]; "<200.00" -> [null, 200]; ">59" -> [59, null]; anything else -> null (keep the model's).
export function parseRange(text: string | null | undefined): [number | null, number | null] | null {
  const s = String(text ?? '').replace(/,/g, '').trim()
  let m = s.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/)
  if (m) return [Number(m[1]), Number(m[2])]
  if ((m = s.match(/^(?:<|<=|≤|up ?to)\s*(\d+(?:\.\d+)?)$/i))) return [null, Number(m[1])]
  if ((m = s.match(/^(?:>|>=|≥)\s*(\d+(?:\.\d+)?)$/))) return [Number(m[1]), null]
  return null
}

type T = { name: string; ref_text?: string | null; ref_low?: number | null; ref_high?: number | null; printed_flag?: string | null }
// Plain-code corrections after the on-device model (it mixed up "<" ranges and added flags the report never printed):
// bounds come from the printed range text, and a flag is kept only if the row itself prints H/L/High/Low.
export function fixFromRow<X extends T>(t: X, row: string | undefined): X {
  const r = parseRange(t.ref_text)
  const printed = row ? cols(row).slice(1).map((c) => c.toLowerCase()).find((c) => ['h', 'l', 'high', 'low'].includes(c)) : undefined
  return { ...t, ...(r ? { ref_low: r[0], ref_high: r[1] } : {}), printed_flag: printed ? (printed[0] === 'h' ? 'H' : 'L') : null }
}

// Rows the model returned nothing for. Each returned test covers ONE row, so a name printed twice
// (WM15: "Monocytes" as % and as an absolute count) needs two answers.
export function skippedRows(rows: string[], names: string[]): string[] {
  const used = new Set<number>()
  return rows.filter((r) => {
    const i = names.findIndex((n, k) => !used.has(k) && rowFor(n, [r]))
    if (i < 0) return true
    used.add(i)
    return false
  })
}
