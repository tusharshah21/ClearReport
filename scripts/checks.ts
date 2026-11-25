// Plain assert checks for the no-AI code paths. Run: npm test
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { canonical, displayName } from '../src/canonical'
import { ageBand, toPayload } from '../src/privacy'
import { normalize } from '../src/units'
import { apply, homography } from '../src/crop'
import { BANNED, checkAll, checkTest, disagrees, farOutOfRange } from '../src/guidelines'
import type { Test } from '../src/privacy'
import { trustOf } from '../src/trust'
import { completeHindi, sameNumbers, untranslated } from '../src/hindi'
import { isBusy, isDailyLimit, withFallback } from '../src/retry'
import { fixQuestionGrammar, fixUnits, fixUnitsIn, questionsFor, questionsSpecific } from '../src/questions'
import { fileError, NO_RESULTS } from '../src/fileerror'

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
assert.match(glu.message, /Your lab's range for fasting glucose is 70-110.*A widely used guideline \(ADA 2026\) uses 100-125 mg\/dL as one of the criteria doctors consider for prediabetes, usually confirmed with a repeat test\. You may want to ask your doctor about this\./)
assert.match(glu.range_note!, /\(70-110\) is different from .*\(below 100 mg\/dL\)/)
assert.ok(disagrees(glu), 'r2 fasting glucose: the "different ranges" callout shows')
// r6: LDL 136 with a printed "< 100": lab and guideline both say high, so no callout; the range note stays in the details.
const ldl = checksOf('r6').find((c) => c.key === 'ldl')!
assert.equal(ldl.outcome, 'agrees')
assert.ok(!disagrees(ldl), 'r6 LDL: no callout when both verdicts agree')
assert.equal(ldl.callout, null)
// The callout says what the guideline means for THIS result, in plain code.
assert.equal(glu.tag, 'borderline')
assert.equal(glu.callout, "Your result, 104 mg/dL, is inside your lab's range (70-110). A widely used guideline (ADA 2026) uses 100-125 mg/dL as one of the criteria doctors consider for prediabetes (usually confirmed with a repeat test), so by that guideline this result would be borderline. You may want to ask your doctor about this.")
// Doctor questions: generic ones fail; the plain-code ones name a result and its value, the disagreement first.
{
  const r2 = toPayload(gtOf('r2')).payload, c2 = checkAll(r2)
  assert.ok(!questionsSpecific(['Should I talk to my doctor about these numbers?', 'What do these results mean for my health?', 'Do I need any follow-up tests?'], r2, c2), 'generic questions must fail')
  assert.ok(!questionsSpecific(["My LDL Cholesterol is 160 mg/dL, above my lab's range. What might explain this?", 'My HDL Cholesterol is 38 mg/dL. Why is it low?', 'My Triglycerides are 188 mg/dL. Is that a concern?'], r2, c2), 'the disagreement must come first')
  assert.ok(questionsSpecific(["My fasting glucose is 104 mg/dL, inside my lab's range but borderline by a guideline. Which should we go by?", 'My LDL cholesterol is 160 mg/dL. What might explain this?', 'Why is my HDL 38 mg/dL?'], r2, c2), 'specific questions pass')
  for (const id of ['r2', 'r6']) {
    const p = toPayload(gtOf(id)).payload, c = checkAll(p), q = questionsFor(p, c)
    assert.ok(questionsSpecific(q, p, c), `${id}: built questions are specific: ${q.join(' | ')}`)
    for (const x of q) assert.ok(!BANNED.test(x), `${id}: ${x}`)
  }
  assert.match(questionsFor(r2, c2)[0], /^My Glucose Fasting \(FBS\) result is 104 mg\/dL/)
}
assert.ok(ldl.range_note && !/below 130/.test(ldl.range_note) && /below 100 mg\/dL optimal, 100-129 mg\/dL near or above optimal, 130-159 mg\/dL borderline high/.test(ldl.range_note), ldl.range_note ?? 'no note')
// r4: TSH 0.35-5.50 has no guideline threshold in the table, so it must say so rather than invent one.
const tsh = checksOf('r4').find((c) => c.key === 'tsh')!
assert.equal(tsh.outcome, 'no guideline for this test')
assert.equal(tsh.range_note, null)
// Same cutoff written inclusively is not a difference; abnormal both ways agrees; mmol/L is converted first.
const one = (t: Partial<Test>, who = { sex: 'Male' as const, age_band: '30-39' }) => checkTest({ name: '', value: null, unit: 'mg/dL', ref_low: null, ref_high: null, ref_text: null, printed_flag: null, ...t }, who)
// A lab's 13.5 differs from WHO's 13.0 (printed precision, not whole numbers); WHO is a cutoff, never "the anaemia range".
const hb = one({ name: 'Hemoglobin', unit: 'g/dL', value: 12.8, ref_low: 13.5, ref_high: 17 })
assert.ok(hb.range_note, 'hemoglobin 13.5 vs 13.0 is a range difference')
assert.match(hb.message, /uses below 13\.0 g\/dL as its cutoff for anaemia/)
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
assert.match(one({ name: 'FBS', value: 132, ref_low: 70, ref_high: 100 }).message, /\(ADA 2026\) uses 126 mg\/dL or higher as one of the criteria doctors consider for diabetes, usually confirmed with a repeat test\./)
assert.equal(one({ name: 'Platelets', unit: 'lakhs/L', value: 2 }).outcome, 'no guideline for this test')
assert.equal(one({ name: 'FBS', unit: 'mg/L', value: 2 }).outcome, 'unit not recognized')
// Wording rules: describe, never diagnose or blame.
for (const f of readdirSync('test-data/ground-truth')) for (const c of checksOf(f.replace('.json', '')))
  for (const s of [c.message, c.range_note ?? '']) assert.ok(!BANNED.test(s), `${f}: ${s}`)
// "you haven't eaten" (a general fasting description) is fine; "you have diabetes" is not.
assert.ok(!BANNED.test("the amount of sugar in your blood after you haven't eaten for a few hours") && BANNED.test('you have high sugar'), 'BANNED: you have, not you haven\'t')
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

// Badges: legible=false, a text-layer mismatch or a row not found in the text layer => "check"; match => "verified"; photo => "image".
const w = (text: string, x0: number, y: number) => ({ text, x0, x1: x0 + 0.01 * text.length, y0: y, y1: y + 0.012 })
const page = [w('Triglycerides', 0.1, 0.3), w('145.00', 0.45, 0.3), w('mg/dL', 0.6, 0.3), w('<150.00', 0.75, 0.3), w('HDL', 0.1, 0.33), w('Cholesterol', 0.14, 0.33), w('41.00', 0.45, 0.33)]
const row = (name: string, value: number | null, extra = {}) => ({ name, value, ref_low: null, ref_high: null, ...extra })
assert.deepEqual(trustOf([row('Triglycerides', 145, { ref_high: 150, unit: 'mg/dL' }), row('Triglycerides', 115, { unit: 'mg/dL' }), row('HDL Cholesterol', 41), row('HDL Cholesterol', null, { legible: false }), row('Urea', 20)], [page]).map((t) => t.badge),
  ['verified', 'check', 'verified', 'check', 'check']) // Urea is not in this PDF's text: it cannot be checked, so it is never neutral
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
{
  const { aiBoxes, nonResultLines, resultLine, suggestMasks } = await import('../src/masks')
  const w = (text: string, x0: number, y0: number) => ({ text, x0, x1: x0 + 0.01 * text.length, y0, y1: y0 + 0.02 })
  const words = [
    w('ROHAN', 0.1, 0.1), w('UNLABELLEDNAME', 0.17, 0.1),                       // name with no label
    w('Reg', 0.1, 0.15), w('No:', 0.14, 0.15), w('LVP-TEST-40721', 0.18, 0.15),  // labelled ID: a rule finds it
    w('Haemoglobin', 0.1, 0.3), w('13.9', 0.4, 0.3), w('g/dL', 0.5, 0.3), w('13.0', 0.6, 0.3), w('-', 0.65, 0.3), w('17.0', 0.67, 0.3),
  ]
  const lines = nonResultLines(words)
  assert.deepEqual(lines.map((l) => l.text), ['ROHAN UNLABELLEDNAME', 'Reg No: LVP-TEST-40721'], 'result rows never reach the model')
  const rules = suggestMasks(words)
  assert.deepEqual(rules.map((b) => [b.field, b.method]), [['id', 'rule']])
  const ai = aiBoxes(lines, [{ line: 1, text: 'Rohan Unlabelledname', kind: 'patient_name' }, { line: 2, text: 'LVP-TEST-40721', kind: 'patient_id' }, { line: 9, text: 'x', kind: 'phone' }], rules)
  assert.deepEqual(ai.map((b) => [b.field, b.method]), [['patient_name', 'ai']], 'one box for the name; the ID is already covered by a rule; a bad line number is ignored')
  assert.ok(ai[0].x <= 0.1 && ai[0].x + ai[0].w >= 0.31, 'the name box spans both words')
  assert.deepEqual(nonResultLines([w('EER', 0.1, 0.5), w('0h', 0.1, 0.6), w('wae', 0.14, 0.6)]), [], 'OCR noise never reaches the model')
  assert.deepEqual(aiBoxes(lines, [{ line: 1, text: 'ROHAN', kind: 'date_of_birth' }], []), [], 'a finding that does not fit its kind is dropped')
  // OCR result lines never get a box: "Ph 6.0" (urine pH) is not a phone label; age/sex and dates are not results.
  const ocr = [w('Ph', 0.1, 0.4), w('6.0', 0.3, 0.4), w('5.0', 0.5, 0.4), w('-', 0.55, 0.4), w('8.0', 0.57, 0.4), w('Age/Sex:', 0.1, 0.45), w('45Y/M', 0.2, 0.45)]
  assert.deepEqual(suggestMasks(ocr, true).map((b) => b.field), ['age/sex'], 'no box on an OCR result line')
  assert.deepEqual(suggestMasks(ocr).map((b) => b.field), ['phone', 'age/sex'], 'without the OCR guard the pH row would be boxed')
  // A garbled OCR row inside the results block ("pete" for "34.2 %") never reaches the model: it is between result lines.
  const block = [w('Patient', 0.1, 0.1), w('Name:', 0.17, 0.1), w('ROHAN', 0.25, 0.1), ...[0.3, 0.4, 0.5].flatMap((y) => [w('Hb', 0.1, y), w('13.9', 0.3, y), w('g/dL', 0.4, y)]), w('pete', 0.3, 0.35), w('Thank', 0.1, 0.8), w('you', 0.2, 0.8)]
  assert.deepEqual(nonResultLines(block).map((l) => l.text), ['PatientName: ROHAN', 'Thank you'], 'nothing inside the results block reaches the model')
  for (const [t, want] of [['91 70-100', true], ['27.9 an-n', true], ['3 4% - 50', true], ['Date: 17-11-2026', false], ['Age/Sex: 57Y/FEMALE', false], ['AGE/SEX 57Y/FEMALE PH +91 20000 00006', false], [': STY/FDMALE LL) +0 92000 ¢ 00006', false], ['212 mg/dL < 200', true], ['1.3 lakhs/cumm', true], ['Mobile: +91 80000 00014', false]] as const)
    assert.equal(resultLine(t), want, t)
  console.log('ai mask boxes ok')
}
// Photo and scan label rules (OCR words only; the PDF path keeps its exact labels).
{
  const { mergePasses, missingCore, resultLine, suggestMasks } = await import('../src/masks')
  const w = (text: string, x0: number, y0: number) => ({ text, x0, x1: x0 + 0.008 * text.length, y0, y1: y0 + 0.012 })
  const fields = (ws: ReturnType<typeof w>[], ocr = true) => suggestMasks(ws, ocr).map((b) => b.field)
  const rows = [0.4, 0.45, 0.5].flatMap((y) => [w('Haemoglobin', 0.03, y), w('13.9', 0.4, y), w('g/dL', 0.5, y), w('13.0-17.0', 0.7, y)])
  // A toll-free number in the header is not a printed range, so it does not start the results block.
  assert.equal(resultLine('Toll free 1800-000-0000'), false)
  assert.equal(resultLine('oll free 200-000 0000'), false)
  // Stacked labels with the values on the line below (scanned.pdf); "Collected" is a label of no interest.
  const stacked = [w('Toll', 0.8, 0.03), w('free', 0.85, 0.03), w('200-000', 0.9, 0.03),
    w('Name', 0.04, 0.07), w('Age/Gender', 0.35, 0.07), w('Lab', 0.66, 0.07), w('No/', 0.69, 0.07), w('UHID', 0.72, 0.07),
    w('Mrs.', 0.04, 0.09), w('Priya', 0.08, 0.09), w('Samplename', 0.15, 0.09), w('52Y/F', 0.35, 0.09), w('SPL/FAKE/0772', 0.66, 0.09),
    w('Contact', 0.04, 0.11), w('Referred', 0.35, 0.11), w('By', 0.46, 0.11), w('Collected', 0.66, 0.11),
    w('+91', 0.04, 0.13), w('90000', 0.09, 0.13), w('00002', 0.16, 0.13), w('Dr.', 0.35, 0.13), w('Notreal', 0.39, 0.13), w('02-Nov-2026', 0.66, 0.13), ...rows]
  assert.deepEqual(fields(stacked), ['name', 'age/sex', 'id', 'phone', 'doctor'], 'stacked labels: every value below its label, the collected date left alone')
  // OCR misspellings of a label: "Patent 1D".
  assert.deepEqual(fields([w('Patent', 0.5, 0.1), w('1D:', 0.58, 0.1), w('TL-FAKE-100231', 0.62, 0.1), ...rows]), ['id'])
  assert.deepEqual(fields([w('Patent', 0.5, 0.1), w('1D:', 0.58, 0.1), w('TL-FAKE-100231', 0.62, 0.1)], false), [], 'the PDF path keeps exact labels')
  // A colon OCR dropped: "Male Reg No LVP-TEST-40721 Mobile +91 ...".
  assert.deepEqual(fields([w('38', 0.03, 0.2), w('Years,', 0.06, 0.2), w('Male', 0.14, 0.2), w('Reg', 0.2, 0.2), w('No', 0.24, 0.2), w('LVP-TEST-40721', 0.28, 0.2), w('Mobile', 0.47, 0.2), w('+91', 0.55, 0.2), w('90000', 0.6, 0.2), ...rows]), ['id', 'phone'])
  // Labels OCR could not read (r6-photo): values in the same column as a labelled one are covered, a date is not.
  const grid = [w('ra', 0.02, 0.09), w(':', 0.197, 0.09), w('SUNITA', 0.214, 0.09), w('NOTAREALPERSON', 0.3, 0.09), w('REG.', 0.5, 0.09), w('NO.', 0.545, 0.09), w('MW00FAKE6020', 0.689, 0.09),
    w(':', 0.197, 0.112), w('57Y/FEMALE', 0.213, 0.112), w('LL)', 0.501, 0.112), w('EE', 0.69, 0.112), w(':', 0.725, 0.112), w('009', 0.743, 0.112), w('00006', 0.78, 0.112),
    w('REF.', 0.023, 0.133), w('DR.', 0.068, 0.133), w('t', 0.197, 0.133), w('DR.', 0.214, 0.133), w('EXAMPLE', 0.25, 0.133), w('VERMA', 0.35, 0.133), w('DATE', 0.501, 0.133), w(':', 0.674, 0.133), w('21/11/2026', 0.69, 0.133), ...rows]
  const g = suggestMasks(grid, true)
  assert.deepEqual(g.map((b) => b.field), ['id', 'doctor', 'detail', 'detail', 'detail'])
  assert.ok(!g.some((b) => b.y > 0.125 && b.x > 0.6), 'the report date beside DATE is not covered')
  // Two OCR passes: fields the better pass lacks are added from the other, never over a result line.
  assert.equal(missingCore(suggestMasks(grid, true)), true)
  const merged = mergePasses(grid, [w('Mobile:', 0.5, 0.112), w('+91', 0.57, 0.112), w('90000', 0.6, 0.112), w('Ph', 0.03, 0.45), w('6.0', 0.1, 0.45), ...rows]).boxes
  assert.equal(merged.length, g.length + 1, 'the phone label from the strong pass is added')
  assert.ok(merged.every((b) => b.y < 0.3), 'nothing over the results')
  console.log('photo mask rules ok')
}
// Units in AI-written text are replaced by the payload's exact unit strings (plain code), anchored to the value.
{
  const p1 = toPayload(gtOf('p1')).payload // TSH 3.1 µIU/mL, WBC 11200 /cumm, glucose 96 mg/dL
  assert.equal(fixUnits('My TSH result is 3.1 ΕIU/mL, inside my lab\'s range.', p1), 'My TSH result is 3.1 µIU/mL, inside my lab\'s range.') // Greek capital epsilon
  assert.equal(fixUnits('My TSH is 3.1 EIU/mL.', p1), 'My TSH is 3.1 µIU/mL.')
  assert.equal(fixUnits('TSH 3.1 uiu/ml and 3.1 μIU/mL', p1), 'TSH 3.1 µIU/mL and 3.1 µIU/mL')
  assert.equal(fixUnits('Glucose 96 MG/DL; WBC 11,200 /CUMM', p1), 'Glucose 96 mg/dL; WBC 11,200 /cumm')
  assert.equal(fixUnits('13.1 EIU/mL and 3.1 times', p1), '13.1 EIU/mL and 3.1 times') // other numbers and non-units untouched
  const e = fixUnitsIn({ summary: 'TSH 3.1 EIU/mL.', tests: [{ name: 'TSH', explanation: '3.1 ΕIU/mL' }], questions: ['My TSH is 3.1 ΕIU/mL. Why?'] }, p1)
  assert.deepEqual([e.summary, e.tests[0].explanation, e.questions[0]], ['TSH 3.1 µIU/mL.', '3.1 µIU/mL', 'My TSH is 3.1 µIU/mL. Why?'])
}
// AI-written questions get the same "result is" grammar as the built ones, only for a test name followed by its value.
{
  const r2p = toPayload(gtOf('r2')).payload
  const g = (q: string) => fixQuestionGrammar(q, r2p)
  assert.equal(g("My Triglycerides are 188 mg/dL, above my lab's range. What might explain this?"), "My Triglycerides result is 188 mg/dL, above my lab's range. What might explain this?")
  assert.equal(g('My Total Cholesterol is 236 mg/dL.'), 'My Total Cholesterol result is 236 mg/dL.')
  assert.equal(g("My Glucose Fasting (FBS) is 104 mg/dL, and my lab's range differs."), "My Glucose Fasting (FBS) result is 104 mg/dL, and my lab's range differs.")
  assert.equal(g('My HDL cholesterol is 38 mg/dL.'), 'My HDL cholesterol result is 38 mg/dL.') // case-insensitive name match
  for (const q of ['My Triglycerides result is 188 mg/dL.', 'My HDL Cholesterol level is 38 mg/dL.', 'My Triglycerides are 200 mg/dL.', 'My doctor is 104 years old.', 'Why is my LDL 160?'])
    assert.equal(g(q), q, q) // already right, a level, wrong value, not a test, or not that shape: unchanged
}
// Hindi completeness: a field the translation left in English is translated again on its own; if that fails the
// Devanagari or number checks, the English stays and is listed so the page can label it "(English)".
{
  const en = { summary: 'Your triglycerides are above the range.', tests: [{ name: 'TG', explanation: 'Triglycerides are 188 mg/dL.' }, { name: 'X', explanation: '' }], questions: ['My TG result is 188 mg/dL. Why?', 'My HDL result is 38 mg/dL. Why?', 'My LDL result is 160 mg/dL. Why?'] }
  const hi = { summary: 'आपके ट्राइग्लिसराइड्स सीमा से ऊपर हैं।', tests: [{ name: 'TG', explanation: 'Triglycerides are 188 mg/dL.' }, { name: 'X', explanation: '' }], questions: ['My TG result is 188 mg/dL. Why?', 'मेरा HDL नतीजा 38 mg/dL है। क्यों?', 'My LDL result is 160 mg/dL. Why?'] }
  assert.deepEqual(untranslated(en, hi), ['test:0', 'q:0', 'q:2']) // the empty explanation needs nothing
  assert.deepEqual(untranslated(en, { ...hi, questions: hi.questions.slice(0, 2) }), ['test:0', 'q:0', 'q:2']) // a missing question counts too
  const asked: string[] = []
  const fake = async (s: string) => {
    asked.push(s)
    if (s.startsWith('Triglycerides')) return 'ट्राइग्लिसराइड्स 188 mg/dL हैं।' // good
    if (s.startsWith('My TG')) return 'मेरा TG नतीजा 189 mg/dL है।' // changed a number: rejected
    throw new Error('[500 ] high demand') // still failing after its retries
  }
  const r = await completeHindi(en, hi, fake)
  assert.deepEqual(asked, ['Triglycerides are 188 mg/dL.', 'My TG result is 188 mg/dL. Why?', 'My LDL result is 160 mg/dL. Why?'])
  assert.equal(r.hi.tests[0].explanation, 'ट्राइग्लिसराइड्स 188 mg/dL हैं।')
  assert.deepEqual(r.english, ['q:0', 'q:2'])
  assert.deepEqual(r.hi.questions, ['My TG result is 188 mg/dL. Why?', 'मेरा HDL नतीजा 38 mg/dL है। क्यों?', 'My LDL result is 160 mg/dL. Why?'])
  assert.equal(r.hi.summary, hi.summary) // already Hindi: untouched, not sent again
  assert.ok(sameNumbers('a 1.5 b 20', 'क 20 ख 1.5') && !sameNumbers('a 20', 'क 200'))
  const all = await completeHindi(en, { ...hi, tests: [{ name: 'TG', explanation: 'ट्राइग्लिसराइड्स 188 mg/dL.' }, hi.tests[1]], questions: ['क 188', 'ख 38', 'ग 160'] }, fake)
  assert.deepEqual(all.english, []) // nothing to fix: no call
  console.log('hindi completeness ok')
}
// Cloud resilience: busy errors are retried on the main model, then the fallback model is tried once; other errors
// are not retried and never reach the fallback.
{
  const models = { main: 'main-model', fallback: 'fallback-model' }
  const busy = new Error('AI: Error fetching ... [500 ] This model is currently experiencing high demand.')
  const script = (answers: (string | Error)[]) => {
    const seen: string[] = []
    return { seen, call: async (m: string) => { seen.push(m); const a = answers.shift()!; if (a instanceof Error) throw a; return a } }
  }
  const quiet = console.info; console.info = () => {}
  try {
    let s = script([busy, 'ok'])
    assert.deepEqual(await withFallback('t', models, s.call, [0, 0, 0]), { value: 'ok', model: 'main-model' })
    assert.deepEqual(s.seen, ['main-model', 'main-model']) // one retry on the main model was enough

    s = script([busy, busy, busy, busy, 'ok'])
    assert.deepEqual(await withFallback('t', models, s.call, [0, 0, 0]), { value: 'ok', model: 'fallback-model' })
    assert.deepEqual(s.seen, ['main-model', 'main-model', 'main-model', 'main-model', 'fallback-model']) // 1 + 3 retries, then the fallback once

    s = script([busy, busy, busy, busy, busy])
    await assert.rejects(withFallback('t', models, s.call, [0, 0, 0]), /high demand/)
    assert.equal(s.seen.length, 5) // the fallback is tried once only

    s = script([new Error('[400 ] invalid argument'), 'ok'])
    await assert.rejects(withFallback('t', models, s.call, [0, 0, 0]), /400/)
    assert.deepEqual(s.seen, ['main-model']) // not busy: no retry, no fallback

    s = script([busy, busy])
    await assert.rejects(withFallback('t', { main: 'm', fallback: 'm' }, s.call, [0]), /high demand/) // fallback = main: not tried twice
    assert.equal(s.seen.length, 2)
    for (const e of ['[503 ] unavailable', '[429 ] resource exhausted', 'The model is overloaded']) assert.ok(isBusy(new Error(e)), e)
    assert.ok(!isBusy(new Error('[400 ] bad request')))

    // A free-tier daily limit (the real 429 text, 2026-11-23) is not "busy": one call, no retry, no fallback model.
    const daily = new Error('AI: Error fetching from https://firebasevertexai.googleapis.com/v1beta/projects/x/models/gemini-3.8-flash:generateContent: [429 ] You exceeded your current quota, please check your plan and billing details. * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.8-flash, description: Generate content requests per day limit exceeded on Free Tier. "quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"')
    assert.ok(isDailyLimit(daily) && !isBusy(daily))
    s = script([daily, 'ok', 'ok'])
    await assert.rejects(withFallback('t', models, s.call, [0, 0, 0]), /per day/)
    assert.deepEqual(s.seen, ['main-model']) // stopped at once
    // A per-minute free-tier 429 is still "busy" (retried), and a 500 high demand is not a daily limit.
    const perMinute = new Error('[429 ] Quota exceeded for metric: generate_content_free_tier_requests, quotaId: GenerateRequestsPerMinutePerProjectPerModel-FreeTier')
    assert.ok(isBusy(perMinute) && !isDailyLimit(perMinute))
    assert.ok(!isDailyLimit(busy))
  } finally { console.info = quiet }
  console.log('cloud fallback ok')
}

// File errors: a clear message for each file the app cannot read (test-data/edge, scripts/edge.ts).
{
  const pdf = { name: 'r.pdf', type: 'application/pdf' }
  const pw = Object.assign(new Error('No password given'), { name: 'PasswordException' })
  assert.match(fileError(pw, pdf), /protected with a password/)
  assert.match(fileError(new Error('This PDF has 20 pages; at most 10 are supported.'), pdf), /has 20 pages; ClearReport reads at most 10\. Save only the pages/)
  assert.match(fileError(Object.assign(new Error('Invalid PDF structure.'), { name: 'InvalidPDFException' }), pdf), /can't be opened as a PDF/)
  assert.match(fileError(new Error('The PDF file is empty, i.e. its size is zero bytes.'), pdf), /may be empty, damaged/)
  assert.match(fileError(new Error('The source image could not be decoded.'), { name: 'IMG_0042.HEIC', type: '' }), /HEIC photos can't be read/)
  assert.match(fileError(new Error('The source image could not be decoded.'), { name: 'x.jpg', type: 'image/heic' }), /HEIC/)
  assert.match(fileError(new Error('The source image could not be decoded.'), { name: 'report.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), /file type can't be read/)
  for (const m of [fileError(pw, pdf), fileError(new Error('x'), pdf)]) assert.ok(!/[—–]/.test(m), 'no dashes in messages')
  assert.ok(`Error: ${NO_RESULTS}`.endsWith(NO_RESULTS))
  console.log('file errors ok')
}
