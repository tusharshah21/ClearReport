import { useRef, useState } from 'react'
// "What leaves your device": the three paths as a data journey. Layout idea from Magic UI "Animated Beam" (MIT),
// rebuilt in plain CSS and SVG. The pulse is violet while the data is on this device and rose once it heads to the
// cloud. With prefers-reduced-motion the connectors are drawn in those colours and nothing moves.

const ico = (d: string) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
)
const ICONS = {
  laptop: ico('M5 6h14v9H5zM3 18h18'),
  shield: ico('M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6zM9 12l2 2 4-4'),
  box: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="7" width="16" height="10" rx="1.5" fill="currentColor" /></svg>,
  cloud: ico('M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.6A3.3 3.3 0 0 0 7 18z'),
}
type Kind = 'private' | 'mask' | 'full'
type Node = { icon: keyof typeof ICONS; label: string; sub: string; where: 'device' | 'cloud' }
const DEVICE: Node = { icon: 'laptop', label: 'Your device', sub: 'your report is opened here', where: 'device' }
const CLOUD: Node = { icon: 'cloud', label: 'Gemini in the cloud', sub: '', where: 'cloud' }
// mark: the one phrase of this section drawn with the highlighter stroke (decoration only; the words are unchanged).
const PATHS: Record<Kind, { tab: string; mid: Node | null; here: string; there: string; mark?: string }> = {
  private: { tab: 'Private (PDF)', mid: { icon: 'shield', label: 'Personal details removed', sub: 'on this device', where: 'device' }, here: 'Your PDF is read here; name, ID and phone removed here', there: 'Only anonymous numbers, age range and sex', mark: 'Only anonymous numbers' },
  mask: { tab: 'Mask it yourself', mid: { icon: 'box', label: 'You cover your details', sub: 'black boxes, on this device', where: 'device' }, here: 'You cover your details with black boxes here', there: 'The covered image, then anonymous numbers' },
  full: { tab: 'Full report', mid: null, here: 'Nothing is removed first', there: 'The full report image, only with your consent' },
}
const KINDS = Object.keys(PATHS) as Kind[]

function Link({ tone, second, full }: { tone: 'device' | 'cloud'; second?: boolean; full?: boolean }) {
  const d = 'M0 20 C 35 2, 65 38, 100 20'
  return (
    <svg className={`beam-link ${tone}${second ? ' second' : ''}${full ? ' full' : ''}`} viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <path className="track" d={d} vectorEffect="non-scaling-stroke" />
      <path className="pulse" d={d} pathLength={100} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
function Stop({ n, text, mark }: { n: Node; text?: string; mark?: string }) {
  const t = text ?? n.sub
  return (
    <div className={`beam-node ${n.where}`}>
      <span className="beam-icon">{ICONS[n.icon]}</span>
      <span><b>{n.label}</b>{t && <small>{mark && t.startsWith(mark) ? <><mark className="hl">{mark}</mark>{t.slice(mark.length)}</> : t}</small>}</span>
    </div>
  )
}

export default function Beam() {
  const [kind, setKind] = useState<Kind>('private')
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const p = PATHS[kind]
  // Arrow keys move between tabs (WAI-ARIA tabs pattern); Tab moves on to the panel.
  const onKey = (e: React.KeyboardEvent) => {
    const i = KINDS.indexOf(kind)
    const j = e.key === 'ArrowRight' ? (i + 1) % 3 : e.key === 'ArrowLeft' ? (i + 2) % 3 : e.key === 'Home' ? 0 : e.key === 'End' ? 2 : -1
    if (j < 0) return
    e.preventDefault()
    setKind(KINDS[j])
    tabs.current[j]?.focus()
  }
  return (
    <div className="beam-wrap">
      <div className="beam-tabs" role="tablist" aria-label="Ways to read your report" onKeyDown={onKey}>
        {KINDS.map((k, i) => (
          <button key={k} ref={(el) => { tabs.current[i] = el }} role="tab" id={`beam-tab-${k}`} aria-selected={k === kind} aria-controls="beam-panel" tabIndex={k === kind ? 0 : -1} onClick={() => setKind(k)}>{PATHS[k].tab}</button>
        ))}
      </div>
      <div id="beam-panel" role="tabpanel" aria-labelledby={`beam-tab-${kind}`} tabIndex={0}>
        <p className="sr-only">
          {kind === 'full'
            ? `${p.tab}: ${p.here}. Your device sends ${p.there.toLowerCase()} straight to Gemini in the cloud.`
            : `${p.tab}: on your device, ${p.mid!.label.toLowerCase()} (${p.here.toLowerCase()}). Then ${p.there.toLowerCase()} go to Gemini in the cloud.`}
        </p>
        {/* key: switching tabs restarts the pulse from the device */}
        <div className="beam" key={kind} aria-hidden="true">
          <Stop n={DEVICE} text={kind === 'full' ? p.here : undefined} />
          {p.mid ? <><Link tone="device" /><Stop n={p.mid} /><Link tone="cloud" second /></> : <Link tone="cloud" full />}
          <Stop n={CLOUD} text={p.there} mark={p.mark} />
        </div>
      </div>
    </div>
  )
}
