// Scores saved runs (test-data/runs, written by the spike page) against ground truth.
// Prints a table and writes test-data/results.md. Run: npm run eval
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonical } from '../src/canonical'

const DIR = dirname(fileURLToPath(import.meta.url))
type Test = { name: string; value: number | string | null; unit: string | null; ref_low: number | null; ref_high: number | null; ref_text: string | null; printed_flag: string | null }
type Pii = Record<string, string | null>
type Out = { lab_name?: string | null; pii?: Pii; tests?: Test[] }
type Run = { report: string; mode: string; strategy: string; ok: boolean; latency_ms: number; output_chars: number; calls: { source: string | null; error?: string }[]; output: Out | null }

const alnum = (s: unknown) => String(s ?? '').toLowerCase().replace(/µ|μ|mc(?=[gi])/g, 'u').replace(/[^a-z0-9]/g, '')
const words = (s: unknown) => new Set(String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !['mr', 'mrs', 'ms', 'dr'].includes(w)))
const numEq = (a: unknown, b: unknown) => (a === null || a === undefined ? b === null : b !== null && Math.abs(Number(String(a).replace(/,/g, '')) - Number(b)) < 1e-6)

// Same canonical key (src/canonical.ts alias table), each extracted row used at most once.
const matchTest = (gt: Test, got: Test[], used: Set<Test>): Test | undefined => {
  const m = got.find((t) => !used.has(t) && canonical(t.name) === canonical(gt.name))
  if (m) used.add(m)
  return m
}

// A PII field counts as found only if the extracted value carries the same identity.
const PII_CHECK: Record<string, (gt: string, got: string) => boolean> = {
  patient_name: (g, x) => [...words(g)].every((w) => words(x).has(w)),
  doctor_name: (g, x) => [...words(g)].every((w) => words(x).has(w)),
  age: (g, x) => g.replace(/\D/g, '') === x.replace(/\D/g, ''),
  sex: (g, x) => g[0]?.toLowerCase() === x.trim()[0]?.toLowerCase(),
  patient_id: (g, x) => alnum(g) === alnum(x),
  phone: (g, x) => g.replace(/\D/g, '').slice(-10) === x.replace(/\D/g, '').slice(-10),
}

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : 'n/a')
const rows: string[][] = []
const totals: Record<string, { n: number; found: number; value: number; unit: number; range: number; flag: number; piiMissed: number; piiN: number; lat: number[]; chars: number[]; runs: number; failed: number }> = {}

for (const f of readdirSync(join(DIR, 'ground-truth')).sort()) {
  const gt = JSON.parse(readFileSync(join(DIR, 'ground-truth', f), 'utf-8'))
  for (const mode of ['device', 'cloud']) {
    const T = (totals[`${mode} ${gt.id.endsWith('-photo') ? 'photo' : 'clean'}`] ??= { n: 0, found: 0, value: 0, unit: 0, range: 0, flag: 0, piiMissed: 0, piiN: 0, lat: [], chars: [], runs: 0, failed: 0 })
    const runs = ['single', 'split'].map((s) => join(DIR, 'runs', `${gt.id}.${mode}.${s}.json`)).filter(existsSync).map((p) => JSON.parse(readFileSync(p, 'utf-8')) as Run)
    if (!runs.length) { rows.push([gt.id, gt.layout, mode, 'no run', '', '', '', '', '', '', '', '', '']); continue }
    const tried = runs.map((r) => `${r.strategy}:${r.ok ? 'ok' : 'fail'}`).join(' ')
    const run = runs.find((r) => r.ok) ?? runs[0]
    const served = [...new Set(run.calls.map((c) => c.source ?? 'none'))].join('+')
    T.runs++
    T.n += gt.tests.length
    T.piiN += 6
    if (!run.ok || !run.output) {
      T.failed++
      T.piiMissed += 6
      rows.push([gt.id, gt.layout, mode, tried, served, `0/${gt.tests.length}`, '-', '-', '-', '-', 'all 6 (no output)', String(run.latency_ms), String(run.output_chars)])
      continue
    }
    const got = run.output.tests ?? []
    const used = new Set<Test>()
    let found = 0, value = 0, unit = 0, range = 0, flag = 0
    for (const t of gt.tests as Test[]) {
      const m = matchTest(t, got, used)
      if (!m) continue
      found++
      if (numEq(m.value, t.value)) value++
      if (alnum(m.unit) === alnum(t.unit)) unit++
      if (numEq(m.ref_low, t.ref_low) && numEq(m.ref_high, t.ref_high)) range++
      if ((m.printed_flag ?? null) === t.printed_flag) flag++
    }
    const missed = Object.entries(gt.pii as Pii).filter(([k, v]) => !run.output!.pii?.[k] || !PII_CHECK[k](v!, String(run.output!.pii[k]))).map(([k]) => k)
    const extra = got.length - found
    Object.assign(T, { found: T.found + found, value: T.value + value, unit: T.unit + unit, range: T.range + range, flag: T.flag + flag, piiMissed: T.piiMissed + missed.length })
    T.lat.push(run.latency_ms)
    T.chars.push(run.output_chars)
    const n = gt.tests.length
    rows.push([gt.id, gt.layout, mode, tried, served, `${found}/${n}${extra > 0 ? ` (+${extra} extra)` : ''}`, pct(value, n), pct(unit, n), pct(range, n), pct(flag, n), missed.join(', ') || 'none', String(run.latency_ms), String(run.output_chars)])
  }
}

const head = ['report', 'layout', 'mode', 'attempts', 'served by', 'tests found', 'value', 'unit', 'range', 'flag', 'PII missed', 'latency ms', 'out chars']
const md = (h: string[], rs: string[][]) => [h, h.map(() => '---'), ...rs].map((r) => `| ${r.join(' | ')} |`).join('\n')
const med = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0)
const sumRows = Object.entries(totals).sort(([a], [b]) => a.localeCompare(b)).map(([m, t]) => [m, `${t.runs - t.failed}/${t.runs}`, pct(t.found, t.n), pct(t.value, t.n), pct(t.unit, t.n), pct(t.range, t.n), pct(t.flag, t.n), `${t.piiMissed}/${t.piiN}`, String(med(t.lat)), String(med(t.chars))])
const out = `# Extraction spike results

Generated ${new Date().toISOString()} by \`npm run eval\` from \`test-data/runs/\`. Accuracy columns are over all ground-truth tests (a test not found counts as wrong). PII missed = identity fields not extracted correctly; each one is a field the stripping step would not know to remove.

## Summary

${md(['mode / set', 'successful runs', 'tests found', 'value', 'unit', 'range', 'flag', 'PII missed', 'median latency ms', 'median out chars'], sumRows)}

## Per report

${md(head, rows)}
`
writeFileSync(join(DIR, 'results.md'), out, 'utf-8')
console.log(out)
