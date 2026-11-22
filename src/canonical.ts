// Canonical test names. Used by the scorer now, and by the range checker later.
// Lookup: normalise spelling, then try the full name, the name outside (...), and the text inside (...).
// No fuzzy matching: an unknown name only matches the identical normalised name.

export const ALIASES: Record<string, string[]> = {
  hemoglobin: ['hemoglobin', 'hb', 'hgb'],
  rbc: ['total rbc count', 'rbc count', 'rbc', 'red blood cell count', 'erythrocyte count', 'total erythrocyte count'],
  pcv: ['pcv', 'hematocrit', 'hct', 'packed cell volume'],
  mcv: ['mcv', 'mean corpuscular volume'],
  mch: ['mch', 'mean corpuscular hemoglobin'],
  mchc: ['mchc', 'mean corpuscular hemoglobin concentration'],
  wbc: ['total wbc count', 'wbc count', 'wbc', 'total leukocyte count', 'tlc', 'white blood cell count', 'total white blood cell count'],
  neutrophils: ['neutrophils', 'neutrophil', 'polymorphs'],
  lymphocytes: ['lymphocytes', 'lymphocyte'],
  platelets: ['platelet count', 'platelets', 'plt'],
  total_cholesterol: ['total cholesterol', 'cholesterol total', 'serum cholesterol', 'cholesterol'],
  triglycerides: ['triglycerides', 'triglyceride', 'tg', 'serum triglycerides'],
  hdl: ['hdl cholesterol', 'hdl', 'hdl c', 'hdl cholesterol direct'],
  ldl: ['ldl cholesterol', 'ldl', 'ldl c', 'ldl cholesterol calculated', 'ldl cholesterol direct'],
  vldl: ['vldl cholesterol', 'vldl', 'vldl c'],
  tc_hdl_ratio: ['total cholesterol hdl ratio', 'tc hdl ratio', 'cholesterol hdl ratio', 'chol hdl ratio'],
  fasting_glucose: ['glucose fasting', 'fasting glucose', 'fbs', 'fasting blood sugar', 'blood sugar fasting', 'fasting plasma glucose', 'fpg', 'plasma glucose fasting'],
  hba1c: ['hba1c', 'a1c', 'glycosylated hemoglobin', 'glycated hemoglobin', 'glycohemoglobin'],
  eag: ['estimated average glucose', 'eag', 'mean blood glucose', 'mean plasma glucose'],
  t3: ['total t3', 't3', 't3 total', 'triiodothyronine', 'total triiodothyronine'],
  t4: ['total t4', 't4', 't4 total', 'thyroxine', 'total thyroxine'],
  tsh: ['tsh', 'thyroid stimulating hormone', 'tsh ultrasensitive', 'ultrasensitive tsh', 'us tsh'],
}

const norm = (s: string) =>
  s.toLowerCase()
    .replace(/haem/g, 'hem').replace(/aem/g, 'em').replace(/leuco/g, 'leuko') // British -> US spelling
    .replace(/[^a-z0-9]+/g, ' ').trim()

const LOOKUP = new Map(Object.entries(ALIASES).flatMap(([key, names]) => names.map((n) => [norm(n), key] as const)))

export function canonical(name: string | null | undefined): string {
  if (!name) return ''
  const inside = [...name.matchAll(/\(([^)]*)\)/g)].map((m) => m[1])
  const outside = name.replace(/\([^)]*\)/g, ' ')
  for (const c of [name, outside, ...inside]) {
    const key = LOOKUP.get(norm(c))
    if (key) return key
  }
  return `?${norm(name)}`
}
