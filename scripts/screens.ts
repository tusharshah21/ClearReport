// The key screenshots for the README and the submission, into docs/screenshots/ as compressed JPEGs (under 200 KB each).
// Runs against the dev server (npm run dev) with a synthetic report (r2: fake identity, a fasting glucose range that differs from a guideline), through Path 2.
// Desktop: installed Chrome with a fresh profile, so its built-in AI shows as a one-time download.
// Phone: the built-in AI is hidden, as on a phone, so the paths screen shows Private greyed out.
// Usage: npx tsx scripts/screens.ts
import { chromium } from 'playwright'
import { mkdirSync, statSync } from 'node:fs'

const URL = 'http://localhost:5173/'
const OUT = 'docs/screenshots'
const KEEP: Record<string, string[]> = { desktop: ['02-paths', '07-review', '08-explanation'], mobile: ['02-paths-no-ai', '05-mask', '08-explanation'] }
mkdirSync(OUT, { recursive: true })

const sizes = [{ tag: 'desktop', width: 1280, height: 860, mobile: false }, { tag: 'mobile', width: 390, height: 844, mobile: true }]
const hosts = new Set<string>() // every non-local host the app contacts during the run
const browser = await chromium.launch({ channel: 'chrome' }) // installed Chrome, fresh temporary profile
for (const s of sizes) {
  const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: 1, isMobile: s.mobile, hasTouch: s.mobile })
  if (s.mobile) await ctx.addInitScript(() => { delete (window as { LanguageModel?: unknown }).LanguageModel })
  const page = await ctx.newPage()
  page.on('request', (r) => { const h = new globalThis.URL(r.url()).host; if (!h.startsWith('localhost')) hosts.add(h) })
  const shot = async (name: string) => {
    if (!KEEP[s.tag].includes(name)) return
    await page.waitForTimeout(300)
    const path = `${OUT}/${name}-${s.tag}.jpg`
    await page.screenshot({ path, fullPage: true, type: 'jpeg', quality: 55 })
    console.log(`${path} ${Math.round(statSync(path).size / 1024)} KB`)
  }
  const click = (name: string | RegExp) => page.getByRole('button', { name }).first().click()

  await page.goto(URL)
  await page.getByText('Before you start').waitFor()
  await click('I am 18 or older')
  await page.getByText('How should we read your report?').waitFor()
  await page.waitForFunction(() => !document.body.innerText.includes('Checking whether this device'))
  if (s.mobile) await page.getByText('See how private reading works').click()
  await shot(s.mobile ? '02-paths-no-ai' : '02-paths')
  await click('Mask my details')
  await page.setInputFiles('input[type=file]', 'test-data/reports/r2.png')
  const crop = page.getByRole('heading', { name: 'Straighten the photo' })
  const mask = page.getByRole('heading', { name: 'Cover your personal details' })
  await Promise.race([crop.waitFor(), mask.waitFor({ timeout: 120_000 })])
  if (await crop.isVisible()) { await page.waitForTimeout(500); await click('Straighten') }
  await mask.waitFor({ timeout: 120_000 })
  await page.waitForTimeout(800)
  // Draw one box as a user would (over the name line near the top), so the confirm screen shows a covered image.
  const c = (await page.locator('canvas').boundingBox())!
  await page.mouse.move(c.x + c.width * 0.04, c.y + c.height * 0.1)
  await page.mouse.down()
  await page.mouse.move(c.x + c.width * 0.6, c.y + c.height * 0.2, { steps: 5 })
  await page.mouse.up()
  await shot('05-mask')
  await click('Done masking')
  await page.getByRole('heading', { name: /exact image/ }).waitFor()
  await click(/^Send this image/)
  await page.getByRole('heading', { name: 'Check your results' }).waitFor({ timeout: 120_000 })
  await shot('07-review')
  await click('Approve and send these numbers')
  await page.getByRole('heading', { name: 'Summary' }).waitFor({ timeout: 120_000 })
  await shot('08-explanation')
  await ctx.close()
}
await browser.close()
console.log('external hosts:', [...hosts].sort().join(', '))
