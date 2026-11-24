// Edge-case files (test-data/edge, from test-data/edge-gen.ts) through the real app, Gemini blocked (route-abort).
// Path 1 runs with a stand-in on-device model that answers with no tests, so anything Path 1 shows came from plain
// code; Path 2 runs without built-in AI and stops at the mask screen (the cloud read is never reached or is aborted).
// Prints, per file and path: where the app ended up, what it said, time taken and JS heap. Needs the dev server.
// Usage: npx tsx scripts/edge.ts [file ...]   Writes docs/overnight/edge.md
import { chromium, type Page } from 'playwright'
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs'

const BASE = process.env.APP_URL ?? 'http://localhost:5173'
const DIR = 'test-data/edge'
const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(DIR).sort()
const UPLOAD = ['Add the PDF from your lab', 'Add a photo or PDF of your report']
const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-features=AIPromptAPI,AIPromptAPIMultimodalInput,OptimizationGuideOnDeviceModel'] })
let gemini = 0

async function settle(page: Page, ms = 150_000) {
  const t0 = Date.now()
  for (;;) {
    const s = await page.evaluate(() => {
      const h = document.querySelector('#main section h2, #main section h1')?.textContent ?? ''
      const busy = !!document.querySelector('#main .spinner')
      const notes = [...document.querySelectorAll('#main .notice, #main [role=alert], #main .error, #main details p')].map((e) => e.textContent!.trim()).filter(Boolean)
      return { h, busy, notes }
    })
    const upload = s.h && ['Add the PDF from your lab', 'Add a photo or PDF of your report'].includes(s.h)
    if (!s.busy && s.h && (!upload || s.notes.some((n) => /could not|can't|not|only|password|supported/i.test(n)))) return { ...s, ms: Date.now() - t0 }
    if (Date.now() - t0 > ms) return { ...s, ms: Date.now() - t0, timeout: true }
    await page.waitForTimeout(400)
  }
}

async function run(file: string, path: 1 | 2) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await ctx.route('**/*', (r) => (/(firebasevertexai|generativelanguage)\.googleapis\.com/.test(r.request().url()) ? (gemini++, r.abort()) : r.continue()))
  if (path === 1) await ctx.addInitScript(`
    const session = { prompt: async () => '{"tests":[]}', promptStreaming: () => new ReadableStream({ start(c) { c.enqueue('{"tests":[]}'); c.close() } }), measureInputUsage: async () => 1, inputQuota: 100000, inputUsage: 0, destroy() {}, clone: async () => session, addEventListener() {} }
    window.LanguageModel = { availability: async () => 'available', create: async () => session, params: async () => ({ defaultTopK: 3, maxTopK: 8, defaultTemperature: 1, maxTemperature: 2 }) }`)
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))
  await page.goto(`${BASE}/app`)
  await page.getByRole('button', { name: 'I am 18 or older' }).click()
  await page.waitForFunction(() => !document.body.innerText.includes('Checking whether this device'))
  await page.getByRole('button', { name: path === 1 ? 'Read it privately' : 'Mask my details' }).first().click()
  await page.setInputFiles('input[type=file]', `${DIR}/${file}`)
  let s = await settle(page)
  let total = s.ms
  if (s.h === 'Straighten the photo') {
    const t1 = Date.now()
    await page.getByRole('button', { name: 'Straighten' }).click()
    await page.getByRole('heading', { name: 'Straighten the photo' }).waitFor({ state: 'detached', timeout: 150_000 })
    s = await settle(page); total += Date.now() - t1
  }
  const rows = s.h === 'Check your results' ? await page.locator('table.results tbody tr td:first-child').allTextContents() : []
  const heap = await page.evaluate(() => Math.round(((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1e6))
  await ctx.close()
  return { file, path, screen: s.h, notes: s.notes, rows, ms: total, heap, timeout: !!(s as { timeout?: boolean }).timeout, errors }
}

const out: string[] = ['| File | Path | Ends on | What it says | Rows | Time | Heap MB |', '| --- | --- | --- | --- | --- | --- | --- |']
for (const f of files) {
  const pdf = f.endsWith('.pdf')
  for (const p of (pdf ? [1, 2] : [2]) as (1 | 2)[]) {
    const r = await run(f, p)
    const said = [...new Set(r.notes)].join(' / ').replace(/\|/g, '/').slice(0, 300)
    console.log(`${f} path ${p}: ${r.screen}${r.timeout ? ' (TIMEOUT)' : ''} | ${said} | rows ${r.rows.join(', ')} | ${r.ms} ms | ${r.heap} MB${r.errors.length ? ` | page errors: ${r.errors.join(' ; ')}` : ''}`)
    out.push(`| ${f} | ${p} | ${r.screen}${r.timeout ? ' (timeout)' : ''} | ${said} | ${r.rows.join(', ') || '-'} | ${(r.ms / 1000).toFixed(1)} s | ${r.heap} |`)
  }
}
await browser.close()
mkdirSync('docs/overnight', { recursive: true })
writeFileSync('docs/overnight/edge.md', `# Edge cases (Gemini blocked; Path 1 with a stand-in model that returns no tests)\n\n${out.join('\n')}\n\nGemini requests attempted and aborted: ${gemini}\n`)
console.log(`gemini requests aborted: ${gemini}`)
