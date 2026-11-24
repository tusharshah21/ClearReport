// Privacy proof by interception: drives the real app, captures every request to the Gemini hosts BEFORE aborting it
// (so no AI call is ever made), and checks what would have left the device.
//   Path 2 (Mask it yourself) with r1.png, r6-photo.jpg and demo.pdf, keeping only the suggested boxes.
//   Path 1 (Read it privately) with demo.pdf in a browser with a stubbed on-device model, up to the explanation call.
// For each captured request: none of the ground-truth identity strings (names, IDs, phones, doctor names) appear
// in it, the parts are only text and images, and the explanation payload has only the allow-listed fields.
// Each image sent is decoded: every burned box is solid black, and OCR of the image finds no identity string that
// OCR can read on the same page unmasked (photos go through the default Straighten step first). When OCR cannot read
// the identity even unmasked, the image gets a WARN line and needs a look by eye: PROOF_SAVE=dir writes it out.
// Needs the dev server (npm run dev). Usage: npm run privacy-proof  (exit 1 on any leak)
import { chromium, type BrowserContext, type Page } from 'playwright'
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { createWorker } from 'tesseract.js'

const BASE = process.env.APP_URL ?? 'http://localhost:5173'
const GEMINI = /(^|\.)(firebasevertexai|generativelanguage)\.googleapis\.com$/
const PAYLOAD_KEYS = ['lab_name', 'age_band', 'sex', 'tests']
const TEST_KEYS = ['name', 'value', 'unit', 'lab_range', 'printed_flag', 'range_check', 'range_check_note']

type Pii = Record<string, string | null>
type Captured = { url: string; body: string }
type Burn = { cw: number; ch: number; x: number; y: number; w: number; h: number }
type Orig = { cw: number; ch: number; url: string }
const fails: string[] = []
const notes: string[] = []
const warns: string[] = []
const fail = (s: string) => { fails.push(s); console.log(`  LEAK/FAIL ${s}`) }
const ok = (s: string) => { notes.push(s); console.log(`  ok ${s}`) }

const pii = (id: string): Pii => JSON.parse(readFileSync(`test-data/ground-truth/${id}.json`, 'utf-8')).pii
// The app's own source text (prompts, labels). A synthetic name word that is also app text ("Example" in
// "Dr. Example Iyer" vs "for example" in the prompt) cannot be told apart, so only the other words are searched.
const APP_TEXT = readdirSync('src').map((f) => readFileSync(`src/${f}`, 'utf-8')).join('\n')
// What must never appear: each name word (3+ letters, not a title), each ID, each phone (last 10 digits).
function needles(p: Pii) {
  const words = [p.patient_name, p.doctor_name].flatMap((v) => String(v ?? '').split(/\s+/)).map((w) => w.replace(/\W/g, '')).filter((w) => w.length >= 3 && !/^(mr|mrs|ms|dr)$/i.test(w) && !new RegExp(`\\b${w}\\b`, 'i').test(APP_TEXT))
  return { words, ids: [p.patient_id].filter(Boolean) as string[], phones: [p.phone].filter(Boolean).map((v) => v!.replace(/\D/g, '').slice(-10)) }
}
function visible(text: string, p: Pii) {
  const n = needles(p)
  const low = text.toLowerCase(), digits = text.replace(/\D/g, '')
  return [...n.words.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(text)), ...n.ids.filter((v) => low.includes(v.toLowerCase())), ...n.phones.filter((v) => digits.includes(v))]
}
function scanText(text: string, p: Pii, where: string) {
  const hits = visible(text, p)
  if (hits.length) fail(`${where}: identity found: ${hits.join(', ')}`)
  return hits.length === 0
}

async function newContext(stubAI: boolean) {
  // Installed Chrome with its built-in AI switched off, so window.LanguageModel is absent unless the stub below adds it.
  const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-features=AIPromptAPI,AIPromptAPIMultimodalInput,OptimizationGuideOnDeviceModel'] })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  // A string, not a function: tsx wraps functions in a __name() helper that does not exist in the page.
  await ctx.addInitScript(`
    // Record every solid black rectangle drawn on a canvas that is not on screen (the burn-in in reencode()).
    // Also keep the page as it was just before its first box (the control image for OCR).
    window.__name = (f) => f // the helper tsx adds to functions passed to page.evaluate
    window.__burn = []; window.__orig = []
    const fr = CanvasRenderingContext2D.prototype.fillRect
    CanvasRenderingContext2D.prototype.fillRect = function (x, y, w, h) {
      if (!this.canvas.isConnected && String(this.fillStyle).toLowerCase() === '#000000') {
        if (!this.canvas.__seen) { this.canvas.__seen = true; window.__orig.push({ cw: this.canvas.width, ch: this.canvas.height, url: this.canvas.toDataURL('image/png') }) }
        window.__burn.push({ cw: this.canvas.width, ch: this.canvas.height, x, y, w, h })
      }
      return fr.call(this, x, y, w, h)
    }
    if (${stubAI}) {
      // A stand-in on-device model: always available, answers with an empty list (demo.pdf needs no model rows).
      const session = { prompt: async () => '{"tests":[]}', promptStreaming: () => new ReadableStream({ start(c) { c.enqueue('{"tests":[]}'); c.close() } }), measureInputUsage: async () => 1, inputQuota: 100000, inputUsage: 0, destroy() {}, clone: async () => session, addEventListener() {} }
      window.LanguageModel = { availability: async () => 'available', create: async () => session, params: async () => ({ defaultTopK: 3, maxTopK: 8, defaultTemperature: 1, maxTemperature: 2 }) }
    }
  `)
  const captured: Captured[] = []
  const others: Captured[] = []
  await ctx.route('**/*', (route) => {
    const r = route.request(), host = new URL(r.url()).host
    if (GEMINI.test(host)) { captured.push({ url: r.url(), body: r.postData() ?? '' }); return route.abort() }
    if (!host.startsWith('localhost') && r.postData()) others.push({ url: r.url(), body: r.postData()! })
    return route.continue()
  })
  return { browser, ctx, captured, others }
}

async function start(page: Page) {
  await page.goto(`${BASE}/app`)
  await page.getByRole('button', { name: 'I am 18 or older' }).click()
  await page.getByText('How should we read your report?').waitFor()
  await page.waitForFunction(() => !document.body.innerText.includes('Checking whether this device'))
}

// Strip image data out before scanning text, so random base64 digits are never read as a phone number.
function parts(body: string) {
  const j = JSON.parse(body) as { contents?: { parts?: Record<string, unknown>[] }[] }
  return (j.contents ?? []).flatMap((c) => c.parts ?? [])
}

async function checkImage(ctx: BrowserContext, b64: string, mime: string, burns: Burn[], origs: Orig[], p: Pii, where: string, worker: Awaited<ReturnType<typeof createWorker>>) {
  const page = await ctx.newPage()
  await page.goto(`${BASE}/favicon.svg`)
  const r = await page.evaluate(async ({ b64, mime, burns, origs }) => {
    // Scaled so the long side is 2000 px, as the app does before its own OCR (small text OCRs badly).
    const big = async (src: string) => {
      const b = await createImageBitmap(await (await fetch(src)).blob()), s = Math.max(1, 2000 / Math.max(b.width, b.height))
      const k = new OffscreenCanvas(Math.round(b.width * s), Math.round(b.height * s)); k.getContext('2d')!.drawImage(b, 0, 0, k.width, k.height)
      const u8 = new Uint8Array(await (await k.convertToBlob({ type: 'image/png' })).arrayBuffer())
      let bin = ''; for (let i = 0; i < u8.length; i += 32768) bin += String.fromCharCode(...u8.subarray(i, i + 32768))
      return btoa(bin)
    }
    const bmp = await createImageBitmap(await (await fetch(`data:${mime};base64,${b64}`)).blob())
    const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d')!
    g.drawImage(bmp, 0, 0)
    const mine = burns.filter((b) => b.cw === bmp.width && b.ch === bmp.height)
    const tol = mime === 'image/png' ? 0 : 40, inset = mime === 'image/png' ? 0 : 3
    let bad = 0, total = 0
    for (const b of mine) {
      const x0 = Math.ceil(b.x) + inset, y0 = Math.ceil(b.y) + inset, x1 = Math.floor(b.x + b.w) - inset, y1 = Math.floor(b.y + b.h) - inset
      if (x1 <= x0 || y1 <= y0) continue
      const d = g.getImageData(x0, y0, x1 - x0, y1 - y0).data
      for (let i = 0; i < d.length; i += 4) { total++; if (d[i] > tol || d[i + 1] > tol || d[i + 2] > tol) bad++ }
    }
    const orig = origs.find((o) => o.cw === bmp.width && o.ch === bmp.height)
    return { w: bmp.width, h: bmp.height, boxes: mine.length, total, bad, sentBig: await big(`data:${mime};base64,${b64}`), origBig: orig ? await big(orig.url) : null }
  }, { b64, mime, burns, origs })
  await page.close()
  if (!r.boxes) fail(`${where}: no burned boxes match the ${r.w}x${r.h} image sent`)
  else if (r.bad) fail(`${where}: ${r.bad} of ${r.total} pixels inside the ${r.boxes} boxes are not black`)
  else ok(`${where}: ${r.w}x${r.h} ${mime}, ${r.boxes} boxes, all ${r.total} pixels inside them solid black`)
  // Control first: what OCR can read on the same page before any box was burned. Then the exact image sent.
  const seen = r.origBig ? visible((await worker.recognize(Buffer.from(r.origBig, 'base64'))).data.text, p) : []
  const { data } = await worker.recognize(Buffer.from(r.sentBig, 'base64'))
  if (scanText(data.text, p, `${where} OCR of sent image`)) ok(`${where}: OCR reads ${seen.length ? seen.join(', ') : 'no identity string'} on the unmasked page, and none of it on the sent image (${data.text.split(/\s+/).length} words)`)
  if (!seen.length) { warns.push(`${where}: OCR cannot read the identity even on the unmasked page, so this image needs a look by eye (PROOF_SAVE=dir)`); console.log(`  WARN ${warns.at(-1)}`) }
}

async function path2(file: string, id: string, worker: Awaited<ReturnType<typeof createWorker>>) {
  console.log(`Path 2 ${file}`)
  const { browser, ctx, captured, others } = await newContext(false)
  const page = await ctx.newPage()
  await start(page)
  await page.getByRole('button', { name: 'Mask my details' }).click()
  await page.setInputFiles('input[type=file]', file)
  const crop = page.getByRole('heading', { name: 'Straighten the photo' }), mask = page.getByRole('heading', { name: 'Cover your personal details' })
  await Promise.race([crop.waitFor({ timeout: 180_000 }), mask.waitFor({ timeout: 180_000 })])
  if (await crop.isVisible()) { await page.waitForTimeout(800); await page.getByRole('button', { name: process.env.PROOF_ASIS ? 'Use the photo as it is' : 'Straighten' }).click() } // the primary action, as a user would
  await mask.waitFor({ timeout: 180_000 })
  const note = (await page.getByTestId('suggested-note').textContent().catch(() => '')) ?? ''
  ok(`${id}: ${note.match(/\d+ suggested box(es)?/)?.[0] ?? 'no suggested boxes'}, kept as they are`)
  await page.getByRole('button', { name: 'Done masking' }).click()
  await page.getByRole('heading', { name: /exact image/ }).waitFor()
  await page.getByRole('button', { name: /^Send this image/ }).click()
  await page.waitForFunction(() => /could not read your report/i.test(document.body.innerText), null, { timeout: 120_000 }).catch(() => {})
  const burns = (await page.evaluate(() => (window as unknown as { __burn: Burn[] }).__burn)) as Burn[]
  const origs = (await page.evaluate(() => (window as unknown as { __orig: Orig[] }).__orig)) as Orig[]
  if (!captured.length) fail(`${id}: no request to Gemini was captured (the send did not happen)`)
  const p = pii(id)
  for (const [k, c] of captured.entries()) {
    const ps = parts(c.body)
    const extra = ps.flatMap((x) => Object.keys(x)).filter((k) => k !== 'text' && k !== 'inlineData')
    if (extra.length) fail(`${id} request ${k + 1}: unexpected part fields ${extra.join(', ')}`)
    scanText(ps.filter((x) => x.text).map((x) => x.text).join('\n'), p, `${id} request ${k + 1} text`)
    const imgs = ps.filter((x) => x.inlineData) as { inlineData: { mimeType: string; data: string } }[]
    // PROOF_SAVE=dir also writes each image sent, to look at by eye (synthetic reports only).
    if (k === 0 && process.env.PROOF_SAVE) imgs.forEach((im, j) => writeFileSync(`${process.env.PROOF_SAVE}/${id}-sent-${j + 1}.${im.inlineData.mimeType.split('/')[1]}`, Buffer.from(im.inlineData.data, 'base64')))
    if (k === 0) for (const im of imgs) await checkImage(ctx, im.inlineData.data, im.inlineData.mimeType, burns, origs, p, `${id} request 1 image`, worker)
  }
  if (captured.length) ok(`${id}: ${captured.length} Gemini request(s) captured and aborted; text parts carry no identity`)
  for (const o of others) scanText(o.body, p, `${id} other request ${new URL(o.url).host}`)
  await browser.close()
}

async function path1(file: string, id: string) {
  console.log(`Path 1 ${file} (stubbed on-device model)`)
  const { browser, ctx, captured, others } = await newContext(true)
  const page = await ctx.newPage()
  await start(page)
  await page.getByRole('button', { name: 'Read it privately' }).click()
  await page.setInputFiles('input[type=file]', file)
  await page.getByRole('heading', { name: 'Check your results' }).waitFor({ timeout: 120_000 })
  if (captured.length) fail(`${id}: Path 1 sent ${captured.length} request(s) to Gemini before Approve`)
  else ok(`${id}: no request to Gemini while reading (the PDF was read on this device)`)
  await page.getByRole('button', { name: 'Approve and send these numbers' }).click()
  await page.waitForFunction(() => /What your report says|explained|summary/i.test(document.body.innerText) && !/Explaining/i.test(document.body.innerText), null, { timeout: 120_000 }).catch(() => {})
  await page.waitForTimeout(1500)
  if (!captured.length) fail(`${id}: no explanation request was captured`)
  const p = pii(id)
  for (const [k, c] of captured.entries()) {
    const ps = parts(c.body)
    if (ps.some((x) => x.inlineData)) fail(`${id} explanation request ${k + 1}: contains an image`)
    scanText(c.body, p, `${id} explanation request ${k + 1}`)
    const json = ps.map((x) => { try { return JSON.parse(String(x.text)) } catch { return null } }).find((j) => j && typeof j === 'object' && 'tests' in j)
    if (!json) { fail(`${id} explanation request ${k + 1}: no JSON payload part`); continue }
    const bad = Object.keys(json).filter((x) => !PAYLOAD_KEYS.includes(x))
    const badT = [...new Set((json.tests as Record<string, unknown>[]).flatMap((t) => Object.keys(t)).filter((x) => !TEST_KEYS.includes(x)))]
    if (bad.length || badT.length) fail(`${id} explanation request ${k + 1}: fields outside the allow-list: ${[...bad, ...badT].join(', ')}`)
    else ok(`${id} explanation request ${k + 1}: only ${PAYLOAD_KEYS.join(', ')}; tests carry only ${TEST_KEYS.join(', ')} (${json.tests.length} tests, age_band ${json.age_band}, sex ${json.sex})`)
  }
  for (const o of others) scanText(o.body, p, `${id} other request ${new URL(o.url).host}`)
  await browser.close()
}

const worker = await createWorker('eng', 1, { langPath: 'node_modules/@tesseract.js-data/eng/4.0.0_best_int', gzip: true })
try {
  await path2('test-data/reports/r1.png', 'r1', worker)
  await path2('test-data/reports/r6-photo.jpg', 'r6-photo', worker)
  await path2('test-data/reports/demo.pdf', 'demo', worker)
  await path1('test-data/reports/demo.pdf', 'demo')
} finally {
  await worker.terminate()
}
mkdirSync('docs/overnight', { recursive: true })
writeFileSync('docs/overnight/privacy-proof.txt', [...notes.map((n) => `ok ${n}`), ...warns.map((w) => `WARN ${w}`), ...fails.map((f) => `FAIL ${f}`)].join('\n') + '\n')
console.log(fails.length ? `privacy-proof FAILED: ${fails.length} problem(s)` : `privacy-proof ok: ${notes.length} checks`)
process.exit(fails.length ? 1 : 0)
