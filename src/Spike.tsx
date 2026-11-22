import { useState } from 'react'
import { setLogLevel } from 'firebase/app'
import { extract, extractDoc, model, toB64, type Mode, type Run } from './extract'
import { isPdf, pdfPages } from './pdf'
import type { Word } from './textlayer'
import { trustOf } from './trust'

setLogLevel('debug') // SDK logs why on-device was or wasn't used

const SYNTHETIC = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r1-photo', 'r6-photo']
// Public sample PDFs published by Dr Lal PathLabs (dummy patients), kept locally in test-data/real-samples/.
const SAMPLES = ['WM14', 'WM15']
const KNOWN = [...SYNTHETIC, ...SAMPLES]
type Page = { mimeType: string; data: string; url: string; words: Word[] | null }
type Img = { name: string; synthetic: boolean; pages: Page[]; skipped: number[] } // skipped: 1-based PDF pages without results, not sent

// Dev server only (vite.config.ts); the call is compiled out of production builds.
const save = (run: Run) => import.meta.env.DEV && fetch('/__runs', { method: 'POST', body: JSON.stringify(run) })

// Same page dropping as Flow: pages without results are not sent.
async function toPages(f: Blob): Promise<Pick<Img, 'pages' | 'skipped'>> {
  const all = isPdf(f) ? await pdfPages(f) : [{ png: f, words: null, results: true }]
  const kept = all.some((p) => p.results) ? all.filter((p) => p.results) : all
  const pages = await Promise.all(kept.map(async ({ png, words }) => ({ mimeType: png.type, data: await toB64(png), url: URL.createObjectURL(png), words })))
  return { pages, skipped: all.flatMap((p, i) => (kept.includes(p) ? [] : [i + 1])) }
}
async function loadSynthetic(id: string): Promise<Img> {
  const path = SAMPLES.includes(id) ? `/test-data/real-samples/${id}.pdf` : `/test-data/reports/${id}.${id.endsWith('-photo') ? 'jpg' : 'png'}`
  const res = await fetch(path)
  const blob = new Blob([await res.arrayBuffer()], { type: SAMPLES.includes(id) ? 'application/pdf' : res.headers.get('content-type') ?? '' })
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
        <button disabled={busy} onClick={() => runAll(['device'])}>2. Run all 8 ONLY_ON_DEVICE</button>
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
