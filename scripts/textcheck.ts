// Text-layer cross-check against the Dr Lal PathLabs sample PDFs (skipped if they are not downloaded).
// Every hand-checked true value must verify; every altered value must be flagged as a mismatch.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { displayName } from '../src/canonical'
import { pageWords, toLines, verify, type Line } from '../src/textlayer'

const best = (rs: string[]) => (rs.includes('verified') ? 'verified' : rs.includes('mismatch') ? 'mismatch' : 'unverified')
for (const id of ['WM14', 'WM15']) {
  const pdf = `test-data/real-samples/${id}.pdf`
  if (!existsSync(pdf)) { console.log(`textcheck: ${pdf} not downloaded, skipped`); continue }
  const doc = await getDocument({ data: new Uint8Array(readFileSync(pdf)), verbosity: 0 }).promise
  const pages: Line[][] = []
  for (let p = 1; p <= doc.numPages; p++) pages.push(toLines(await pageWords(await doc.getPage(p))))
  const seen: Record<string, number> = {}
  for (const t of JSON.parse(readFileSync(`test-data/ground-truth/${id}.json`, 'utf-8')).tests) {
    const k = displayName(t.name).toLowerCase()
    const nth = (seen[k] = (seen[k] ?? -1) + 1)
    const check = (x: typeof t) => pages.map((l) => verify(x, l, nth))
    const ok = check(t)
    if (t.value !== null) assert.equal(best(ok.map((r) => r.value)), 'verified', `${id} ${t.name} ${t.value}`)
    if (t.ref_low !== null || t.ref_high !== null) assert.equal(best(ok.map((r) => r.range)), 'verified', `${id} ${t.name} range`)
    if (t.unit) assert.equal(best(ok.map((r) => r.unit)), 'verified', `${id} ${t.name} unit ${t.unit}`)
    assert.notEqual(best(check({ ...t, unit: null }).map((r) => r.unit)), 'verified', `${id} ${t.name} null unit must not verify`)
    // A guessed digit (like the watermark misreads) must not verify.
    if (t.value !== null) assert.notEqual(best(check({ ...t, value: t.value + 10 }).map((r) => r.value)), 'verified', `${id} ${t.name} altered`)
  }
}
console.log('textcheck ok')
