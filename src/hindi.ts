// Plain code, no AI: is every translated field really in Hindi? The model sometimes returns a field (often the
// doctor questions) still in English. Each such field is translated again on its own; if that fails too, the field
// is shown in English with an "(English)" label rather than mixed in silently.
type Expl = { summary: string; tests: { name: string; explanation: string }[]; questions: string[] }
export type FieldKey = string // 'summary' | 'test:<i>' | 'q:<i>'

export const DEVANAGARI = /[ऀ-ॿ]/
const hasWords = (s: string) => /[A-Za-z]/.test(s) // an empty or number-only field needs no translation

// The fields of the English explanation, keyed so the Hindi one can be compared field by field.
export const fieldsOf = (e: Expl): [FieldKey, string][] => [
  ['summary', e.summary],
  ...e.tests.map((t, i): [FieldKey, string] => [`test:${i}`, t.explanation]),
  ...e.questions.map((q, i): [FieldKey, string] => [`q:${i}`, q]),
]
const get = (e: Expl, k: FieldKey): string | undefined => {
  if (k === 'summary') return e.summary
  const [kind, n] = k.split(':')
  return kind === 'test' ? e.tests[Number(n)]?.explanation : e.questions[Number(n)]
}

// Keys of the fields that should be Hindi but have no Devanagari (or are missing), measured against the English.
export const untranslated = (en: Expl, hi: Expl): FieldKey[] =>
  fieldsOf(en).filter(([k, s]) => hasWords(s) && !DEVANAGARI.test(get(hi, k) ?? '')).map(([k]) => k)

const numbers = (s: string) => new Set(s.match(/\d+(?:[.,]\d+)?/g) ?? [])
// A translation must not invent or change a number.
export const sameNumbers = (en: string, hi: string) => [...numbers(hi)].every((n) => numbers(en).has(n))

// Fill each untranslated field with a single-field translation that passes the same checks; otherwise keep the English
// and list the key in `english`, so the page can label it. The result always has the English one's shape.
export async function completeHindi<E extends Expl>(en: E, hi: E, translate: (text: string) => Promise<string>): Promise<{ hi: E; english: FieldKey[] }> {
  const out: E = { ...hi, tests: en.tests.map((t, i) => ({ ...t, explanation: hi.tests[i]?.explanation ?? '' })), questions: en.questions.map((_, i) => hi.questions[i] ?? '') }
  const english: FieldKey[] = []
  for (const k of untranslated(en, hi)) {
    const src = get(en, k)!
    let text: string | null = null
    try {
      const t = (await translate(src)).trim()
      if (DEVANAGARI.test(t) && sameNumbers(src, t)) text = t
    } catch { /* falls back to English below */ }
    if (text === null) english.push(k)
    const v = text ?? src
    if (k === 'summary') out.summary = v
    else if (k.startsWith('test:')) out.tests[Number(k.slice(5))].explanation = v
    else out.questions[Number(k.slice(2))] = v
  }
  return { hi: out, english }
}
