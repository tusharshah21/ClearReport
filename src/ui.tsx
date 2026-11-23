import { useState } from 'react'
// Small shared UI pieces: status icons and the data trail. Icons always come with words (never colour alone).

const svg = (d: string) => (
  <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
)
export const Icon = {
  ok: svg('M4 10.5l4 4 8-9'),
  out: svg('M10 3v9M10 16.5v.5'), // exclamation, calm weight
  check: svg('M7.5 7.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M10 16v.5'), // question mark
  plain: svg('M4 10h12'),
  down: svg('M10 4v12M5.5 11.5L10 16l4.5-4.5'), // below the range
  up: svg('M10 16V4M5.5 8.5L10 4l4.5 4.5'), // above the range
  ruler: svg('M3 13.5L13.5 3l3.5 3.5L6.5 17zM6.5 10l1.5 1.5M9 7.5l1.5 1.5M11.5 5l1.5 1.5'),
}

export function Badge({ kind, icon, children }: { kind: 'ok' | 'out' | 'check' | 'plain' | 'note'; icon?: React.ReactNode; children: React.ReactNode }) {
  return <span className={`badge ${kind}`}>{icon ?? Icon[kind === 'note' ? 'ruler' : kind]}{children}</span>
}

export function Busy({ children }: { children: React.ReactNode }) {
  return <p className="status-line" role="status"><span className="spinner" aria-hidden="true" />{children}</p>
}

// ---- Data trail: each step of this report and where it happened, as a timeline (layout idea from Dice UI Timeline, MIT). ----
export type TrailPath = 1 | 2 | 3 | null
export type TrailStep = 'choose' | 'upload' | 'crop' | 'mask' | 'confirm-masked' | 'consent' | 'extracting' | 'failed' | 'review' | 'explaining' | 'explained'
type Item = { key: string; label: string; where: 'device' | 'cloud' }
const OPEN: Item = { key: 'open', label: 'Report opened', where: 'device' }
const REMOVED: Item = { key: 'removed', label: 'Personal details removed', where: 'device' }
const NUMBERS: Item = { key: 'numbers', label: 'Anonymous numbers sent to Gemini (after you approve)', where: 'cloud' }
const EXPLAINED: Item = { key: 'explained', label: 'Explanation received', where: 'cloud' }
const ITEMS: Record<1 | 2 | 3, Item[]> = {
  1: [OPEN, REMOVED, { key: 'read', label: 'Read on this device', where: 'device' }, NUMBERS, EXPLAINED],
  2: [OPEN, { key: 'cover', label: 'Personal details covered by you', where: 'device' }, { key: 'read', label: 'Covered image sent to Gemini to read', where: 'cloud' }, REMOVED, NUMBERS, EXPLAINED],
  3: [OPEN, { key: 'read', label: 'Full report sent to Gemini to read, with your consent', where: 'cloud' }, REMOVED, NUMBERS, EXPLAINED],
}
// The step the user is on, as a trail key. Path 1 removes personal details before reading, so "removed" comes first.
function current(path: 1 | 2 | 3, step: TrailStep, hasFile: boolean): string {
  switch (step) {
    case 'choose': case 'upload': return hasFile ? (path === 2 ? 'cover' : 'read') : 'open'
    case 'crop': case 'mask': case 'confirm-masked': return 'cover'
    case 'consent': case 'extracting': case 'failed': return 'read'
    case 'review': return 'numbers'
    case 'explaining': return 'explained'
    case 'explained': return 'done'
  }
}

export function DataTrail({ path, step, hasFile }: { path: TrailPath; step: TrailStep; hasFile: boolean }) {
  const [wide] = useState(() => !window.matchMedia?.('(max-width: 860px)').matches)
  const items = path ? ITEMS[path] : null
  const cur = path ? current(path, step, hasFile) : 'open'
  const at = items ? (cur === 'done' ? items.length : items.findIndex((i) => i.key === cur)) : -1
  const state = (i: number) => (i < at ? 'done' : i === at ? 'now' : 'todo')
  const where = { device: 'On this device', cloud: 'Google Gemini, in the cloud' }
  const body = (
    <>
      <h2 id="trail-title">Data trail</h2>
      {!items ? (
        <p className="muted small">Choose how to read your report, and this panel shows each step and where it happens: on this device or in the cloud.</p>
      ) : (
        <ol aria-labelledby="trail-title">
          {items.map((it, i) => (
            <li key={it.key} className={`${state(i)} ${it.where}`} aria-current={state(i) === 'now' ? 'step' : undefined}>
              <span className="dot" aria-hidden="true">{state(i) === 'done' && Icon.ok}</span>
              <span className="sr-only">{state(i) === 'done' ? 'Done: ' : state(i) === 'now' ? 'Now: ' : 'Not yet: '}</span>
              {it.key === 'read' && path === 1 ? 'Read on this device' : it.label}
              {it.key === 'removed' && path === 1 && <> (before reading)</>}
              <br /><span className={`where ${it.where}`}>{where[it.where]}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="muted small">Nothing is stored by ClearReport. Report images stay in this tab's memory and are gone when you close it.</p>
    </>
  )
  const now = items && at >= 0 && at < items.length ? (items[at].key === 'read' && path === 1 ? 'Read on this device' : items[at].label) : null
  return (
    // No motion on the results and explanation screens: the timeline's fade-in is switched off there.
    <aside className={`trail card${['review', 'explaining', 'explained'].includes(step) ? ' still' : ''}`} aria-label="Data trail">
      {/* Open beside the content on wide screens; on a phone it starts as one line above the content. */}
      <details open={wide}>
        <summary>Data trail{now ? <>: <span className="muted">now, {now.replace(' (after you approve)', '')}</span></> : ': where your report goes'}</summary>
        {body}
      </details>
    </aside>
  )
}
