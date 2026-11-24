// The Open Graph image (public/landing/og.jpg, 1200x630): a night band with the brand mark and name, over the top of
// the hero screenshot (public/landing/hero.jpg). Rendered with Playwright and installed Chrome; fonts are the
// self-hosted IBM Plex files, so nothing is fetched. Usage: npx tsx scripts/og.ts
import { chromium } from 'playwright'
import { readFileSync, statSync } from 'node:fs'
import { logoSvg } from '../src/logo'

const b64 = (p: string) => readFileSync(p).toString('base64')
const font = (w: number) => `@font-face { font-family: Plex; font-weight: ${w}; src: url(data:font/woff2;base64,${b64(`node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-${w}-normal.woff2`)}) format('woff2'); }`
const logo = logoSvg({ size: 52 })

const html = `<!doctype html><html><head><style>
${font(500)} ${font(700)}
* { margin: 0; box-sizing: border-box; }
body { width: 1200px; height: 630px; overflow: hidden; background: #050608; font-family: Plex, sans-serif; }
header { height: 96px; display: flex; align-items: center; gap: 16px; padding: 0 40px; color: #F5F5F7; }
b { font-size: 38px; font-weight: 700; letter-spacing: -0.02em; }
span { margin-left: auto; font-size: 22px; font-weight: 500; color: #A1A1AA; }
img { display: block; width: 1200px; height: 534px; object-fit: cover; object-position: top; }
</style></head><body>
<header>${logo}<b>ClearReport</b><span>Understand your blood test report. Keep your identity.</span></header>
<img src="data:image/jpeg;base64,${b64('public/landing/hero.jpg')}">
</body></html>`

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
await page.setContent(html)
await page.evaluate(() => document.fonts.ready)
const path = 'public/landing/og.jpg'
await page.screenshot({ path, type: 'jpeg', quality: 82 })
console.log(`${path} ${Math.round(statSync(path).size / 1024)} KB`)
await browser.close()
