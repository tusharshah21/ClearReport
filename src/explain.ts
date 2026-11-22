// Plain-language explanation of an APPROVED anonymous payload (cloud only), then a Hindi translation.
// Input is only { lab_name, age_band, sex, tests } plus the range-check results computed by plain code.
// The range-check notes are never rewritten by the model: the UI shows the engine's own text next to each test.
import { getGenerativeModel, InferenceMode, InferenceSource } from 'firebase/ai'
import { ai } from './firebase'
import { BANNED, type Check } from './guidelines'
import type { Payload } from './privacy'
import { config } from './remote'

export type Explanation = { summary: string; tests: { name: string; explanation: string }[]; questions: string[] }
export type ExplainPath = 'first try' | 'retry' | 'template'
export type Explained = { en: Explanation; hi: Explanation | null; path: ExplainPath; hindi_note: string | null; prompt_version: string; model: string }

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    tests: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, explanation: { type: 'string' } }, required: ['name', 'explanation'] } },
    questions: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 5 },
  },
  required: ['summary', 'tests', 'questions'],
}

const RULES = `You explain a blood test report to the person it belongs to, in plain everyday English (reading age about 12).
Return JSON:
- summary: 2-3 sentences giving the overall picture.
- tests: one entry per test, in the same order, with "name" copied exactly. "explanation": 1-2 short sentences: what the test measures, then where the result sits compared with the lab's printed range (inside, above or below). No range given: say so.
- questions: 3-5 short questions the person could ask their doctor.
Strict wording rules:
- Describe, never diagnose. Never name a disease or condition as something the person has.
- Never write "you have", "you should", "take", "treat", "treatment with", "diagnose", "diagnosis" or "wrong".
- Never say a result is in a "diabetes range" or "prediabetes range".
- No advice about medicines, diet changes or doses. Suggest talking to the doctor instead.
- Use only the numbers given. Do not invent values, ranges or tests.`
const STRICTER = `\nYour previous answer broke the wording rules. Rewrite more cautiously: only describe what each test measures and where the number sits relative to the printed range. Avoid every banned phrase listed above, even inside a question.`

// Only these fields reach the model: the approved payload plus the engine's outcome and messages.
const input = (p: Payload, checks: Check[]) =>
  JSON.stringify({
    lab_name: p.lab_name, age_band: p.age_band, sex: p.sex,
    tests: p.tests.map((t, i) => ({ name: t.name, value: t.value, unit: t.unit, lab_range: t.ref_text, printed_flag: t.printed_flag, range_check: checks[i]?.outcome, range_check_note: checks[i]?.message })),
  })

const textOf = (e: Explanation) => [e.summary, ...e.tests.map((t) => t.explanation), ...e.questions].join('\n')
export const wordingOk = (e: Explanation) => !BANNED.test(textOf(e))

async function ask(prompt: string, payload: string): Promise<Explanation> {
  const m = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: { model: config().model, generationConfig: { responseMimeType: 'application/json', responseJsonSchema: SCHEMA, temperature: 0.2 } },
  })
  const res = await m.generateContent([prompt, payload])
  if (res.response.inferenceSource && res.response.inferenceSource !== InferenceSource.IN_CLOUD) throw new Error(`served by ${res.response.inferenceSource}`)
  const out = JSON.parse(res.response.text()) as Explanation
  if (!Array.isArray(out.tests) || !Array.isArray(out.questions) || typeof out.summary !== 'string') throw new Error('explanation missing fields')
  return out
}

// Plain template from the engine's own messages: used when the model's wording fails twice (or the call fails).
export function template(p: Payload, checks: Check[]): Explanation {
  const outside = p.tests.filter((t) => t.value !== null && ((t.ref_high !== null && t.value > t.ref_high) || (t.ref_low !== null && t.value < t.ref_low))).length
  return {
    summary: `Your report lists ${p.tests.length} test${p.tests.length === 1 ? '' : 's'}. ${outside ? `${outside} result${outside === 1 ? ' is' : 's are'} outside the range printed by your lab.` : 'All results with a printed range are inside it.'} The notes below compare each result with your lab's range.`,
    tests: p.tests.map((t, i) => ({ name: t.name, explanation: checks[i]?.message ?? '' })),
    questions: ['Which of these results matter most for me, and why?', 'Do any of these results need a repeat test?', 'Is there anything in this report you would like to follow up on?'],
  }
}

async function english(p: Payload, checks: Check[]): Promise<{ en: Explanation; path: ExplainPath }> {
  const data = input(p, checks)
  for (const [path, prompt] of [['first try', RULES], ['retry', RULES + STRICTER]] as const) {
    try {
      const en = await ask(prompt, data)
      if (wordingOk(en) && en.tests.length === p.tests.length) return { en, path }
      console.info(`ClearReport explanation: ${path} failed the wording or shape check`)
    } catch (e) {
      console.info(`ClearReport explanation: ${path} failed: ${String(e)}`)
    }
  }
  return { en: template(p, checks), path: 'template' }
}

const HINDI = `Translate this JSON from English to Hindi (Devanagari script) for the person the report belongs to.
Preserve the meaning exactly; do not add, remove or soften anything. Keep every number, unit and test name exactly as written, in the same Latin characters and Western digits (do not convert to Devanagari numerals). Keep the "name" fields unchanged. Return the same JSON shape.`

const numbers = (s: string) => new Set(s.match(/\d+(?:[.,]\d+)?/g) ?? [])
// Every number in the Hindi output must also appear in the English output (a translation must not invent or change one).
export function numbersConsistent(en: Explanation, hi: Explanation): string[] {
  const ok = numbers(textOf(en))
  return [...numbers(textOf(hi))].filter((n) => !ok.has(n))
}

export async function explain(p: Payload, checks: Check[]): Promise<Explained> {
  const cfg = config()
  const { en, path } = await english(p, checks)
  console.info(`ClearReport explanation path: ${path}`) // logged path only, never the content
  let hi: Explanation | null = null, hindi_note: string | null = null
  if (cfg.hindi) {
    try {
      const out = await ask(HINDI, JSON.stringify(en))
      const extra = numbersConsistent(en, out)
      if (out.tests.length !== en.tests.length) hindi_note = 'The Hindi version did not match the English one, so it is not shown.'
      else if (extra.length) hindi_note = `The Hindi version changed a number (${extra.join(', ')}), so it is not shown.`
      else hi = { ...out, tests: out.tests.map((t, i) => ({ ...t, name: en.tests[i].name })) }
    } catch (e) {
      hindi_note = 'The Hindi version could not be made this time.'
      console.info(`ClearReport Hindi translation failed: ${String(e)}`)
    }
  }
  return { en, hi, path, hindi_note, prompt_version: cfg.promptVersion, model: cfg.model }
}
