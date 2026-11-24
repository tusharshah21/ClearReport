import { useEffect, useRef, useState } from 'react'
import Beam from './Beam'
import { checkTest, DISCLAIMER } from './guidelines'
import { Badge, Icon, Logo } from './ui'
// The landing page at "/". Static: no Firebase, no AI, no report. The tool lives at /app.
// Hero layout inspired by "Hero Section Dark" by kinfe123 / FarmUI (MIT) and the 21st.dev "SaaS Template" (header,
// announcement pill, button styles and the glow behind the product image), rebuilt in plain CSS with the Specimen tokens.

const REPO = 'https://github.com/tusharshah21/ClearReport'

// The phone hero: the sample report's fasting glucose card, live HTML instead of a shrunken screenshot.
// The callout is the range-check engine's own text for this result, so it always matches the app.
const GLUCOSE = { name: 'Glucose Fasting (FBS)', value: 104, unit: 'mg/dL', ref_low: 70, ref_high: 110, ref_text: '70 - 110', printed_flag: null }
const glucose = checkTest(GLUCOSE, { sex: 'Male', age_band: '50-59' })

function GlucoseCard() {
  return (
    <article className="test-card hero-card" aria-labelledby="hero-card-title">
      <p className="hero-card-from">From the synthetic sample report</p>
      <div className="head">
        <h2 id="hero-card-title">{GLUCOSE.name}</h2>
        <span className="badges">
          <Badge kind="ok" icon={Icon.ok}>Within range</Badge>
          {glucose.tag && <Badge kind="note" icon={Icon.ruler}>Guideline: {glucose.tag}</Badge>}
        </span>
      </div>
      <p className="hero-card-value"><span className="value">{GLUCOSE.value} {GLUCOSE.unit}</span><span className="range"> · Lab range {GLUCOSE.ref_text}</span></p>
      {glucose.callout && (
        <div className="range-note">
          {Icon.pen}
          <div><b>Your lab and a common guideline use different ranges</b>{glucose.callout}</div>
        </div>
      )}
    </article>
  )
}

const FAQ: [string, React.ReactNode][] = [
  ['Is this medical advice?', <>No. ClearReport explains your report in plain words and compares each result with your lab's range and a named guideline. It <mark className="hl">does not give medical advice</mark> and never says you have a condition. Always discuss your results with your doctor.</>],
  ['What is stored?', <>Nothing about your report. It stays in your browser tab's memory and is gone when you close the tab. ClearReport has no database and no storage bucket. The only thing your browser remembers is that you confirmed you are 18 or over.</>],
  ['Which devices get private mode?', <>Private reading uses Chrome's built-in AI, so it needs desktop Chrome 139 or newer on a laptop or desktop with 16 GB of RAM or a graphics card with more than 4 GB of memory, free disk space for the model, and Chrome's built-in AI switched on (see the <a href={`${REPO}#try-it`}>README</a>). On other devices, including phones, you cover your details yourself before the image is sent.</>],
  ['Which languages?', <>Explanations are written in plain English, with a Hindi version you can switch to.</>],
  ['Is it free?', <>Yes. There is no account to create and nothing to pay.</>],
]

const NAV: [string, string][] = [['#how', 'How it works'], ['#privacy', 'Privacy'], ['#hood', 'Under the hood']]
const svgIcon = (d: string) => <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d={d} /></svg>

// Sticky header. On phones the links sit behind a menu button (disclosure pattern): Escape and a link tap close it.
function Header() {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])
  const links = NAV.map(([href, label]) => <a key={href} href={href} onClick={() => setOpen(false)}>{label}</a>)
  return (
    <div className="land-dark land-head">
      <header className="land-top">
        <a className="brand" href="/"><Logo />ClearReport</a>
        <nav className="land-nav" aria-label="Sections">{links}</nav>
        <div className="land-top-right">
          <a className="btn ghost small-btn" href={REPO}>GitHub</a>
          <a className="btn light small-btn" href="/app">Open the app</a>
        </div>
        <button ref={button} type="button" className="menu-btn" aria-expanded={open} aria-controls="land-menu" aria-label="Menu" onClick={() => setOpen(!open)}>
          {open ? svgIcon('M18 6 6 18M6 6l12 12') : svgIcon('M4 6h16M4 12h16M4 18h16')}
        </button>
      </header>
      <div id="land-menu" className="land-menu" hidden={!open}>
        <nav aria-label="Sections">
          {links}
          <a href={REPO} onClick={() => setOpen(false)}>GitHub</a>
          <a className="btn light" href="/app">Open the app</a>
        </nav>
      </div>
    </div>
  )
}

export default function Landing() {
  return (
    <div className="landing">
      <Header />

      <main id="main">
        <section className="land-hero" aria-labelledby="land-title">
          <div className="land-hero-top land-dark">
            <div className="hero-grid" aria-hidden="true"><div className="hero-grid-plane"><div className="hero-grid-lines" /></div></div>
            <div className="land-hero-inner">
              <p className="pill"><span className="pill-long">Built with Firebase AI Logic and Chrome's built-in Gemini Nano</span><span className="pill-short">Built with Firebase AI Logic ·</span> <a href="#hood">See how <span aria-hidden="true">→</span></a></p>
              <h1 id="land-title">Understand your blood test report. <span className="grad">Keep your identity.</span></h1>
              <p className="lede">Your report is read on your device when possible, and only anonymous numbers go to the cloud for a plain-language explanation in English or Hindi.</p>
              <div className="land-ctas">
                <a className="btn light" href="/app">Read my report</a>
                <a className="btn ghost" href="/app?sample=demo">Try a sample report</a>
              </div>
            </div>
          </div>
          {/* The product image straddles the edge: the night ends halfway down it and the paper starts there. */}
          <div className="hero-shot">
            <figure className="browser-frame">
              <div className="browser-bar" aria-hidden="true"><i /><i /><i /><span>clearreport-717f3.web.app/app</span></div>
              <picture><source media="(max-width: 600px)" srcSet="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" /><source srcSet="/landing/hero.webp" type="image/webp" /><img src="/landing/hero.jpg" width="1120" height="700" fetchPriority="high" alt="ClearReport explaining a synthetic report: the fasting glucose result of 104 mg/dL is within the lab's range of 70 to 110, and a callout says a widely used guideline (ADA 2026) would call it borderline. The data trail beside it shows which steps happened on the device and which in the cloud." /></picture>
            </figure>
            <GlucoseCard />
          </div>
        </section>

        <div className="land-light land-dark">
        <section className="land-section" aria-labelledby="journey-title">
          <p className="sec-label" aria-hidden="true"><span>01</span> · What leaves your device</p>
          <h2 id="journey-title">What leaves your device</h2>
          <p className="muted">Choose a path to see where your report goes.</p>
          <div className="card"><Beam /></div>
        </section>

        <section className="land-section" aria-labelledby="why-title">
          <p className="sec-label" aria-hidden="true"><span>02</span> · Why this matters</p>
          <h2 id="why-title">Why this matters</h2>
          <div className="land-grid2">
            <div className="card fact">
              <p className="fact-big">33,244</p>
              <p>Indian labs: a 2026 preprint found their reference ranges vary significantly, so "inside your lab's range" is <mark className="hl">not a fixed truth</mark>.</p>
              <p className="small muted">Lakhani S., medRxiv preprint, June 2026. <a href="https://www.medrxiv.org/content/10.64898/2026.06.01.26354654v1">Read the preprint</a></p>
            </div>
            <div className="card fact">
              <p className="fact-big">77%</p>
              <p>of US adults in KFF's February 2026 survey said they are concerned about the privacy of medical information given to AI tools. Yet 41% of those who used AI for health information had uploaded personal medical information such as test results.</p>
              <p className="small muted">KFF Tracking Poll on Health Information and Trust, 2026. <a href="https://www.kff.org/public-opinion/kff-tracking-poll-on-health-information-and-trust-use-of-ai-for-health-information-and-advice/">Read the survey</a></p>
            </div>
          </div>
        </section>

        <section className="land-section" id="how" aria-labelledby="how-title">
          <p className="sec-label" aria-hidden="true"><span>03</span> · How it works</p>
          <h2 id="how-title">How it works</h2>
          <ol className="steps3">
            <li><b>1. Read</b>Your report's numbers are read, on this device when it can.</li>
            <li><b>2. Check</b>You see exactly what will be sent, with <mark className="hl">your name and details removed</mark>, and approve it.</li>
            <li><b>3. Explain</b>Gemini explains the anonymous numbers in plain English or Hindi, with questions for your doctor.</li>
          </ol>
        </section>

        <section className="land-section" id="hood" aria-labelledby="hood-title">
          <p className="sec-label" aria-hidden="true"><span>04</span> · Under the hood</p>
          <h2 id="hood-title">Under the hood</h2>
          <div className="hood">
            <div className="card hood-col device">
              <h3>On this device</h3>
              <p className="small muted">Chrome's built-in Gemini Nano, through Firebase AI Logic</p>
              <ul>
                <li><code>ONLY_ON_DEVICE</code> Reads result rows from a PDF layout the parser does not know, with the lines around them. On our test of a new card layout it read all 10 values right in three runs, and plain code verified each one against the PDF text.</li>
                <li><code>ONLY_ON_DEVICE</code> Finds names, ID numbers and phone numbers in a photo's text, so you can cover them.</li>
                <li><code>PREFER_ON_DEVICE</code> "What does this test mean?", sending only the test's name. Gemini in the cloud answers when this device cannot.</li>
              </ul>
            </div>
            <div className="card hood-col cloud">
              <h3>In the cloud</h3>
              <p className="small muted">Gemini Flash-Lite, through Firebase AI Logic</p>
              <ul>
                <li><code>ONLY_IN_CLOUD</code> Reads the image you covered (or the full report, only if you chose that and agreed).</li>
                <li><code>ONLY_IN_CLOUD</code> Writes the plain-language explanation and the Hindi translation from the anonymous numbers.</li>
                <li>It sees <mark className="hl">only what you approved</mark>.</li>
                <li>If it is busy, the app waits and retries, then tries Gemini 3.8 Flash once. The page names the model that answered. If today's free limit is reached, it stops at once and shows plain-language checks only.</li>
              </ul>
            </div>
            <div className="card hood-col code">
              <h3>Plain code, no AI</h3>
              <p className="small muted">Runs in your browser</p>
              <ul>
                <li>PDF parser for known lab layouts</li>
                <li>Cross-check of every value against the PDF text</li>
                <li>Identity removal before anything is sent</li>
                <li>Range-check engine comparing your lab's range with named guidelines</li>
              </ul>
            </div>
          </div>
          <p className="small muted hood-more">Also Firebase App Check, Anonymous Auth, Remote Config and Hosting. <a href={`${REPO}#how-we-use-firebase-ai-logic`}>Every AI call, with its code</a></p>
        </section>

        <section className="land-section" id="privacy" aria-labelledby="privacy-title">
          <p className="sec-label" aria-hidden="true"><span>05</span> · Privacy promises</p>
          <h2 id="privacy-title">Privacy promises</h2>
          <ul className="promises">
            <li><b>Nothing is stored.</b> Your report stays in your browser tab's memory. ClearReport has <mark className="hl">no database and no storage bucket</mark>.</li>
            <li><b>You approve what is sent.</b> You see the exact anonymous numbers, or the exact covered image, before anything goes to the cloud.</li>
            <li><b>Free-tier Gemini, for now.</b> The Gemini Developer API currently runs on Google's free tier. ClearReport only sends anonymous numbers or a masked image you approved, and stores nothing.</li>
            <li><b>App Check.</b> Firebase App Check (reCAPTCHA Enterprise) lets only the ClearReport web app call Gemini.</li>
          </ul>
        </section>

        <section className="land-section" aria-labelledby="faq-title">
          <p className="sec-label" aria-hidden="true"><span>06</span> · Questions</p>
          <h2 id="faq-title">Questions</h2>
          <div className="faq">
            {FAQ.map(([q, a]) => (
              <details key={q} className="card">
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
        </div>
      </main>

      <footer className="land-footer land-dark">
        <p>{DISCLAIMER}</p>
        <p>
          <a href={REPO}>Source code on GitHub</a> · Built with Firebase AI Logic · <a href={`${REPO}/blob/main/LICENSE`}>Apache-2.0 license</a> · <a href={`${REPO}#design-credits`}>Design credits</a>
        </p>
      </footer>
    </div>
  )
}
