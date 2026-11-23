import { useState } from 'react'
import { meaning, type Explained, type Meaning } from './explain'
import { DISCLAIMER, FAR_OUT_BANNER, farOutOfRange, type Check } from './guidelines'
import type { Payload } from './privacy'
import type { Badge as TrustBadge } from './trust'
import { Badge, Icon } from './ui'

const SOURCE_LABEL: Record<Meaning['source'], string> = { on_device: 'Answered on this device', in_cloud: 'Answered by Gemini in the cloud', template: 'Not answered by AI' }
const T = {
  en: { summary: 'Summary', tests: 'Your results', questions: 'Questions you could ask your doctor', check: 'Range check (plain code, no AI)', confirmed: 'checked by you', within: 'Within range', outside: 'Outside range', please: 'Please check', norange: 'No range printed', range: 'Lab range', copy: 'Copy questions', copied: 'Copied', print: 'Print or save as PDF', mean: 'What does this test mean?', looking: 'Looking it up...', again: 'Read another report', note: 'Your lab and a common guideline use different ranges' },
  hi: { summary: 'सारांश', tests: 'आपके नतीजे', questions: 'अपने डॉक्टर से पूछने के लिए सवाल', check: 'Range check (plain code, no AI, shown in English)', confirmed: 'आपने जाँचा', within: 'सीमा के अंदर', outside: 'सीमा से बाहर', please: 'कृपया जाँचें', norange: 'कोई सीमा नहीं छपी', range: 'लैब की सीमा', copy: 'सवाल कॉपी करें', copied: 'कॉपी हो गया', print: 'प्रिंट करें या PDF सहेजें', mean: 'यह टेस्ट क्या बताता है?', looking: 'खोज रहे हैं...', again: 'दूसरी रिपोर्ट पढ़ें', note: 'आपकी लैब और एक आम गाइडलाइन की सीमाएँ अलग हैं' },
}

// Calm status from the lab's own printed range; a value the user has not been able to confirm says "please check".
type Status = 'within' | 'outside' | 'please' | 'norange'
function statusOf(t: Payload['tests'][number], badge: TrustBadge, confirmed: boolean): Status {
  if (t.value === null || (badge === 'check' && !confirmed)) return 'please'
  if (t.ref_low === null && t.ref_high === null) return 'norange'
  return (t.ref_high !== null && t.value > t.ref_high) || (t.ref_low !== null && t.value < t.ref_low) ? 'outside' : 'within'
}
const KIND = { within: 'ok', outside: 'out', please: 'check', norange: 'plain' } as const

// badges[i]: the trust badge from the review screen; a value the user confirmed there shows "checked by you".
export default function Explanation({ payload, checks, badges, confirmed, explained, onDone }: { payload: Payload; checks: Check[]; badges: TrustBadge[]; confirmed: boolean[]; explained: Explained; onDone: () => void }) {
  const [lang, setLang] = useState<'en' | 'hi'>('en')
  const hi = lang === 'hi' && !!explained.hi
  const e = hi ? explained.hi! : explained.en
  const t = T[hi ? 'hi' : 'en']
  const far = payload.tests.some(farOutOfRange)
  const [copied, setCopied] = useState(false)
  // Only the test name is sent (explain.ts meaning()); answers are cached in memory per name.
  const [meanings, setMeanings] = useState<Record<string, Meaning | 'loading'>>({})
  const ask = async (name: string) => {
    setMeanings((m) => ({ ...m, [name]: 'loading' }))
    const a = await meaning(name)
    setMeanings((m) => ({ ...m, [name]: a }))
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${t.questions}\n${e.questions.map((q) => `- ${q}`).join('\n')}`); setCopied(true); setTimeout(() => setCopied(false), 2500) } catch { /* clipboard blocked: the list is still selectable */ }
  }
  const counts = payload.tests.reduce((a, x, i) => ({ ...a, [statusOf(x, badges[i], confirmed[i])]: (a[statusOf(x, badges[i], confirmed[i])] ?? 0) + 1 }), {} as Partial<Record<Status, number>>)

  return (
    <section lang={hi ? 'hi' : 'en'} aria-labelledby="sum-title">
      <div className="actions no-print" role="group" aria-label="Language" style={{ marginTop: 0 }}>
        <button aria-pressed={lang === 'en'} onClick={() => setLang('en')} lang="en">English</button>
        <button aria-pressed={lang === 'hi'} disabled={!explained.hi} onClick={() => setLang('hi')} lang="hi">हिन्दी</button>
        {explained.hindi_note && <small className="muted" lang="en">{explained.hindi_note}</small>}
      </div>
      <p className="print-only small" lang="en">ClearReport: an explanation of a blood test report. {DISCLAIMER}</p>

      <div className="card summary-card">
        <h1 id="sum-title" style={{ fontSize: '1.5rem' }}>{t.summary}</h1>
        <p style={{ fontSize: '1.08rem' }}>{e.summary}</p>
        <div className="actions" style={{ margin: 0 }}>
          {(['within', 'outside', 'please', 'norange'] as Status[]).filter((s) => counts[s]).map((s) => <Badge key={s} kind={KIND[s]}>{counts[s]} {t[s].toLowerCase()}</Badge>)}
        </div>
      </div>
      {far && <p role="status" data-testid="far-out" className="notice calm">{FAR_OUT_BANNER}</p>}

      <h2>{t.tests}</h2>
      {payload.tests.map((x, i) => {
        const s = statusOf(x, badges[i], confirmed[i])
        const m = meanings[x.name]
        const c = checks[i]
        return (
          <article key={i} className="test-card" aria-labelledby={`t${i}`}>
            <div className="head">
              <h3 id={`t${i}`} style={{ margin: 0 }} lang="en">{x.name}</h3>
              <Badge kind={KIND[s]}>{t[s]}</Badge>
            </div>
            <p style={{ margin: '4px 0 8px' }}>
              <span className="value">{x.value ?? '-'} {x.unit}</span>
              {x.ref_text && <span className="range"> · {t.range} {x.ref_text}</span>}
              {confirmed[i] && <small className="muted"> · {t.confirmed}</small>}
            </p>
            <p style={{ margin: 0 }}>{e.tests[i]?.explanation}</p>
            {c?.range_note && (
              <div className="range-note" data-testid="range-note" lang="en">
                {Icon.ruler}
                <div><b>{t.note}</b>{c.range_note}</div>
              </div>
            )}
            {c && c.outcome !== 'no guideline for this test' && (
              <details className="mini" lang="en" style={{ marginTop: 8 }}>
                <summary>{t.check}</summary>
                <p className="small" style={{ margin: '4px 0' }}>{c.message}</p>
              </details>
            )}
            <div className="no-print" style={{ marginTop: 6 }}>
              {!m && <button className="link" onClick={() => ask(x.name)}>{t.mean}</button>}
              {m === 'loading' && <span className="status-line" role="status" style={{ margin: 0 }}><span className="spinner" aria-hidden="true" />{t.looking}</span>}
            </div>
            {typeof m === 'object' && (
              <p className="meaning" lang="en" data-testid="meaning">
                {m.text} <span className="source-tag">{SOURCE_LABEL[m.source]}</span>
              </p>
            )}
          </article>
        )
      })}

      <div className="card" style={{ marginTop: 20 }}>
        <h2>{t.questions}</h2>
        <ul className="questions">{e.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
        <div className="actions no-print">
          <button onClick={copy}>{copied ? t.copied : t.copy}</button>
          <button onClick={() => window.print()}>{t.print}</button>
          <span role="status" className="sr-only">{copied ? t.copied : ''}</span>
        </div>
      </div>

      <p className="footer-note" lang="en">
        {explained.path === 'template'
          ? 'This explanation is a plain summary from the range check (no AI): Gemini could not be reached, or its wording did not pass our safety checks.'
          : `Explanation by Gemini in the cloud (${explained.path}), from the anonymous summary you approved.`}{' '}
        Prompt {explained.prompt_version}, model {explained.model}. {DISCLAIMER}
      </p>
      <div className="actions no-print"><button className="primary" onClick={onDone}>{t.again}</button></div>
    </section>
  )
}
