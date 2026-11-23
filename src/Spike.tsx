import { useState } from 'react'
import { setLogLevel } from 'firebase/app'
import { guessCorners, straighten } from './crop'
import { extract, extractDoc, extractRows, findPersonal, model, textModel, toB64, warmText, type Mode, type Run } from './extract'
import { aiBoxes, nonResultLines, ocrWords, resultLine, suggestMasks, type Suggestion } from './masks'
import { isPdf, pdfPages } from './pdf'
import { toLines, type Word } from './textlayer'
import { rowsForModel } from './textrows'
import { trustOf } from './trust'

setLogLevel('debug') // SDK logs why on-device was or wasn't used

const SYNTHETIC = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r1-photo', 'r6-photo']
// Public sample PDFs published by Dr Lal PathLabs (dummy patients), kept locally in test-data/real-samples/.
const SAMPLES = ['WM14', 'WM15']
// Synthetic text PDFs in other layouts (test-data/generate-pdf.ts).
const TEXT_PDFS = ['p1', 'p2', 'p3']
const KNOWN = [...SYNTHETIC, ...SAMPLES, ...TEXT_PDFS]
type Page = { mimeType: string; data: string; url: string; words: Word[] | null }
type Img = { name: string; synthetic: boolean; pages: Page[]; skipped: number[] } // skipped: 1-based PDF pages without results, not sent

// Dev server only (vite.config.ts); the call is compiled out of production builds.
const save = (run: Run) => import.meta.env.DEV && fetch('/__runs', { method: 'POST', body: JSON.stringify(run) })

// Same page dropping as Flow: pages without results are not sent.
async function toPages(f: Blob): Promise<Pick<Img, 'pages' | 'skipped'>> {
  const all = isPdf(f) ? await pdfPages(f) : [{ png: f, words: null, results: true }]
  const kept = all.some((p) => p.results) ? all.filter((p) => p.results) : all
  const pages = await Promise.all(kept.map(async ({ png: p, words }) => { const png = p!; return { mimeType: png.type, data: await toB64(png), url: URL.createObjectURL(png), words } }))
  return { pages, skipped: all.flatMap((p, i) => (kept.includes(p) ? [] : [i + 1])) }
}
// Mask coverage for one identity field: every word of the true value that OCR read must sit inside a box.
// 'not read' = OCR never read that word, so no method could box it.
const tk = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
function coverage(value: string, words: Word[], boxes: Suggestion[]): 'covered' | 'partial' | 'missed' | 'not read' {
  const want = value.split(/\s+/).map(tk).filter((t) => t.length >= 2 && !['mr', 'mrs', 'ms', 'dr'].includes(t))
  const like = (w: Word, t: string) => { const x = tk(w.text); return x === t || (t.length >= 5 && x.length >= 4 && (x.includes(t) || t.includes(x))) }
  const inBox = (w: Word) => boxes.some((b) => (w.x0 + w.x1) / 2 >= b.x && (w.x0 + w.x1) / 2 <= b.x + b.w && (w.y0 + w.y1) / 2 >= b.y && (w.y0 + w.y1) / 2 <= b.y + b.h)
  const seen = want.filter((t) => words.some((w) => like(w, t)))
  if (!seen.length) return 'not read'
  const hit = seen.filter((t) => words.some((w) => like(w, t) && inBox(w)))
  return hit.length === want.length ? 'covered' : hit.length ? 'partial' : 'missed'
}

async function loadSynthetic(id: string): Promise<Img> {
  const isText = SAMPLES.includes(id) || TEXT_PDFS.includes(id)
  const path = SAMPLES.includes(id) ? `/test-data/real-samples/${id}.pdf` : `/test-data/reports/${id}.${TEXT_PDFS.includes(id) ? 'pdf' : id.endsWith('-photo') ? 'jpg' : 'png'}`
  const res = await fetch(path)
  const blob = new Blob([await res.arrayBuffer()], { type: isText ? 'application/pdf' : res.headers.get('content-type') ?? '' })
  return { name: id, synthetic: true, ...(await toPages(blob)) }
}

// Chrome's Prompt API global, read directly only for the status panel.
declare const LanguageModel: { availability(o: object): Promise<string> } | undefined

export default function Spike() {
  const [log, setLog] = useState<string[]>([])
  const [img, setImg] = useState<Img | null>(null)
  const [runs, setRuns] = useState<Run[]>([])
  const [busy, setBusy] = useState(false)
  const say = (s: string) => setLog((l) => [...l, `${new Date().toLocaleTimeString()} ${s}`])

  async function checkStatus() {
    say(`UA: ${navigator.userAgent}`)
    if (typeof LanguageModel === 'undefined') return say('LanguageModel global: MISSING (Prompt API not exposed in this browser)')
    for (const inputs of [[{ type: 'text', languages: ['en'] }], [{ type: 'text', languages: ['en'] }, { type: 'image' }]])
      say(`LanguageModel.availability(${inputs.map((i) => i.type).join('+')}): ${await LanguageModel.availability({ expectedInputs: inputs })}`)
  }

  async function initDevice() {
    setBusy(true)
    say('initializeDeviceModel() called from click')
    try {
      await model('device', 'full').initializeDeviceModel((p) => say(`download progress: ${(p * 100).toFixed(1)}%`))
      await textModel().initializeDeviceModel(() => {})
      say('initializeDeviceModel() resolved: on-device model ready')
    } catch (e) {
      say(`initializeDeviceModel() FAILED: ${e}`)
    }
    await checkStatus()
    setBusy(false)
  }

  async function run(target: Img, mode: Mode) {
    if (mode === 'cloud' && !target.synthetic) return say('Cloud runs are blocked for non-synthetic images.')
    if (target.skipped.length) say(`${target.name}: skipped page(s) ${target.skipped.join(', ')} (no results)`)
    if (target.pages.length > 1) return report({ ...(await extractDoc(target.name, mode, target.pages, (d, n) => say(`${target.name}/${mode}: ${d} of ${n} pages read`))), skipped_pages: target.skipped }, target)
    let r = await extract(target.name, mode, 'single', target.pages[0])
    report(r, target)
    if (!r.ok) {
      say(`${target.name}/${mode}: single call failed, trying split (header + tests)`)
      r = await extract(target.name, mode, 'split', target.pages[0])
      report(r, target)
    }
  }
  function report(r: Run, target?: Img) {
    // Badges per row (legible flag + PDF text-layer check), saved with the run for the eval.
    const rows = (r.output as { tests?: [] } | null)?.tests
    if (target && rows) r = { ...r, trust: trustOf(rows, target.pages.map((p) => p.words)) }
    setRuns((rs) => [...rs, r])
    say(`${r.report}/${r.mode}/${r.strategy}${r.page_strategies ? ` [${r.page_strategies.join(',')}]` : ''}: ${r.ok ? 'ok' : 'FAILED'} served_by=[${r.calls.map((c) => c.source).join(',')}] ${r.latency_ms}ms ${r.output_chars} chars${r.ok ? '' : ` ${r.calls.find((c) => !c.ok)?.error}`}`)
    if (KNOWN.includes(r.report)) save(r) // never write uploaded (possibly real) reports to disk
  }

  async function runAll(modes: Mode[] = ['device', 'cloud']) {
    setBusy(true)
    for (const id of SYNTHETIC) {
      const s = await loadSynthetic(id)
      setImg(s)
      for (const mode of modes) await run(s, mode)
    }
    say('Run all: done. Now run `npm run eval`.')
    setBusy(false)
  }

  // New Path 1: text rows (identity removed locally) to the on-device model. The sent text is saved with the run for the leak check.
  async function runText(ids = SAMPLES) {
    setBusy(true)
    const w0 = performance.now()
    await warmText() // the real flow warms up while the user uploads; timings below start warm
    say(`On-device model warm-up: ${((performance.now() - w0) / 1000).toFixed(1)} s`)
    for (const id of ids) {
      const s = await loadSynthetic(id)
      setImg(s)
      const rows = rowsForModel(s.pages.map((p) => p.words ?? []))
      say(`${id}: ${rows.batches.length} batches, local age ${rows.age}, sex ${rows.sex}, ${rows.dropped_lines} identity lines dropped`)
      const r = await extractRows(id, rows.batches, rows, (d, n) => say(`${id}/rows: ${d} of ${n} batches`))
      report({ ...r, sent: rows.batches.map((b) => b.text) }, s)
    }
    say('Path 1 text runs: done.')
    setBusy(false)
  }

  // The duplicate-name fix (skippedRows) on the device: WM15's blood-count rows with the parser off. Not saved as a run.
  async function runMonocytes() {
    setBusy(true)
    const s = await loadSynthetic('WM15')
    const rows = rowsForModel(s.pages.map((p) => p.words ?? []))
    const cbc = rows.batches.filter((b) => /Monocytes/.test(b.text))
    const r = await extractRows('WM15-cbc', cbc, rows, (d, n) => say(`WM15 blood count, model only: ${d} of ${n} batches`), undefined, false)
    const tests = ((r.output as { tests?: { name: string; value: unknown; unit: unknown }[] } | null)?.tests ?? [])
    say(`Model only: ${r.calls.length} calls, ${(r.latency_ms / 1000).toFixed(1)} s. Monocytes rows: ${JSON.stringify(tests.filter((t) => /monocytes/i.test(t.name)).map((t) => [t.value, t.unit]))}`)
    setBusy(false)
  }

  // Path 2 masking: label rules alone vs rules + the on-device model, on OCR words (photos straightened with the
  // suggested corners, as when the user accepts them). Counts only; nothing is saved.
  async function runMasks() {
    setBusy(true)
    for (const id of ['r1', 'r6', 'r6-photo', 'r7-photo']) {
      let blob = await (await fetch(`/test-data/reports/${id}.${id.endsWith('-photo') ? 'jpg' : 'png'}`)).blob()
      if (id.endsWith('-photo')) { const bmp = await createImageBitmap(blob); blob = await straighten(blob, guessCorners(bmp)); bmp.close() }
      const pii = (await (await fetch(`/test-data/ground-truth/${id}.json`)).json()).pii as Record<string, string>
      const t0 = performance.now()
      let words = await ocrWords(blob)
      let rules = suggestMasks(words, true)
      if (rules.length < 2) { const w2 = await ocrWords(blob, true); const again = suggestMasks(w2, true); if (again.length > rules.length) { rules = again; words = w2 } }
      // Boxes whose centre sits on a line that looks like a test result (should be 0 after the result-line guard).
      const resLines = toLines(words).filter((l) => resultLine(l.text))
      const onResult = (bs: Suggestion[]) => bs.filter((b) => resLines.some((l) => b.y + b.h / 2 >= l.y0 && b.y + b.h / 2 <= l.y1)).length
      const unguarded = suggestMasks(words)
      const ocrMs = performance.now() - t0
      const lines = nonResultLines(words)
      let extra: Suggestion[] = [], aiMs = 0, calls = 0, err = ''
      try { const r = await findPersonal(lines.map((l) => l.text)); extra = aiBoxes(lines, r.found, rules); aiMs = r.ms; calls = r.calls } catch (e) { err = String(e) }
      const fields: [string, string][] = [['name', pii.patient_name], ['id', pii.patient_id], ['phone', pii.phone], ['doctor', pii.doctor_name], ['age', pii.age]]
      const cov = (b: Suggestion[]) => fields.map(([k, v]) => `${k}=${coverage(v, words, b)}`).join(' ')
      const stray = extra.filter((b) => !fields.some(([, v]) => coverage(v, words, [b]) !== 'missed' && coverage(v, words, [b]) !== 'not read')).length
      say(`${id}: OCR ${(ocrMs / 1000).toFixed(1)} s, ${lines.length} non-result lines | rules: ${cov(rules)} | rules+AI: ${cov([...rules, ...extra])} | AI +${extra.length} boxes (${stray} on non-identity text), ${calls} calls | boxes on result lines: rules without guard ${onResult(unguarded)}/${unguarded.length}, with guard ${onResult(rules)}/${rules.length}, AI ${onResult(extra)}/${extra.length}, ${(aiMs / 1000).toFixed(1)} s${err ? ` | AI error: ${err}` : ''}`)
    }
    say('Mask coverage: done.')
    setBusy(false)
  }

  async function runOne(mode: Mode) {
    if (!img) return
    setBusy(true)
    await run(img, mode)
    setBusy(false)
  }

  return (
    <main style={{ fontFamily: 'sans-serif', padding: 16, maxWidth: 1100 }}>
      <h1>ClearReport extraction spike</h1>
      <p>
        <button disabled={busy} onClick={initDevice}>1. Initialize on-device model</button>{' '}
        <button disabled={busy} onClick={checkStatus}>Check status</button>{' '}
        <button disabled={busy} onClick={() => runAll()}>Run all 8 synthetic reports (device + cloud)</button>{' '}
        <button disabled={busy} onClick={() => runAll(['device'])}>2. Run all 8 ONLY_ON_DEVICE</button>{' '}
        <button disabled={busy} onClick={() => runText()}>3. Run WM14 + WM15 as text ONLY_ON_DEVICE (Path 1)</button>{' '}
        <button disabled={busy} onClick={runMonocytes}>4. WM15 blood count, model only (Monocytes check)</button>{' '}
        <button disabled={busy} onClick={() => runText(TEXT_PDFS)}>5. Run p1-p3 as text (Path 1, other layouts)</button>{' '}
        <button disabled={busy} onClick={runMasks}>6. Mask coverage: rules vs rules + on-device AI</button>
      </p>
      <p>
        Synthetic:{' '}
        {KNOWN.map((id) => (
          <button key={id} disabled={busy} onClick={async () => setImg(await loadSynthetic(id))}>{id}</button>
        ))}{' '}
        or upload:{' '}
        <input type="file" accept="image/png,image/jpeg,application/pdf" onChange={async (e) => {
          const f = e.target.files?.[0]
          if (f) setImg({ name: f.name, synthetic: false, ...(await toPages(f)) })
        }} />
      </p>
      {img && (
        <p>
          <b>{img.name}</b>{' '}
          <button disabled={busy} onClick={() => runOne('device')}>Extract ONLY_ON_DEVICE</button>{' '}
          <button disabled={busy || !img.synthetic} onClick={() => runOne('cloud')}>Extract ONLY_IN_CLOUD (synthetic only)</button>
        </p>
      )}
      <div style={{ display: 'flex', gap: 16 }}>
        <pre style={{ flex: 1, background: '#111', color: '#0f0', padding: 8, whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 500, overflow: 'auto' }}>{log.join('\n')}</pre>
        {img && <div style={{ width: 380 }}>{img.pages.map((p, i) => <img key={i} src={p.url} style={{ width: '100%', border: '1px solid #ccc' }} />)}</div>}
      </div>
      <h2>Runs</h2>
      <table border={1} cellPadding={4} style={{ borderCollapse: 'collapse', fontSize: 13 }}>
        <thead><tr><th>report</th><th>mode</th><th>strategy</th><th>served by</th><th>ok</th><th>latency ms</th><th>output chars</th></tr></thead>
        <tbody>
          {runs.map((r, i) => (
            <tr key={i}><td>{r.report}</td><td>{r.mode}</td><td>{r.strategy}</td><td>{r.calls.map((c) => c.source).join(', ')}</td><td>{String(r.ok)}</td><td>{r.latency_ms}</td><td>{r.output_chars}</td></tr>
          ))}
        </tbody>
      </table>
      {runs.length > 0 && <pre style={{ fontSize: 11 }}>{JSON.stringify(runs.at(-1), null, 2)}</pre>}
    </main>
  )
}
