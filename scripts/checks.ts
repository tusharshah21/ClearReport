// Plain assert checks for the no-AI code paths. Run: npm test
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { canonical, displayName } from '../src/canonical'
import { ageBand, toPayload } from '../src/privacy'
import { normalize } from '../src/units'
import { apply, homography } from '../src/crop'
import { BANNED, checkAll, checkTest, farOutOfRange } from '../src/guidelines'
import type { Test } from '../src/privacy'
import { trustOf } from '../src/trust'

// Every ground-truth name resolves to a known key, and no report has two tests with the same key.
for (const f of readdirSync('test-data/ground-truth')) {
  const keys = JSON.parse(readFileSync(`test-data/ground-truth/${f}`, 'utf-8')).tests.map((t: { name: string }) => canonical(t.name))
  assert.ok(keys.every((k: string) => !k.startsWith('?')), `${f}: unknown name ${keys.find((k: string) => k.startsWith('?'))}`)
  // Synthetic reports have one row per test. Real ones can repeat a name (WM15: Neutrophils as % and as a count).
  if (f.startsWith('r')) assert.equal(new Set(keys).size, keys.length, `${f}: duplicate canonical keys`)
}
// Spelling variants and names a model is likely to emit instead of the printed one.
const same: [string, string][] = [
  ['Haemoglobin', 'Hemoglobin'], ['Hb', 'Haemoglobin'], ['TSH (Ultrasensitive)', 'Thyroid Stimulating Hormone'],
  ['PCV (Haematocrit)', 'Hematocrit'], ['HbA1c (Glycosylated Haemoglobin)', 'Glycated Hemoglobin (HbA1c)'],
  ['Glucose Fasting (FBS)', 'Fasting Blood Sugar'], ['Total WBC Count', 'Total Leucocyte Count (TLC)'],
  ['LDL Cholesterol', 'LDL-C'], ['Total Cholesterol / HDL Ratio', 'TC/HDL Ratio'],
]
same.push(['Differential Leucocyte Count (DLC)\n(VCS Technology)\nLymphocytes', 'Lymphocytes'], ['Absolute Leucocyte Count\n(Calculated)\nBasophils', 'Basophils'], ['Creatinine\n(Compensated Jaffes reaction, IDMS traceable)', 'Creatinine'])
for (const [a, b] of same) assert.equal(canonical(a), canonical(b), `${a} vs ${b}`)
// Near-misses that must NOT match (the old substring matcher got the first one wrong).
const different: [string, string][] = [['LDL Cholesterol', 'VLDL Cholesterol'], ['HDL Cholesterol', 'LDL Cholesterol'], ['MCH', 'MCHC'], ['Total T3', 'Total T4']]
for (const [a, b] of different) assert.notEqual(canonical(a), canonical(b), `${a} vs ${b}`)

// PII stripping: every ground truth, fed through as if the model extracted it perfectly.
for (const f of readdirSync('test-data/ground-truth')) {
  const gt = JSON.parse(readFileSync(`test-data/ground-truth/${f}`, 'utf-8'))
  const { payload, findings } = toPayload(gt)
  const sent = JSON.stringify(payload)
  assert.deepEqual(Object.keys(payload), ['lab_name', 'age_band', 'sex', 'tests'], f)
  for (const [k, v] of Object.entries(gt.pii as Record<string, string>)) if (v && !['age', 'sex'].includes(k)) assert.ok(!sent.includes(v), `${f}: leaked ${v}`)
  assert.deepEqual(findings, [], `${f}: false positives ${JSON.stringify(findings)}`) // clean reports must not trip the scan
  assert.equal(payload.tests.length, gt.tests.length)
  assert.deepEqual(payload.tests.map((t) => t.value), gt.tests.map((t: { value: number }) => t.value), `${f}: values changed`)
}
// Leftovers the model put in the wrong field are caught.
const leaky = {
  lab_name: 'City Lab, call 98765 43210',
  pii: { patient_name: 'Mr. Aarav Testpatient', age: '34 Yrs', sex: 'M', patient_id: null, phone: null, doctor_name: null },
  tests: [
    { name: 'Haemoglobin (Aarav Testpatient)', value: 13, unit: 'g/dL', ref_low: 13, ref_high: 17, ref_text: '13 - 17', printed_flag: null },
    { name: 'Total WBC Count', value: 9876543210, unit: '/cumm', ref_low: 4000, ref_high: 10000, ref_text: '4000-10000', printed_flag: 'H' },
    { name: 'TSH', value: 2.1, unit: 'µIU/mL', ref_low: null, ref_high: null, ref_text: 'UHID SPL/FAKE/2024/0772 a@b.in 1234 5678 9012', printed_flag: 'x' },
    { name: 'HbA1c', value: 190000, unit: '10^3/uL', ref_low: null, ref_high: null, ref_text: 'mill/cumm', printed_flag: 'L' },
  ],
}
const { payload: p, findings: fs } = toPayload(leaky)
const out = JSON.stringify(p)
for (const bad of ['98765', 'Aarav', 'Testpatient', 'SPL/FAKE', 'a@b.in', '1234 5678 9012', '9876543210']) assert.ok(!out.includes(bad), `leaked ${bad}`)
assert.deepEqual([...new Set(fs.map((x) => x.kind))].sort(), ['aadhaar-like 12-digit number', 'email', 'extracted patient_name', 'long ID string', 'phone number'])
assert.equal(p.tests[1].value, null) // a phone number in a value field is dropped
assert.equal(p.tests[1].ref_text, '4000-10000') // ranges are not IDs
assert.equal(p.tests[3].value, 190000) // ordinary large values survive
assert.equal(p.tests[3].unit, '10^3/uL')
assert.equal(p.tests[2].printed_flag, null)
assert.deepEqual([p.age_band, p.sex], ['30-39', 'Male'])
assert.deepEqual([ageBand('9 months'), ageBand(90), ageBand('45Y'), ageBand(null)], ['0-9', '90+', '40-49', null])

// Units: every ground-truth unit is recognized, and each conversion gives the expected canonical number.
for (const f of readdirSync('test-data/ground-truth')) {
  if (f.startsWith('r')) for (const t of JSON.parse(readFileSync(`test-data/ground-truth/${f}`, 'utf-8')).tests) assert.notEqual(normalize(t).status, 'unit not recognized', `${f}: ${t.name} [${t.unit}]`)
}
const conv = (name: string, unit: string | null, value: number, low: number | null = null, high: number | null = null) => {
  const n = normalize({ name, unit, value, ref_low: low, ref_high: high })
  return [n.status, n.unit, n.value, n.ref_low, n.ref_high]
}
const cases: [Parameters<typeof conv>, unknown[]][] = [
  // platelets: lakhs, thousands, cells
  [['Platelet Count', 'lakhs/cumm', 2.6, 1.5, 4.1], ['ok', '/µL', 260000, 150000, 410000]],
  [['Platelet Count', 'Lacs/cu mm', 2.6], ['ok', '/µL', 260000, null, null]],
  [['Platelets', 'thou/uL', 260, 150, 410], ['ok', '/µL', 260000, 150000, 410000]],
  [['Platelets', '10^3/µL', 260], ['ok', '/µL', 260000, null, null]],
  [['Platelets', 'x10³/µL'.replace('³', '^3'), 260], ['ok', '/µL', 260000, null, null]],
  [['Platelets', '10^9/L', 260], ['ok', '/µL', 260000, null, null]],
  [['Platelets', '/cumm', 260000, 150000, 410000], ['ok', '/µL', 260000, 150000, 410000]],
  // WBC
  [['Total WBC Count', '/cumm', 11200, 4000, 10000], ['ok', '/µL', 11200, 4000, 10000]],
  [['TLC', 'cells/cu.mm', 11200], ['ok', '/µL', 11200, null, null]],
  [['WBC', 'thou/uL', 11.2, 4, 10], ['ok', '/µL', 11200, 4000, 10000]],
  [['WBC', '10^3/uL', 11.2], ['ok', '/µL', 11200, null, null]],
  [['WBC', '10^9/L', 11.2], ['ok', '/µL', 11200, null, null]],
  // RBC
  [['Total RBC Count', 'mill/cumm', 4.2, 4.5, 5.5], ['ok', 'million/µL', 4.2, 4.5, 5.5]],
  [['RBC', '10^12/L', 4.2], ['ok', 'million/µL', 4.2, null, null]],
  // hemoglobin, PCV, MCHC
  [['Hemoglobin', 'gm/dL', 11.8, 13, 17], ['ok', 'g/dL', 11.8, 13, 17]],
  [['Hemoglobin', 'g/L', 118, 130, 170], ['ok', 'g/dL', 11.8, 13, 17]],
  [['PCV', 'L/L', 0.385], ['ok', '%', 38.5, null, null]],
  [['MCHC', 'g/L', 307], ['ok', 'g/dL', 30.7, null, null]],
  // glucose and lipids in mmol/L
  [['Fasting Blood Sugar', 'mg/dL', 104, 70, 110], ['ok', 'mg/dL', 104, 70, 110]],
  [['Fasting Blood Sugar', 'mmol/L', 5.8, 3.9, 6.1], ['ok', 'mg/dL', 104.4928, 70.2624, 109.8976]],
  [['Estimated Average Glucose', 'mmol/L', 7], ['ok', 'mg/dL', 126.112, null, null]],
  [['Total Cholesterol', 'mmol/L', 5.17], ['ok', 'mg/dL', 199.9239, null, null]],
  [['LDL Cholesterol', 'mmol/L', 2.59], ['ok', 'mg/dL', 100.1553, null, null]],
  [['HDL Cholesterol', 'mmol/L', 1.03], ['ok', 'mg/dL', 39.8301, null, null]],
  [['VLDL', 'mmol/L', 0.78], ['ok', 'mg/dL', 30.1626, null, null]],
  [['Triglycerides', 'mmol/L', 1.69], ['ok', 'mg/dL', 149.6833, null, null]],
  // HbA1c IFCC -> NGSP: 48 mmol/mol is 6.5%
  [['HbA1c', 'mmol/mol', 48], ['ok', '%', 6.54304, null, null]],
  [['HbA1c', '%', 6.1, 4, 5.6], ['ok', '%', 6.1, 4, 5.6]],
  // thyroid
  [['TSH', 'mIU/L', 2.1, 0.35, 5.5], ['ok', 'µIU/mL', 2.1, 0.35, 5.5]],
  [['TSH', 'μIU/mL', 2.1], ['ok', 'µIU/mL', 2.1, null, null]],
  [['Total T3', 'ng/mL', 1.2], ['ok', 'ng/dL', 120, null, null]],
  [['Total T4', 'mcg/dL', 8.1], ['ok', 'µg/dL', 8.1, null, null]],
  // never guess
  [['Platelet Count', 'lakhs/L', 2.6, 1.5, 4.1], ['unit not recognized', 'lakhs/L', 2.6, 1.5, 4.1]],
  [['Fasting Blood Sugar', null, 104], ['unit not recognized', null, 104, null, null]],
  [['Vitamin D', 'ng/mL', 21], ['unknown test', null, 21, null, null]],
]
for (const [args, want] of cases) assert.deepEqual(conv(...args), want, `${args[0]} [${args[1]}]`)

// Range checks. r2: fasting glucose 104 with a printed range of 70-110.
const gtOf = (id: string) => JSON.parse(readFileSync(`test-data/ground-truth/${id}.json`, 'utf-8'))
const checksOf = (id: string) => checkAll(toPayload(gtOf(id)).payload)
const glu = checksOf('r2').find((c) => c.key === 'fasting_glucose')!
assert.equal(glu.lab, 'normal')
assert.equal(glu.outcome, 'lab says normal, guideline says borderline or high/low')
assert.match(glu.message, /Your lab's range for fasting glucose is 70 - 110.*A widely used guideline \(ADA\) uses 100-125 mg\/dL as one of the criteria doctors consider for prediabetes, usually confirmed with a repeat test\. You may want to ask your doctor about this\./)
assert.match(glu.range_note!, /\(70 - 110\) is different from .*\(below 100 mg\/dL\)/)
// r4: TSH 0.35-5.50 has no guideline threshold in the table, so it must say so rather than invent one.
const tsh = checksOf('r4').find((c) => c.key === 'tsh')!
assert.equal(tsh.outcome, 'no guideline for this test')
assert.equal(tsh.range_note, null)
// Same cutoff written inclusively is not a difference; abnormal both ways agrees; mmol/L is converted first.
const one = (t: Partial<Test>, who = { sex: 'Male' as const, age_band: '30-39' }) => checkTest({ name: '', value: null, unit: 'mg/dL', ref_low: null, ref_high: null, ref_text: null, printed_flag: null, ...t }, who)
assert.equal(one({ name: 'HbA1c', unit: '%', value: 5.5, ref_low: 4, ref_high: 5.6 }).range_note, null)
assert.equal(one({ name: 'HbA1c', unit: '%', value: 5.5, ref_low: 4, ref_high: 5.6 }).outcome, 'agrees')
assert.equal(one({ name: 'LDL', value: 160, ref_high: 100 }).outcome, 'agrees')
assert.equal(one({ name: 'Total Cholesterol', value: 195, ref_high: 180 }).outcome, 'lab says abnormal, guideline says normal')
assert.equal(one({ name: 'FBS', unit: 'mmol/L', value: 7.2, ref_low: 3.9, ref_high: 6.1 }).guideline, 'diabetes criterion (126 mg/dL or higher)')
assert.equal(one({ name: 'Hemoglobin', unit: 'g/dL', value: 12.5, ref_low: 12, ref_high: 15 }, { sex: 'Female', age_band: '20-29' }).outcome, 'agrees')
assert.equal(one({ name: 'Hemoglobin', unit: 'g/dL', value: 12.5, ref_low: 12, ref_high: 15 }, { sex: 'Male', age_band: '20-29' }).outcome, 'lab says normal, guideline says borderline or high/low')
assert.equal(one({ name: 'Hemoglobin', unit: 'g/dL', value: 12.5 }, { sex: null as never, age_band: '20-29' }).outcome, 'no guideline for this test')
// WHO 2024 adult cutoffs cover ages 15 to 65: bands crossing that span are skipped.
for (const [age_band, applies] of [['10-19', false], ['20-29', true], ['50-59', true], ['60-69', false], ['90+', false], [null, false]] as const)
  assert.equal(one({ name: 'Hemoglobin', unit: 'g/dL', value: 12.5, ref_low: 12 }, { sex: 'Male', age_band: age_band as never }).outcome !== 'no guideline for this test', applies, String(age_band))
// Decisions of 2026-11-22: HDL below 40 for everyone; LDL 100-129 not flagged; lipid, pregnancy and ADA wording notes.
assert.equal(one({ name: 'HDL', value: 45, ref_low: 40 }, { sex: 'Female', age_band: '40-49' }).outcome, 'agrees')
assert.equal(one({ name: 'HDL', value: 38, ref_low: 40 }, { sex: 'Female', age_band: '40-49' }).outcome, 'agrees')
assert.equal(one({ name: 'LDL', value: 115, ref_high: 130 }).outcome, 'agrees')
assert.equal(one({ name: 'LDL', value: 115, ref_high: 100 }).outcome, 'lab says abnormal, guideline says normal')
assert.equal(one({ name: 'LDL', value: 135, ref_high: 130 }).guideline, 'borderline high (130-159 mg/dL)')
for (const name of ['Total Cholesterol', 'LDL', 'HDL', 'Triglycerides']) assert.ok(one({ name, value: 100, ref_high: 200 }).message.endsWith('Indian guidelines (Lipid Association of India, 2020) set targets based on overall heart risk, so your doctor may use different goals.'), name)
assert.ok(one({ name: 'Hemoglobin', unit: 'g/dL', value: 14, ref_low: 13, ref_high: 17 }).message.endsWith('Different ranges apply during pregnancy.'))
assert.match(one({ name: 'FBS', value: 132, ref_low: 70, ref_high: 100 }).message, /\(ADA\) uses 126 mg\/dL or higher as one of the criteria doctors consider for diabetes, usually confirmed with a repeat test\./)
assert.equal(one({ name: 'Platelets', unit: 'lakhs/L', value: 2 }).outcome, 'no guideline for this test')
assert.equal(one({ name: 'FBS', unit: 'mg/L', value: 2 }).outcome, 'unit not recognized')
// Wording rules: describe, never diagnose or blame.
for (const f of readdirSync('test-data/ground-truth')) for (const c of checksOf(f.replace('.json', '')))
  for (const s of [c.message, c.range_note ?? '']) assert.ok(!BANNED.test(s), `${f}: ${s}`)
// Far-out-of-range banner rule: hemoglobin, platelets, WBC only; below 0.5x lower or above 2x upper limit.
assert.deepEqual(
  ([['Hemoglobin', 6.4, 13, 17], ['Hemoglobin', 6.5, 13, 17], ['Platelet Count', 9, 1.5, 4.1], ['Platelet Count', 8.2, 1.5, 4.1], ['Total WBC Count', 1900, 4000, 10000], ['TLC', 2000, 4000, 10000],
    ['LDL Cholesterol', 300, null, 100], ['Glucose Fasting', 250, 70, 100], ['HbA1c', 12, 4, 5.6], ['Hemoglobin', null, 13, 17], ['Hemoglobin', 40, null, null]] as [string, number | null, number | null, number | null][])
    .map(([name, value, ref_low, ref_high]) => farOutOfRange({ name, value, ref_low, ref_high })),
  [true, false, true, false, true, false, false, false, false, false, false])

// Payload names drop section headers and method lines the model copied in.
assert.equal(displayName('Absolute Leucocyte Count\n(Calculated)\nBasophils'), 'Basophils')
assert.equal(displayName('Creatinine\n(Modified Jaffe,Kinetic)'), 'Creatinine')
assert.equal(displayName('Some New Test\n(Method)'), 'Some New Test (Method)')

// Badges: legible=false or a text-layer mismatch => "check"; text-layer match => "verified"; photo => "image".
const w = (text: string, x0: number, y: number) => ({ text, x0, x1: x0 + 0.01 * text.length, y0: y, y1: y + 0.012 })
const page = [w('Triglycerides', 0.1, 0.3), w('145.00', 0.45, 0.3), w('mg/dL', 0.6, 0.3), w('<150.00', 0.75, 0.3), w('HDL', 0.1, 0.33), w('Cholesterol', 0.14, 0.33), w('41.00', 0.45, 0.33)]
const row = (name: string, value: number | null, extra = {}) => ({ name, value, ref_low: null, ref_high: null, ...extra })
assert.deepEqual(trustOf([row('Triglycerides', 145, { ref_high: 150, unit: 'mg/dL' }), row('Triglycerides', 115, { unit: 'mg/dL' }), row('HDL Cholesterol', 41), row('HDL Cholesterol', null, { legible: false }), row('Urea', 20)], [page]).map((t) => t.badge),
  ['verified', 'check', 'verified', 'check', 'image'])
assert.deepEqual(trustOf([row('Triglycerides', 145, { ref_high: 160, unit: 'mg/dL' })], [page]).map((t) => [t.value, t.range, t.badge]), [['verified', 'mismatch', 'check']])
// Units: missing (WM14 T3) or misread (WM15 RBC) units on a row that prints one => "check".
assert.deepEqual(trustOf([row('Triglycerides', 145), row('Triglycerides', 145, { unit: 'mmol/L' }), row('Triglycerides', 145, { unit: 'MG/DL' }), row('Triglycerides', 145, { unit: 'g/dL' })], [page]).map((t) => [t.unit, t.badge]),
  [['mismatch', 'check'], ['mismatch', 'check'], ['verified', 'verified'], ['mismatch', 'check']]) // "g/dL" is not "mg/dL" (WM14 T4 read "µg/dL" as "g/dL")
assert.deepEqual(trustOf([row('Triglycerides', 115)], [null]).map((t) => t.badge), ['image']) // photo: nothing to compare against

console.log('checks ok')

// Homography: the four corners of a tilted quad map exactly onto the output rectangle.
{
  const quad = [{ x: 12, y: 30 }, { x: 410, y: 8 }, { x: 450, y: 600 }, { x: 0, y: 560 }]
  const rect = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 580 }, { x: 0, y: 580 }]
  const H = homography(rect, quad)
  rect.forEach((p, i) => { const q = apply(H, p); assert.ok(Math.abs(q.x - quad[i].x) < 1e-6 && Math.abs(q.y - quad[i].y) < 1e-6, `homography corner ${i}`) })
}
console.log('crop ok')

// Path 1 plain-code corrections after the on-device model.
{
  const { parseRange, fixFromRow, isResultRow, rowFor } = await import('../src/textrows')
  assert.deepEqual(parseRange('0.67 - 1.17'), [0.67, 1.17])
  assert.deepEqual(parseRange('<200.00'), [null, 200])
  assert.deepEqual(parseRange('>59'), [59, null])
  assert.equal(parseRange('Negative'), null)
  const row = 'LDL Cholesterol, Calculated | 160.20 | mg/dL | <100.00'
  assert.deepEqual(fixFromRow({ name: 'LDL Cholesterol, Calculated', ref_text: '<100.00', ref_low: 100, ref_high: null, printed_flag: 'H' }, row), { name: 'LDL Cholesterol, Calculated', ref_text: '<100.00', ref_low: null, ref_high: 100, printed_flag: null })
  assert.equal(fixFromRow({ name: 'Hb', printed_flag: null }, 'Hb | 9.1 | L | g/dL | 13 - 17').printed_flag, 'L')
  assert.ok(isResultRow('Sodium | 140.00 | mEq/L | 136.00 - 146.00'))
  assert.ok(!isResultRow('1. | TSH levels are subject to circadian variation, reaching peak levels between 2 - 4.a.m. and at a'))
  assert.equal(rowFor('VLDL Cholesterol, Calculated', ['LDL Cholesterol | 1', 'VLDL Cholesterol,Calculated | 33.30']), 'VLDL Cholesterol,Calculated | 33.30')
  console.log('textrows ok')
}
{
  const { skippedRows } = await import('../src/textrows')
  const rows = ['Monocytes | 6 | % | 2 - 10', 'Lymphocytes | 30 | % | 20 - 40', 'Monocytes | 0.4 | thou/mm3 | 0.2 - 1.0']
  assert.deepEqual(skippedRows(rows, ['Monocytes', 'Lymphocytes']), ['Monocytes | 0.4 | thou/mm3 | 0.2 - 1.0'])
  assert.deepEqual(skippedRows(rows, ['Monocytes', 'Lymphocytes', 'Monocytes']), [])
  console.log('skipped rows ok')
}
{
  const { parseRow } = await import('../src/textrows')
  const p = (r: string) => { const x = parseRow(r); return x && [x.value, x.unit, x.ref_low, x.ref_high, x.printed_flag] }
  assert.deepEqual(p('Hemoglobin | 10.9 | L | g/dL | 13.0 - 17.0'), [10.9, 'g/dL', 13, 17, 'L'])
  assert.deepEqual(p('Cholesterol, Total | 250.70 H | mg/dL | <200.00'), [250.7, 'mg/dL', null, 200, 'H'])
  assert.deepEqual(p('HDL Cholesterol | 51.2 | mg/dL | >40'), [51.2, 'mg/dL', 40, null, null])
  assert.deepEqual(p('Triglycerides | 120 | High | mg/dL | Upto 150'), [120, 'mg/dL', null, 150, 'H'])
  assert.deepEqual(p('A : G Ratio | 1.34 | 0.90 - 2.00'), [1.34, null, 0.9, 2, null])
  assert.deepEqual(p('Platelet Count | 151 | 10^3/µL | 150 - 410'), [151, '10^3/µL', 150, 410, null])
  // Not sure: the model reads these.
  for (const r of ['Glucose | <5 | mg/dL', 'Page | 2 | of | 5', 'HbA1c | 5.0 | % | Non diabetic: <5.7', 'TSH | 4 | uIU/mL | 0.5 - 4.8 | extra', 'Desirable | 200 - 239'])
    assert.equal(parseRow(r), null, r)
  console.log('row parser ok')
}
{
  const { parseRow, parseRange, splitPair } = await import('../src/textrows')
  const p = (r: string, sex?: string) => { const x = parseRow(r, sex); return x && [x.name, x.value, x.unit, x.ref_low, x.ref_high, x.printed_flag] }
  // Result first, unit inside the value cell, flag column last; Indian digit grouping.
  assert.deepEqual(p('11,200 /cumm | Total WBC Count | 4000 - 10000 | High'), ['Total WBC Count', 11200, '/cumm', 4000, 10000, 'H'])
  assert.deepEqual(p('1,25,000 /cumm | Platelet Count | 150000 - 410000'), ['Platelet Count', 125000, '/cumm', 150000, 410000, null])
  // Footnote marks on the name and the value.
  assert.deepEqual(p('TSH# | 6.8 * | µIU/mL | 0.4 - 4.0'), ['TSH', 6.8, 'µIU/mL', 0.4, 4, null])
  // Sex-specific ranges: the patient's own bounds, or not parsed when sex is unknown.
  assert.deepEqual(parseRange('M: 13-17 / F: 12-15', 'Male'), [13, 17])
  assert.deepEqual(parseRange('M: 13-17 / F: 12-15', 'F'), [12, 15])
  assert.equal(parseRange('M: 13-17 / F: 12-15'), null)
  assert.equal(parseRow('Haemoglobin | 12.1 | g/dL | M: 13-17 / F: 12-15'), null)
  // Two tests on one printed row are split only when both halves parse.
  assert.deepEqual(splitPair('Haemoglobin | 12.4 | g/dL | 12.0 - 15.0 | Triglycerides | 165 H | mg/dL | < 150'), ['Haemoglobin | 12.4 | g/dL | 12.0 - 15.0', 'Triglycerides | 165 H | mg/dL | < 150'])
  assert.deepEqual(splitPair('Haemoglobin | 12.4 | g/dL | see note | Triglycerides | 165'), ['Haemoglobin | 12.4 | g/dL | see note | Triglycerides | 165'])
  // Two values, or a flag both in the value and in its own column: not sure, so the model reads it.
  assert.equal(parseRow('Haemoglobin | 12.4 | 13.1 | g/dL'), null)
  assert.equal(parseRow('Haemoglobin | 12.4 L | g/dL | Low'), null)
  console.log('row parser layouts ok')
}
