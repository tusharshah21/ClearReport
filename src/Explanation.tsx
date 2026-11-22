import { useState } from 'react'
import { meaning, type Explained, type Meaning } from './explain'
import { DISCLAIMER, FAR_OUT_BANNER, farOutOfRange, type Check } from './guidelines'
import type { Payload } from './privacy'
import { BADGE_TEXT, type Badge } from './trust'

const SOURCE_LABEL: Record<Meaning['source'], string> = { on_device: 'Answered on this device', in_cloud: 'Answered by Gemini in the cloud', template: 'Not answered by AI' }
const COLORS: Record<Badge, string> = { verified: '#1a7f37', check: '#b35900', image: '#555' }
const T = {
  en: { summary: 'Summary', tests: 'Your results', questions: 'Questions you could ask your doctor', check: 'Range check (plain code, no AI)', confirmed: 'checked by you' },
  hi: { summary: 'सारांश', tests: 'आपके नतीजे', questions: 'अपने डॉक्टर से पूछने के लिए सवाल', check: 'Range check (plain code, no AI, shown in English)', confirmed: 'आपने जाँचा' },
}

// badges[i]: the trust badge from the review screen; a value the user confirmed there shows "checked by you".
export default function Explanation({ payload, checks, badges, confirmed, explained, onDone }: { payload: Payload; checks: Check[]; badges: Badge[]; confirmed: boolean[]; explained: Explained; onDone: () => void }) {
  const [lang, setLang] = useState<'en' | 'hi'>('en')
  const e = lang === 'hi' && explained.hi ? explained.hi : explained.en
  const t = T[lang === 'hi' && explained.hi ? 'hi' : 'en']
  const far = payload.tests.some(farOutOfRange)
  // Only the test name is sent (explain.ts meaning()); answers are cached in memory per name.
  const [meanings, setMeanings] = useState<Record<string, Meaning | 'loading'>>({})
  const ask = async (name: string) => {
    setMeanings((m) => ({ ...m, [name]: 'loading' }))
    const a = await meaning(name)
    setMeanings((m) => ({ ...m, [name]: a }))
  }
  return (
    <section style={{ border: '1px solid #bbb', borderRadius: 6, padding: 12, margin: '10px 0' }} lang={lang === 'hi' && explained.hi ? 'hi' : 'en'}>
      <p style={{ background: '#fffbe6', padding: 8 }}>{DISCLAIMER}</p>
      {far && <p role="status" data-testid="far-out" style={{ background: '#eef4ff', border: '1px solid #9bb7e0', padding: 10 }}>{FAR_OUT_BANNER}</p>}
      <div role="group" aria-label="Language" style={{ marginBottom: 8 }}>
        <button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>{' '}
        <button aria-pressed={lang === 'hi'} disabled={!explained.hi} onClick={() => setLang('hi')}>हिन्दी</button>
        {explained.hindi_note && <small style={{ marginLeft: 8, color: '#666' }}>{explained.hindi_note}</small>}
      </div>
      <h2>{t.summary}</h2>
      <p>{e.summary}</p>
      <h3>{t.tests}</h3>
      {payload.tests.map((x, i) => (
        <div key={i} style={{ borderTop: '1px solid #eee', padding: '8px 0' }}>
          <b>{x.name}</b>: {x.value ?? '-'} {x.unit}{x.ref_text && <span style={{ color: '#555' }}> (lab range {x.ref_text})</span>}{' '}
          <small style={{ color: COLORS[badges[i]] }}>{confirmed[i] ? t.confirmed : BADGE_TEXT[badges[i]]}</small>
          <p style={{ margin: '4px 0' }}>{e.tests[i]?.explanation}</p>
          {!meanings[x.name] && <button style={{ fontSize: 12 }} onClick={() => ask(x.name)}>What does this test mean?</button>}
          {meanings[x.name] === 'loading' && <small style={{ color: '#666' }}>Looking it up...</small>}
          {typeof meanings[x.name] === 'object' && (
            <p style={{ margin: '4px 0', background: '#f4f7fb', padding: 6, fontSize: 13 }} lang="en" data-testid="meaning">
              {(meanings[x.name] as Meaning).text}{' '}
              <small style={{ color: '#555' }}>({SOURCE_LABEL[(meanings[x.name] as Meaning).source]})</small>
            </p>
          )}
          {checks[i] && checks[i].outcome !== 'no guideline for this test' && (
            <p style={{ margin: '4px 0', fontSize: 13, color: '#444' }} lang="en"><i>{t.check}:</i> {checks[i].message}{checks[i].range_note && <> {checks[i].range_note}</>}</p>
          )}
        </div>
      ))}
      <h3>{t.questions}</h3>
      <ul>{e.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
      <p style={{ fontSize: 12, color: '#666' }}>
        Explanation by Gemini in the cloud ({explained.path === 'template' ? 'the AI wording did not pass our checks, so this is a plain summary of the range check' : explained.path}), from the anonymous summary you approved. Prompt {explained.prompt_version}, model {explained.model}.
      </p>
      <button onClick={onDone}>Read another report</button>
    </section>
  )
}
