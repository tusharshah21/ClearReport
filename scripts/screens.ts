// The key screenshots for the README and the submission, into docs/screenshots/ as compressed JPEGs (under 200 KB each).
// Runs against the dev server (npm run dev) with a synthetic report (r2: fake identity, a fasting glucose range that differs from a guideline), through Path 2.
// Desktop: installed Chrome with a fresh profile, so its built-in AI shows as a one-time download.
// Phone: the built-in AI is hidden, as on a phone, so the paths screen shows Private greyed out.
// Usage: npx tsx scripts/screens.ts [r2|r6|landing], then python scripts/compress-shots.py.
import { chromium } from 'playwright'
import { mkdirSync, statSync } from 'node:fs'

const URL = 'http://localhost:5173/app'
const OUT = 'docs/screenshots'
// npx tsx scripts/screens.ts [r2|r6]: r2 takes every key screen; r6 only its explanation (08-explanation-r6-*).
const ID = process.argv[2] ?? 'r2'
const FILE = { r2: 'test-data/reports/r2.png', r6: 'test-data/reports/r6-photo.jpg' }[ID as 'r2']
const KEEP: Record<string, string[]> = ID === 'r2'
  ? { desktop: ['02-paths', '05-mask', '07-review', '08-explanation', '09-hindi'], mobile: ['02-paths-no-ai', '05-mask', '07-review', '08-explanation', '09-hindi'] }
  : { desktop: ['08-explanation'], mobile: ['08-explanation'] }
mkdirSync(OUT, { recursive: true })

// npx tsx scripts/screens.ts landing: the landing page ("/") at both sizes, full page.
if (ID === 'landing') {
  const b = await chromium.launch({ channel: 'chrome' })
  for (const [tag, width, height] of [['desktop', 1280, 860], ['mobile', 390, 844]] as const) {
    const page = await b.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
    await page.goto(URL.replace('/app', '/'))
    await page.locator('.browser-frame img').evaluate((img: HTMLImageElement) => img.decode())
    const path = `${OUT}/01-landing-${tag}.jpg`
    await page.screenshot({ path, fullPage: true, type: 'jpeg', quality: 70 })
    console.log(`${path} ${Math.round(statSync(path).size / 1024)} KB`)
    await page.close()
  }
  await b.close()
  process.exit(0)
}

// An optional third argument (desktop or mobile) takes only that size, to redo one after a busy cloud model.
const sizes = [{ tag: 'desktop', width: 1280, height: 860, mobile: false }, { tag: 'mobile', width: 390, height: 844, mobile: true }].filter((s) => !process.argv[3] || s.tag === process.argv[3])
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
    const path = `${OUT}/${name}${ID === 'r2' ? '' : `-${ID}`}-${s.tag}.jpg`
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
  await page.setInputFiles('input[type=file]', FILE)
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
  // If the cloud read fails, print the page's technical details (for example a busy model or a quota error) before stopping.
  await page.getByRole('heading', { name: 'Check your results' }).waitFor({ timeout: 120_000 }).catch(async (e) => {
    await page.getByText('Technical details').click().catch(() => {})
    console.log('Cloud read failed:', (await page.locator('main').innerText()).slice(0, 1500)); throw e
  })
  await shot('07-review')
  await click('Approve and send these numbers')
  await page.getByRole('heading', { name: 'Summary' }).waitFor({ timeout: 120_000 })
  await shot('08-explanation')
  // The Hindi view: switch the language and wait until the summary is in Devanagari.
  if (KEEP[s.tag].includes('09-hindi')) {
    await page.getByRole('button', { name: 'हिन्दी' }).first().click({ timeout: 180_000 }) // the tap asks for the translation
    await page.waitForFunction(() => /[ऀ-ॿ]{3}/.test(document.querySelector('main')?.innerText ?? ''), null, { timeout: 180_000 })
    await shot('09-hindi')
  }
  // The landing hero (public/landing/hero.jpg, hero.webp, og.jpg) is captured by hand from a Path 1 run of the sample in Chrome
  // with on-device AI, so its data trail shows the on-device steps. Playwright's Chrome has no on-device model.
  await ctx.close()
}
await browser.close()
console.log('external hosts:', [...hosts].sort().join(', '))
