// Plain code, no AI.
import { ALIASES, canonical } from './canonical'
import type { Check } from './guidelines'
import type { Payload } from './privacy'

// ---- Doctor questions: each must name a test from this report and its value; a disagreement comes first. ----
type T = Payload['tests'][number]
const low = (s: string) => s.toLowerCase().replace(/[^a-z0-9.%/ ]+/g, ' ')
// Names a question may use for a test: the printed name, the name without "(...)", and the known aliases.
const namesOf = (t: T) => [t.name, t.name.replace(/\(.*?\)/g, ''), ...(ALIASES[canonical(t.name)] ?? [])].map(low).map((n) => n.trim()).filter((n) => n.length > 1)
const mentions = (q: string, t: T) => {
  const text = ` ${low(q)} `
  return t.value !== null && new RegExp(`(^|[^0-9.])${String(t.value).replace('.', '\.')}([^0-9]|$)`).test(q) && namesOf(t).some((n) => text.includes(` ${n} `) || text.includes(` ${n}`))
}
export function questionsSpecific(questions: string[], p: Payload, checks: Check[]): boolean {
  const split = p.tests.filter((_, i) => checks[i]?.callout)
  if (questions.length < 3) return false
  if (!questions.every((q) => p.tests.some((t) => mentions(q, t)))) return false
  return !split.length || split.some((t) => mentions(questions[0], t))
}
// Built from the findings when the model's questions are generic (or the model failed).
export function questionsFor(p: Payload, checks: Check[]): string[] {
  const v = (t: T) => `${t.value}${t.unit === '%' ? '' : ' '}${t.unit ?? ''}`.trim()
  const range = (t: T) => (t.ref_text ?? '').replace(/(\d)\s*-\s*(\d)/, '$1-$2')
  const pos = (t: T) => (t.ref_high !== null && t.value! > t.ref_high ? 'above' : t.ref_low !== null && t.value! < t.ref_low ? 'below' : 'inside')
  const out: string[] = []
  p.tests.forEach((t, i) => {
    const c = checks[i]
    if (!c?.callout || t.value === null) return
    out.push(pos(t) === 'inside'
      ? `My ${t.name} result is ${v(t)}, inside my lab's range (${range(t)}), but a widely used guideline would call it ${c.tag}. Which range should we go by for me?`
      : `My ${t.name} result is ${v(t)}, ${pos(t)} my lab's range (${range(t)}), but a widely used guideline would not flag it. How should we read this result?`)
  })
  for (const t of p.tests) if (out.length < 4 && t.value !== null && pos(t) !== 'inside' && !out.some((q) => q.startsWith(`My ${t.name} result is`)))
    out.push(`My ${t.name} result is ${v(t)}, ${pos(t)} my lab's range (${range(t)}). What might explain this, and does it need a repeat test?`)
  for (const t of p.tests) if (out.length < 3 && t.value !== null && !out.some((q) => q.startsWith(`My ${t.name} result is`)))
    out.push(`My ${t.name} result is ${v(t)}${t.ref_text ? `, inside my lab's range (${range(t)})` : ''}. Is this worth checking again at my next test?`)
  return out.slice(0, 5)
}
