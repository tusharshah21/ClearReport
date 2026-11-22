// Plain assert checks for the no-AI code paths. Run: npm test
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { canonical } from '../src/canonical'
import { ageBand, toPayload } from '../src/privacy'

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

console.log('checks ok')
