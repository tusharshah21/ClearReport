// Plain-language explanation of an APPROVED anonymous payload (cloud only), then a Hindi translation.
// Input is only { lab_name, age_band, sex, tests } plus the range-check results computed by plain code.
// The range-check notes are never rewritten by the model: the UI shows the engine's own text next to each test.
import { getGenerativeModel, InferenceMode, InferenceSource } from 'firebase/ai'
import { RETRYABLE, RETRY_DELAYS_MS } from './extract'
import { ai } from './firebase'
import { completeHindi } from './hindi'
import { BANNED, disagrees, type Check } from './guidelines'
import type { Payload } from './privacy'
import { fixQuestionGrammar, fixUnitsIn, questionsFor, questionsSpecific } from './questions'
import { config } from './remote'

export type Explanation = { summary: string; tests: { name: string; explanation: string }[]; questions: string[] }
export type ExplainPath = 'first try' | 'retry' | 'template'
export type Explained = { en: Explanation; hi: Explanation | null; path: ExplainPath; hindi_note: string | null; hindi_busy?: boolean; hi_english?: string[]; prompt_version: string; model: string }

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
- summary: 2-3 sentences. Name the specific tests whose result is above or below the lab's printed range, by test name, in plain words (for example: "Your triglycerides and LDL cholesterol are above your lab's range, and your HDL cholesterol is below it."). If range_check says the lab and the guideline disagree for a test, name that test and say the two ranges differ. If every result is inside its range, say so.
- tests: one entry per test, in the same order, with "name" copied exactly. "explanation": 1-2 short sentences: what the test measures, then where the result sits compared with the lab's printed range (inside, above or below). No range given: say so.
- questions: 3-5 short questions the person could ask their doctor. Each question names one specific test from this report and its value (for example: "My LDL cholesterol is 160 mg/dL, above my lab's range. What might explain this?"). If range_check shows that the lab and the guideline disagree for a test, the first question is about that test. No general questions that name no test.
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
  const named = (f: (t: Payload['tests'][number]) => boolean) => p.tests.filter((t) => t.value !== null && f(t)).map((t) => t.name).join(', ')
  const above = named((t) => t.ref_high !== null && t.value! > t.ref_high)
  const below = named((t) => t.ref_low !== null && t.value! < t.ref_low)
  const split = p.tests.filter((_, i) => checks[i] && disagrees(checks[i])).map((t) => t.name).join(', ')
  return {
    summary: [
      `Your report lists ${p.tests.length} test${p.tests.length === 1 ? '' : 's'}.`,
      above && `Above your lab's range: ${above}.`,
      below && `Below your lab's range: ${below}.`,
      !above && !below && 'All results with a printed range are inside it.',
      split && `Your lab's range and a common guideline differ for: ${split}.`,
      "The notes below compare each result with your lab's range.",
    ].filter(Boolean).join(' '),
    tests: p.tests.map((t, i) => ({ name: t.name, explanation: checks[i]?.message ?? '' })),
    questions: questionsFor(p, checks),
  }
}

async function english(p: Payload, checks: Check[]): Promise<{ en: Explanation; path: ExplainPath }> {
  const data = input(p, checks)
  for (const [path, prompt] of [['first try', RULES], ['retry', RULES + STRICTER]] as const) {
    try {
      const en = await ask(prompt, data)
      if (wordingOk(en) && en.tests.length === p.tests.length) {
        if (questionsSpecific(en.questions, p, checks)) return { en: { ...en, questions: en.questions.map((q) => fixQuestionGrammar(q, p)) }, path }
        console.info('ClearReport explanation: the questions named no specific result, so they are built from the findings')
        return { en: { ...en, questions: questionsFor(p, checks) }, path }
      }
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
  const { en: raw, path } = await english(p, checks)
  const en = fixUnitsIn(raw, p) // units exactly as in the approved payload (plain code)
  console.info(`ClearReport explanation path: ${path}`) // logged path only, never the content
  const h = cfg.hindi ? await hindi(en, p) : { hi: null, hindi_note: null }
  return { en, ...h, path, prompt_version: cfg.promptVersion, model: cfg.model }
}

// Hindi translation of the English explanation. A busy cloud (500 "high demand", 503, 429) is retried with backoff,
// as extraction is; if it is still busy, hindi_busy lets the page offer "try again" (hindiAgain).
export type Hindi = Pick<Explained, 'hi' | 'hindi_note' | 'hindi_busy' | 'hi_english'>
export const HINDI_BUSY = 'Hindi is busy right now, try again.'
export async function hindi(en: Explanation, p: Payload): Promise<Hindi> {
  let out: Explanation
  try {
    out = await retrying('Hindi translation', () => ask(HINDI, JSON.stringify(en)))
  } catch (e) {
    return RETRYABLE.test(String(e)) ? { hi: null, hindi_note: HINDI_BUSY, hindi_busy: true } : { hi: null, hindi_note: 'The Hindi version could not be made this time.' }
  }
  const extra = numbersConsistent(en, out)
  if (out.tests.length !== en.tests.length) return { hi: null, hindi_note: 'The Hindi version did not match the English one, so it is not shown.' }
  if (extra.length) return { hi: null, hindi_note: `The Hindi version changed a number (${extra.join(', ')}), so it is not shown.` }
  // Every field must really be Hindi: any field left in English is translated again on its own (plain-code check).
  const done = await completeHindi(en, { ...out, tests: out.tests.map((t, i) => ({ ...t, name: en.tests[i].name })) }, translateOne)
  if (done.english.length) console.info(`ClearReport Hindi: ${done.english.length} field(s) shown in English`)
  return { hi: fixUnitsIn(done.hi, p), hindi_note: null, hi_english: done.english }
}

// A busy cloud (500 "high demand", 503, 429) is retried with backoff, as extraction is; other errors are thrown at once.
async function retrying<T>(what: string, call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call()
    } catch (e) {
      console.info(`ClearReport ${what} failed (attempt ${attempt + 1}): ${String(e)}`)
      if (!RETRYABLE.test(String(e)) || attempt >= RETRY_DELAYS_MS.length) throw e
      await new Promise((ok) => setTimeout(ok, RETRY_DELAYS_MS[attempt] * (0.75 + Math.random() / 2)))
    }
  }
}

// One field at a time, for a field the full translation left in English. Same cloud model, same number rules.
const ONE_SCHEMA = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
const HINDI_ONE = `Translate this text from English to Hindi (Devanagari script) for the person the report belongs to.
Preserve the meaning exactly; do not add, remove or soften anything. Keep every number, unit and test name exactly as written, in the same Latin characters and Western digits (do not convert to Devanagari numerals). Return JSON {"text": "..."}.`
async function translateOne(text: string): Promise<string> {
  return retrying('Hindi field translation', async () => {
    const m = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: { model: config().model, generationConfig: { responseMimeType: 'application/json', responseJsonSchema: ONE_SCHEMA, temperature: 0.2 } },
    })
    const res = await m.generateContent([HINDI_ONE, text])
    if (res.response.inferenceSource && res.response.inferenceSource !== InferenceSource.IN_CLOUD) throw new Error(`served by ${res.response.inferenceSource}`)
    return String((JSON.parse(res.response.text()) as { text?: unknown }).text ?? '')
  })
}

// ---- "What does this test mean?": only the test's name is sent, never a value or anything personal. ----
// PREFER_ON_DEVICE: Chrome's built-in model answers when it is available, otherwise Gemini in the cloud.
export type Meaning = { text: string; source: 'on_device' | 'in_cloud' | 'template' }
const MEANING_SCHEMA = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] }
const MEANING = (name: string) => `In 2-3 short, plain sentences (reading age about 12), say what the blood test "${name}" measures and why doctors commonly order it.
General information only. Do not mention any result, number, disease the reader has, medicine or advice.
Never write "you have", "you should", "take", "treat", "treatment with", "diagnose", "diagnosis" or "wrong". Return JSON {"answer": "..."}.`
let meaningModel: ReturnType<typeof getGenerativeModel> | null = null
const meanings = new Map<string, Promise<Meaning>>() // in memory only, per test name, for this page load

export function meaning(name: string): Promise<Meaning> {
  if (!meanings.has(name)) meanings.set(name, askMeaning(name))
  return meanings.get(name)!
}
async function askMeaning(name: string): Promise<Meaning> {
  meaningModel ??= getGenerativeModel(ai, {
    mode: InferenceMode.PREFER_ON_DEVICE,
    onDeviceParams: { createOptions: { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] }, promptOptions: { responseConstraint: MEANING_SCHEMA } },
    inCloudParams: { model: config().model, generationConfig: { responseMimeType: 'application/json', responseJsonSchema: MEANING_SCHEMA, temperature: 0.2 } },
  })
  for (const prompt of [MEANING(name), MEANING(name) + STRICTER]) {
    try {
      const res = await meaningModel.generateContent(prompt)
      const text = String((JSON.parse(res.response.text()) as { answer?: unknown }).answer ?? '').trim()
      const source = res.response.inferenceSource === InferenceSource.ON_DEVICE ? 'on_device' : 'in_cloud'
      console.info(`ClearReport meaning: answered ${source}`)
      // No numbers except those in the test's own name ("HbA1c", "T3"): a general answer has no results or doses.
      const strayNumber = (text.match(/\d+(?:\.\d+)?/g) ?? []).some((n) => !name.includes(n))
      if (text && !BANNED.test(text) && !strayNumber) return { text, source }
    } catch (e) {
      console.info(`ClearReport meaning failed: ${String(e)}`)
    }
  }
  meanings.delete(name) // let a later tap try again
  return { text: 'We could not write a careful answer this time. Your doctor or lab can explain what this test measures.', source: 'template' }
}
