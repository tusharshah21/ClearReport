import { useEffect, useState } from 'react'
import { canonical } from './canonical'
import { meaning, type Explained, type Meaning } from './explain'
import { DISCLAIMER, FAR_OUT_BANNER, disagrees, farOutOfRange, type Check } from './guidelines'
import type { Payload } from './privacy'
import type { Badge as TrustBadge } from './trust'
import { Badge, Icon } from './ui'

const SOURCE_LABEL: Record<Meaning['source'], string> = { on_device: 'Answered on this device', in_cloud: 'Answered by Gemini in the cloud', template: 'Not answered by AI' }
const T = {
  en: {
    summary: 'Summary', tests: 'Your results', questions: 'Questions you could ask your doctor', check: 'Range check (plain code, no AI)', confirmed: 'checked by you',
    within: 'Within range', below: 'Below range', above: 'Above range', please: 'Please check', norange: 'No range printed', range: 'Lab range',
    belowList: "Below your lab's range", aboveList: "Above your lab's range", allIn: "Every result with a printed range is inside your lab's range.",
    disagree: (n: number) => `${n} result${n === 1 ? '' : 's'} where your lab's range and a common guideline disagree`,
    copy: 'Copy questions', copied: 'Copied', print: 'Print or save as PDF', mean: 'What does this test mean?', looking: 'Looking it up...', again: 'Read another report', note: 'Your lab and a common guideline use different ranges',
    panels: { blood: 'Blood count', cholesterol: 'Cholesterol', sugar: 'Blood sugar', thyroid: 'Thyroid', other: 'Other tests' },
  },
  hi: {
    summary: 'सारांश', tests: 'आपके नतीजे', questions: 'अपने डॉक्टर से पूछने के लिए सवाल', check: 'Range check (plain code, no AI, shown in English)', confirmed: 'आपने जाँचा',
    within: 'सीमा के अंदर', below: 'सीमा से कम', above: 'सीमा से ज़्यादा', please: 'कृपया जाँचें', norange: 'कोई सीमा नहीं छपी', range: 'लैब की सीमा',
    belowList: 'आपकी लैब की सीमा से कम', aboveList: 'आपकी लैब की सीमा से ज़्यादा', allIn: 'जिन नतीजों की सीमा छपी है, वे सब आपकी लैब की सीमा के अंदर हैं।',
    disagree: (n: number) => `${n} नतीजा जहाँ आपकी लैब की सीमा और एक आम गाइडलाइन अलग बात कहती हैं`,
    copy: 'सवाल कॉपी करें', copied: 'कॉपी हो गया', print: 'प्रिंट करें या PDF सहेजें', mean: 'यह टेस्ट क्या बताता है?', looking: 'खोज रहे हैं...', again: 'दूसरी रिपोर्ट पढ़ें', note: 'आपकी लैब और एक आम गाइडलाइन की सीमाएँ अलग हैं',
    panels: { blood: 'ब्लड काउंट', cholesterol: 'कोलेस्ट्रॉल', sugar: 'ब्लड शुगर', thyroid: 'थायरॉइड', other: 'दूसरे टेस्ट' },
  },
}

// Calm status from the lab's own printed range; a value the user has not been able to confirm says "please check".
type Status = 'within' | 'below' | 'above' | 'please' | 'norange'
function statusOf(t: Payload['tests'][number], badge: TrustBadge, confirmed: boolean): Status {
  if (t.value === null || (badge === 'check' && !confirmed)) return 'please'
  if (t.ref_low === null && t.ref_high === null) return 'norange'
  return t.ref_high !== null && t.value > t.ref_high ? 'above' : t.ref_low !== null && t.value < t.ref_low ? 'below' : 'within'
}
const KIND = { within: 'ok', below: 'out', above: 'out', please: 'check', norange: 'plain' } as const
const ICON = { within: Icon.ok, below: Icon.down, above: Icon.up, please: Icon.check, norange: Icon.plain }
const RANK: Record<Status, number> = { below: 0, above: 0, please: 1, norange: 2, within: 3 } // outside the range first

type Panel = keyof typeof T.en.panels
const PANEL: Record<string, Panel> = Object.fromEntries([
  ...['hemoglobin', 'rbc', 'pcv', 'mcv', 'mch', 'mchc', 'rdw', 'wbc', 'neutrophils', 'lymphocytes', 'monocytes', 'eosinophils', 'basophils', 'platelets', 'mpv'].map((k) => [k, 'blood']),
  ...['total_cholesterol', 'triglycerides', 'hdl', 'ldl', 'vldl', 'non_hdl', 'tc_hdl_ratio'].map((k) => [k, 'cholesterol']),
  ...['fasting_glucose', 'hba1c', 'eag'].map((k) => [k, 'sugar']),
  ...['t3', 't4', 'tsh'].map((k) => [k, 'thyroid']),
])

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
  // Printing opens every compact row, so the paper copy has every explanation.
  useEffect(() => {
    const open = () => document.querySelectorAll<HTMLDetailsElement>('details.test-row').forEach((d) => { d.open = true })
    window.addEventListener('beforeprint', open)
    return () => window.removeEventListener('beforeprint', open)
  }, [])

  const rows = payload.tests.map((x, i) => ({ x, i, s: statusOf(x, badges[i], confirmed[i]), c: checks[i], panel: PANEL[canonical(x.name)] ?? 'other' }))
  const counts = rows.reduce((a, r) => ({ ...a, [r.s]: (a[r.s] ?? 0) + 1 }), {} as Partial<Record<Status, number>>)
  const names = (s: Status) => rows.filter((r) => r.s === s).map((r) => r.x.name)
  const split = rows.filter((r) => r.c && disagrees(r.c))
  const groups = (Object.keys(T.en.panels) as Panel[]).map((p) => ({ p, rows: rows.filter((r) => r.panel === p).sort((a, b) => RANK[a.s] - RANK[b.s]) })).filter((g) => g.rows.length)

  const card = ({ x, i, s, c }: (typeof rows)[number]) => {
    const m = meanings[x.name]
    const callout = !!c?.callout
    const value = <span className="value">{x.value ?? '-'} {x.unit}</span>
    const body = (
      <>
        <p style={{ margin: 0 }}>{e.tests[i]?.explanation}</p>
        {callout && (
          <div className="range-note" data-testid="range-note" lang="en">
            {Icon.ruler}
            <div><b>{t.note}</b>{c.callout}</div>
          </div>
        )}
        {c && c.outcome !== 'no guideline for this test' && (
          <details className="mini" lang="en" style={{ marginTop: 8 }}>
            <summary>{t.check}</summary>
            <p className="small" style={{ margin: '4px 0' }}>{c.message}{c.range_note && <> {c.range_note}</>}</p>
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
      </>
    )
    const badge = (
      <span className="badges">
        <Badge kind={KIND[s]} icon={ICON[s]}>{t[s]}</Badge>
        {callout && c.tag && <span lang="en" data-testid="guideline-tag"><Badge kind="note" icon={Icon.ruler}>Guideline: {c.tag}</Badge></span>}
      </span>
    )
    // Within range and nothing to flag: one compact line that opens on tap.
    if (s === 'within' && !callout)
      return (
        <details key={i} id={`card-${i}`} className="test-card test-row" data-testid="test-row">
          <summary>
            <span className="name" lang="en">{x.name}</span>
            {value}
            {badge}
          </summary>
          <p className="small muted" style={{ margin: '6px 0 8px' }}>{x.ref_text && <>{t.range} {x.ref_text}</>}{confirmed[i] && <> · {t.confirmed}</>}</p>
          {body}
        </details>
      )
    return (
      <article key={i} id={`card-${i}`} className="test-card" aria-labelledby={`t${i}`} tabIndex={-1}>
        <div className="head">
          <h4 id={`t${i}`} style={{ margin: 0 }} lang="en">{x.name}</h4>
          {badge}
        </div>
        <p style={{ margin: '4px 0 8px' }}>
          {value}
          {x.ref_text && <span className="range"> · {t.range} {x.ref_text}</span>}
          {confirmed[i] && <small className="muted"> · {t.confirmed}</small>}
        </p>
        {body}
      </article>
    )
  }

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
        {/* Plain code, from the lab's printed ranges: the same list whatever the AI wrote. */}
        <ul className="findings" data-testid="findings">
          {(['below', 'above'] as const).filter((s) => counts[s]).map((s) => (
            <li key={s}><span className={`fi ${s}`}>{ICON[s]}</span><span><b>{t[`${s}List`]}:</b> <span lang="en">{names(s).join(', ')}</span></span></li>
          ))}
          {!counts.below && !counts.above && <li><span className="fi within">{Icon.ok}</span>{t.allIn}</li>}
          {split.length > 0 && (
            <li data-testid="disagree-line"><span className="fi note">{Icon.ruler}</span>
              <span><a href={`#card-${split[0].i}`} onClick={() => setTimeout(() => document.getElementById(`card-${split[0].i}`)?.focus(), 0)}>{t.disagree(split.length)}</a>
              <span lang="en">: {split.map((r) => r.x.name).join(', ')}</span></span>
            </li>
          )}
        </ul>
        <div className="actions" style={{ margin: 0 }}>
          {(['below', 'above', 'please', 'within', 'norange'] as Status[]).filter((s) => counts[s]).map((s) => <Badge key={s} kind={KIND[s]} icon={ICON[s]}>{counts[s]} {t[s].toLowerCase()}</Badge>)}
        </div>
      </div>
      {far && <p role="status" data-testid="far-out" className="notice calm">{FAR_OUT_BANNER}</p>}

      <h2>{t.tests}</h2>
      {groups.map((g) => (
        <section key={g.p} className="panel" aria-labelledby={`panel-${g.p}`}>
          <h3 id={`panel-${g.p}`}>{t.panels[g.p]}</h3>
          {g.rows.map(card)}
        </section>
      ))}

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
