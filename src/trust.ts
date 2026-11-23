// Plain code, runs locally: one badge per extracted row, from the model's own "legible" flag and,
// for digital PDFs, a cross-check against the page's text layer.
import { displayName } from './canonical'
import { toLines, verify, type ValueCheck, type Word } from './textlayer'

export type Badge = 'verified' | 'check' | 'image'
export type Trust = ValueCheck & { legible: boolean; badge: Badge; why: string }
export const BADGE_TEXT: Record<Badge, string> = {
  verified: 'Verified against your PDF',
  check: 'Please check this value',
  image: 'Read from image',
}

type Row = { name: string; value: number | null; unit?: string | null; ref_low: number | null; ref_high: number | null; legible?: boolean; page?: number }

// pages[i] = text-layer words of page i, or null for a photo or a scanned PDF page.
export function trustOf(rows: Row[], pages: (Word[] | null)[]): Trust[] {
  const lines = pages.map((w) => (w?.length ? toLines(w) : null))
  const seen: Record<string, number> = {}
  return rows.map((r) => {
    const page = r.page ?? 0
    const k = `${page}|${displayName(r.name).toLowerCase()}`
    const nth = (seen[k] = (seen[k] ?? -1) + 1)
    const c = verify(r, lines[page] ?? null, nth)
    const legible = r.legible !== false
    const t = (badge: Badge, why: string): Trust => ({ ...c, legible, badge, why })
    if (!legible) return t('check', 'Part of this value or its range could not be read clearly on the report.')
    if (c.value === 'mismatch' && c.pdf_value === null) return t('check', "Your PDF's text has no number on the same line as this test's name, so the value could not be checked automatically.")
    if (c.value === 'mismatch') return t('check', "The value read for this test does not match the number in your PDF's text.")
    if (c.range === 'mismatch') return t('check', "The reference range read for this test does not match your PDF's text.")
    if (c.unit === 'mismatch') return t('check', "The unit read for this test does not match your PDF's text.")
    if (r.value === null && c.pdf_value !== null) return t('check', "No value was read for this test, but your PDF's text has a number on this row.")
    if (c.value === 'verified') return t('verified', '')
    // A page with a text layer (a lab PDF) can always be checked: a row that could not be matched to it is not
    // trusted. "Read from image" is only for pages with no text layer (photos and scans).
    if (lines[page]) return t('check', r.value === null ? 'No value was read for this test.' : "This test's name or value could not be found in your PDF's text, so it could not be checked.")
    return t('image', '')
  })
}
