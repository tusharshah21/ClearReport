// Plain code, runs locally: one badge per extracted row, from the model's own "legible" flag and,
// for digital PDFs, a cross-check against the page's text layer.
import { displayName } from './canonical'
import { toLines, verify, type Check, type Word } from './textlayer'

export type Badge = 'verified' | 'check' | 'image'
export type Trust = { value: Check; range: Check; legible: boolean; badge: Badge; why: string }
export const BADGE_TEXT: Record<Badge, string> = {
  verified: 'Verified against your PDF',
  check: 'Please check this value',
  image: 'Read from image',
}

type Row = { name: string; value: number | null; ref_low: number | null; ref_high: number | null; legible?: boolean; page?: number }

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
    if (c.value === 'mismatch') return t('check', 'The number read from the image does not match the number in your PDF.')
    if (c.range === 'mismatch') return t('check', 'The reference range read from the image does not match your PDF.')
    if (c.value === 'verified') return t('verified', '')
    return t('image', '')
  })
}
