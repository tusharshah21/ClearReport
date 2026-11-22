// Plain code, no AI: compares each result against the lab's printed range and a published guideline.
//
// STATUS: PENDING REVIEW BY A DOCTOR. Every threshold below names its source; none has been
// clinically reviewed yet. Deliberately left out (no single attributable guideline threshold
// I am sure of): WBC, platelets, TSH. See NOT_INCLUDED.
//
// Wording follows the Gemini API terms (no medical advice): describe, never diagnose.
import { normalize } from './units'
import type { Payload, Test } from './privacy'

type Dir = 'normal' | 'high' | 'low'
// Bands are ordered; a value belongs to the first band whose upTo it is below (exclusive). Last band: upTo null.
type Band = { upTo: number | null; dir: Dir; name: string; text: string }
type Guideline = {
  label: string
  unit: string
  sex?: 'Male' | 'Female'
  adultOnly?: boolean
  source: string
  normal: { low: number | null; high: number | null; text: string } // for the "your lab's range differs" note
  bands: Band[]
}

export const REVIEW_STATUS = 'pending review by a doctor'
export const NOT_INCLUDED = {
  wbc: 'No single named guideline sets a general adult WBC threshold; labs use local reference intervals.',
  platelets: '150,000/µL is a widely taught lower limit, but I could not pin it to one named guideline (ITP criteria use 100,000/µL, a different purpose).',
  tsh: 'ATA/AACE material discusses a population range of about 0.45-4.12 mIU/L (NHANES III), but it is a study-derived reference interval, not a guideline threshold, and it shifts with age and pregnancy.',
}

const ADA = 'ADA Standards of Care in Diabetes, diagnosis criteria'
const ATP3 = 'NCEP ATP III (US National Cholesterol Education Program)'
const WHO_HB = 'WHO guideline on haemoglobin cutoffs for anaemia (2024), non-pregnant adults'

export const GUIDELINES: Record<string, Guideline[]> = {
  fasting_glucose: [{
    label: 'fasting glucose', unit: 'mg/dL', source: 'ADA', normal: { low: null, high: 100, text: 'below 100' },
    bands: [
      { upTo: 100, dir: 'normal', name: 'normal', text: 'below 100' },
      { upTo: 126, dir: 'high', name: 'prediabetes', text: '100-125' },
      { upTo: null, dir: 'high', name: 'diabetes', text: '126 or higher' },
    ],
  }],
  hba1c: [{
    label: 'HbA1c', unit: '%', source: 'ADA', normal: { low: null, high: 5.7, text: 'below 5.7' },
    bands: [
      { upTo: 5.7, dir: 'normal', name: 'normal', text: 'below 5.7' },
      { upTo: 6.5, dir: 'high', name: 'prediabetes', text: '5.7-6.4' },
      { upTo: null, dir: 'high', name: 'diabetes', text: '6.5 or higher' },
    ],
  }],
  total_cholesterol: [{
    label: 'total cholesterol', unit: 'mg/dL', source: 'NCEP ATP III', normal: { low: null, high: 200, text: 'below 200' },
    bands: [
      { upTo: 200, dir: 'normal', name: 'desirable', text: 'below 200' },
      { upTo: 240, dir: 'high', name: 'borderline high', text: '200-239' },
      { upTo: null, dir: 'high', name: 'high', text: '240 or higher' },
    ],
  }],
  ldl: [{
    label: 'LDL cholesterol', unit: 'mg/dL', source: 'NCEP ATP III', normal: { low: null, high: 100, text: 'below 100' },
    bands: [
      { upTo: 100, dir: 'normal', name: 'optimal', text: 'below 100' },
      { upTo: 130, dir: 'high', name: 'near or above optimal', text: '100-129' },
      { upTo: 160, dir: 'high', name: 'borderline high', text: '130-159' },
      { upTo: 190, dir: 'high', name: 'high', text: '160-189' },
      { upTo: null, dir: 'high', name: 'very high', text: '190 or higher' },
    ],
  }],
  triglycerides: [{
    label: 'triglycerides', unit: 'mg/dL', source: 'NCEP ATP III', normal: { low: null, high: 150, text: 'below 150' },
    bands: [
      { upTo: 150, dir: 'normal', name: 'normal', text: 'below 150' },
      { upTo: 200, dir: 'high', name: 'borderline high', text: '150-199' },
      { upTo: 500, dir: 'high', name: 'high', text: '200-499' },
      { upTo: null, dir: 'high', name: 'very high', text: '500 or higher' },
    ],
  }],
  // ATP III: "low HDL" is <40 overall; its metabolic syndrome criteria use <40 for men and <50 for women.
  hdl: (['Male', 'Female'] as const).map((sex) => {
    const cut = sex === 'Male' ? 40 : 50
    return {
      label: 'HDL cholesterol', unit: 'mg/dL', sex, source: 'NCEP ATP III, metabolic syndrome criteria', normal: { low: cut, high: null, text: `${cut} or higher` },
      bands: [
        { upTo: cut, dir: 'low' as const, name: 'low', text: `below ${cut}` },
        { upTo: null, dir: 'normal' as const, name: 'not low', text: `${cut} or higher` },
      ],
    }
  }),
  hemoglobin: (['Male', 'Female'] as const).map((sex) => {
    const cut = sex === 'Male' ? 13 : 12
    return {
      label: 'hemoglobin', unit: 'g/dL', sex, adultOnly: true, source: 'WHO', normal: { low: cut, high: null, text: `${cut}.0 or higher` },
      bands: [
        { upTo: cut, dir: 'low' as const, name: 'anaemia', text: `below ${cut}.0` },
        { upTo: null, dir: 'normal' as const, name: 'not anaemic', text: `${cut}.0 or higher` },
      ],
    }
  }),
}
export const SOURCES: Record<string, string> = { ADA, 'NCEP ATP III': ATP3, 'NCEP ATP III, metabolic syndrome criteria': ATP3, WHO: WHO_HB }

export type Outcome =
  | 'agrees'
  | 'lab says normal, guideline says borderline or high/low'
  | 'lab says abnormal, guideline says normal'
  | 'lab and guideline point in opposite directions'
  | 'no guideline for this test'
  | 'unit not recognized'
  | 'no printed range'
  | 'no value'
export type Check = { test: string; key: string; value: string; lab: Dir | 'no range' | null; guideline: string | null; outcome: Outcome; message: string; range_note: string | null; source: string | null }

const fmt = (n: number) => String(Number(n.toPrecision(4)))
// "70-110", "< 200", "> 40": the printed text if the model kept it, else built from the bounds.
const rangeText = (t: Test) => t.ref_text ?? (t.ref_low !== null && t.ref_high !== null ? `${t.ref_low}-${t.ref_high}` : t.ref_high !== null ? `below ${t.ref_high}` : `above ${t.ref_low}`)
// 5.6 vs 5.7 or 99 vs 100 is the same cutoff written inclusively; anything further apart is a real difference.
const step = (g: number) => 10 ** -((String(g).split('.')[1] ?? '').length)
const differs = (lab: number | null, g: number | null) => g !== null && lab !== null && Math.abs(lab - g) > step(g) + 1e-9

export function checkTest(t: Test, who: Pick<Payload, 'sex' | 'age_band'>): Check {
  const n = normalize(t)
  const shown = `${t.value} ${t.unit ?? ''}`.trim()
  const base = { test: t.name, key: n.key, value: shown, lab: null, guideline: null, range_note: null, source: null }
  const options = GUIDELINES[n.key]
  if (!options) return { ...base, outcome: 'no guideline for this test', message: `No guideline threshold is included for ${t.name} yet, so only your lab's range applies.` }
  if (n.status !== 'ok') return { ...base, outcome: 'unit not recognized', message: `The unit "${t.unit ?? 'none'}" for ${t.name} was not recognized, so no range check was done.` }
  if (n.value === null) return { ...base, outcome: 'no value', message: `No value was read for ${t.name}.` }
  const g = options.find((o) => !o.sex || o.sex === who.sex)
  const child = who.age_band === '0-9' || who.age_band === '10-19'
  if (!g || (g.adultOnly && (child || !who.age_band)))
    return { ...base, outcome: 'no guideline for this test', message: `The guideline for ${t.name} depends on ${!g ? 'sex' : 'age'}, which was not read from the report, so only your lab's range applies.` }

  const band = g.bands.find((b) => b.upTo === null || n.value! < b.upTo)!
  const unitNote = n.value === t.value ? '' : `, which is ${fmt(n.value)} ${g.unit}`
  const src = `a widely used guideline (${g.source})`
  const withUnit = (text: string) => text.replace(/^(below )?([\d.]+(?:-[\d.]+)?)( or higher)?$/, `$1$2 ${g.unit}$3`) // "126 mg/dL or higher"
  const gText = withUnit(band.text)
  const lab: Check['lab'] = n.ref_low === null && n.ref_high === null ? 'no range' : n.ref_high !== null && n.value > n.ref_high ? 'high' : n.ref_low !== null && n.value < n.ref_low ? 'low' : 'normal'
  const labRange = lab === 'no range' ? null : rangeText(t)
  const range_note = labRange && (differs(n.ref_high, g.normal.high) || differs(n.ref_low, g.normal.low))
    ? `Your lab's range for ${g.label} (${labRange}) is different from the range ${src} uses (${withUnit(g.normal.text)}).`
    : null
  const out = { ...base, lab, guideline: `${band.name} (${gText})`, range_note, source: SOURCES[g.source] }
  const where = `${src} treats ${gText} as ${band.dir === 'normal' ? band.name : `the ${band.name} range`}`

  if (lab === 'no range') return { ...out, outcome: 'no printed range', message: `Your report shows no range for ${g.label}. Your result is ${shown}${unitNote}; ${where}.${band.dir === 'normal' ? '' : ' You may want to ask your doctor about this.'}` }
  if (lab === 'normal' && band.dir === 'normal') return { ...out, outcome: 'agrees', message: `Your ${g.label} result (${shown}${unitNote}) is inside your lab's range (${labRange}), and ${where}.` }
  if (lab === 'normal') return { ...out, outcome: 'lab says normal, guideline says borderline or high/low', message: `Your lab's range for ${g.label} is ${labRange}, and your result is ${shown}${unitNote}. ${cap(where)}. You may want to ask your doctor about this.` }
  if (band.dir === 'normal') return { ...out, outcome: 'lab says abnormal, guideline says normal', message: `Your lab marks your ${g.label} result (${shown}${unitNote}) as outside its range (${labRange}). ${cap(where)}. You may want to ask your doctor how to read this.` }
  if (band.dir === lab) return { ...out, outcome: 'agrees', message: `Your ${g.label} result (${shown}${unitNote}) is outside your lab's range (${labRange}), and ${where}. You may want to ask your doctor about this.` }
  return { ...out, outcome: 'lab and guideline point in opposite directions', message: `Your lab's range for ${g.label} is ${labRange} and ${where}; they point in different directions for your result (${shown}${unitNote}). You may want to ask your doctor about this.` }
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

export const checkAll = (p: Payload) => p.tests.map((t) => checkTest(t, p))
