// Devpost gallery images: 1500x1000 JPEG under 1 MB, the real screen on a dark frame with a short caption bar.
// Captures the live site (or APP_URL) with Gemini blocked, in Chrome without built-in AI; synthetic sample only.
// An optional frame from the Scene 3 recording (path in UNFAMILIAR_FRAME) becomes 05-unfamiliar-layout.jpg.
// Usage: npx tsx scripts/devpost.ts   Writes docs/devpost/*.jpg
import { chromium, type Page } from 'playwright'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE = process.env.APP_URL ?? 'https://clearreport-717f3.web.app'
const OUT = 'docs/devpost'
const font = (w: number) => `data:font/woff2;base64,${readFileSync(`node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-${w}-normal.woff2`).toString('base64')}`
const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-features=AIPromptAPI,AIPromptAPIMultimodalInput,OptimizationGuideOnDeviceModel'] })
const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
await ctx.route('**/*', (r) => (/(firebasevertexai|generativelanguage)\.googleapis\.com/.test(r.request().url()) ? r.abort() : r.continue()))
const page = await ctx.newPage()
const shots: [string, string, Buffer][] = []
const grab = async (p: Page) => p.screenshot({ type: 'png' })

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.locator('.browser-frame img').evaluate((img: HTMLImageElement) => img.decode())
shots.push(['01-landing-hero', 'Your blood test report in plain words, with your personal details kept on your device', await grab(page)])
await page.locator('.cmp').scrollIntoViewIfNeeded()
await page.evaluate(() => scrollBy(0, -140))
await page.locator('.cmp input[type=range]').fill('55')
await page.waitForTimeout(600)
shots.push(['02-compare', 'Drag to compare: your report, and exactly what is sent to explain it', await grab(page)])
await page.locator('#hood').evaluate((e) => e.scrollIntoView({ block: 'start' }))
await page.waitForTimeout(600)
shots.push(['04-under-the-hood', 'Under the hood: Firebase AI Logic on the device, in the cloud, and plain code', await grab(page)])

await page.goto(`${BASE}/app?sample=demo`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'I am 18 or older' }).click()
await page.waitForFunction(() => !document.body.innerText.includes('Loading the sample'))
await page.getByRole('button', { name: 'Mask my details' }).first().click()
await page.getByRole('heading', { name: 'Cover your personal details' }).waitFor({ timeout: 60_000 })
await page.getByRole('heading', { name: 'Cover your personal details' }).evaluate((e) => e.scrollIntoView({ block: 'start' }))
await page.evaluate(() => scrollBy(0, -20))
await page.waitForTimeout(800)
shots.push(['03-mask', 'Mask it yourself: suggested boxes found on this device, burned in as solid black', await grab(page)])

const frame = process.env.UNFAMILIAR_FRAME
if (frame && existsSync(frame)) shots.push(['05-unfamiliar-layout', 'A layout the parser has never seen: read by Gemini Nano on the device, every value verified', readFileSync(frame)])

const comp = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 })
for (const [name, caption, img] of shots) {
  const mime = img[0] === 0x89 ? 'image/png' : 'image/jpeg'
  await comp.setContent(`<!doctype html><style>
    @font-face{font-family:Plex;font-weight:500;src:url(${font(500)})}@font-face{font-family:Plex;font-weight:600;src:url(${font(600)})}
    body{margin:0;width:1500px;height:1000px;background:radial-gradient(120% 90% at 50% 0%,#1d1830 0%,#0b0a10 60%);font-family:Plex,sans-serif;display:flex;flex-direction:column;align-items:center}
    .shot{margin-top:44px;width:1380px;height:802px;border-radius:14px;overflow:hidden;box-shadow:0 0 0 1px rgba(255,255,255,.12),0 24px 60px rgba(0,0,0,.6);background:#000}
    .shot img{width:100%;height:100%;object-fit:cover;object-position:top}
    .bar{margin-top:30px;padding:16px 30px;border-radius:999px;background:rgba(255,255,255,.07);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);color:#f3f0fa;font-size:30px;font-weight:600;letter-spacing:-.2px}
  </style><div class="shot"><img src="data:${mime};base64,${img.toString('base64')}"></div><div class="bar">${caption}</div>`)
  await comp.evaluate(() => document.fonts.ready)
  for (const q of [88, 80, 70]) {
    const path = `${OUT}/${name}.jpg`
    await comp.screenshot({ path, type: 'jpeg', quality: q })
    if (statSync(path).size < 1_000_000) { console.log(`${resolve(path)} ${Math.round(statSync(path).size / 1024)} KB (q${q})`); break }
  }
}
await browser.close()
