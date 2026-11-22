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
      .filter(looksLikeResult) // headings, comments and footers never reach the model
    for (let i = 0; i < rows.length; i += perBatch) batches.push({ page: p, text: rows.slice(i, i + perBatch).join('\n') })
  }
  return { batches, age, sex, dropped_lines: dropped }
}
