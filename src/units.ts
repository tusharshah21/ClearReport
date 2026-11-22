// Plain code, no AI: converts a test's value and printed range to one canonical unit per test.
// Unknown unit => status 'unit not recognized' and no numbers are converted. Never guess.
import { canonical } from './canonical'

type Conv = number | ((v: number) => number) // a factor, or a formula for non-linear units
type Spec = { unit: string; from: Record<string, Conv> }

// Keys are normalised unit spellings (see normUnit). Every spelling here must be listed on purpose.
const CELLS_UL = ['/cumm', 'cells/cumm', '/ul', 'cells/ul', '/mm3', 'cells/mm3', '/cmm']
const THOU_UL = ['thou/ul', 'thou/cumm', 'thou/mm3','10^3/ul', 'x10^3/ul', '10e3/ul', '10^3/cumm', 'x10^3/cumm', 'k/ul', '10^9/l', 'x10^9/l']
const MILL_UL = ['mill/cumm', 'mill/mm3','million/cumm', 'mill/ul', 'million/ul', '10^6/ul', 'x10^6/ul', '10^12/l', 'x10^12/l', 'm/ul']
const all = (names: string[], c: Conv) => Object.fromEntries(names.map((n) => [n, c]))
const same = (...names: string[]) => all(names, 1)

const MGDL = ['mg/dl', 'mg%']
export const UNITS: Record<string, Spec> = {
  hemoglobin: { unit: 'g/dL', from: { ...same('g/dl', 'gm/dl', 'g%', 'gm%'), 'g/l': 0.1 } },
  rbc: { unit: 'million/µL', from: same(...MILL_UL) },
  pcv: { unit: '%', from: { ...same('%'), 'l/l': 100 } },
  mcv: { unit: 'fL', from: same('fl', 'cu.micron', 'um3') },
  mch: { unit: 'pg', from: same('pg') },
  mchc: { unit: 'g/dL', from: { ...same('g/dl', 'gm/dl', '%'), 'g/l': 0.1 } },
  wbc: { unit: '/µL', from: { ...all(CELLS_UL, 1), ...all(THOU_UL, 1e3) } },
  neutrophils: { unit: '%', from: same('%') },
  lymphocytes: { unit: '%', from: same('%') },
  platelets: { unit: '/µL', from: { ...all(CELLS_UL, 1), ...all(THOU_UL, 1e3), ...all(['lakhs/cumm', 'lakh/cumm', 'lakhs/ul', 'lakh/ul', 'lakhs/mm3'], 1e5) } },
  // mmol/L factors: glucose 18.016 (MW 180.16), cholesterol 38.67, triglycerides 88.57.
  fasting_glucose: { unit: 'mg/dL', from: { ...same(...MGDL), 'mmol/l': 18.016 } },
  eag: { unit: 'mg/dL', from: { ...same(...MGDL), 'mmol/l': 18.016 } },
  total_cholesterol: { unit: 'mg/dL', from: { ...same(...MGDL), 'mmol/l': 38.67 } },
  hdl: { unit: 'mg/dL', from: { ...same(...MGDL), 'mmol/l': 38.67 } },
  ldl: { unit: 'mg/dL', from: { ...same(...MGDL), 'mmol/l': 38.67 } },
  vldl: { unit: 'mg/dL', from: { ...same(...MGDL), 'mmol/l': 38.67 } },
  triglycerides: { unit: 'mg/dL', from: { ...same(...MGDL), 'mmol/l': 88.57 } },
  tc_hdl_ratio: { unit: 'ratio', from: same('ratio', '') },
  // IFCC mmol/mol -> NGSP % (NGSP master equation): % = 0.09148 * mmol/mol + 2.152
  hba1c: { unit: '%', from: { ...same('%', '%ofhb', '%hb'), 'mmol/mol': (v) => 0.09148 * v + 2.152 } },
  t3: { unit: 'ng/dL', from: { ...same('ng/dl'), 'ng/ml': 100 } },
  t4: { unit: 'µg/dL', from: same('ug/dl') },
  tsh: { unit: 'µIU/mL', from: same('uiu/ml', 'miu/l', 'uu/ml', 'mu/l') },
}

export const normUnit = (u: string | null | undefined) =>
  String(u ?? '').toLowerCase()
    .replace(/[µμ]/g, 'u').replace(/mcg/g, 'ug').replace(/×/g, 'x').replace(/\s+/g, '')
    .replace(/cu\.?mm$/, 'cumm').replace(/mcl$/, 'ul').replace(/mm\^?3$/, 'mm3')
    .replace(/lacs?\//, 'lakhs/').replace(/^thousands?\//, 'thou/').replace(/^x?10\*\*?(\d+)/, '10^$1')

export type Normalized = {
  key: string // canonical test key ('?...' if unknown)
  status: 'ok' | 'unit not recognized' | 'unknown test'
  unit: string | null // canonical unit when ok
  value: number | null
  ref_low: number | null
  ref_high: number | null
}
type In = { name: string; value: number | null; unit: string | null; ref_low: number | null; ref_high: number | null }

const round = (n: number) => Number(n.toPrecision(10)) // drop float noise like 260000.00000000003

export function normalize(t: In): Normalized {
  const key = canonical(t.name)
  const spec = UNITS[key]
  if (!spec) return { key, status: 'unknown test', unit: null, value: t.value, ref_low: t.ref_low, ref_high: t.ref_high }
  const c = spec.from[normUnit(t.unit)]
  if (c === undefined) return { key, status: 'unit not recognized', unit: t.unit, value: t.value, ref_low: t.ref_low, ref_high: t.ref_high }
  const conv = (v: number | null) => (v === null ? null : round(typeof c === 'number' ? v * c : c(v)))
  return { key, status: 'ok', unit: spec.unit, value: conv(t.value), ref_low: conv(t.ref_low), ref_high: conv(t.ref_high) }
}
