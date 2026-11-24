import type { ReactNode } from 'react'
// "How it works" on the landing page as a bento grid: each card has a small static illustration of the real step,
// drawn from the app's own sample (the synthetic report's fasting glucose). The illustrations are decorative
// (aria-hidden); each card's heading and text carry the meaning. Layout after the 21st.dev "Marketing Feature Bento",
// rebuilt in plain CSS with the landing tokens (no Tailwind, no framer-motion).

type Card = { size: 'sm' | 'md' | 'lg'; title: string; text: ReactNode; visual: ReactNode }

// Where each step happens, in order. Bars are illustrative positions, not measured times.
const TRAIL: [string, 'device' | 'you' | 'cloud', number, number][] = [
  ['read the PDF', 'device', 0, 14], ['check each value', 'device', 14, 12], ['remove your name', 'device', 26, 10],
  ['you approve', 'you', 36, 22], ['explain', 'cloud', 58, 42],
]

const trail = (
  <div className="bv-panel bv-trail">
    {TRAIL.map(([label, where, start, width]) => (
      <div key={label} className="bv-row">
        <span className={where === 'cloud' ? 'bv-label strong' : 'bv-label'}>{label}</span>
        <span className="bv-track"><i className={`bv-bar ${where}`} style={{ marginLeft: `${start}%`, width: `${width}%` }} /></span>
      </div>
    ))}
    <p className="bv-legend"><span><i className="dot device" />on this device</span><span><i className="dot you" />you</span><span><i className="dot cloud" />in the cloud</span></p>
  </div>
)

const approve = (
  <div className="bv-panel bv-mono">
    <p className="bv-head">Will be sent <span className="bv-badge">name removed</span></p>
    <p><s className="bv-redact">Meera Fictitious</s> · Female · 50-59</p>
    <p>Glucose Fasting (FBS) <b>104 mg/dL</b></p>
    <p>Lab range 70 - 110</p>
  </div>
)

// The glucose scale from 60 to 140 mg/dL: the lab's range, the ADA criterion band, and the result.
const pos = (v: number) => `${((v - 60) / 80) * 100}%`
const span = (a: number, b: number) => ({ left: pos(a), width: `${((b - a) / 80) * 100}%` })
const ranges = (
  <div className="bv-panel bv-ranges">
    <p className="bv-value">104 <small>mg/dL</small></p>
    <div className="bv-scale">
      <span className="bv-band lab" style={span(70, 110)} />
      <span className="bv-band guide" style={span(100, 126)} />
      <i className="bv-marker" style={{ left: pos(104) }} />
    </div>
    <p className="bv-key"><span><i className="dot lab" />Lab 70 - 110</span><span><i className="dot guide" />ADA 2026 criterion 100 - 125</span></p>
  </div>
)

const languages = (
  <div className="bv-panel">
    <p className="bv-toggle"><span className="on">English</span><span lang="hi">हिन्दी</span></p>
    <p className="bv-line">Your fasting glucose is inside your lab's range.</p>
    <p className="bv-line" lang="hi">आपका फ़ास्टिंग ग्लूकोज़ आपकी लैब की सीमा के भीतर है।</p>
  </div>
)

const questions = (
  <div className="bv-stack">
    <p>Which range should I go by for my glucose?</p>
    <p>Should I repeat this test while fasting?</p>
  </div>
)

const crosscheck = (
  <div className="bv-panel bv-mono">
    <p className="bv-head">Checked against the PDF text</p>
    {[['Haemoglobin', '13.8 g/dL'], ['Glucose Fasting', '104 mg/dL'], ['Platelets', '2.6 lakh/cumm']].map(([n, v]) => (
      <p key={n} className="bv-check"><span>{n}</span><span>{v} <b>✓</b></span></p>
    ))}
  </div>
)

const mask = (
  <div className="bv-panel bv-mono bv-photo">
    <p><span className="bv-box">Meera Fictitious</span></p>
    <p>Age <span className="bv-box">54</span> · ID <span className="bv-box">RB-20419</span></p>
    <p>Glucose Fasting 104 mg/dL</p>
  </div>
)

const CARDS: Card[] = [
  { size: 'lg', title: 'Read on your device, explained in the cloud', text: <>Plain code in your browser reads the PDF, checks each value and removes your name. Only after you approve do the anonymous numbers go to Gemini.</>, visual: trail },
  { size: 'sm', title: 'You see what is sent', text: <>The exact anonymous numbers, with <mark className="hl">your name and details removed</mark>, before anything leaves.</>, visual: approve },
  { size: 'sm', title: 'Your lab and a guideline, side by side', text: <>Each result is compared with your lab's range and a named guideline, and the page says when they disagree.</>, visual: ranges },
  { size: 'sm', title: 'English, or Hindi on a tap', text: <>Plain-language explanations in English, with a Hindi version when you ask for it.</>, visual: languages },
  { size: 'sm', title: 'Questions for your doctor', text: <>Each explanation ends with questions to take to your appointment. It never says you have a condition.</>, visual: questions },
  { size: 'md', title: 'Every value checked against the PDF', text: <>When you upload a PDF, plain code finds each value and range in the PDF's own text, so a misread number is caught before you see it.</>, visual: crosscheck },
  { size: 'md', title: 'On a phone, you cover your details', text: <>Without Chrome's built-in AI, you draw boxes over your name and IDs, and only that covered image is sent.</>, visual: mask },
]

export default function Bento() {
  return (
    <ul className="bento">
      {CARDS.map((c) => (
        <li key={c.title} className={`card bento-card ${c.size}`}>
          <div className="bento-visual" aria-hidden="true">{c.visual}</div>
          <h3>{c.title}</h3>
          <p>{c.text}</p>
        </li>
      ))}
    </ul>
  )
}
