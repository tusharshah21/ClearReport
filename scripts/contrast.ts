// WCAG contrast of every colour pair the UI uses, read from the :root tokens in src/index.css.
// Text pairs need 4.5:1 (AA); non-text pairs (focus ring, the guideline callout's border, mask outlines) need 3:1.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync('src/index.css', 'utf-8')
const root = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')))
const T: Record<string, string> = Object.fromEntries([...root.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]))
T.white = '#FFFFFF'
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

// [foreground token, background token, minimum, where it is used]
const PAIRS: [string, string, number, string][] = [
  ['foreground', 'background', 4.5, 'body text'], ['foreground', 'card', 4.5, 'text on cards'], ['foreground', 'muted', 4.5, 'text on muted panels, "Please check" badge'],
  ['muted-foreground', 'background', 4.5, 'secondary text'], ['muted-foreground', 'card', 4.5, 'secondary text on cards'], ['muted-foreground', 'muted', 4.5, 'secondary text on muted panels'],
  ['white', 'primary', 4.5, 'primary button'], ['white', 'primary-hover', 4.5, 'primary button, hover'],
  ['primary', 'background', 4.5, 'links, brand'], ['primary', 'card', 4.5, 'links and secondary buttons on cards'], ['primary', 'device-bg', 4.5, 'secondary button hover'],
  ['device-fg', 'device-bg', 4.5, 'on-device chips, summary card'], ['cloud-fg', 'cloud-bg', 4.5, 'cloud chips'],
  ['guideline-fg', 'guideline-bg', 4.5, 'guideline callout and label'], ['guideline-border', 'guideline-bg', 3, 'callout border (non-text)'],
  ['status-range-fg', 'status-range-bg', 4.5, 'Above/Below range badge'], ['status-ok-fg', 'status-ok-bg', 4.5, 'Within range badge'],
  ['error', 'card', 4.5, 'error text on cards'], ['error-fg', 'error-bg', 4.5, 'error notice'],
  ['ring', 'background', 3, 'focus ring (non-text)'], ['ring', 'card', 3, 'focus ring on cards (non-text)'],
  ['white', 'cloud-fg', 3, 'tick in a finished cloud step (non-text)'], ['cloud-fg', 'card', 3, 'outline of the current cloud step (non-text)'],
  ['white', 'mask-chip', 4.5, 'numbered chip on suggested mask boxes'], ['mask-outline', 'white', 3, 'suggested mask outline on paper (non-text)'],
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
// The landing headline's gradient text (sage to apricot): every point along it must pass 4.5:1 on the background.
const mix = (a: string, b: string, t: number) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('')
const grad = Array.from({ length: 11 }, (_, k) => ratio(mix(T.primary, T['cloud-fg'], k / 10), T.background))
assert.ok(Math.min(...grad) >= 4.5, `hero gradient: lightest point ${Math.min(...grad).toFixed(2)} < 4.5`)
if (process.argv.includes('--table')) console.log(`| gradient \`--primary\` to \`--cloud-fg\` (lightest point) | \`--background\` ${T.background} | ${Math.min(...grad).toFixed(2)}:1 | 4.5:1 | landing headline "Keep your identity." |`)
console.log(`contrast ok: ${rows.length} pairs and the hero gradient`)
