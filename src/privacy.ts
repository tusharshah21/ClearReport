// Plain code, no AI: turns a model's extraction into the payload that may leave the device.
// Whitelist copy (only known non-identity fields survive), then a regex scan of every value.

export type Test = { name: string; value: number | null; unit: string | null; ref_low: number | null; ref_high: number | null; ref_text: string | null; printed_flag: 'H' | 'L' | null }
export type Payload = { lab_name: string | null; age_band: string | null; sex: 'Male' | 'Female' | null; tests: Test[] }
export type Finding = { where: string; kind: string }

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/,/g, '')) : NaN
  return Number.isFinite(n) ? n : null
}

export function ageBand(age: unknown): string | null {
  const n = num(String(age ?? '').match(/\d+/)?.[0])
  if (n === null || n > 120) return null
  return n >= 90 ? '90+' : `${Math.floor(n / 10) * 10}-${Math.floor(n / 10) * 10 + 9}`
}
const sexOf = (s: unknown) => ({ m: 'Male', f: 'Female' } as const)[String(s ?? '').trim().toLowerCase()[0] as 'm' | 'f'] ?? null

const PATTERNS: [string, RegExp][] = [
  ['email', /[\w.+-]+@[\w-]+\.[\w.-]+/g],
  ['aadhaar-like 12-digit number', /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g],
  ['phone number', /(?:\+?91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/g],
  // 8+ chars of CAPITALS/digits/-/ with both a letter and a digit, e.g. SPL/FAKE/2024/0772, MW00FAKE6020.
  // Case-sensitive on purpose: lowercase units like mL/min/1.73m2 and thou/mm3 must survive.
  ['long ID string', /\b(?=[A-Z0-9/-]*[A-Z])(?=[A-Z0-9/-]*\d)[A-Z0-9][A-Z0-9/-]{7,}/g],
]

export function toPayload(extracted: unknown): { payload: Payload; findings: Finding[] } {
  const x = (extracted ?? {}) as { lab_name?: unknown; pii?: Record<string, unknown>; tests?: unknown[] }
  const pii = x.pii ?? {}
  const findings: Finding[] = []

  // The identity values the model found are also searched for literally, wherever they ended up.
  const known: [string, RegExp][] = []
  for (const [k, v] of Object.entries(pii)) {
    if (k === 'age' || k === 'sex') continue
    // Words with a letter only: digit fragments ("90000" from a phone) are left to PATTERNS, so lab values survive.
    const words = String(v ?? '').split(/\s+/).map((w) => w.replace(/^\W+|\W+$/g, '')).filter((w) => w.length >= 3 && /[a-z]/i.test(w) && !/^(mr|mrs|ms|dr)$/i.test(w))
    for (const w of words) known.push([`extracted ${k}`, new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')])
  }
  const clean = (v: string | null, where: string, numeric = false): string | null => {
    if (v === null) return null
    let out = v
    for (const [kind, re] of numeric ? PATTERNS.slice(1, 3) : [...known, ...PATTERNS]) {
      out = out.replace(re, () => {
        findings.push({ where, kind })
        return '[removed]'
      })
    }
    return out
  }
  const cleanNum = (v: number | null, where: string) => (v !== null && clean(String(v), where, true) !== String(v) ? null : v)

  const tests = (Array.isArray(x.tests) ? x.tests : []).map((raw, i): Test => {
    const t = (raw ?? {}) as Record<string, unknown>
    const at = `tests[${i}]`
    const flag = str(t.printed_flag)?.toUpperCase()
    return {
      name: clean(str(t.name), `${at}.name`) ?? '',
      value: cleanNum(num(t.value), `${at}.value`),
      unit: clean(str(t.unit), `${at}.unit`),
      ref_low: num(t.ref_low),
      ref_high: num(t.ref_high),
      ref_text: clean(str(t.ref_text), `${at}.ref_text`),
      printed_flag: flag === 'H' || flag === 'L' ? flag : null,
    }
  })
  return { payload: { lab_name: clean(str(x.lab_name), 'lab_name'), age_band: ageBand(pii.age), sex: sexOf(pii.sex), tests }, findings }
}
