// Cross-browser and phone-width check of the live site (or APP_URL), Gemini blocked (route-abort).
// Chrome without built-in AI, Firefox and WebKit, at 1280 and 390 px: landing (no sideways scroll, phone menu,
// compare slider by mouse and by touch), /app (18+ notice, path cards with Private unavailable, the sample report,
// Mask it yourself up to "This exact image will be sent"). Screenshots of failures go to docs/overnight/.
// Usage: npx tsx scripts/xbrowser.ts   (needs npx playwright install firefox webkit)
import { chromium, firefox, webkit, type BrowserType, type Page } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.APP_URL ?? 'https://clearreport-717f3.web.app'
const OUT = 'docs/overnight'
mkdirSync(OUT, { recursive: true })
const engines: [string, BrowserType, object][] = [
  ['chrome', chromium, { channel: 'chrome', args: ['--disable-features=AIPromptAPI,AIPromptAPIMultimodalInput,OptimizationGuideOnDeviceModel'] }],
  ['firefox', firefox, {}],
  ['webkit', webkit, {}],
]
const rows: string[] = []
let gemini = 0, failures = 0

for (const [name, type, opts] of engines) {
  const browser = await type.launch(opts)
  for (const width of [1280, 390]) {
    const phone = width === 390
    const ctx = await browser.newContext({ viewport: { width, height: phone ? 844 : 860 }, hasTouch: phone, ...(phone && name !== 'firefox' ? { isMobile: true } : {}) })
    await ctx.route('**/*', async (r) => {
      const url = r.request().url()
      if (/(firebasevertexai|generativelanguage)\.googleapis\.com/.test(url)) { gemini++; return r.abort() }
      // The sample arrives 3 s late, so a path is always picked before it has loaded (the race a slow phone hits).
      if (url.includes('/samples/demo.pdf')) await new Promise((ok) => setTimeout(ok, 3000))
      return r.continue()
    })
    const page = await ctx.newPage()
    const errs: string[] = []
    page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)))
    page.on('console', (m) => m.type() === 'error' && errs.push(`console: ${m.text().slice(0, 140)}`))
    const tag = `${name}-${width}`
    const check = async (what: string, fn: (p: Page) => Promise<string | true>) => {
      let r: string | true
      try { r = await fn(page) } catch (e) { r = String(e).split('\n')[0].slice(0, 160) }
      if (r !== true) { failures++; await page.screenshot({ path: `${OUT}/x-${tag}-${what.replace(/\W+/g, '-')}.png` }).catch(() => {}) }
      rows.push(`| ${name} | ${width} | ${what} | ${r === true ? 'ok' : `**${r}**`} |`)
      console.log(`${tag} ${what}: ${r === true ? 'ok' : r}`)
    }
    const noSideways = async (p: Page) => { const [sw, iw] = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); return sw <= iw || `page is ${sw} px wide in a ${iw} px window` }

    await page.goto(BASE, { waitUntil: 'networkidle' })
    await check('landing: no sideways scroll', noSideways)
    if (phone) await check('landing: menu opens and Escape closes it', async (p) => {
      await p.locator('.menu-btn').click()
      if (!(await p.locator('#land-menu').isVisible())) return 'menu did not open'
      await p.keyboard.press('Escape')
      return (await p.locator('#land-menu').isHidden()) || 'Escape did not close the menu'
    })
    await check(`landing: compare slider by ${phone ? 'touch' : 'mouse'}`, async (p) => {
      const input = p.locator('.cmp input[type=range]')
      await input.scrollIntoViewIfNeeded()
      await p.waitForTimeout(2500) // let the intro animation finish
      const before = Number(await input.inputValue())
      const b = (await input.boundingBox())!
      const target = before > 50 ? 0.15 : 0.85
      if (phone) await p.touchscreen.tap(b.x + b.width * target, b.y + b.height / 2)
      else { await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await p.mouse.move(b.x + b.width * target, b.y + b.height / 2, { steps: 8 }); await p.mouse.up() }
      const after = Number(await input.inputValue())
      return Math.abs(after - before) >= 20 || `value ${before} -> ${after}`
    })

    await page.goto(`${BASE}/app?sample=demo`, { waitUntil: 'networkidle' })
    await check('/app: 18+ notice', async (p) => { await p.getByRole('button', { name: 'I am 18 or older' }).click(); return true })
    await check('/app: Private shown as not available, with the laptop note', async (p) => {
      await p.getByText('How should we read your report?').waitFor()
      const card = p.getByTestId('path1-unavailable')
      await card.waitFor({ timeout: 15_000 })
      const t = await card.textContent()
      return /Needs Chrome on a laptop/.test(t ?? '') || `card says: ${t?.slice(0, 80)}`
    })
    await check('/app: no sideways scroll on paths', noSideways)
    await check('/app: sample report, Mask my details, suggested boxes', async (p) => {
      await p.getByRole('button', { name: 'Mask my details' }).first().click()
      await p.getByRole('heading', { name: 'Cover your personal details' }).waitFor({ timeout: 60_000 })
      return /\d+ suggested box/.test((await p.getByTestId('suggested-note').textContent()) ?? '') || 'no suggested boxes'
    })
    await check('/app: no sideways scroll on mask', noSideways)
    await check('/app: up to "This exact image will be sent"', async (p) => {
      await p.getByRole('button', { name: 'Done masking' }).click()
      await p.getByRole('heading', { name: 'This exact image will be sent' }).waitFor({ timeout: 20_000 })
      return true
    })
    await check('no page errors', async () => (errs.filter((e) => !/firebasevertexai|generativelanguage|ERR_FAILED/.test(e)).length ? errs.join(' ; ') : true))
    await ctx.close()
  }
  await browser.close()
}
writeFileSync(`${OUT}/xbrowser.md`, `# Cross-browser check of ${BASE}\n\n| Browser | Width | Check | Result |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n\nGemini requests aborted: ${gemini}. Failures: ${failures}.\n`)
console.log(`failures ${failures}, gemini aborted ${gemini}`)
