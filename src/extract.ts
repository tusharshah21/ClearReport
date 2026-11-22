import { getGenerativeModel, InferenceMode, InferenceSource, type GenerativeModel } from 'firebase/ai'
import { ai } from './firebase'
import { config } from './remote'

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
      legible: { type: 'boolean' },
    },
    required: ['name', 'value', 'unit', 'ref_low', 'ref_high', 'ref_text', 'printed_flag', 'legible'],
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
name is only the test's own name as printed, without section headings or method lines.
ref_text is the reference interval exactly as printed. ref_low/ref_high are its numeric bounds ("< 200" means ref_low null, ref_high 200; "> 40" means ref_low 40, ref_high null).
printed_flag is "H" or "L" only if the report itself marks the result (H/L, High/Low, arrows), else null. Do not judge values yourself.
Numbers without thousands separators.
legible: false if ANY digit, decimal point or sign of the value or the reference interval is unclear, covered (by a stamp, watermark, fold, glare or mark) or cut off. In that case set value to null (and the affected range bound to null). Never guess or reconstruct a digit. Otherwise legible: true.`
export const PROMPTS: Record<Part, string> = {
  full: `This is a photo of a blood test report. Extract the lab name, the patient identity fields and every test row as JSON.\n${RULES}`,
  header: `This is a photo of a blood test report. Extract only the lab name and the patient identity fields (name, age, sex, patient/lab ID, phone, referring doctor) as JSON. Copy exactly as printed; null if absent.`,
  tests: `This is a photo of a blood test report. Extract every test row from the results table(s) as JSON. Ignore the patient details.\n${RULES}`,
}

export type Mode = 'device' | 'cloud'
// Shared with the availability check so it asks Chrome about exactly what extraction needs.
export const DEVICE_CREATE_OPTIONS = {
  expectedInputs: [{ type: 'text' as const, languages: ['en'] }, { type: 'image' as const }],
  expectedOutputs: [{ type: 'text' as const, languages: ['en'] }],
}
export const toB64 = (b: Blob) =>
  new Promise<string>((ok, fail) => {
    const r = new FileReader()
    r.onload = () => ok((r.result as string).split(',')[1])
    r.onerror = () => fail(r.error)
    r.readAsDataURL(b)
  })
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
              createOptions: DEVICE_CREATE_OPTIONS,
              promptOptions: { responseConstraint: SCHEMAS[part] },
            },
          })
        : getGenerativeModel(ai, {
            mode: InferenceMode.ONLY_IN_CLOUD,
            inCloudParams: {
              model: config().model, // Remote Config, default pinned in remote.ts so results are reproducible
              generationConfig: { responseMimeType: 'application/json', responseJsonSchema: SCHEMAS[part], temperature: 0 },
            },
          }),
    )
  }
  return cache.get(key)!
}

export type Call = { part: Part; source: string | null; latency_ms: number; output_chars: number; ok: boolean; error?: string; raw?: string; retries?: number }
export type Run = { report: string; mode: Mode; strategy: 'single' | 'split' | 'pages'; at: string; latency_ms: number; output_chars: number; ok: boolean; calls: Call[]; output: unknown; page_strategies?: (string | null)[]; skipped_pages?: number[]; trust?: unknown[] }
type Image = { mimeType: string; data: string }
type Out = { lab_name?: unknown; pii?: Record<string, unknown>; tests?: unknown[] }

// Cloud pages run 3 at a time; on-device stays one at a time (one local session, and a device failure must never be hidden by parallel work).
const CONCURRENCY: Record<Mode, number> = { cloud: 3, device: 1 }

// One call per page (single, then split if that fails, always the same mode), merged in page order.
// Header fields take the first non-null value across pages; test rows are concatenated.
// Pages without results are dropped by the caller before this (pdf.ts pagesWithResults). onProgress(done, total) after each page.
export async function extractDoc(report: string, mode: Mode, pages: Image[], onProgress?: (done: number, total: number) => void): Promise<Run> {
  const t0 = performance.now()
  const runs: (Run | null)[] = pages.map(() => null)
  let next = 0, done = 0, failed = false
  const worker = async () => {
    while (!failed && next < pages.length) {
      const i = next++
      let r = await extract(report, mode, 'single', pages[i])
      if (!r.ok) {
        const first = r
        r = await extract(report, mode, 'split', pages[i])
        r = { ...r, calls: [...first.calls, ...r.calls], latency_ms: first.latency_ms + r.latency_ms, output_chars: first.output_chars + r.output_chars } // keep why single failed
      }
      runs[i] = r
      if (!r.ok) failed = true
      onProgress?.(++done, pages.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY[mode], pages.length) }, worker))
  if (pages.length === 1) return runs[0]!
  const ok = runs.every((r) => r?.ok)
  const outs = runs.map((r) => (r?.output ?? {}) as Out)
  const pii: Record<string, unknown> = {}
  for (const o of outs) for (const [k, v] of Object.entries(o.pii ?? {})) pii[k] ??= v ?? undefined
  return {
    report, mode, strategy: 'pages', at: new Date().toISOString(), ok,
    calls: runs.flatMap((r) => r?.calls ?? []),
    page_strategies: runs.map((r) => r?.strategy ?? null),
    latency_ms: Math.round(performance.now() - t0), // wall-clock time; pages overlap, so this is less than the sum of call latencies
    output_chars: runs.reduce((s, r) => s + (r?.output_chars ?? 0), 0),
    output: ok ? { lab_name: outs.map((o) => o.lab_name).find((v) => v) ?? null, pii: Object.fromEntries(Object.entries(pii).map(([k, v]) => [k, v ?? null])), tests: outs.flatMap((o, i) => (o.tests ?? []).map((t) => ({ ...(t as object), page: i }))) } : null,
  }
}

// Busy or rate-limited cloud ("[500 ] This model is currently experiencing high demand", 503, 429): worth waiting and retrying
// before the two-call split, which would only add load. Never retried on device (no cloud involved, and errors there are not load).
const RETRYABLE = /\[(429|500|503)\b|high demand|overloaded|resource.?exhausted/i
const RETRY_DELAYS_MS = [1500, 4000, 10000]
async function call(mode: Mode, part: Part, image: Image): Promise<{ c: Call; json?: Record<string, unknown> }> {
  for (let attempt = 0; ; attempt++) {
    const r = await callOnce(mode, part, image)
    if (r.c.ok || mode !== 'cloud' || attempt >= RETRY_DELAYS_MS.length || !RETRYABLE.test(r.c.error ?? '')) return { ...r, c: { ...r.c, retries: attempt } }
    await new Promise((ok) => setTimeout(ok, RETRY_DELAYS_MS[attempt] * (0.75 + Math.random() / 2))) // jitter so parallel pages don't retry in lockstep
  }
}

async function callOnce(mode: Mode, part: Part, image: Image): Promise<{ c: Call; json?: Record<string, unknown> }> {
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

export async function extract(report: string, mode: Mode, strategy: Run['strategy'], image: Image): Promise<Run> {
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
