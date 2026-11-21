import { useState } from 'react'
import { setLogLevel } from 'firebase/app'
import { extract, model, type Mode, type Run } from './extract'

setLogLevel('debug') // SDK logs why on-device was or wasn't used

const SYNTHETIC = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']
type Img = { name: string; synthetic: boolean; mimeType: string; data: string; url: string }

const toB64 = (b: Blob) =>
  new Promise<string>((ok) => {
    const r = new FileReader()
    r.onload = () => ok((r.result as string).split(',')[1])
    r.readAsDataURL(b)
  })
const save = (run: Run) => fetch('/__runs', { method: 'POST', body: JSON.stringify(run) })

async function loadSynthetic(id: string): Promise<Img> {
  const blob = await (await fetch(`/test-data/reports/${id}.png`)).blob()
  return { name: id, synthetic: true, mimeType: 'image/png', data: await toB64(blob), url: URL.createObjectURL(blob) }
}

// Chrome's Prompt API global, read directly only for the status panel.
declare const LanguageModel: { availability(o: object): Promise<string> } | undefined

export default function App() {
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
    let r = await extract(target.name, mode, 'single', target)
    report(r)
    if (!r.ok) {
      say(`${target.name}/${mode}: single call failed, trying split (header + tests)`)
      r = await extract(target.name, mode, 'split', target)
      report(r)
    }
  }
  function report(r: Run) {
    setRuns((rs) => [...rs, r])
    say(`${r.report}/${r.mode}/${r.strategy}: ${r.ok ? 'ok' : 'FAILED'} served_by=[${r.calls.map((c) => c.source).join(',')}] ${r.latency_ms}ms ${r.output_chars} chars${r.ok ? '' : ` ${r.calls.find((c) => !c.ok)?.error}`}`)
    if (SYNTHETIC.includes(r.report)) save(r) // never write uploaded (possibly real) reports to disk
  }

  async function runAll() {
    setBusy(true)
    for (const id of SYNTHETIC) {
      const s = await loadSynthetic(id)
      setImg(s)
      for (const mode of ['device', 'cloud'] as Mode[]) await run(s, mode)
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
        <button disabled={busy} onClick={runAll}>Run all 6 synthetic reports (device + cloud)</button>
      </p>
      <p>
        Synthetic:{' '}
        {SYNTHETIC.map((id) => (
          <button key={id} disabled={busy} onClick={async () => setImg(await loadSynthetic(id))}>{id}</button>
        ))}{' '}
        or upload:{' '}
        <input type="file" accept="image/png,image/jpeg" onChange={async (e) => {
          const f = e.target.files?.[0]
          if (f) setImg({ name: f.name, synthetic: false, mimeType: f.type, data: await toB64(f), url: URL.createObjectURL(f) })
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
        {img && <img src={img.url} style={{ width: 380, border: '1px solid #ccc' }} />}
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
