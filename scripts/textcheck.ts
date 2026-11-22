// Text-layer cross-check against the Dr Lal PathLabs sample PDFs (skipped if they are not downloaded).
// Every hand-checked true value must verify; every altered value must be flagged as a mismatch.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { displayName } from '../src/canonical'
import { suggestMasks } from '../src/masks'
import { pageWords, pagesWithResults, toLines, verify, type Line, type Word } from '../src/textlayer'

const best = (rs: string[]) => (rs.includes('verified') ? 'verified' : rs.includes('mismatch') ? 'mismatch' : 'unverified')
for (const id of ['WM14', 'WM15']) {
  const pdf = `test-data/real-samples/${id}.pdf`
  if (!existsSync(pdf)) { console.log(`textcheck: ${pdf} not downloaded, skipped`); continue }
  const doc = await getDocument({ data: new Uint8Array(readFileSync(pdf)), verbosity: 0 }).promise
  const pages: Line[][] = []
  const raw: { words: Word[]; images: string[] }[] = []
  const gt = JSON.parse(readFileSync(`test-data/ground-truth/${id}.json`, 'utf-8'))
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const words = await pageWords(page)
    pages.push(toLines(words))
    const ops = await page.getOperatorList()
    raw.push({ words, images: ops.fnArray.flatMap((fn: number, k: number) => (fn === OPS.paintImageXObject ? [`${ops.argsArray[k][1]}x${ops.argsArray[k][2]}`] : [])) })
    // Mask suggestions: every identity field on every page (WM14 page 5 prints the referrer two rows off).
    // Ground truth keeps WM14's placeholder ID and the "SELF" referrer as null, so those are spelled out here.
    const boxes = suggestMasks(words)
    const covered = (field: string) => words.filter((w) => boxes.some((b) => b.field === field && w.x0 >= b.x && w.x1 <= b.x + b.w && w.y0 >= b.y && w.y1 <= b.y + b.h)).map((w) => w.text).join(' ')
    for (const [field, value] of [['name', gt.pii.patient_name], ['id', gt.pii.patient_id ?? 'XXXXXXXXX'], ['doctor', gt.pii.doctor_name ?? 'SELF'], ['sex', gt.pii.sex], ['age', gt.pii.age]])
      if (value) assert.ok(covered(field).toLowerCase().includes(String(value).split(/\s+/).at(-1)!.toLowerCase().slice(0, 4)), `${id} page ${p} ${field}: covered "${covered(field)}", want "${value}"`)
  }
  const results = pagesWithResults(raw)
  const seen: Record<string, number> = {}
  const sugg = { total: 0, right: 0, wrong: [] as string[] }
  for (const t of gt.tests) {
    const k = displayName(t.name).toLowerCase()
    const nth = (seen[k] = (seen[k] ?? -1) + 1)
    const check = (x: typeof t) => pages.map((l) => verify(x, l, nth))
    const ok = check(t)
    // Page skipping must never drop a page that holds a result.
    ok.forEach((r, p) => r.value === 'verified' && assert.ok(results[p], `${id} page ${p + 1} holds ${t.name} but would be skipped`))
    if (t.value !== null) assert.equal(best(ok.map((r) => r.value)), 'verified', `${id} ${t.name} ${t.value}`)
    // The "From your PDF's text" suggestion for a blanked value: the first number beside the name on the page that holds it.
    if (t.value !== null) { sugg.total++; const s = check({ ...t, value: null }).find((_, p) => ok[p].value === 'verified')?.pdf_value; if (s === t.value) sugg.right++; else sugg.wrong.push(`${t.name}: ${s} (want ${t.value})`) }
    if (t.ref_low !== null || t.ref_high !== null) assert.equal(best(ok.map((r) => r.range)), 'verified', `${id} ${t.name} range`)
    if (t.unit) assert.equal(best(ok.map((r) => r.unit)), 'verified', `${id} ${t.name} unit ${t.unit}`)
    assert.notEqual(best(check({ ...t, unit: null }).map((r) => r.unit)), 'verified', `${id} ${t.name} null unit must not verify`)
    // A guessed digit (like the watermark misreads) must not verify.
    if (t.value !== null) assert.notEqual(best(check({ ...t, value: t.value + 10 }).map((r) => r.value)), 'verified', `${id} ${t.name} altered`)
  }
  console.log(`textcheck: ${id} PDF-text suggestion right for ${sugg.right}/${sugg.total} values${sugg.wrong.length ? `; wrong: ${sugg.wrong.join('; ')}` : ''}`)
  assert.equal(sugg.right, sugg.total, `${id} PDF-text suggestions`)
  console.log(`textcheck: ${id} pages skipped as having no results: ${results.flatMap((r, p) => (r ? [] : [p + 1])).join(', ') || 'none'}`)
}
// A scanned page (big image of its own) in a digital PDF must still be read; a letterhead on every page is ignored.
const w = Array.from({ length: 25 }, (_, i) => ({ text: i ? 'note' : '12.5 mg/dL', x0: 0.1, x1: 0.2, y0: i * 0.03, y1: i * 0.03 + 0.01 }))
const prose = w.map((x) => ({ ...x, text: 'note' }))
assert.deepEqual(pagesWithResults([{ words: w, images: ['1240x1753'] }, { words: prose, images: ['1240x1753'] }]), [true, false])
assert.deepEqual(pagesWithResults([{ words: w, images: [] }, { words: prose, images: ['1240x1753'] }]), [true, true])
assert.deepEqual(pagesWithResults([{ words: prose, images: [] }, { words: [], images: [] }]), [false, true]) // no text layer: always read
console.log('textcheck ok')
