// WCAG contrast of every colour pair the UI uses, read from the :root tokens in src/index.css.
// Text pairs need 4.5:1 (AA); non-text pairs (focus ring, the guideline callout's border, mask outlines) need 3:1.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync('src/index.css', 'utf-8')
const root = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')))
const T: Record<string, string> = Object.fromEntries([...root.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]))
T.white = '#FFFFFF'
// The dark app (body:has(.app) inside @media screen): the same tokens with dark values. App pairs are checked in both.
const darkBlock = css.slice(css.indexOf('body:has(.app) {'), css.indexOf('}', css.indexOf('body:has(.app) {')))
const D: Record<string, string> = { ...T, ...Object.fromEntries([...darkBlock.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]])) }
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

// [foreground token, background token, minimum, where it is used]
const PAIRS: [string, string, number, string][] = [
  // App (light)
  ['ink', 'paper', 4.5, 'body text'], ['ink', 'card', 4.5, 'text on cards'], ['ink', 'muted', 4.5, 'text on muted panels, "Please check" badge'],
  ['ink-muted', 'paper', 4.5, 'secondary text, section labels, disclaimer bar'], ['ink-muted', 'card', 4.5, 'secondary text on cards'], ['ink-muted', 'muted', 4.5, 'secondary text on muted panels'],
  ['ink', 'grid-line', 4.5, 'text where it crosses a graph-paper line'], ['ink-muted', 'grid-line', 4.5, 'secondary text where it crosses a graph-paper line'],
  ['card', 'primary', 4.5, 'primary button, pressed buttons, selected tab'], ['card', 'primary-hover', 4.5, 'primary button, hover'],
  ['primary', 'paper', 4.5, 'links, brand, section label numbers'], ['primary', 'card', 4.5, 'links and secondary buttons on cards'], ['primary', 'device-bg', 4.5, 'secondary button hover'],
  ['device-fg', 'device-bg', 4.5, 'on-device chips, tags, promises'], ['cloud-fg', 'cloud-bg', 4.5, 'cloud chips, Full report button hover'], ['cloud-fg', 'card', 4.5, 'Full report button text'],
  ['on-highlight', 'highlight', 4.5, 'callout heading on the highlighter band, "Guideline: borderline" chip, landing highlighter marks'], ['ink', 'highlight-tint', 4.5, 'callout body'],
  ['status-range-fg', 'status-range-bg', 4.5, 'Above/Below range badge'], ['status-ok-fg', 'status-ok-bg', 4.5, 'Within range badge'],
  ['error', 'card', 4.5, 'error text on cards'], ['error', 'error-bg', 4.5, 'error notice'],
  ['ring', 'paper', 3, 'focus ring (non-text)'], ['ring', 'card', 3, 'focus ring on cards (non-text)'],
  ['card', 'cloud-fg', 3, 'tick in a finished cloud step (non-text)'], ['cloud-fg', 'card', 3, 'outline of the current cloud step (non-text)'],
  ['card', 'primary', 3, 'tick in a finished device step (non-text)'],
  ['white', 'mask-chip', 4.5, 'numbered chip on suggested mask boxes'], ['mask-outline', 'white', 3, 'suggested mask outline on paper (non-text)'],
  // Landing (dark)
  ['night-text', 'night', 4.5, 'headline top, header and menu text, ghost buttons'], ['night-text', 'night-surface', 4.5, 'pill link, ghost button and menu button hover'],
  ['night-text-fade', 'night', 4.5, 'headline bottom (white fading to 70% white)'],
  ['night-muted', 'night', 4.5, 'lede, header links, footer text'], ['night-muted', 'night-surface', 4.5, 'announcement pill text, address bar in the browser frame'],
  ['night-text', 'night-grid', 4.5, 'text where it crosses a slide-grid line, menu link dividers'],
  ['night', 'white', 4.5, 'white button text ("Read my report", "Open the app"), top'], ['night', 'light-btn-end', 4.5, 'white button text, bottom of its gradient'],
  ['glow-violet', 'night', 4.5, 'links on dark, gradient start'], ['glow-rose', 'night', 4.5, 'gradient end'],
  ['night-muted', 'night-grid', 4.5, 'section text where it crosses a slide-grid line'],
  ['glow-violet', 'night-surface', 4.5, 'links, step names and fact numbers on dark cards'], ['glow-rose', 'night-surface', 4.5, 'fact number gradient end on dark cards'],
  ['night', 'glow-rose', 4.5, '"Sent to explain" chip on the compare slider'], ['night-text', 'night', 4.5, '"Your report" chip on the compare slider'],
  ['night-text', 'night-border', 4.5, '"Paused" note and hovered tabs in the data-journey diagram'], ['night', 'night-text', 4.5, 'selected tab in the data-journey diagram'],
  ['night-control', 'night', 3, 'ghost button and menu button borders on dark (non-text)'], ['glow-violet', 'night', 3, 'focus ring on dark (non-text)'], ['glow-violet', 'night-surface', 3, 'focus ring on a hovered dark control (non-text)'],
]
const rows = PAIRS.map(([f, b, min, use]) => {
  assert.ok(T[f] && T[b], `missing token ${T[f] ? b : f}`)
  const r = ratio(T[f], T[b])
  return { f, b, r, min, use }
})
if (process.argv.includes('--table')) {
  console.log('| Foreground | Background | Ratio | Needs | Used for |\n| --- | --- | --- | --- | --- |')
  for (const x of rows) console.log(`| \`--${x.f}\` ${T[x.f]} | \`--${x.b}\` ${T[x.b]} | ${x.r.toFixed(2)}:1 | ${x.min}:1 | ${x.use} |`)
}
for (const x of rows) assert.ok(x.r >= x.min, `contrast --${x.f} on --${x.b}: ${x.r.toFixed(2)} < ${x.min}`)
// The same app pairs with the dark app's values (landing pairs already are dark; mask pairs are drawn on the light
// canvas, which keeps the root values).
const appPairs = PAIRS.filter(([f, b]) => ![f, b].some((t) => /^(night|glow|light-btn|mask)/.test(t)))
const darkRows = appPairs.map(([f, b, min, use]) => ({ f, b, r: ratio(D[f], D[b]), min, use }))
if (process.argv.includes('--table')) for (const x of darkRows) console.log(`| \`--${x.f}\` ${D[x.f]} (dark app) | \`--${x.b}\` ${D[x.b]} | ${x.r.toFixed(2)}:1 | ${x.min}:1 | ${x.use} |`)
for (const x of darkRows) assert.ok(x.r >= x.min, `dark app: contrast --${x.f} on --${x.b}: ${x.r.toFixed(2)} < ${x.min}`)
// The landing headline's gradient text (violet to rose): every point along it must pass 4.5:1 on the night.
const mix = (a: string, b: string, t: number) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('')
const grad = Array.from({ length: 11 }, (_, k) => ratio(mix(T['glow-violet'], T['glow-rose'], k / 10), T.night))
assert.ok(Math.min(...grad) >= 4.5, `hero gradient: lowest point ${Math.min(...grad).toFixed(2)} < 4.5`)
if (process.argv.includes('--table')) console.log(`| gradient \`--glow-violet\` to \`--glow-rose\` (lowest point) | \`--night\` ${T.night} | ${Math.min(...grad).toFixed(2)}:1 | 4.5:1 | landing headline "Keep your identity." |`)
// The floating header is --night at 86% with a blur and a white sheen of up to 3% on top: over the light compare
// report it is at its palest.
const header = mix(mix(T.night, T.paper, 0.14), '#FFFFFF', 0.03)
for (const [f, use] of [['night-text', 'header text and logo name over the light sections'], ['night-muted', 'header links over the light sections']] as const) {
  const r = ratio(T[f], header)
  if (process.argv.includes('--table')) console.log(`| \`--${f}\` ${T[f]} | header over \`--paper\` ${header} | ${r.toFixed(2)}:1 | 4.5:1 | ${use} |`)
  assert.ok(r >= 4.5, `contrast --${f} on the header over paper: ${r.toFixed(2)} < 4.5`)
}
// The footer's light shaft brightens the black by at most violet at 20% (it is 16% at its peak, then blurred).
const beam = mix(T.night, T['glow-violet'], 0.2)
for (const [f, use] of [['night-muted', 'footer text under the light shaft'], ['glow-violet', 'footer links under the light shaft']] as const) {
  const r = ratio(T[f], beam)
  if (process.argv.includes('--table')) console.log(`| \`--${f}\` ${T[f]} | footer shaft ${beam} | ${r.toFixed(2)}:1 | 4.5:1 | ${use} |`)
  assert.ok(r >= 4.5, `contrast --${f} under the footer shaft: ${r.toFixed(2)} < 4.5`)
}
// The glows behind the landing sections are at most 22% violet or 18% rose over the black where text sits on them.
for (const [glow, peak] of [['glow-violet', 0.22], ['glow-rose', 0.18]] as const) {
  const bg = mix(T.night, T[glow], peak)
  for (const [f, use] of [['night-muted', 'section text and labels over a glow'], ['night-text', 'headings over a glow'], ['glow-violet', 'label numbers and links over a glow']] as const) {
    const r = ratio(T[f], bg)
    if (process.argv.includes('--table')) console.log(`| \`--${f}\` ${T[f]} | ${glow} glow ${bg} | ${r.toFixed(2)}:1 | 4.5:1 | ${use} |`)
    assert.ok(r >= 4.5, `contrast --${f} over the ${glow} glow: ${r.toFixed(2)} < 4.5`)
  }
}
console.log(`contrast ok: ${rows.length} pairs, ${darkRows.length} dark app pairs, the hero gradient, the header over paper, the footer shaft and the section glows`)
