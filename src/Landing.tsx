import Beam from './Beam'
import { DISCLAIMER } from './guidelines'
// The landing page at "/". Static: no Firebase, no AI, no report. The tool lives at /app.
// Hero layout inspired by "Hero Section Dark" by kinfe123 / FarmUI (MIT), rebuilt in plain CSS with the Sage tokens.

const REPO = 'https://github.com/tusharshah21/ClearReport'

const FAQ: [string, React.ReactNode][] = [
  ['Is this medical advice?', <>No. ClearReport explains your report in plain words and compares each result with your lab's range and a named guideline. It does not give medical advice and never says you have a condition. Always discuss your results with your doctor.</>],
  ['What is stored?', <>Nothing about your report. It stays in your browser tab's memory and is gone when you close the tab. ClearReport has no database and no storage bucket. The only thing your browser remembers is that you confirmed you are 18 or over.</>],
  ['Which devices get private mode?', <>Private reading uses Chrome's built-in AI, so it needs desktop Chrome 139 or newer on a laptop or desktop with 16 GB of RAM or a graphics card with more than 4 GB of memory, free disk space for the model, and Chrome's built-in AI switched on (see the <a href={`${REPO}#try-it`}>README</a>). On other devices, including phones, you cover your details yourself before the image is sent.</>],
  ['Which languages?', <>Explanations are written in plain English, with a Hindi version you can switch to.</>],
  ['Is it free?', <>Yes. There is no account to create and nothing to pay.</>],
]

export default function Landing() {
  return (
    <div className="landing">
      <header className="land-top">
        <p className="brand">ClearReport</p>
        <a className="btn quiet small-btn" href="/app">Open the app</a>
      </header>

      <main id="main">
        <section className="land-hero" aria-labelledby="land-title">
          <div className="hero-grid" aria-hidden="true"><div className="hero-grid-plane"><div className="hero-grid-lines" /></div></div>
          <div className="land-hero-inner">
            <p className="eyebrow">Free, no account. English and हिन्दी.</p>
            <h1 id="land-title">Understand your blood test report. <span className="grad">Keep your identity.</span></h1>
            <p className="lede">Your report is read on your device when possible, and only anonymous numbers go to the cloud for a plain-language explanation in English or Hindi.</p>
            <div className="land-ctas">
              <a className="btn primary" href="/app">Read my report</a>
              <a className="btn" href="/app?sample=demo">Try a sample report</a>
            </div>
            <figure className="browser-frame">
              <div className="browser-bar" aria-hidden="true"><i /><i /><i /><span>clearreport-717f3.web.app/app</span></div>
              <picture><source media="(max-width: 600px)" srcSet="/landing/hero-mobile.webp" type="image/webp" /><source media="(max-width: 600px)" srcSet="/landing/hero-mobile.jpg" /><source srcSet="/landing/hero.webp" type="image/webp" /><img src="/landing/hero.jpg" width="1120" height="700" fetchPriority="high" alt="ClearReport explaining a synthetic report: the fasting glucose result of 104 mg/dL is within the lab's range of 70 to 110, and a callout says a widely used guideline (ADA 2026) would call it borderline. The data trail beside it shows which steps happened on the device and which in the cloud." /></picture>
            </figure>
          </div>
        </section>

        <section className="land-section" aria-labelledby="journey-title">
          <h2 id="journey-title">What leaves your device</h2>
          <p className="muted">Choose a path to see where your report goes.</p>
          <div className="card"><Beam /></div>
        </section>

        <section className="land-section" aria-labelledby="why-title">
          <h2 id="why-title">Why this matters</h2>
          <div className="land-grid2">
            <div className="card fact">
              <p className="fact-big">33,244</p>
              <p>Indian diagnostic centres were covered by a 2026 preprint analysing 794,811 examinations. It found significant variation in laboratory reference ranges, so "inside your lab's range" is not a fixed truth.</p>
              <p className="small muted">Lakhani S., medRxiv preprint, June 2026. <a href="https://www.medrxiv.org/content/10.64898/2026.06.01.26354654v1">Read the preprint</a></p>
            </div>
            <div className="card fact">
              <p className="fact-big">77%</p>
              <p>of US adults in KFF's February 2026 survey said they are concerned about the privacy of medical information given to AI tools. Yet 41% of those who used AI for health information had uploaded personal medical information such as test results.</p>
              <p className="small muted">KFF Tracking Poll on Health Information and Trust, 2026. <a href="https://www.kff.org/public-opinion/kff-tracking-poll-on-health-information-and-trust-use-of-ai-for-health-information-and-advice/">Read the survey</a></p>
            </div>
          </div>
        </section>

        <section className="land-section" aria-labelledby="how-title">
          <h2 id="how-title">How it works</h2>
          <ol className="steps3">
            <li><b>1. Read</b>Your report's numbers are read, on this device when it can.</li>
            <li><b>2. Check</b>You see exactly what will be sent, with your name and details removed, and approve it.</li>
            <li><b>3. Explain</b>Gemini explains the anonymous numbers in plain English or Hindi, with questions for your doctor.</li>
          </ol>
        </section>

        <section className="land-section" aria-labelledby="privacy-title">
          <h2 id="privacy-title">Privacy promises</h2>
          <ul className="promises">
            <li><b>Nothing is stored.</b> Your report stays in your browser tab's memory. ClearReport has no database and no storage bucket.</li>
            <li><b>You approve what is sent.</b> You see the exact anonymous numbers, or the exact covered image, before anything goes to the cloud.</li>
            <li><b>Paid-tier Gemini.</b> Explanations use the Gemini Developer API on a paid plan, under Google's paid-services terms.</li>
            <li><b>App Check.</b> Firebase App Check (reCAPTCHA Enterprise) lets only the ClearReport web app call Gemini.</li>
          </ul>
        </section>

        <section className="land-section" aria-labelledby="faq-title">
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
      </main>

      <footer className="land-footer">
        <p>{DISCLAIMER}</p>
        <p>
          <a href={REPO}>Source code on GitHub</a> · Built with Firebase AI Logic · <a href={`${REPO}/blob/main/LICENSE`}>Apache-2.0 license</a> · <a href={`${REPO}#design-credits`}>Design credits</a>
        </p>
      </footer>
    </div>
  )
}
