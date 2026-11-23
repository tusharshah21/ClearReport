// Text-layer cross-check against the Dr Lal PathLabs sample PDFs (skipped if they are not downloaded).
// Every hand-checked true value must verify; every altered value must be flagged as a mismatch.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { displayName } from '../src/canonical'
import { suggestMasks } from '../src/masks'
import { parseRow, rowsForModel } from '../src/textrows'
import { pageWords, pagesWithResults, toLines, verify, type Line, type Word } from '../src/textlayer'

const norm = (s: string) => displayName(s).toLowerCase().replace(/[^a-z0-9]/g, '')
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
  // Path 1 (text to the on-device model): no identity text may reach the model; every result row must.
  const rows = rowsForModel(raw.map((r) => r.words))
  const sent = rows.batches.map((b) => b.text).join('\n')
  for (const v of [gt.pii.patient_name, gt.pii.patient_id, gt.pii.phone, gt.pii.doctor_name].filter(Boolean))
    for (const w of String(v).split(/\s+/).filter((w) => /[a-z]/i.test(w) && w.replace(/\W/g, '').length >= 3)) assert.ok(!sent.toLowerCase().includes(w.toLowerCase().replace(/\W+$/, '')), `${id} Path 1 rows leak "${w}"`)
  assert.equal(rows.age, gt.pii.age, `${id} Path 1 local age`)
  assert.equal(rows.sex, gt.pii.sex, `${id} Path 1 local sex`)
  const missingRows = gt.tests.filter((t: { name: string }) => !sent.toLowerCase().includes(displayName(t.name).toLowerCase().split(/[ ,(]/)[0]))
  assert.deepEqual(missingRows.map((t: { name: string }) => t.name), [], `${id} Path 1 rows missing tests`)
  console.log(`textcheck: ${id} Path 1 sends ${rows.batches.length} batches, ${sent.split('\n').length} rows, ${rows.dropped_lines} identity lines dropped`)
  // Deterministic parser: every row it accepts must equal ground truth (same name, in order for repeated names).
  const all = sent.split('\n'), parsed = all.map(parseRow)
  const used = new Set<number>(), bad: string[] = []
  for (const p of parsed.filter((p) => p !== null)) {
    const k = gt.tests.findIndex((t: { name: string }, i: number) => !used.has(i) && norm(t.name) === norm(p.name))
    if (k < 0) { bad.push(`${p.name}: not in ground truth`); continue }
    used.add(k)
    const t = gt.tests[k]
    // Ground truth keeps a value hidden on the page (text layer only) as null; the parser reads the text, like the cross-check.
    for (const f of ['value', 'unit', 'ref_low', 'ref_high', 'ref_text', 'printed_flag'] as const)
      if (!(f === 'value' && t.value === null) && String(p[f]).replace('μ', 'µ') !== String(t[f]).replace('μ', 'µ')) bad.push(`${p.name} ${f}: ${p[f]} (want ${t[f]})`)
  }
  assert.deepEqual(bad, [], `${id} parser rows differ from ground truth`)
  console.log(`textcheck: ${id} parser reads ${parsed.filter(Boolean).length} of ${all.length} rows, ${all.length - parsed.filter(Boolean).length} go to the on-device model; lab_name "${rows.lab_name}"`)
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
