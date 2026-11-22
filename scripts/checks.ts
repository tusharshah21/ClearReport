// Plain assert checks for the no-AI code paths. Run: npm test
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { canonical } from '../src/canonical'
import { ageBand, toPayload } from '../src/privacy'
import { normalize } from '../src/units'

// Every ground-truth name resolves to a known key, and no report has two tests with the same key.
for (const f of readdirSync('test-data/ground-truth')) {
  const keys = JSON.parse(readFileSync(`test-data/ground-truth/${f}`, 'utf-8')).tests.map((t: { name: string }) => canonical(t.name))
  assert.ok(keys.every((k: string) => !k.startsWith('?')), `${f}: unknown name ${keys.find((k: string) => k.startsWith('?'))}`)
  assert.equal(new Set(keys).size, keys.length, `${f}: duplicate canonical keys`)
}
// Spelling variants and names a model is likely to emit instead of the printed one.
const same: [string, string][] = [
  ['Haemoglobin', 'Hemoglobin'], ['Hb', 'Haemoglobin'], ['TSH (Ultrasensitive)', 'Thyroid Stimulating Hormone'],
  ['PCV (Haematocrit)', 'Hematocrit'], ['HbA1c (Glycosylated Haemoglobin)', 'Glycated Hemoglobin (HbA1c)'],
  ['Glucose Fasting (FBS)', 'Fasting Blood Sugar'], ['Total WBC Count', 'Total Leucocyte Count (TLC)'],
  ['LDL Cholesterol', 'LDL-C'], ['Total Cholesterol / HDL Ratio', 'TC/HDL Ratio'],
]
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
  for (const [k, v] of Object.entries(gt.pii as Record<string, string>)) if (!['age', 'sex'].includes(k)) assert.ok(!sent.includes(v), `${f}: leaked ${v}`)
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
  for (const t of JSON.parse(readFileSync(`test-data/ground-truth/${f}`, 'utf-8')).tests) assert.equal(normalize(t).status, 'ok', `${f}: ${t.name} [${t.unit}]`)
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

console.log('checks ok')
