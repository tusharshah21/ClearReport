// Plain code, runs locally: turns a PDF's text layer into short batches of table-row text for the on-device model
// (Path 1). Identity fields are found by position (masks.ts) and removed HERE, before any model sees the text:
// every line holding an identity field is dropped, those words are removed wherever else they appear, and the
// privacy patterns (phone, email, long IDs) are scrubbed from what is left. Age and sex are read locally.
import { canonical } from './canonical'
import { suggestMasks } from './masks'
import { PATTERNS } from './privacy'
import { looksLikeResult, toLines, type Word } from './textlayer'

export type Batch = { page: number; text: string }
// Every kept line of the report in reading order, identity removed; rows = the result rows it holds (none for a heading,
// a name-only line or a range line).
export type TextLine = { page: number; text: string; rows: string[] }
export type Rows = { batches: Batch[]; lines: TextLine[]; age: string | null; sex: string | null; lab_name: string | null; dropped_lines: number }

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
  const kept: { page: number; text: string; words: Word[] }[] = []
  const header: string[] = [] // non-identity lines, only for the lab name
  pages.forEach((words, page) => {
    const boxes = suggestMasks(words)
    const idWords = words.filter((w) => boxes.some((b) => inside(w, b)))
    for (const b of boxes) {
      const ws = words.filter((w) => inside(w, b)).map((w) => w.text).join(' ')
      if (b.field.includes('age')) age ??= ws.match(/\d+/)?.[0] ?? null
      if (b.field.includes('sex') || b.field === 'age/sex') sex ??= ws.match(/\b(male|female|m|f)\b/i)?.[0] ?? null
    }
    for (const w of idWords) if (/[a-z]/i.test(w.text) && tok(w.text).length >= 3) identity.add(tok(w.text))
    let prev: (typeof kept)[number] | null = null // the line just above, if it was kept
    for (const line of toLines(words)) {
      if (line.words.some((w) => idWords.includes(w) || boxes.some((b) => inside(w, b)))) { dropped++; prev = null; continue }
      header.push(line.words.map((w) => w.text).join(' '))
      if (prev && wrapsName(prev.words, line.words)) {
        // A test name wrapped onto the next line ("Glycosylated" / "Haemoglobin (HbA1c)"): join it to the row above's name.
        const t = line.words.map((w) => w.text).join(' '), i = prev.text.indexOf(' | ')
        prev.text = i < 0 ? `${prev.text} ${t}` : `${prev.text.slice(0, i)} ${t}${prev.text.slice(i)}`
        continue
      }
      kept.push((prev = { page, text: rowText(line.words), words: line.words }))
    }
  })
  const batches: Batch[] = [], lines: TextLine[] = []
  for (let p = 0; p < pages.length; p++) {
    const page = kept
      .filter((k) => k.page === p)
      .map((k) => k.text.split(' ').filter((w) => !identity.has(tok(w)) || !tok(w)).join(' '))
      .map((t) => PATTERNS.reduce((s, [, re]) => s.replace(re, '[removed]'), t))
      .map((text) => ({ page: p, text, rows: looksLikeResult(text) && isResultRow(text) ? splitPair(text, sex) : [] }))
    lines.push(...page)
    const rows = page.flatMap((l) => l.rows) // headings, comments and footers never reach the parser
    for (let i = 0; i < rows.length; i += perBatch) batches.push({ page: p, text: rows.slice(i, i + perBatch).join('\n') })
  }
  return { batches, lines, age, sex, lab_name: labName(header), dropped_lines: dropped }
}

// Context for the on-device model where the parser fails: in layouts where a test's name, value and range sit on
// separate lines, a result row alone is not enough. Each block is a contiguous run of lines (identity already removed),
// in reading order: every line the parser could not read, plus up to CONTEXT lines either side, without any line the
// parser did read. Blocks are cut at MAX_BLOCK lines to stay within the on-device model's limits.
// Before this, only result rows reached the model, so a header line such as "Consultant : Dr. X" that the identity rules
// miss was never sent. Context lines (lines with no result row) are therefore held to a stricter rule: none with a
// personal-details label, a title before a name, or a long digit run (an ID of 7+ digits, or a phone number).
const PERSONAL = /\b(patient|name|age|sex|gender|phone|mobile|contact|uhid|reg(istration)?|id|consultant|doctor|physician|referred|ref|address|e-?mail|dob|birth|collected|sample)\b|\b(mr|mrs|ms|miss|dr|shri|smt)\b\.?\s+[a-z]|\d{7,}|(?:\d[ -]?){10,}/i
export const safeContext = (l: TextLine) => l.rows.length > 0 || !PERSONAL.test(l.text)
export const CONTEXT = 2, MAX_BLOCK = 18
export function contextBlocks(lines: TextLine[], unread: (row: string) => boolean): { page: number; lines: string[]; rows: string[] }[] {
  const read = lines.map((l) => l.rows.length > 0 && !l.rows.some(unread))
  const ok = (j: number, page: number) => lines[j]?.page === page && !read[j] && safeContext(lines[j])
  const want = new Set<number>()
  lines.forEach((l, i) => {
    if (!l.rows.some(unread)) return
    for (let j = i - CONTEXT; j <= i + CONTEXT; j++) if (ok(j, l.page)) want.add(j)
  })
  // A short gap between two wanted lines (a value line with no name in its first column, say) is part of the region.
  const sorted = [...want].sort((a, b) => a - b)
  for (let k = 1; k < sorted.length; k++) {
    const [a, b] = [sorted[k - 1], sorted[k]]
    if (b - a - 1 <= CONTEXT && lines[a].page === lines[b].page) for (let j = a + 1; j < b; j++) if (ok(j, lines[a].page)) want.add(j)
  }
  const blocks: { page: number; lines: string[]; rows: string[] }[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!want.has(i)) continue
    const last = blocks.at(-1), l = lines[i]
    const cur = last && want.has(i - 1) && last.page === l.page && last.lines.length < MAX_BLOCK ? last : { page: l.page, lines: [], rows: [] }
    if (cur !== last) blocks.push(cur)
    cur.lines.push(l.text)
    cur.rows.push(...l.rows.filter(unread))
  }
  return blocks
}

// A wrapped name: the row above has a name the alias table does not know ("Glycosylated"), and this short line with no
// number (a digit inside a word, as in "HbA1c", is fine) starts at that name's column and ends before the next column.
// A known name ("Urea") is complete, so the line under it is a method note ("(Urease UV)" in Dr Lal reports).
function wrapsName(above: Word[], ws: Word[]): boolean {
  const gap = above.findIndex((w, k) => k > 0 && w.x0 - above[k - 1].x1 > 0.015)
  const secondCol = gap < 0 ? 1 : above[gap].x0
  const name = above.slice(0, gap < 0 ? above.length : gap).map((w) => w.text).join(' ').replace(/\s*[*#†]+$/, '')
  const height = Math.max(...above.map((w) => w.y1 - w.y0))
  return canonical(name).startsWith('?') && /\d/.test(above.map((w) => w.text).join(' ')) && !ws.some((w) => /^[<>(]?\d/.test(w.text)) && ws.length <= 4
    && Math.abs(ws[0].x0 - above[0].x0) < 0.01 && Math.max(...ws.map((w) => w.x1)) < secondCol
    && ws[0].y0 - Math.max(...above.map((w) => w.y1)) < height
}

// Two tests printed side by side on one row: split it when BOTH halves parse cleanly; otherwise leave it whole.
export function splitPair(row: string, sex?: string | null): string[] {
  const c = cols(row)
  if (parseRow(row, sex)) return [row]
  for (let k = 2; k <= c.length - 2; k++) {
    const a = c.slice(0, k).join(' | '), b = c.slice(k).join(' | ')
    if (parseRow(a, sex) && parseRow(b, sex)) return [a, b]
  }
  return [row]
}

// A result row: a first column with letters (the test name) and a later column starting with a number or < >.
// Numbered notes ("1. | TSH levels ...") and wrapped comment lines fail this.
const cols = (row: string) => row.split(' | ').map((c) => c.trim())
export const isResultRow = (row: string) => {
  const c = cols(row)
  return /[a-z]/i.test(c[0]) && c.slice(1).some((x) => /^[<>≤≥]?\s*\d/.test(x))
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
// The row a model's test name came from: a column equal to the name, or one containing the other
// ("VLDL Cholesterol,Calculated"). Any column, since some layouts print the result first.
const names = (r: string) => cols(r).map(key).filter((k) => /[a-z]{3}/.test(k))
export const rowFor = (name: string, rows: string[]) => {
  const n = key(name)
  return rows.find((r) => names(r).includes(n)) ?? rows.find((r) => n && names(r).some((k) => k.includes(n) || n.includes(k)))
}

// "0.67 - 1.17" -> [0.67, 1.17]; "<200.00" -> [null, 200]; ">59" -> [59, null]; anything else -> null (keep the model's).
// "M: 13-17 / F: 12-15" -> the patient's own bounds when sex is known (read locally), else null.
export function parseRange(text: string | null | undefined, sex?: string | null): [number | null, number | null] | null {
  const s = String(text ?? '').replace(/,/g, '').trim()
  const bySex = s.match(/^M(?:ale)?\s*:\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*[/;,]?\s*F(?:emale)?\s*:\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/i)
  if (bySex) {
    const x = String(sex ?? '').trim().toUpperCase()[0]
    return x === 'M' ? [Number(bySex[1]), Number(bySex[2])] : x === 'F' ? [Number(bySex[3]), Number(bySex[4])] : null
  }
  let m = s.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/)
  if (m) return [Number(m[1]), Number(m[2])]
  if ((m = s.match(/^(?:<|<=|≤|up ?to)\s*(\d+(?:\.\d+)?)$/i))) return [null, Number(m[1])]
  if ((m = s.match(/^(?:>|>=|≥)\s*(\d+(?:\.\d+)?)$/))) return [Number(m[1]), null]
  return null
}

type T = { name: string; ref_text?: string | null; ref_low?: number | null; ref_high?: number | null; printed_flag?: string | null }
// Deterministic parser (plain code, no AI). Each column is typed: one test name, one value (which may carry a
// footnote mark, a flag or the unit: "165 H", "6.8 *", "11.8 g/dL"), at most one unit, range and H/L flag, in any
// order (some labs print the result first). Anything it is not sure about returns null and goes to the model.
const U = String.raw`(?:[a-zµμ%/]|10\^|x10)[\w/µμ%.^³²*-]{0,19}`
const VAL = new RegExp(String.raw`^(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*[*#†]*(?:\s+(H|L|High|Low))?(?:\s+(${U}))?\s*[*#†]*$`, 'i')
const FLAG = /^(h|l|high|low)$/i
const UNIT = new RegExp(`^${U}$`, 'i')
const NOT_A_TEST = /^(page|sample|lab|age|ref|reported|collected|printed)\b/i
export type Parsed = { name: string; value: number; unit: string | null; ref_low: number | null; ref_high: number | null; ref_text: string | null; printed_flag: 'H' | 'L' | null; legible: true }
export function parseRow(row: string, sex?: string | null): Parsed | null {
  let name: string | null = null, v: RegExpMatchArray | null = null, flag: string | null = null, unit: string | null = null, ref: string | null = null
  for (const c of cols(row)) {
    const m = c.match(VAL)
    if (m) { if (v) return null; v = m }
    else if (parseRange(c, sex)) { if (ref) return null; ref = c }
    else if (FLAG.test(c)) { if (flag) return null; flag = c }
    else if (!name && /[a-z]{2}/i.test(c) && !/\d{3,}/.test(c)) name = c.replace(/\s*[*#†]+$/, '')
    else if (!unit && UNIT.test(c) && (/[^a-z]/i.test(c) || c.length <= 5)) unit = c // a letters-only unit is short: fL, pg, Ratio
    else return null // an extra or unexpected column: not sure, ask the model
  }
  if (!v || !name || NOT_A_TEST.test(name) || (v[2] && flag) || (v[3] && unit)) return null
  unit ??= v[3] ?? null
  flag ??= v[2] ?? null
  const r = ref ? parseRange(ref, sex)! : [null, null]
  return { name, value: Number(v[1].replace(/,/g, '')), unit, ref_low: r[0], ref_high: r[1], ref_text: ref, printed_flag: flag ? (flag[0].toUpperCase() as 'H' | 'L') : null, legible: true }
}

// The lab's name, read locally (not personal data): a short line with a company word, else one with a weaker lab word
// and no comma (addresses and degrees like "MD, Pathology" have commas), else the "Processed at" lab.
const LAB = /\b(ltd|limited|pvt|labs|pathlabs|diagnostics?|hospital)\b/i
const LAB_WEAK = /\b(laborator(?:y|ies)|patholog(?:y|ies)|path|clinic(?:al)?|cent(?:re|er))\b/i
export function labName(lines: string[]): string | null {
  const short = lines.filter((l) => !l.includes(':') && l.split(/\s+/).length <= 6)
  return short.find((l) => LAB.test(l))?.trim() ?? short.find((l) => LAB_WEAK.test(l) && !l.includes(','))?.trim()
    ?? lines.map((l) => l.match(/processed at\s*:\s*(.+)$/i)?.[1]).find(Boolean)?.trim() ?? null
}

// Plain-code corrections after the on-device model (it mixed up "<" ranges and added flags the report never printed):
// bounds come from the printed range text, and a flag is kept only if the row itself prints H/L/High/Low.
export function fixFromRow<X extends T>(t: X, row: string | undefined, sex?: string | null): X {
  const r = parseRange(t.ref_text, sex)
  // A flag column ("Low"), or a flag written in the value cell ("165 H").
  const printed = row ? cols(row).map((c) => (FLAG.test(c) ? c : c.match(VAL)?.[2])).find(Boolean)?.toLowerCase() : undefined
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
