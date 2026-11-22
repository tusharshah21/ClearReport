// Plain assert checks for the no-AI code paths. Run: npm test
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { canonical } from '../src/canonical'

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

console.log('checks ok')
