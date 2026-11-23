// Prints every range-check message for sample values of each test, to audit the wording against docs/guidelines.md.
// Usage: npx tsx scripts/audit-wording.ts
import { checkTest } from '../src/guidelines'

const who = { sex: 'Male' as const, age_band: '30-39' }
const cases: [string, string, number[], number | null, number | null][] = [
  ['Glucose Fasting', 'mg/dL', [90, 104, 130], 70, 110],
  ['HbA1c', '%', [5.4, 6.0, 7.0], 4, 5.6],
  ['Total Cholesterol', 'mg/dL', [180, 220, 250], null, 200],
  ['LDL Cholesterol', 'mg/dL', [90, 115, 136, 170, 200], null, 100],
  ['Triglycerides', 'mg/dL', [120, 170, 300, 600], null, 150],
  ['HDL Cholesterol', 'mg/dL', [35, 45], 40, null],
  ['HDL Cholesterol', 'mg/dL', [45], 50, null],
  ['Hemoglobin', 'g/dL', [11, 12.8, 14], 13.5, 17],
]
for (const [name, unit, values, ref_low, ref_high] of cases)
  for (const value of values) {
    const c = checkTest({ name, value, unit, ref_low, ref_high, ref_text: null, printed_flag: null } as never, who)
    console.log(`\n[${name} ${value}, lab ${ref_low ?? ''}-${ref_high ?? ''}] ${c.outcome}\n  ${c.message}${c.range_note ? `\n  NOTE: ${c.range_note}` : ''}`)
  }
