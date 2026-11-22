import { getGenerativeModel, InferenceMode, InferenceSource, type GenerativeModel } from 'firebase/ai'
import { ai } from './firebase'

const num = { type: ['number', 'null'] }
const str = { type: ['string', 'null'] }
const TESTS = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      value: num,
      unit: str,
      ref_low: num,
      ref_high: num,
      ref_text: str,
      printed_flag: { type: ['string', 'null'], enum: ['H', 'L', null] },
    },
    required: ['name', 'value', 'unit', 'ref_low', 'ref_high', 'ref_text', 'printed_flag'],
  },
}
const PII = {
  type: 'object',
  properties: { patient_name: str, age: str, sex: str, patient_id: str, phone: str, doctor_name: str },
  required: ['patient_name', 'age', 'sex', 'patient_id', 'phone', 'doctor_name'],
}

// Same shape as test-data/ground-truth/*.json. "header" + "tests" is the split fallback.
export const SCHEMAS = {
  full: { type: 'object', properties: { lab_name: str, pii: PII, tests: TESTS }, required: ['lab_name', 'pii', 'tests'] },
  header: { type: 'object', properties: { lab_name: str, pii: PII }, required: ['lab_name', 'pii'] },
  tests: { type: 'object', properties: { tests: TESTS }, required: ['tests'] },
} as const
export type Part = keyof typeof SCHEMAS

const RULES = `Copy values exactly as printed. Use null for anything not printed.
ref_text is the reference interval exactly as printed. ref_low/ref_high are its numeric bounds ("< 200" means ref_low null, ref_high 200).
printed_flag is "H" or "L" only if the report itself marks the result (H/L, High/Low, arrows), else null. Do not judge values yourself.
Numbers without thousands separators.`
export const PROMPTS: Record<Part, string> = {
  full: `This is a photo of a blood test report. Extract the lab name, the patient identity fields and every test row as JSON.\n${RULES}`,
  header: `This is a photo of a blood test report. Extract only the lab name and the patient identity fields (name, age, sex, patient/lab ID, phone, referring doctor) as JSON. Copy exactly as printed; null if absent.`,
  tests: `This is a photo of a blood test report. Extract every test row from the results table(s) as JSON. Ignore the patient details.\n${RULES}`,
}

export type Mode = 'device' | 'cloud'
const cache = new Map<string, GenerativeModel>()
export function model(mode: Mode, part: Part): GenerativeModel {
  const key = `${mode}:${part}`
  if (!cache.has(key)) {
    cache.set(
      key,
      mode === 'device'
        ? getGenerativeModel(ai, {
            mode: InferenceMode.ONLY_ON_DEVICE,
            onDeviceParams: {
              createOptions: {
                expectedInputs: [{ type: 'text', languages: ['en'] }, { type: 'image' }],
                expectedOutputs: [{ type: 'text', languages: ['en'] }],
              },
              promptOptions: { responseConstraint: SCHEMAS[part] },
            },
          })
        : getGenerativeModel(ai, {
            mode: InferenceMode.ONLY_IN_CLOUD,
            inCloudParams: {
              model: 'gemini-3.5-flash-lite', // documented default, pinned so results are reproducible
              generationConfig: { responseMimeType: 'application/json', responseJsonSchema: SCHEMAS[part], temperature: 0 },
            },
          }),
    )
  }
  return cache.get(key)!
}

export type Call = { part: Part; source: string | null; latency_ms: number; output_chars: number; ok: boolean; error?: string; raw?: string }
export type Run = { report: string; mode: Mode; strategy: 'single' | 'split'; at: string; latency_ms: number; output_chars: number; ok: boolean; calls: Call[]; output: unknown }

async function call(mode: Mode, part: Part, image: { mimeType: string; data: string }): Promise<{ c: Call; json?: Record<string, unknown> }> {
  const t0 = performance.now()
  try {
    const res = await model(mode, part).generateContent([PROMPTS[part], { type: 'inlineData', inlineData: { mimeType: image.mimeType, data: image.data } }])
    const raw = res.response.text()
    const c: Call = { part, source: res.response.inferenceSource ?? null, latency_ms: Math.round(performance.now() - t0), output_chars: raw.length, ok: true, raw }
    // ONLY_ON_DEVICE already makes the SDK throw instead of falling back; this catches it if that ever changes.
    const expected = mode === 'device' ? InferenceSource.ON_DEVICE : InferenceSource.IN_CLOUD
    if (c.source !== expected) return { c: { ...c, ok: false, error: `served by ${c.source}, expected ${expected}` } }
    try {
      return { c, json: JSON.parse(raw) }
    } catch (e) {
      return { c: { ...c, ok: false, error: `JSON parse: ${(e as Error).message}` } }
    }
  } catch (e) {
    return { c: { part, source: null, latency_ms: Math.round(performance.now() - t0), output_chars: 0, ok: false, error: String(e) } }
  }
}

export async function extract(report: string, mode: Mode, strategy: Run['strategy'], image: { mimeType: string; data: string }): Promise<Run> {
  // Split = two calls with the SAME mode (a device retry never touches the cloud) and the same SCHEMAS
  // objects that model() passes to responseConstraint (device) and responseJsonSchema (cloud).
  const parts: Part[] = strategy === 'single' ? ['full'] : ['header', 'tests']
  const results = []
  for (const p of parts) results.push(await call(mode, p, image)) // sequential: one on-device session at a time
  const calls = results.map((r) => r.c)
  const ok = calls.every((c) => c.ok)
  return {
    report, mode, strategy, at: new Date().toISOString(), ok, calls,
    latency_ms: calls.reduce((s, c) => s + c.latency_ms, 0),
    output_chars: calls.reduce((s, c) => s + c.output_chars, 0),
    output: ok ? Object.assign({}, ...results.map((r) => r.json)) : null,
  }
}
