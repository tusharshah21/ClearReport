// Writes the brand mark files from src/logo.ts: public/favicon.svg (no shield, for the 16 px tab icon), the 16 and 32 px
// PNG favicons, the 180 px apple-touch-icon (on the landing black), and docs/brand/marks.png (the mark at 16, 32 and
// 180 px on light paper and on black, for review). Rendered with Playwright and installed Chrome; nothing is fetched.
// Usage: npx tsx scripts/icons.ts
import { chromium } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { logoSvg } from '../src/logo'

writeFileSync('public/favicon.svg', logoSvg({ shield: false }) + '\n')
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ deviceScaleFactor: 1 })
const shoot = async (svg: string, size: number, path: string) => {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<style>*{margin:0}svg{display:block}</style>${svg}`)
  await page.screenshot({ path, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
  console.log(path)
}
await shoot(logoSvg({ size: 16, shield: false }), 16, 'public/favicon-16.png')
await shoot(logoSvg({ size: 32 }), 32, 'public/favicon-32.png')
await shoot(logoSvg({ size: 180, bg: '#050608' }), 180, 'public/apple-touch-icon.png')

// Review sheet: each size at 1:1 (and the 16 and 32 also enlarged 4x, pixelated, to show the real pixels).
mkdirSync('docs/brand', { recursive: true })
const row = (bg: string, fg: string, label: string) => `<div style="background:${bg};color:${fg};padding:24px;display:flex;gap:32px;align-items:end;font:13px system-ui">
  <b style="width:90px">${label}</b>
  <figure>${logoSvg({ size: 16, shield: false })}<figcaption>16</figcaption></figure>
  <figure>${logoSvg({ size: 32 })}<figcaption>32</figcaption></figure>
  <figure>${logoSvg({ size: 180 })}<figcaption>180</figcaption></figure>
  <figure><img src="/16" width="64" height="64"><figcaption>16 at 4x</figcaption></figure>
  <figure><img src="/32" width="128" height="128"><figcaption>32 at 4x</figcaption></figure>
</div>`
await page.setViewportSize({ width: 760, height: 560 })
const png = (p: string) => `data:image/png;base64,${readFileSync(p).toString('base64')}`
const html = `<style>*{margin:0}figure{display:grid;justify-items:center;gap:6px}img{image-rendering:pixelated}</style>${row('#FCFCFA', '#111827', 'Light (app)')}${row('#050608', '#F5F5F7', 'Dark (landing)')}`
  .replaceAll('src="/16"', `src="${png('public/favicon-16.png')}"`).replaceAll('src="/32"', `src="${png('public/favicon-32.png')}"`)
await page.setContent(html)
await page.locator('body').screenshot({ path: 'docs/brand/marks.png' })
console.log('docs/brand/marks.png')
await browser.close()
