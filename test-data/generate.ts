// Renders synthetic Indian lab reports (HTML -> PNG via Playwright) plus ground-truth JSON.
// All names, IDs and phone numbers are fake. Run: npm run gen
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = dirname(fileURLToPath(import.meta.url))

type T = { name: string; value: number; unit: string; ref: string; section: string }
type Report = {
  id: string
  layout: 'A' | 'B' | 'C'
  lab_name: string
  lab_addr: string
  pii: { patient_name: string; age: string; sex: string; patient_id: string; phone: string; doctor_name: string }
  tests: T[]
  note?: string
}

// Parse a printed range into numbers. "13.0 - 17.0", "< 200", "> 40".
function parseRef(ref: string): { ref_low: number | null; ref_high: number | null } {
  const m = ref.match(/^([\d.]+)\s*-\s*([\d.]+)$/)
  if (m) return { ref_low: +m[1], ref_high: +m[2] }
  if (ref.startsWith('<')) return { ref_low: null, ref_high: +ref.slice(1) }
  if (ref.startsWith('>')) return { ref_low: +ref.slice(1), ref_high: null }
  throw new Error(`bad ref ${ref}`)
}
const flagOf = (t: T) => {
  const { ref_low, ref_high } = parseRef(t.ref)
  return ref_high !== null && t.value > ref_high ? 'H' : ref_low !== null && t.value < ref_low ? 'L' : null
}

const CBC = (v: number[]): T[] => {
  const rows: [string, string, string][] = [
    ['Haemoglobin', 'g/dL', '13.0 - 17.0'],
    ['Total RBC Count', 'mill/cumm', '4.5 - 5.5'],
    ['PCV (Haematocrit)', '%', '40 - 50'],
    ['MCV', 'fL', '83 - 101'],
    ['MCH', 'pg', '27 - 32'],
    ['MCHC', 'g/dL', '31.5 - 34.5'],
    ['Total WBC Count', '/cumm', '4000 - 10000'],
    ['Neutrophils', '%', '40 - 80'],
    ['Lymphocytes', '%', '20 - 40'],
    ['Platelet Count', 'lakhs/cumm', '1.5 - 4.1'],
  ]
  return rows.map(([name, unit, ref], i) => ({ name, unit, ref, value: v[i], section: 'Complete Blood Count (CBC)' }))
}
const LIPID = (v: number[], ldlRef = '< 100'): T[] => {
  const rows: [string, string, string][] = [
    ['Total Cholesterol', 'mg/dL', '< 200'],
    ['Triglycerides', 'mg/dL', '< 150'],
    ['HDL Cholesterol', 'mg/dL', '> 40'],
    ['LDL Cholesterol', 'mg/dL', ldlRef],
    ['VLDL Cholesterol', 'mg/dL', '< 30'],
    ['Total Cholesterol / HDL Ratio', 'Ratio', '3.0 - 5.0'],
  ]
  return rows.map(([name, unit, ref], i) => ({ name, unit, ref, value: v[i], section: 'Lipid Profile' }))
}
const FBS = (value: number, ref = '70 - 100'): T => ({ name: 'Glucose Fasting (FBS)', unit: 'mg/dL', ref, value, section: 'Diabetes Screening' })
const HBA1C = (value: number, eag: number): T[] => [
  { name: 'HbA1c (Glycosylated Haemoglobin)', unit: '%', ref: '4.0 - 5.6', value, section: 'Diabetes Screening' },
  { name: 'Estimated Average Glucose (eAG)', unit: 'mg/dL', ref: '68 - 114', value: eag, section: 'Diabetes Screening' },
]
const THYROID = (v: number[], tshRef = '0.4 - 4.0'): T[] => [
  { name: 'Total T3', unit: 'ng/dL', ref: '80 - 200', value: v[0], section: 'Thyroid Profile' },
  { name: 'Total T4', unit: 'µg/dL', ref: '5.1 - 14.1', value: v[1], section: 'Thyroid Profile' },
  { name: 'TSH (Ultrasensitive)', unit: 'µIU/mL', ref: tshRef, value: v[2], section: 'Thyroid Profile' },
]

const REPORTS: Report[] = [
  {
    id: 'r1', layout: 'A', lab_name: 'Testline Diagnostics Pvt. Ltd.', lab_addr: '12 Sample Road, Fakepur, Pune 411000',
    pii: { patient_name: 'Mr. Aarav Testpatient', age: '34', sex: 'Male', patient_id: 'TL-FAKE-100231', phone: '+91 90000 00001', doctor_name: 'Dr. Placeholder Sharma' },
    tests: CBC([11.8, 4.2, 38.5, 91.6, 28.1, 30.7, 11200, 76, 18, 2.6]),
  },
  {
    id: 'r2', layout: 'B', lab_name: 'Specimen Path Labs', lab_addr: 'Plot 9, Demo Nagar, Jaipur 302000',
    pii: { patient_name: 'Mrs. Priya Samplename', age: '52', sex: 'Female', patient_id: 'SPL/FAKE/2024/0772', phone: '+91 90000 00002', doctor_name: 'Dr. Notreal Iyer' },
    tests: [...LIPID([236, 188, 38, 160, 38, 6.2]), FBS(104, '70 - 110')],
    note: 'Fasting glucose range printed as 70-110 (common cutoff 70-100). 104 is not flagged by the lab.',
  },
  {
    id: 'r3', layout: 'C', lab_name: 'Mockwell Healthcare Laboratory', lab_addr: 'Shop 3, Imaginary Complex, Lucknow 226000',
    pii: { patient_name: 'Rohit Fakename', age: '45', sex: 'Male', patient_id: 'MW00FAKE5531', phone: '+91 90000 00003', doctor_name: 'Dr. Example Verma' },
    tests: [FBS(132), ...HBA1C(7.1, 157)],
  },
  {
    id: 'r4', layout: 'A', lab_name: 'Testline Diagnostics Pvt. Ltd.', lab_addr: '12 Sample Road, Fakepur, Pune 411000',
    pii: { patient_name: 'Ms. Kavya Dummydata', age: '29', sex: 'Female', patient_id: 'TL-FAKE-100877', phone: '+91 90000 00004', doctor_name: 'Dr. Placeholder Sharma' },
    tests: THYROID([118, 6.9, 5.2], '0.35 - 5.50'),
    note: 'TSH range printed as 0.35-5.50 (common cutoff 0.4-4.0). 5.2 is not flagged by the lab.',
  },
  {
    id: 'r5', layout: 'B', lab_name: 'Specimen Path Labs', lab_addr: 'Plot 9, Demo Nagar, Jaipur 302000',
    pii: { patient_name: 'Mr. Imran Testcase', age: '61', sex: 'Male', patient_id: 'SPL/FAKE/2024/0913', phone: '+91 90000 00005', doctor_name: 'Dr. Sample Khan' },
    tests: [...CBC([14.2, 4.9, 43.1, 88, 29, 32.9, 7400, 62, 30, 2.1]), ...HBA1C(6.1, 128)],
  },
  {
    id: 'r6', layout: 'C', lab_name: 'Mockwell Healthcare Laboratory', lab_addr: 'Shop 3, Imaginary Complex, Lucknow 226000',
    pii: { patient_name: 'Sunita Notarealperson', age: '57', sex: 'Female', patient_id: 'MW00FAKE6020', phone: '+91 90000 00006', doctor_name: 'Dr. Example Verma' },
    tests: [
      ...CBC([10.9, 3.9, 34.2, 87.7, 27.9, 31.9, 6100, 58, 33, 1.3]),
      ...LIPID([212, 162, 44, 136, 32, 4.8]),
      FBS(118),
      ...HBA1C(6.6, 143),
      ...THYROID([96, 8.2, 6.8]),
    ],
  },
]

const FOOTER = `<div class="synth">SYNTHETIC TEST DATA. NOT A REAL PATIENT. NOT FOR MEDICAL USE.</div>`
const fmt = (v: number) => (v >= 1000 ? v.toLocaleString('en-IN') : String(v))
const groups = (r: Report) => [...new Set(r.tests.map((t) => t.section))].map((s) => [s, r.tests.filter((t) => t.section === s)] as const)

// Layout A: bordered header box, grid table, flag printed next to the result in bold.
function layoutA(r: Report) {
  const p = r.pii
  return `<style>
  body{font-family:Arial,sans-serif;font-size:14px;margin:28px;color:#111}
  .lab{text-align:center;border-bottom:3px double #000;padding-bottom:8px}
  .lab h1{margin:0;font-size:24px;letter-spacing:1px}.lab small{display:block}
  .pt{border:1px solid #000;margin:12px 0;padding:8px;display:grid;grid-template-columns:1fr 1fr;gap:3px 24px}
  table{width:100%;border-collapse:collapse}th,td{border:1px solid #555;padding:5px 7px;text-align:left}
  th{background:#e8e8e8}.sec td{font-weight:bold;text-align:center;background:#f6f6f6}b.f{margin-left:6px}
  .synth{margin-top:24px;text-align:center;font-weight:bold;color:#b00;border:2px dashed #b00;padding:6px}</style>
  <div class="lab"><h1>${r.lab_name.toUpperCase()}</h1><small>${r.lab_addr} | NABL Accredited (sample)</small></div>
  <div class="pt"><div><b>Patient Name:</b> ${p.patient_name}</div><div><b>Patient ID:</b> ${p.patient_id}</div>
  <div><b>Age / Sex:</b> ${p.age} Yrs / ${p.sex}</div><div><b>Mobile:</b> ${p.phone}</div>
  <div><b>Ref. By:</b> ${p.doctor_name}</div><div><b>Reported:</b> 14/10/2026 11:42 AM</div></div>
  <table><tr><th>Test Name</th><th>Result</th><th>Unit</th><th>Bio. Ref. Interval</th></tr>
  ${groups(r).map(([s, ts]) => `<tr class="sec"><td colspan=4>${s.toUpperCase()}</td></tr>` + ts.map((t) => {
    const f = flagOf(t)
    return `<tr><td>${t.name}</td><td>${fmt(t.value)}${f ? `<b class="f">${f}</b>` : ''}</td><td>${t.unit}</td><td>${t.ref}</td></tr>`
  }).join('')).join('')}</table>
  <p style="margin-top:18px">*** End of Report ***</p><p style="text-align:right">Dr. Fake Pathologist, MD (Path)</p>${FOOTER}`
}

// Layout B: coloured header band, info grid, separate Flag column, bold out-of-range rows.
function layoutB(r: Report) {
  const p = r.pii
  return `<style>
  body{font-family:'Segoe UI',Tahoma,sans-serif;font-size:14px;margin:0;color:#222}
  .band{background:#0d4f8b;color:#fff;padding:16px 28px;display:flex;justify-content:space-between;align-items:center}
  .band h1{margin:0;font-size:26px}.band div{font-size:12px;text-align:right}
  .info{margin:14px 28px;display:grid;grid-template-columns:repeat(3,1fr);gap:6px;background:#eef4fa;padding:10px;border-radius:4px}
  .info span{color:#555;font-size:12px;display:block}
  h3{margin:16px 28px 4px;color:#0d4f8b;border-bottom:2px solid #0d4f8b}
  table{width:calc(100% - 56px);margin:0 28px;border-collapse:collapse}th{text-align:left;font-size:12px;color:#555;border-bottom:1px solid #999;padding:4px}
  td{padding:5px 4px;border-bottom:1px solid #e3e3e3}tr.hi td{font-weight:bold}
  .synth{margin:24px 28px;text-align:center;font-weight:bold;color:#b00;border:2px dashed #b00;padding:6px}</style>
  <div class="band"><h1>${r.lab_name}</h1><div>${r.lab_addr}<br>Toll free 1800-000-0000 (fake)</div></div>
  <div class="info"><div><span>Name</span>${p.patient_name}</div><div><span>Age/Gender</span>${p.age} Y / ${p.sex[0]}</div><div><span>Lab No / UHID</span>${p.patient_id}</div>
  <div><span>Contact</span>${p.phone}</div><div><span>Referred By</span>${p.doctor_name}</div><div><span>Collected</span>02-Nov-2026 08:10</div></div>
  ${groups(r).map(([s, ts]) => `<h3>${s}</h3><table><tr><th>Test Description</th><th>Observed Value</th><th>Flag</th><th>Units</th><th>Biological Reference Interval</th></tr>` +
    ts.map((t) => { const f = flagOf(t); return `<tr class="${f ? 'hi' : ''}"><td>${t.name}</td><td>${fmt(t.value)}</td><td>${f === 'H' ? 'High' : f === 'L' ? 'Low' : ''}</td><td>${t.unit}</td><td>${t.ref}</td></tr>` }).join('') + '</table>').join('')}
  ${FOOTER}`
}

// Layout C: plain monospace, dashed rules, arrows for flags, patient block as key: value lines.
function layoutC(r: Report) {
  const p = r.pii
  return `<style>
  body{font-family:'Courier New',monospace;font-size:13px;margin:26px;color:#000}
  h1{font-size:20px;margin:0}hr{border:0;border-top:1px dashed #000}
  .pt{display:grid;grid-template-columns:150px 1fr 150px 1fr;gap:2px}
  table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:3px 4px}th{border-bottom:1px dashed #000}
  .sec{font-weight:bold;text-decoration:underline;padding-top:10px}
  .synth{margin-top:20px;text-align:center;font-weight:bold;color:#b00;border:2px dashed #b00;padding:6px;font-family:Arial}</style>
  <h1>${r.lab_name}</h1><div>${r.lab_addr}</div><hr>
  <div class="pt"><div>PATIENT</div><div>: ${p.patient_name.toUpperCase()}</div><div>REG. NO.</div><div>: ${p.patient_id}</div>
  <div>AGE/SEX</div><div>: ${p.age}Y/${p.sex.toUpperCase()}</div><div>PH</div><div>: ${p.phone}</div>
  <div>REF. DR.</div><div>: ${p.doctor_name.toUpperCase()}</div><div>DATE</div><div>: 21/11/2026</div></div><hr>
  <table><tr><th>INVESTIGATION</th><th>RESULT</th><th>UNIT</th><th>BIO. REF. INTERVAL</th></tr>
  ${groups(r).map(([s, ts]) => `<tr><td class="sec" colspan=4>${s.toUpperCase()}</td></tr>` + ts.map((t) => {
    const f = flagOf(t)
    return `<tr><td>${t.name}</td><td>${fmt(t.value)} ${f === 'H' ? '&uarr;' : f === 'L' ? '&darr;' : ''}</td><td>${t.unit}</td><td>${t.ref}</td></tr>`
  }).join('')).join('')}</table><hr><div>Method: Automated analyser. Results relate only to the sample tested.</div>${FOOTER}`
}

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 900, height: 600 } })
mkdirSync(join(OUT, 'reports'), { recursive: true })
mkdirSync(join(OUT, 'ground-truth'), { recursive: true })
for (const r of REPORTS) {
  const body = { A: layoutA, B: layoutB, C: layoutC }[r.layout](r)
  await page.setContent(`<!doctype html><meta charset="utf-8"><body>${body}</body>`)
  await page.screenshot({ path: join(OUT, 'reports', `${r.id}.png`), fullPage: true })
  const truth = {
    id: r.id,
    layout: r.layout,
    note: r.note ?? null,
    lab_name: r.lab_name,
    tests: r.tests.map((t) => ({ name: t.name, value: t.value, unit: t.unit, ...parseRef(t.ref), ref_text: t.ref, printed_flag: flagOf(t) })),
    pii: r.pii,
  }
  writeFileSync(join(OUT, 'ground-truth', `${r.id}.json`), JSON.stringify(truth, null, 2) + '\n', 'utf-8')
  console.log(`${r.id}: layout ${r.layout}, ${r.tests.length} tests`)
}
await browser.close()
