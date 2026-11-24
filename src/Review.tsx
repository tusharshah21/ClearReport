import { useState } from 'react'
import type { Run } from './extract'
import { checkTest, DISCLAIMER, REVIEW_STATUS } from './guidelines'
import type { Finding, Payload } from './privacy'
import { BADGE_TEXT, type Badge as TrustBadge, type Trust } from './trust'
import { Badge } from './ui'

export type Result = { payload: Payload; findings: Finding[]; run: Run; trust: Trust[] }
const BADGE_KIND: Record<TrustBadge, 'ok' | 'check' | 'plain'> = { verified: 'ok', check: 'check', image: 'plain' }
// Path 1 only: which local method read each row. Shown as a detail, never sent (toPayload whitelists the fields).
const METHOD = { parser: 'Read by plain code (the row parser), on this device.', model: 'Read by the on-device AI model.' } as const

// Values flagged "Please check" stay out of the range check until the user confirms or corrects them.
export default function Review({ result, onCancel, onApprove }: { result: Result; onCancel: () => void; onApprove: (p: Payload, confirmed: boolean[]) => void }) {
  const [edits, setEdits] = useState<Record<number, { text: string; confirmed: boolean }>>({})
  const methods = ((result.run.output as { tests?: { method?: keyof typeof METHOD }[] } | null)?.tests ?? []).map((t) => t?.method)
  const pending = (i: number) => result.trust[i].badge === 'check' && !edits[i]?.confirmed
  const tests = result.payload.tests.map((t, i) => (edits[i]?.confirmed ? { ...t, value: edits[i].text.trim() === '' ? null : Number(edits[i].text) } : t))
  const payload: Payload = { ...result.payload, tests }
  const validNumber = (s: string) => s.trim() === '' || Number.isFinite(Number(s))
  const nPending = tests.filter((_, i) => pending(i)).length
  const checks = tests.map((t, i) => (pending(i) ? null : checkTest(t, payload))).map((c, i) => ({ c, i })).filter(({ c, i }) => pending(i) || (c && c.outcome !== 'no guideline for this test'))
  const local = result.run.calls.every((c) => c.source === 'on_device')

  return (
    <section className="card" aria-labelledby="review-title">
      <h2 id="review-title">Check your results</h2>
      <p>These are the results we read from your report. Compare them with your report; you can correct anything marked <i>Please check</i>.</p>
      {nPending > 0 && <p className="notice" role="status">{nPending} value{nPending > 1 ? 's need' : ' needs'} your check. Compare {nPending > 1 ? 'them' : 'it'} with your report, then confirm or correct. Until then {nPending > 1 ? 'they are' : 'it is'} left out of the range check.</p>}
      <div className="table-wrap">
        <table className="results">
          <thead><tr><th scope="col">Test</th><th scope="col">Value</th><th scope="col">Unit</th><th scope="col">Lab range</th><th scope="col">Check</th></tr></thead>
          <tbody>
            {tests.map((t, i) => {
              const tr = result.trust[i]
              const e = edits[i]
              const open = tr.badge === 'check' && !e?.confirmed
              return (
                <tr key={i} className={pending(i) ? 'pending' : undefined} data-badge={tr.badge}>
                  <td data-label="Test"><b>{t.name}</b></td>
                  <td data-label="Value">
                    {open ? (
                      <div>
                        <input aria-label={`Value for ${t.name}`} inputMode="decimal" style={{ width: 96 }} value={e?.text ?? (t.value === null ? '' : String(t.value))} onChange={(ev) => setEdits({ ...edits, [i]: { text: ev.target.value, confirmed: false } })} />{' '}
                        <button disabled={!validNumber(e?.text ?? String(t.value ?? ''))} onClick={() => setEdits({ ...edits, [i]: { text: e?.text ?? (t.value === null ? '' : String(t.value)), confirmed: true } })}>Confirm</button>
                        {/* One tap fills the box; the user still has to press Confirm. */}
                        {tr.pdf_value !== null && tr.pdf_value !== t.value && (e?.text ?? '') !== String(tr.pdf_value) && (
                          <div><button className="link" data-testid="pdf-suggestion" onClick={() => setEdits({ ...edits, [i]: { text: String(tr.pdf_value), confirmed: false } })}>Use the number in your PDF: {tr.pdf_value}</button></div>
                        )}
                      </div>
                    ) : (
                      <>{t.value ?? '-'}{e?.confirmed && <small className="muted"> (you confirmed)</small>}</>
                    )}
                  </td>
                  <td data-label="Unit">{t.unit}</td>
                  <td data-label="Lab range">{t.ref_text}</td>
                  <td data-label="Check">
                    <Badge kind={BADGE_KIND[tr.badge]}>{BADGE_TEXT[tr.badge]}</Badge>
                    {open && tr.why && <div className="small muted" style={{ marginTop: 4 }}>{tr.why}</div>}
                    {(methods[i] || (tr.why && !open)) && (
                      <details className="mini"><summary>details</summary>
                        {methods[i] && <div data-testid="method" className="small muted">{METHOD[methods[i]!]}</div>}
                        {tr.why && !open && <div className="small muted">{tr.why}</div>}
                      </details>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {checks.length > 0 && (
        <>
          <h3 style={{ marginTop: 22 }}>Your lab's ranges compared with common guidelines</h3>
          <p className="small muted">Plain code, no AI. {DISCLAIMER} These guideline comparisons are {REVIEW_STATUS}.</p>
          <ul>
            {checks.map(({ c, i }) => (
              <li key={i} style={{ marginBottom: 6 }}>
                {c ? <>{c.message}{c.range_note && <> {c.range_note}</>}</> : <i>{tests[i].name}: not compared yet. Please confirm or correct the value above.</i>}
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 style={{ marginTop: 22 }}>What will be sent for the explanation</h3>
      <p>Your name, ID, phone and doctor's name have been removed by plain code (no AI). Age is shown only as a range. This is <b>exactly</b> what will be sent to Gemini:</p>
      {result.findings.length > 0 && (
        <p className="notice">
          Removed {result.findings.length} leftover item(s) that looked personal: {[...new Set(result.findings.map((f) => `${f.kind} in ${f.where}`))].join('; ')}.
        </p>
      )}
      <pre className="payload" data-testid="payload" tabIndex={0} aria-label="The exact data that will be sent">{JSON.stringify(payload, null, 2)}</pre>
      <p className="footer-note">
        Read {local ? 'on this device' : 'by Gemini in the cloud'} in {(result.run.latency_ms / 1000).toFixed(1)} s ({result.run.strategy === 'pages' ? `${result.run.page_strategies?.length} pages` : result.run.strategy === 'rows' ? `${methods.filter((m) => m === 'parser').length} rows by the plain-code parser, ${result.run.calls.length} on-device model call${result.run.calls.length === 1 ? "" : "s"}` : `${result.run.strategy} call`}).
      </p>
      <div className="actions">
        <button className="quiet" onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={nPending > 0} onClick={() => onApprove(payload, tests.map((_, i) => !!edits[i]?.confirmed))}>Approve and send these numbers</button>
      </div>
      {nPending > 0 && <p className="small muted">Confirm or correct the highlighted value{nPending > 1 ? 's' : ''} first (leave the box empty if you can't read it).</p>}
    </section>
  )
}
