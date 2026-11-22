import { useState } from 'react'
import type { Run } from './extract'
import { checkTest, DISCLAIMER, REVIEW_STATUS } from './guidelines'
import type { Finding, Payload } from './privacy'
import { BADGE_TEXT, type Trust } from './trust'

export type Result = { payload: Payload; findings: Finding[]; run: Run; trust: Trust[] }
const COLORS = { verified: '#1a7f37', check: '#b35900', image: '#555' }

// Values flagged "Please check" stay out of the range check until the user confirms or corrects them.
export default function Review({ result, onCancel, onApprove }: { result: Result; onCancel: () => void; onApprove: (p: Payload, confirmed: boolean[]) => void }) {
  const [edits, setEdits] = useState<Record<number, { text: string; confirmed: boolean }>>({})
  const pending = (i: number) => result.trust[i].badge === 'check' && !edits[i]?.confirmed
  const tests = result.payload.tests.map((t, i) => (edits[i]?.confirmed ? { ...t, value: edits[i].text.trim() === '' ? null : Number(edits[i].text) } : t))
  const payload: Payload = { ...result.payload, tests }
  const validNumber = (s: string) => s.trim() === '' || Number.isFinite(Number(s))
  const nPending = tests.filter((_, i) => pending(i)).length
  const checks = tests.map((t, i) => (pending(i) ? null : checkTest(t, payload))).map((c, i) => ({ c, i })).filter(({ c, i }) => pending(i) || (c && c.outcome !== 'no guideline for this test'))

  return (
    <section style={{ border: '1px solid #bbb', borderRadius: 6, padding: 12, margin: '10px 0' }}>
      <h2>Check your results</h2>
      {nPending > 0 && <p style={{ background: '#fff4e0', padding: 8 }}>{nPending} value{nPending > 1 ? 's need' : ' needs'} your check. Compare {nPending > 1 ? 'them' : 'it'} with your report, then confirm or correct. Until then {nPending > 1 ? 'they are' : 'it is'} left out of the range check.</p>}
      <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
        <thead><tr style={{ textAlign: 'left' }}><th>Test</th><th>Value</th><th>Unit</th><th>Lab range</th><th>Source</th></tr></thead>
        <tbody>
          {tests.map((t, i) => {
            const tr = result.trust[i]
            const e = edits[i]
            return (
              <tr key={i} style={{ borderTop: '1px solid #eee', background: pending(i) ? '#fff8ef' : undefined }} data-badge={tr.badge}>
                <td>{t.name}</td>
                <td>
                  {tr.badge === 'check' && !e?.confirmed ? (
                    <>
                      <input aria-label={`Value for ${t.name}`} style={{ width: 80 }} value={e?.text ?? (t.value === null ? '' : String(t.value))} onChange={(ev) => setEdits({ ...edits, [i]: { text: ev.target.value, confirmed: false } })} />{' '}
                      <button disabled={!validNumber(e?.text ?? String(t.value ?? ''))} onClick={() => setEdits({ ...edits, [i]: { text: e?.text ?? (t.value === null ? '' : String(t.value)), confirmed: true } })}>Confirm</button>
                    </>
                  ) : (
                    <>{t.value ?? '-'}{e?.confirmed && <small> (you confirmed)</small>}</>
                  )}
                </td>
                <td>{t.unit}</td>
                <td>{t.ref_text}</td>
                <td><span title={tr.why} style={{ color: COLORS[tr.badge], fontSize: 12 }}>{BADGE_TEXT[tr.badge]}</span>{tr.why && tr.badge === 'check' && !e?.confirmed && <div style={{ fontSize: 11, color: '#666' }}>{tr.why}</div>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {checks.length > 0 && (
        <>
          <h3>Your lab's ranges compared with common guidelines</h3>
          <p style={{ fontSize: 13, color: '#555' }}>{DISCLAIMER} These guideline comparisons are {REVIEW_STATUS}.</p>
          <ul>
            {checks.map(({ c, i }) => (
              <li key={i} style={{ marginBottom: 6 }}>
                {c ? <>{c.message}{c.range_note && <> {c.range_note}</>}</> : <i>{tests[i].name}: not compared yet. Please confirm or correct the value above.</i>}
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>What will be sent for the explanation</h3>
      <p>Your name, ID, phone and doctor's name have been removed by plain code (no AI). Age is shown only as a range. This is <b>exactly</b> what will be sent:</p>
      {result.findings.length > 0 && (
        <p style={{ background: '#fff4e0', padding: 8 }}>
          Removed {result.findings.length} leftover item(s) that looked personal: {[...new Set(result.findings.map((f) => `${f.kind} in ${f.where}`))].join('; ')}.
        </p>
      )}
      <pre data-testid="payload" style={{ background: '#f4f4f4', padding: 10, overflow: 'auto', maxHeight: 420, fontSize: 12 }}>{JSON.stringify(payload, null, 2)}</pre>
      <p style={{ fontSize: 12, color: '#666' }}>
        Read {result.run.calls.every((c) => c.source === 'on_device') ? 'on this device' : 'by Gemini in the cloud'} in {(result.run.latency_ms / 1000).toFixed(1)} s ({result.run.strategy === 'pages' ? `${result.run.page_strategies?.length} pages` : `${result.run.strategy} call`}).
      </p>
      <button onClick={onCancel}>Cancel</button>{' '}
      <button disabled={nPending > 0} onClick={() => onApprove(payload, tests.map((_, i) => !!edits[i]?.confirmed))}><b>Approve</b></button>
      {nPending > 0 && <small> Confirm or correct the highlighted value{nPending > 1 ? 's' : ''} first (leave the box empty if you can't read it).</small>}
    </section>
  )
}
