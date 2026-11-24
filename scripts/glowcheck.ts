// Measures text contrast against the real pixels behind it on the landing page's sections, where the glows sit.
// The static check (contrast.ts) cannot see blurred, drifting gradients, so this hides the text, captures the page at
// several moments of the drift, and compares each light text colour with the brightest pixel behind its box.
// Usage: npm run dev, then npx tsx scripts/glowcheck.ts (no Gemini, no network beyond localhost).
// To find which layer causes a failure, hide one with extra CSS: GC_CSS='.blobs{display:none!important}' npx tsx ...
import { chromium } from 'playwright'

const lum = ([r, g, b]: number[]) => { const f = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

const browser = await chromium.launch({ channel: 'chrome' })
let worst = Infinity, failures = 0
for (const [width, height] of [[1280, 860], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  await page.addInitScript('globalThis.__name = (f) => f') // tsx names inner functions with a helper the page lacks
  await page.goto('http://localhost:5173/')
  await page.locator('.land-light').waitFor()
  // Every element with its own text, on the glow (no fully opaque background between it and the section).
  const targets = await page.evaluate(() => {
    document.querySelectorAll<HTMLDetailsElement>('.land-light details').forEach((d) => { d.open = true }) // answers as read
    const out: { id: string; color: number[]; rects: number[][] }[] = []
    const opaque = (el: Element | null): boolean => {
      for (; el && !el.matches('.land-light, .land-footer, .land-head'); el = el.parentElement) {
        const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g)!.map(Number)
        if ((m[3] ?? 1) >= 0.99) return true
      }
      return false
    }
    // Any CSS colour (rgb(), color(srgb ...) from color-mix) as 0-255 RGB, by painting it.
    const px = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
    const rgb = (css: string) => { px.clearRect(0, 0, 1, 1); px.fillStyle = css; px.fillRect(0, 0, 1, 1); return [...px.getImageData(0, 0, 1, 1).data.slice(0, 3)] }
    document.querySelectorAll('.land-light *, .land-footer *, .land-top *').forEach((el) => {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())
      if (!own || opaque(el) || el.closest('mark, .cmp, .sr-only')) return // .sr-only is never drawn
      // Only the line boxes of the element's own text, so borders, corners and child chips are not counted.
      const rects: number[][] = []
      el.childNodes.forEach((n) => {
        if (n.nodeType !== 3 || !n.textContent!.trim()) return
        const range = document.createRange(); range.selectNodeContents(n)
        for (const r of range.getClientRects()) if (r.width >= 1 && r.height >= 1) rects.push([r.left, r.top + scrollY, r.width, r.height])
      })
      if (!rects.length) return
      out.push({ id: `${el.tagName.toLowerCase()}.${el.className || ''} "${el.textContent!.trim().slice(0, 40)}"`, color: rgb(getComputedStyle(el).color), rects })
    })
    return out
  })
  await page.addStyleTag({ content: (process.env.GC_CSS ?? '') + '.land-light, .land-light *, .land-footer *, .land-top * { color: transparent !important; text-decoration-color: transparent !important; caret-color: transparent !important; } .land-light :is(mark, code, kbd, svg) { visibility: hidden !important; } .land-light .fact-big { background: none !important; }' })
  const min = new Map<string, number>()
  for (let k = 0; k < 6; k++) {
    // Step every animation to a different moment of its cycle (durations differ, so the phases spread out).
    // Transitions (link colour fades and the like) are finished, so hidden text is fully hidden.
    await page.evaluate((t) => document.getAnimations().forEach((a) => { if (a instanceof CSSTransition) a.finish(); else { a.pause(); a.currentTime = t } }), k * 4000)
    const png = (await page.screenshot({ fullPage: true })).toString('base64')
    const res = await page.evaluate(async ({ png, targets }) => {
      const img = new Image(); img.src = `data:image/png;base64,${png}`; await img.decode()
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
      const g = c.getContext('2d')!; g.drawImage(img, 0, 0)
      return targets.map(({ rects }) => {
        let best = [0, 0, 0], bestSum = -1
        for (const [x, y, w, h] of rects) {
          const d = g.getImageData(Math.floor(x), Math.floor(y), Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h))).data
          for (let i = 0; i < d.length; i += 4) { const s = d[i] * 0.3 + d[i + 1] * 0.6 + d[i + 2] * 0.1; if (s > bestSum) { bestSum = s; best = [d[i], d[i + 1], d[i + 2]] } }
        }
        return best
      })
    }, { png, targets })
    targets.forEach((t, i) => {
      const tl = lum(t.color)
      if (tl < 0.2) return // dark text sits on its own light surface (covered by contrast.ts)
      const r = ratio(tl, lum(res[i]))
      min.set(t.id, Math.min(min.get(t.id) ?? Infinity, r))
    })
  }
  for (const [id, r] of min) {
    worst = Math.min(worst, r)
    if (r < (Number(process.env.GC_MIN) || 4.5)) { failures++; console.log(`${width}px ${r.toFixed(2)}:1 ${id}`) }
  }
  console.log(`${width}px: ${min.size} text elements checked, lowest ${Math.min(...min.values()).toFixed(2)}:1`)
  await page.close()
}
await browser.close()
if (failures) { console.log(`glowcheck: ${failures} below 4.5:1`); process.exit(1) }
console.log(`glowcheck ok: lowest ${worst.toFixed(2)}:1`)
