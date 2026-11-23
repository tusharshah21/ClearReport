// Screenshots of every screen at desktop (1280) and phone (390) widths, into docs/screenshots/.
// Runs against the dev server (npm run dev) with a synthetic photo (r6-photo: fake identity, lab ranges that differ from a guideline), through Path 2.
// Desktop: installed Chrome with a fresh profile, so its built-in AI shows as a one-time download.
// Usage: npx tsx scripts/screens.ts
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const URL = 'http://localhost:5173/'
const OUT = 'docs/screenshots'
mkdirSync(OUT, { recursive: true })

const sizes = [{ tag: 'desktop', width: 1280, height: 860, mobile: false }, { tag: 'mobile', width: 390, height: 844, mobile: true }]
const browser = await chromium.launch({ channel: 'chrome' }) // installed Chrome, fresh temporary profile
for (const s of sizes) {
  const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile })
  // Phone browsers have no built-in AI (Prompt API), so the phone run hides it, as a phone would.
  if (s.mobile) await ctx.addInitScript(() => { delete (window as { LanguageModel?: unknown }).LanguageModel })
  const page = await ctx.newPage()
  const shot = async (name: string) => { await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}/${name}-${s.tag}.png`, fullPage: true }); console.log(`${name}-${s.tag}.png`) }
  const click = (name: string | RegExp) => page.getByRole('button', { name }).first().click()

  await page.goto(URL)
  await page.getByText('Before you start').waitFor()
  await shot('01-landing')
  await click('I am 18 or older')
  await page.getByText('How should we read your report?').waitFor()
  await page.waitForFunction(() => !document.body.innerText.includes('Checking whether this device'))
  await shot('02-paths')
  await click('Mask my details')
  await shot('03-upload')
  await page.setInputFiles('input[type=file]', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a report') })
  await page.getByRole('alert').waitFor()
  await shot('03b-upload-error')
  await page.setInputFiles('input[type=file]', 'test-data/reports/r6-photo.jpg')
  await page.getByRole('heading', { name: 'Straighten the photo' }).waitFor()
  await page.waitForTimeout(800)
  await shot('04-crop')
  await click('Straighten')
  await page.getByRole('status').filter({ hasText: 'Looking for your details' }).waitFor().catch(() => {})
  await shot('04b-loading-ocr')
  await page.getByRole('heading', { name: 'Cover your personal details' }).waitFor({ timeout: 120_000 })
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
  await shot('06-confirm')
  await click(/^Send this image/)
  await page.waitForTimeout(400)
  await shot('06b-loading-reading')
  await page.getByRole('heading', { name: 'Check your results' }).waitFor({ timeout: 120_000 })
  await shot('07-review')
  await click('Approve and send these numbers')
  await page.waitForTimeout(400)
  await shot('07b-loading-explaining')
  await page.getByRole('heading', { name: 'Summary' }).waitFor({ timeout: 120_000 })
  await click('What does this test mean?')
  await page.getByTestId('meaning').waitFor({ timeout: 60_000 }).catch(() => {})
  await shot('08-explanation')
  if (await page.getByRole('button', { name: 'हिन्दी' }).isEnabled()) {
    await click('हिन्दी')
    await shot('09-explanation-hindi')
    await click('English')
  }
  if (!s.mobile) {
    await page.emulateMedia({ media: 'print' })
    await shot('10-print')
    await page.pdf({ path: `${OUT}/10-print-a4.pdf`, format: 'A4', printBackground: true })
    await page.emulateMedia({ media: 'screen' })
  }
  await ctx.close()
}
await browser.close()
