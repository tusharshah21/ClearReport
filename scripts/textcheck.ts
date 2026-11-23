// Text-layer cross-check against the Dr Lal PathLabs sample PDFs (skipped if they are not downloaded).
// Every hand-checked true value must verify; every altered value must be flagged as a mismatch.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { canonical, displayName } from '../src/canonical'
import { suggestMasks } from '../src/masks'
import { contextBlocks, MAX_BLOCK, parseRow, rowsForModel } from '../src/textrows'
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

// Other layouts (synthetic text PDFs from test-data/generate-pdf.ts): the parser reads every row and matches ground
// truth, every row verifies against the PDF text, local age/sex are right, and no identity word is sent.
{
  const { trustOf } = await import('../src/trust')
  for (const id of ['p1', 'p2', 'p3', 'demo']) {
    const doc = await getDocument({ data: new Uint8Array(readFileSync(`test-data/reports/${id}.pdf`)), verbosity: 0 }).promise
    const pages: Word[][] = []
    for (let p = 1; p <= doc.numPages; p++) pages.push(await pageWords(await doc.getPage(p)))
    const gt = JSON.parse(readFileSync(`test-data/ground-truth/${id}.json`, 'utf-8'))
    const rows = rowsForModel(pages)
    const sent = rows.batches.map((b) => b.text).join('\n')
    for (const v of [gt.pii.patient_name, gt.pii.patient_id, gt.pii.phone, gt.pii.doctor_name])
      for (const w of String(v).split(/\s+/).filter((w) => /[a-z]/i.test(w) && w.replace(/\W/g, '').length >= 3)) assert.ok(!sent.toLowerCase().includes(w.toLowerCase().replace(/\W+$/, '')), `${id} rows leak "${w}"`)
    assert.equal(rows.age, gt.pii.age, `${id} local age`)
    assert.equal(rows.sex?.[0], gt.pii.sex[0], `${id} local sex`)
    assert.equal(rows.lab_name, gt.lab_name, `${id} lab name`)
    const got = sent.split('\n').map((r) => parseRow(r, rows.sex))
    assert.ok(got.every(Boolean), `${id}: every row parsed`)
    const tests = got.map((t) => ({ ...t!, page: 0 }))
    const mu = (u: unknown) => (typeof u === 'string' ? u.replace('μ', 'µ') : u)
    assert.deepEqual(tests.map((t) => [canonical(t.name), t.value, mu(t.unit), t.ref_low, t.ref_high, t.printed_flag]), gt.tests.map((t: Record<string, unknown>) => [canonical(t.name as string), t.value, mu(t.unit), t.ref_low, t.ref_high, t.printed_flag]), `${id} parsed rows`)
    assert.deepEqual(trustOf(tests, pages).map((t) => t.badge), tests.map(() => 'verified'), `${id} cross-check`)
    assert.notEqual(trustOf([{ ...tests[0], value: tests[0].value + 10 }], pages)[0].badge, 'verified', `${id} altered value must not verify`)
    console.log(`textcheck: ${id} parser reads ${tests.length} of ${tests.length} rows, all verified; lab_name "${rows.lab_name}"`)
  }
}
// On-device fallback context (contextBlocks): where the parser fails, the model gets the unread rows with their
// neighbouring lines. No identity word may be in any block; reports the parser reads fully make no blocks at all.
{
  const { trustOf } = await import('../src/trust')
  const load = async (pdf: string) => {
    const doc = await getDocument({ data: new Uint8Array(readFileSync(pdf)), verbosity: 0 }).promise
    const pages: Word[][] = []
    for (let p = 1; p <= doc.numPages; p++) pages.push(await pageWords(await doc.getPage(p)))
    return pages
  }
  const leaks = (id: string, text: string, pii: Record<string, unknown>) => {
    for (const v of [pii.patient_name, pii.patient_id, pii.phone, pii.doctor_name].filter(Boolean))
      for (const w of String(v).split(/\s+/).filter((w) => /[a-z]/i.test(w) && w.replace(/\W/g, '').length >= 3)) assert.ok(!text.toLowerCase().includes(w.toLowerCase().replace(/\W+$/, '')), `${id} block leaks "${w}"`)
    assert.ok(!/\+?91[ -]?\d{5}/.test(text), `${id} block leaks a phone number`)
  }
  const reports = ['p1', 'p2', 'p3', 'demo', 'demo-unfamiliar'].map((id) => [id, `test-data/reports/${id}.pdf`])
  for (const id of ['WM14', 'WM15']) if (existsSync(`test-data/real-samples/${id}.pdf`)) reports.push([id, `test-data/real-samples/${id}.pdf`])
  for (const [id, pdf] of reports) {
    const pages = await load(pdf)
    const gt = JSON.parse(readFileSync(`test-data/ground-truth/${id}.json`, 'utf-8'))
    const rows = rowsForModel(pages)
    for (const parser of [true, false]) {
      const blocks = contextBlocks(rows.lines, (r) => !parser || !parseRow(r, rows.sex))
      if (parser && id !== 'demo-unfamiliar') assert.equal(blocks.length, 0, `${id}: the parser reads every row, so no model call`)
      assert.ok(blocks.every((b) => b.lines.length <= MAX_BLOCK), `${id}: block size`)
      leaks(`${id}${parser ? '' : ' (parser off)'}`, blocks.map((b) => b.lines.join('\n')).join('\n'), gt.pii)
    }
    if (id !== 'demo-unfamiliar') continue
    // The card layout: each test's name, value line and "Expected:" range line all reach the model.
    const blocks = contextBlocks(rows.lines, (r) => !parseRow(r, rows.sex))
    const sent = blocks.map((b) => b.lines.join('\n')).join('\n')
    for (const t of gt.tests) {
      assert.ok(sent.includes(t.name), `demo-unfamiliar block has the name ${t.name}`)
      assert.ok(sent.includes(`Expected: ${t.ref_text}`), `demo-unfamiliar block has the range of ${t.name}`)
      assert.ok(sent.replace(/,/g, '').includes(`${t.value} ${t.unit}`.replace('µ', 'μ')), `demo-unfamiliar block has the value of ${t.name}`)
    }
    // Part A: on a PDF with a text layer no row is ever neutral. The Prompt 13 reads (invented names, values under
    // the wrong tests) and even the correct rows (the value is not on the name's line here) all ask to be checked.
    const bad = [{ name: 'legible', value: 12.6, unit: 'g/dL', ref_low: null, ref_high: null }, { name: 'Total WBC Count', value: 2.4, unit: 'lakhs/cumm', ref_low: null, ref_high: null }, { name: 'Fasting Glucose', value: 7600, unit: '/cumm', ref_low: null, ref_high: null }]
    assert.deepEqual(trustOf(bad, pages).map((t) => t.badge), ['check', 'check', 'check'], 'demo-unfamiliar: wrong reads ask to be checked')
    assert.ok(trustOf(gt.tests, pages).every((t) => t.badge === 'check'), 'demo-unfamiliar: no row is neutral or verified on this layout')
    assert.deepEqual(trustOf([{ name: 'legible', value: 12.6, ref_low: null, ref_high: null }], [null]).map((t) => t.badge), ['image'], 'a page with no text layer stays "Read from image"')
    console.log(`textcheck: demo-unfamiliar fallback sends ${blocks.length} block(s) of ${blocks.map((b) => b.lines.length).join(', ')} lines, with every name, value and range; no row is neutral`)
  }
}
console.log('textcheck ok')
