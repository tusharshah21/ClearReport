// Plain code, no AI: compares each result against the lab's printed range and a published guideline.
//
// STATUS: PENDING REVIEW BY A DOCTOR. Every threshold below names its source; none has been
// clinically reviewed yet. Deliberately left out (no single attributable guideline threshold
// I am sure of): WBC, platelets, TSH. See NOT_INCLUDED.
//
// Wording follows the Gemini API terms (no medical advice): describe, never diagnose.
import { canonical } from './canonical'
import { normalize } from './units'
import type { Payload, Test } from './privacy'

type Dir = 'normal' | 'high' | 'low'
// Bands are ordered; a value belongs to the first band whose upTo it is below (exclusive). Last band: upTo null.
// criterion: for diagnostic thresholds (ADA), describe the band as one criterion doctors consider, never as "the X range".
// cutoff: for a defining cutoff (WHO anaemia), describe it as the guideline's cutoff, never as "the X range".
// says: what the callout says this result "would" do by the guideline (default "be <name>"); tag: the short card label (default "in range" or the name).
type Band = { upTo: number | null; dir: Dir; name: string; text: string; criterion?: string; cutoff?: string; says?: string; tag?: string }
type Guideline = {
  label: string
  unit: string
  sex?: 'Male' | 'Female'
  ages?: [number, number] // the guideline covers only these ages; applied only when the whole age band is inside
  source: string
  normal: { low: number | null; high: number | null; text: string } // for the "your lab's range differs" note; text carries units only when it is not a plain range
  bands: Band[]
  note?: string // appended to every message for this test
}

export const REVIEW_STATUS = 'pending review by a doctor'
export const DISCLAIMER = 'ClearReport explains your report. It does not give medical advice. Always discuss results with your doctor.'
export const NOT_INCLUDED = {
  wbc: 'No single named guideline sets a general adult WBC threshold; labs use local reference intervals.',
  platelets: '150,000/µL is a widely taught lower limit, but I could not pin it to one named guideline (ITP criteria use 100,000/µL, a different purpose).',
  tsh: 'ATA/AACE material discusses a population range of about 0.45-4.12 mIU/L (NHANES III), but it is a study-derived reference interval, not a guideline threshold, and it shifts with age and pregnancy.',
}

const LIPID_NOTE = 'Indian guidelines (Lipid Association of India, 2020) set targets based on overall heart risk, so your doctor may use different goals.'
const REPEAT = 'usually confirmed with a repeat test'

export const GUIDELINES: Record<string, Guideline[]> = {
  fasting_glucose: [{
    label: 'fasting glucose', unit: 'mg/dL', source: 'ADA', normal: { low: null, high: 100, text: 'below 100' },
    bands: [
      { upTo: 100, dir: 'normal', name: 'normal', text: 'below 100' },
      { upTo: 126, dir: 'high', name: 'prediabetes criterion', text: '100-125', criterion: 'prediabetes', says: 'be borderline', tag: 'borderline' },
      { upTo: null, dir: 'high', name: 'diabetes criterion', text: '126 or higher', criterion: 'diabetes', says: 'be high', tag: 'high' },
    ],
  }],
  hba1c: [{
    label: 'HbA1c', unit: '%', source: 'ADA', normal: { low: null, high: 5.7, text: 'below 5.7' },
    bands: [
      { upTo: 5.7, dir: 'normal', name: 'normal', text: 'below 5.7' },
      { upTo: 6.5, dir: 'high', name: 'prediabetes criterion', text: '5.7-6.4', criterion: 'prediabetes', says: 'be borderline', tag: 'borderline' },
      { upTo: null, dir: 'high', name: 'diabetes criterion', text: '6.5 or higher', criterion: 'diabetes', says: 'be high', tag: 'high' },
    ],
  }],
  total_cholesterol: [{
    label: 'total cholesterol', unit: 'mg/dL', source: 'NCEP ATP III', normal: { low: null, high: 200, text: 'below 200' }, note: LIPID_NOTE,
    bands: [
      { upTo: 200, dir: 'normal', name: 'desirable', text: 'below 200' },
      { upTo: 240, dir: 'high', name: 'borderline high', text: '200-239' },
      { upTo: null, dir: 'high', name: 'high', text: '240 or higher' },
    ],
  }],
  // Not flagged below 130 (product decision): ATP III calls 100-129 "near or above optimal", not borderline.
  // The note names the bands, never a single "below 130" range, which ATP III does not use.
  ldl: [{
    label: 'LDL cholesterol', unit: 'mg/dL', source: 'NCEP ATP III', note: LIPID_NOTE,
    normal: { low: null, high: 130, text: 'below 100 mg/dL optimal, 100-129 mg/dL near or above optimal, 130-159 mg/dL borderline high, 160-189 mg/dL high, 190 mg/dL or higher very high' },
    bands: [
      { upTo: 100, dir: 'normal', name: 'optimal', text: 'below 100' },
      { upTo: 130, dir: 'normal', name: 'near or above optimal', text: '100-129' },
      { upTo: 160, dir: 'high', name: 'borderline high', text: '130-159' },
      { upTo: 190, dir: 'high', name: 'high', text: '160-189' },
      { upTo: null, dir: 'high', name: 'very high', text: '190 or higher' },
    ],
  }],
  triglycerides: [{
    label: 'triglycerides', unit: 'mg/dL', source: 'NCEP ATP III', normal: { low: null, high: 150, text: 'below 150' }, note: LIPID_NOTE,
    bands: [
      { upTo: 150, dir: 'normal', name: 'normal', text: 'below 150' },
      { upTo: 200, dir: 'high', name: 'borderline high', text: '150-199' },
      { upTo: 500, dir: 'high', name: 'high', text: '200-499' },
      { upTo: null, dir: 'high', name: 'very high', text: '500 or higher' },
    ],
  }],
  // ATP III general cutoff for everyone (product decision; the sex-specific 50 came from its metabolic syndrome criteria).
  hdl: [{
    label: 'HDL cholesterol', unit: 'mg/dL', source: 'NCEP ATP III', normal: { low: 40, high: null, text: '40 or higher' }, note: LIPID_NOTE,
    bands: [
      { upTo: 40, dir: 'low', name: 'low', text: 'below 40' },
      { upTo: null, dir: 'normal', name: 'not low', text: '40 or higher', says: 'not be low' },
    ],
  }],
  hemoglobin: (['Male', 'Female'] as const).map((sex) => {
    const cut = sex === 'Male' ? 13 : 12
    return {
      label: 'hemoglobin', unit: 'g/dL', sex, ages: [15, 65] as [number, number], source: 'WHO', normal: { low: cut, high: null, text: `${cut}.0 or higher` },
      note: 'Different ranges apply during pregnancy.',
      bands: [
        { upTo: cut, dir: 'low' as const, name: 'anaemia', text: `below ${cut}.0`, cutoff: 'anaemia', says: 'be below that cutoff', tag: 'below cutoff' },
        { upTo: null, dir: 'normal' as const, name: 'not anaemic', text: `${cut}.0 or higher`, says: 'not be below that cutoff' },
      ],
    }
  }),
}
// Exact editions, each threshold checked against the source text on 2026-11-22: see docs/guidelines.md.
export const SOURCES: Record<string, string> = {
  ADA: 'American Diabetes Association, Standards of Care in Diabetes 2026, Section 2: Diagnosis and Classification of Diabetes, Tables 2.1 and 2.2 (Diabetes Care 2026;49(Suppl. 1):S27-S49, doi:10.2337/dc26-S002)',
  'NCEP ATP III': 'NCEP Adult Treatment Panel III Final Report (Circulation 2002;106(25):3143-3421), ATP III classification of LDL, total, HDL cholesterol and triglycerides',
  WHO: 'WHO Guideline on haemoglobin cutoffs to define anaemia in individuals and populations (Geneva: WHO, 2024; ISBN 978-92-4-008854-2), Table 2, non-pregnant adults aged 15 to 65',
}

// How each source is named in messages: with its edition year where the source has one.
const NAMED: Record<string, string> = { ADA: 'ADA 2026', 'NCEP ATP III': 'NCEP ATP III', WHO: 'WHO 2024' }

export type Outcome =
  | 'agrees'
  | 'lab says normal, guideline says borderline or high/low'
  | 'lab says abnormal, guideline says normal'
  | 'lab and guideline point in opposite directions'
  | 'no guideline for this test'
  | 'unit not recognized'
  | 'no printed range'
  | 'no value'
export type Check = { test: string; key: string; value: string; lab: Dir | 'no range' | null; guideline: string | null; outcome: Outcome; message: string; range_note: string | null; source: string | null; callout: string | null; tag: string | null }

const fmt = (n: number) => String(Number(n.toPrecision(4)))
// "70-110", "< 200", "> 40": the printed text if the model kept it, else built from the bounds.
const rangeText = (t: Test) => t.ref_text?.replace(/(\d)\s*-\s*(\d)/, '$1-$2') ?? (t.ref_low !== null && t.ref_high !== null ? `${t.ref_low}-${t.ref_high}` : t.ref_high !== null ? `below ${t.ref_high}` : `above ${t.ref_low}`)
// 5.6 vs 5.7 or 99 vs 100 is the same cutoff written inclusively; anything further apart is a real difference.
// The step is the guideline's printed precision ("13.0" -> 0.1), so a lab's 13.5 differs from WHO's 13.0.
const step = (printed: string) => 10 ** -((printed.split('.')[1] ?? '').length)
const differs = (lab: number | null, g: number | null, s: number) => g !== null && lab !== null && Math.abs(lab - g) > s + 1e-9

export function checkTest(t: Test, who: Pick<Payload, 'sex' | 'age_band'>): Check {
  const n = normalize(t)
  const shown = `${t.value}${t.unit === '%' ? '' : ' '}${t.unit ?? ''}`.trim()
  const base = { test: t.name, key: n.key, value: shown, lab: null, guideline: null, range_note: null, source: null, callout: null, tag: null }
  const options = GUIDELINES[n.key]
  if (!options) return { ...base, outcome: 'no guideline for this test', message: `No guideline threshold is included for ${t.name} yet, so only your lab's range applies.` }
  if (n.status !== 'ok') return { ...base, outcome: 'unit not recognized', message: `The unit "${t.unit ?? 'none'}" for ${t.name} was not recognized, so no range check was done.` }
  if (n.value === null) return { ...base, outcome: 'no value', message: `No value was read for ${t.name}.` }
  const g = options.find((o) => !o.sex || o.sex === who.sex)
  if (!g || (g.ages && !who.age_band))
    return { ...base, outcome: 'no guideline for this test', message: `The guideline for ${t.name} depends on ${!g ? 'sex' : 'age'}, which was not read from the report, so only your lab's range applies.` }
  const [lo, hi] = (who.age_band ?? '').split(/[-+]/).map(Number) // "60-69" -> 60, 69; "90+" -> 90, NaN
  if (g.ages && !(lo >= g.ages[0] && (hi || 120) <= g.ages[1]))
    return { ...base, outcome: 'no guideline for this test', message: `The guideline for ${t.name} covers ages ${g.ages[0]} to ${g.ages[1]}, so only your lab's range applies.` }

  const band = g.bands.find((b) => b.upTo === null || n.value! < b.upTo)!
  const unitNote = n.value === t.value ? '' : `, which is ${fmt(n.value)} ${g.unit}`
  const src = `a widely used guideline (${NAMED[g.source]})`
  const withUnit = (text: string) => text.replace(/^(below )?([\d.]+(?:-[\d.]+)?)( or higher)?$/, `$1$2${g.unit === '%' ? '' : ' '}${g.unit}$3`) // "126 mg/dL or higher"
  const gText = withUnit(band.text)
  const lab: Check['lab'] = n.ref_low === null && n.ref_high === null ? 'no range' : n.ref_high !== null && n.value > n.ref_high ? 'high' : n.ref_low !== null && n.value < n.ref_low ? 'low' : 'normal'
  const labRange = lab === 'no range' ? null : rangeText(t)
  const s = step(g.normal.text.match(/[\d.]+/)![0])
  const range_note = labRange && (differs(n.ref_high, g.normal.high, s) || differs(n.ref_low, g.normal.low, s))
    ? `Your lab's range for ${g.label} (${labRange}) is different from the range ${src} uses (${withUnit(g.normal.text)}).`
    : null
  const out = { ...base, lab, guideline: `${band.name} (${gText})`, range_note, source: SOURCES[g.source] }
  const where = band.criterion
    ? `${src} uses ${gText} as one of the criteria doctors consider for ${band.criterion}, ${REPEAT}`
    : band.cutoff ? `${src} uses ${gText} as its cutoff for ${band.cutoff}`
    : `${src} treats ${gText} as ${band.dir === 'normal' ? band.name : `the ${band.name} range`}`
  // The callout, only when the two verdicts disagree: what the guideline would say about THIS result.
  const pos = lab === 'normal' ? 'inside' : lab === 'high' ? 'above' : 'below'
  const gWhere = band.criterion ? `${src} uses ${gText} as one of the criteria doctors consider for ${band.criterion} (${REPEAT})` : where
  const callout = `Your result, ${shown}${unitNote}, is ${pos} your lab's range (${labRange}). ${cap(gWhere)}, so by that guideline this result would ${band.says ?? `be ${band.name}`}. You may want to ask your doctor ${band.dir === 'normal' ? 'how to read this' : 'about this'}.`
  const tag = band.tag ?? (band.dir === 'normal' ? 'in range' : band.name)
  const done = (c: Check): Check => {
    const d = disagrees(c) ? { ...c, callout, tag } : c
    return g.note ? { ...d, message: `${d.message} ${g.note}` } : d
  }

  if (lab === 'no range') return done({ ...out, outcome: 'no printed range', message: `Your report shows no range for ${g.label}. Your result is ${shown}${unitNote}; ${where}.${band.dir === 'normal' ? '' : ' You may want to ask your doctor about this.'}` })
  if (lab === 'normal' && band.dir === 'normal') return done({ ...out, outcome: 'agrees', message: `Your ${g.label} result (${shown}${unitNote}) is inside your lab's range (${labRange}), and ${where}.` })
  if (lab === 'normal') return done({ ...out, outcome: 'lab says normal, guideline says borderline or high/low', message: `Your lab's range for ${g.label} is ${labRange}, and your result is ${shown}${unitNote}. ${cap(where)}. You may want to ask your doctor about this.` })
  if (band.dir === 'normal') return done({ ...out, outcome: 'lab says abnormal, guideline says normal', message: `Your lab marks your ${g.label} result (${shown}${unitNote}) as outside its range (${labRange}). ${cap(where)}. You may want to ask your doctor how to read this.` })
  if (band.dir === lab) return done({ ...out, outcome: 'agrees', message: `Your ${g.label} result (${shown}${unitNote}) is outside your lab's range (${labRange}), and ${where}. You may want to ask your doctor about this.` })
  return done({ ...out, outcome: 'lab and guideline point in opposite directions', message: `Your lab's range for ${g.label} is ${labRange} and ${where}; they point in different directions for your result (${shown}${unitNote}). You may want to ask your doctor about this.` })
}

// The "different ranges" callout shows only when the two verdicts disagree; otherwise the range note stays in the details.
export const disagrees = (c: Pick<Check, 'outcome'>) =>
  c.outcome === 'lab says normal, guideline says borderline or high/low' || c.outcome === 'lab says abnormal, guideline says normal' || c.outcome === 'lab and guideline point in opposite directions'

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

export const checkAll = (p: Payload) => p.tests.map((t) => checkTest(t, p))

// Wording rules for every user-facing sentence (engine messages and the AI explanation): describe, never diagnose or blame.
export const BANNED = /you have|you should|wrong|diagnos|treat(ment)? with|take |diabetes range|prediabetes range|anaemia range|below 130/i

// Far-out-of-range rule (product rule, pending review by a doctor; see docs/guidelines.md):
// hemoglobin, platelets and WBC only, below half the lab's lower limit or above twice its upper limit.
// Lipids, glucose and HbA1c are covered by their guideline messages instead.
export const FAR_OUT_BANNER = 'Some results are well outside your lab\'s range. Please share this report with your doctor soon.'
const FAR_OUT_TESTS = new Set(['hemoglobin', 'platelets', 'wbc'])
export const farOutOfRange = (t: Pick<Test, 'name' | 'value' | 'ref_low' | 'ref_high'>) =>
  FAR_OUT_TESTS.has(canonical(t.name)) && t.value !== null &&
  ((t.ref_high !== null && t.ref_high > 0 && t.value > t.ref_high * 2) || (t.ref_low !== null && t.ref_low > 0 && t.value < t.ref_low * 0.5))
