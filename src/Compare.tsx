import { useEffect, useRef, useState, type CSSProperties } from 'react'
// Drag to compare the sample report with what ClearReport sends to the cloud. The explanation call sends only
// { lab_name, age_band, sex, tests } (see explain.ts), so the right side keeps exactly those and drops the rest.
// Before/after slider after Motiq's "Compare Reveal" (MIT), rebuilt in plain CSS: the control is a native range input
// (arrow keys, Home/End, screen-reader value for free), and the reveal is a clip-path driven by --pos. The one-time
// sweep on first view is a CSS animation, off with prefers-reduced-motion. Skipped: the spring physics.

// The synthetic sample report (public/samples/demo.pdf).
const ROWS: [string, string, string, string][] = [
  ['Total Cholesterol', '236', 'mg/dL', '< 200'], ['Triglycerides', '188', 'mg/dL', '< 150'], ['HDL Cholesterol', '38', 'mg/dL', '> 40'],
  ['LDL Cholesterol', '160', 'mg/dL', '< 100'], ['Glucose Fasting (FBS)', '104', 'mg/dL', '70 - 110'],
]

function Report({ sent }: { sent?: boolean }) {
  const gone = (text: string) => (sent ? <s className="cmp-gone">{text}</s> : text)
  return (
    <div className="cmp-report">
      <p className="cmp-lab">Specimen Path Labs</p>
      <p className="cmp-meta">{gone('12 Sample Street, Demopur, Pune 411000')}</p>
      <dl className="cmp-who">
        <div><dt>Patient</dt><dd>{gone('Mrs. Meera Fictitious')}</dd></div>
        <div><dt>Lab no.</dt><dd>{gone('SPL-DEMO-20419')}</dd></div>
        <div><dt>{sent ? 'Age band / Sex' : 'Age / Sex'}</dt><dd>{sent ? <b>50-59 / Female</b> : '54 Y / Female'}</dd></div>
        <div><dt>Mobile</dt><dd>{gone('+91 90000 00015')}</dd></div>
        <div><dt>Ref. by</dt><dd>{gone('Dr. Example Iyer')}</dd></div>
      </dl>
      <table>
        <tbody>{ROWS.map(([t, v, u, r]) => <tr key={t}><td>{t}</td><td>{v}</td><td>{u}</td><td>{r}</td></tr>)}</tbody>
      </table>
    </div>
  )
}

export default function Compare() {
  const [pos, setPos] = useState(50)
  const [touched, setTouched] = useState(false)
  const [seen, setSeen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect() } }, { threshold: 0.5 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <figure className="cmp-figure">
      <div ref={ref} className={`cmp${seen && !touched ? ' cmp-intro' : ''}`} style={{ '--pos': `${pos}%` } as CSSProperties}>
        <div className="cmp-side" aria-hidden="true"><Report sent /></div>
        <div className="cmp-side cmp-before" aria-hidden="true"><Report /></div>
        <span className="cmp-chip left" aria-hidden="true">Your report</span>
        <span className="cmp-chip right" aria-hidden="true">Sent to explain</span>
        <span className="cmp-handle" aria-hidden="true">
          <svg width="18" height="14" viewBox="0 0 18 14" fill="none"><path d="M6 1 1 7l5 6M12 1l5 6-5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <input type="range" min={0} max={100} value={pos} aria-label="Compare your report with what is sent to explain it" aria-valuetext={`${pos}% showing your report`}
          onChange={(e) => { setTouched(true); setPos(Number(e.target.value)) }} onPointerDown={() => setTouched(true)} />
      </div>
      <figcaption className="small muted">Drag to compare. The explanation is written from only the lab's name, your sex, an age band and the results; your name, lab number, exact age, mobile number, doctor and the lab's address are left out. With a photo, you cover your details yourself before the image is read.</figcaption>
    </figure>
  )
}
