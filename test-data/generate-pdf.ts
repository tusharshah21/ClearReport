// Synthetic TEXT PDFs (HTML -> PDF via Playwright page.pdf, so they keep a real text layer) in layouts unlike
// Dr Lal PathLabs, plus ground truth. All names, IDs and phone numbers are fake. Run: npx tsx test-data/generate-pdf.ts [id]
//   p1: result first, unit inside the result cell ("11.8 g/dL"), flag column last
//   p2: two tests per printed row (side-by-side panels)
//   p3: messy: wrapped test names, sex-specific ranges, footnote markers, a comment row
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = dirname(fileURLToPath(import.meta.url))
type GT = { name: string; value: number; unit: string; ref_low: number | null; ref_high: number | null; ref_text: string; printed_flag: 'H' | 'L' | null }
// flags: false for a report that prints no H/L flags (its ground truth then has printed_flag null).
const t = (name: string, value: number, unit: string, ref_text: string, ref_low: number | null, ref_high: number | null, flags = true): GT => ({
  name, value, unit, ref_low, ref_high, ref_text,
  printed_flag: !flags ? null : ref_high !== null && value > ref_high ? 'H' : ref_low !== null && value < ref_low ? 'L' : null,
})
const SYNTH = `<p style="margin-top:20px;text-align:center;font-weight:bold;color:#b00;border:2px dashed #b00;padding:6px">SYNTHETIC TEST DATA. NOT A REAL PATIENT. NOT FOR MEDICAL USE.</p>`

const P1 = {
  id: 'p1', lab_name: 'Northfield Clinical Labs', note: 'Result column first, unit inside the result cell, flag column last.',
  pii: { patient_name: 'Mr. Vikram Fakeperson', age: '41', sex: 'Male', patient_id: 'NF-TEST-55102', phone: '+91 90000 00011', doctor_name: 'Dr. Imaginary Menon' },
  tests: [
    t('Haemoglobin', 11.8, 'g/dL', '13.0 - 17.0', 13, 17), t('Total WBC Count', 11200, '/cumm', '4000 - 10000', 4000, 10000),
    t('Platelet Count', 2.6, 'lakhs/cumm', '1.5 - 4.1', 1.5, 4.1), t('Total Cholesterol', 236, 'mg/dL', '< 200', null, 200),
    t('HDL Cholesterol', 38, 'mg/dL', '> 40', 40, null), t('Triglycerides', 140, 'mg/dL', '< 150', null, 150),
    t('Glucose Fasting', 96, 'mg/dL', '70 - 100', 70, 100), t('TSH', 3.1, 'µIU/mL', '0.4 - 4.0', 0.4, 4),
  ],
}
const P2 = {
  id: 'p2', lab_name: 'Riverbend Diagnostics', note: 'Two tests per printed row (side-by-side panels).',
  pii: { patient_name: 'Ms. Ananya Notreal', age: '33', sex: 'Female', patient_id: 'RBD-2026-88410', phone: '+91 90000 00012', doctor_name: 'Dr. Sample Kapoor' },
  tests: [
    t('Haemoglobin', 12.4, 'g/dL', '12.0 - 15.0', 12, 15), t('Total Cholesterol', 182, 'mg/dL', '< 200', null, 200),
    t('Total RBC Count', 4.3, 'mill/cumm', '3.8 - 4.8', 3.8, 4.8), t('Triglycerides', 165, 'mg/dL', '< 150', null, 150),
    t('PCV (Haematocrit)', 38.2, '%', '36 - 46', 36, 46), t('HDL Cholesterol', 52, 'mg/dL', '> 40', 40, null),
    t('MCV', 88, 'fL', '83 - 101', 83, 101), t('LDL Cholesterol', 97, 'mg/dL', '< 100', null, 100),
    t('Total WBC Count', 6800, '/cumm', '4000 - 10000', 4000, 10000), t('VLDL Cholesterol', 33, 'mg/dL', '< 30', null, 30),
    t('Platelet Count', 2.9, 'lakhs/cumm', '1.5 - 4.1', 1.5, 4.1),
  ],
}
// p3: the patient is male, so ref_low/ref_high hold the male bounds of "M: 13-17 / F: 12-15".
const P3 = {
  id: 'p3', lab_name: 'Hillcrest Path Centre', note: 'Wrapped test names, sex-specific ranges (male bounds apply), footnote markers (* #) and a comment row.',
  pii: { patient_name: 'Mr. Kabir Placeholder', age: '58', sex: 'Male', patient_id: 'HPC/TEST/30917', phone: '+91 90000 00013', doctor_name: 'Dr. Dummy Reddy' },
  tests: [
    t('Haemoglobin', 12.1, 'g/dL', 'M: 13-17 / F: 12-15', 13, 17, false), t('Packed Cell Volume (PCV)', 39.5, '%', 'M: 40-50 / F: 36-46', 40, 50, false),
    t('Total Leukocyte Count (TLC)', 7400, '/cumm', '4000 - 10000', 4000, 10000, false), t('Platelet Count', 1.9, 'lakhs/cumm', '1.5 - 4.1', 1.5, 4.1, false),
    t('Fasting Blood Sugar', 132, 'mg/dL', '70 - 100', 70, 100, false), t('Glycosylated Haemoglobin (HbA1c)', 6.6, '%', '4.0 - 5.6', 4, 5.6, false),
    t('Serum Creatinine', 1.1, 'mg/dL', 'M: 0.7-1.3 / F: 0.6-1.1', 0.7, 1.3, false), t('Thyroid Stimulating Hormone (TSH)', 6.8, 'µIU/mL', '0.4 - 4.0', 0.4, 4, false),
  ],
}
const fmt = (v: number) => (v >= 1000 ? v.toLocaleString('en-IN') : String(v))
const flagWord = (g: GT) => (g.printed_flag === 'H' ? 'High' : g.printed_flag === 'L' ? 'Low' : '')

function p1() {
  const p = P1.pii
  return `<style>body{font-family:Georgia,serif;font-size:13px;margin:30px;color:#111}h1{margin:0;color:#225}
  .pt td{padding:2px 14px 2px 0}table.r{width:100%;border-collapse:collapse;margin-top:14px}table.r th,table.r td{border-bottom:1px solid #ccc;padding:5px;text-align:left}</style>
  <h1>${P1.lab_name}</h1><div>44 Example Avenue, Testnagar, Chennai 600000</div><hr>
  <table class="pt"><tr><td>Patient Name : ${p.patient_name}</td><td>UHID : ${p.patient_id}</td></tr>
  <tr><td>Age / Gender : ${p.age} Y / ${p.sex}</td><td>Mobile No. : ${p.phone}</td></tr>
  <tr><td>Consultant : ${p.doctor_name}</td><td>Sample Date : 19/11/2026</td></tr></table>
  <table class="r"><tr><th>Result</th><th>Investigation</th><th>Reference Range</th><th>Flag</th></tr>
  ${P1.tests.map((g) => `<tr><td>${fmt(g.value)} ${g.unit}</td><td>${g.name}</td><td>${g.ref_text}</td><td>${flagWord(g)}</td></tr>`).join('')}</table>${SYNTH}`
}
function p2() {
  const p = P2.pii
  const L = P2.tests.filter((_, i) => i % 2 === 0), R = P2.tests.filter((_, i) => i % 2 === 1)
  const cells = (g?: GT) => (g ? `<td>${g.name}</td><td>${fmt(g.value)}${g.printed_flag ? ` ${g.printed_flag}` : ''}</td><td>${g.unit}</td><td>${g.ref_text}</td>` : '<td></td><td></td><td></td><td></td>')
  return `<style>body{font-family:Verdana,sans-serif;font-size:11px;margin:24px;color:#111}h1{margin:0;font-size:20px;color:#064}
  .pt{display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;background:#eef6f1;padding:8px;margin:10px 0}
  table{width:100%;border-collapse:collapse}th,td{padding:4px 5px;text-align:left;border-bottom:1px solid #ddd}td.gap{width:18px;border:0}
  th{background:#064;color:#fff}</style>
  <h1>${P2.lab_name}</h1><div>Unit 7, Fictional Plaza, Kochi 682000 | Haematology and Biochemistry</div>
  <div class="pt"><div>Name: ${p.patient_name}</div><div>Sample ID: ${p.patient_id}</div><div>Age/Sex: ${p.age} / ${p.sex[0]}</div>
  <div>Contact: ${p.phone}</div><div>Referred by: ${p.doctor_name}</div><div>Reported: 20-11-2026</div></div>
  <table><tr><th>Haematology</th><th>Result</th><th>Unit</th><th>Range</th><td class="gap"></td><th>Lipid Profile</th><th>Result</th><th>Unit</th><th>Range</th></tr>
  ${L.map((g, i) => `<tr>${cells(g)}<td class="gap"></td>${cells(R[i])}</tr>`).join('')}</table>${SYNTH}`
}
function p3() {
  const p = P3.pii
  const mark: Record<string, string> = { Haemoglobin: '*', 'Fasting Blood Sugar': '#' }
  return `<style>body{font-family:Arial,sans-serif;font-size:12px;margin:28px;color:#111}h1{margin:0;font-size:19px}
  table{border-collapse:collapse;margin-top:10px}th,td{padding:4px 8px;text-align:left;vertical-align:top;border-bottom:1px dotted #999}
  td.n{width:120px}.c td{font-style:italic;color:#444}</style>
  <h1>${P3.lab_name}</h1><div>Ground floor, Mock Towers, Bhopal 462000</div><hr>
  <div>Pt. Name: ${p.patient_name} &nbsp;&nbsp; Reg No: ${p.patient_id} &nbsp;&nbsp; Age/Sex: ${p.age}/${p.sex[0]}</div>
  <div>Ph: ${p.phone} &nbsp;&nbsp; Ref Dr: ${p.doctor_name} &nbsp;&nbsp; Collected: 18-11-2026</div><hr>
  <table><tr><th>Test</th><th>Value</th><th>Unit</th><th>Normal Values</th></tr>
  ${P3.tests.map((g) => `<tr><td class="n">${g.name}${mark[g.name] ?? ''}</td><td>${fmt(g.value)}${g.name.includes('TSH') ? ' *' : ''}</td><td>${g.unit}</td><td>${g.ref_text}</td></tr>`).join('')}
  <tr class="c"><td colspan=4>Comment: Sample received in good condition. Values marked * were rechecked on a second run.</td></tr></table>
  <p style="font-size:10px">* Rechecked. # Fasting sample, 10 hours. Normal values are age and sex dependent.</p>${SYNTH}`
}

// r7: a PHOTO whose patient name is printed with no label (big bold line above the details), for the masking test.
const R7 = {
  id: 'r7', lab_name: 'Lakeview Pathology', note: 'Patient name printed without a label. Photo version: r7-photo.',
  pii: { patient_name: 'Rohan Unlabelledname', age: '38', sex: 'Male', patient_id: 'LVP-TEST-40721', phone: '+91 90000 00014', doctor_name: 'Dr. Fictional Bose' },
  tests: [t('Haemoglobin', 13.9, 'g/dL', '13.0 - 17.0', 13, 17, false), t('Total WBC Count', 8100, '/cumm', '4000 - 10000', 4000, 10000, false), t('Platelet Count', 2.2, 'lakhs/cumm', '1.5 - 4.1', 1.5, 4.1, false), t('Glucose Fasting', 91, 'mg/dL', '70 - 100', 70, 100, false)],
}
function r7() {
  const p = R7.pii
  return `<style>body{font-family:Arial,sans-serif;font-size:15px;margin:30px;color:#111;width:840px}h1{margin:0;font-size:22px;color:#333}
  .who{margin:14px 0;border-top:2px solid #333;border-bottom:2px solid #333;padding:8px 0}.who b{font-size:20px;display:block;margin-bottom:4px}
  table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #bbb;padding:6px;text-align:left}</style>
  <h1>${R7.lab_name}</h1><div>5 Lake Road, Sampletown, Mysuru 570000</div>
  <div class="who"><b>${p.patient_name.toUpperCase()}</b>${p.age} Years, ${p.sex} &nbsp;&nbsp; Reg No: ${p.patient_id} &nbsp;&nbsp; Mobile: ${p.phone}<br>Referred by: ${p.doctor_name} &nbsp;&nbsp; Date: 17/11/2026</div>
  <table><tr><th>Test</th><th>Result</th><th>Unit</th><th>Reference</th></tr>
  ${R7.tests.map((g) => `<tr><td>${g.name}</td><td>${fmt(g.value)}</td><td>${g.unit}</td><td>${g.ref_text}</td></tr>`).join('')}</table>${SYNTH}`
}

// demo: TEXT PDF with the r2 values (same lab, layout B photo in generate.ts), for the demo video on Path 1.
const DEMO = {
  id: 'demo', lab_name: 'Specimen Path Labs', note: 'Text PDF of the r2 values (lipid profile and fasting glucose 104, range 70-110). For the demo video.',
  pii: { patient_name: 'Mrs. Meera Fictitious', age: '54', sex: 'Female', patient_id: 'SPL-DEMO-20419', phone: '+91 90000 00015', doctor_name: 'Dr. Example Iyer' },
  tests: [
    t('Total Cholesterol', 236, 'mg/dL', '< 200', null, 200), t('Triglycerides', 188, 'mg/dL', '< 150', null, 150),
    t('HDL Cholesterol', 38, 'mg/dL', '> 40', 40, null), t('LDL Cholesterol', 160, 'mg/dL', '< 100', null, 100),
    t('VLDL Cholesterol', 38, 'mg/dL', '< 30', null, 30), t('Total Cholesterol / HDL Ratio', 6.2, 'Ratio', '3.0 - 5.0', 3, 5),
    t('Glucose Fasting (FBS)', 104, 'mg/dL', '70 - 110', 70, 110),
  ],
}
function demo() {
  const p = DEMO.pii
  return `<style>body{font-family:Arial,sans-serif;font-size:13px;margin:30px;color:#111}h1{margin:0;font-size:21px;color:#123}
  table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border-bottom:1px solid #bbb;padding:6px;text-align:left}</style>
  <h1>${DEMO.lab_name}</h1><div>12 Sample Street, Demopur, Pune 411000</div><hr>
  <div>Patient Name: ${p.patient_name} &nbsp;&nbsp; Lab No: ${p.patient_id} &nbsp;&nbsp; Age/Sex: ${p.age} Y / ${p.sex}</div>
  <div>Mobile: ${p.phone} &nbsp;&nbsp; Ref. By: ${p.doctor_name} &nbsp;&nbsp; Reported: 21/11/2026</div><hr>
  <table><tr><th>Test</th><th>Result</th><th>Unit</th><th>Reference Interval</th><th>Flag</th></tr>
  ${DEMO.tests.map((g) => `<tr><td>${g.name}</td><td>${fmt(g.value)}</td><td>${g.unit}</td><td>${g.ref_text}</td><td>${g.printed_flag ?? ''}</td></tr>`).join('')}</table>${SYNTH}`
}

// demo-unfamiliar: a layout the parser was not written for (two-column result cards: name, then value and unit,
// then the range on its own line), so Path 1 has to use the on-device model. Not added to textcheck on purpose.
const UNF = {
  id: 'demo-unfamiliar', lab_name: 'Bluepine Health Diagnostics', note: 'Two-column result cards (name / value and unit / range lines), a layout the plain-code parser was not written for. For the demo video.',
  pii: { patient_name: 'Ms. Kavya Madeupname', age: '46', sex: 'Female', patient_id: 'BHD-UNF-73150', phone: '+91 90000 00016', doctor_name: 'Dr. Notarealdoc Pillai' },
  tests: [
    t('Haemoglobin', 12.6, 'g/dL', '12.0 - 15.0', 12, 15), t('Total WBC Count', 7600, '/cumm', '4000 - 10000', 4000, 10000),
    t('Platelet Count', 2.4, 'lakhs/cumm', '1.5 - 4.1', 1.5, 4.1), t('Fasting Glucose', 104, 'mg/dL', '70 - 110', 70, 110),
    t('HbA1c', 5.9, '%', '4.0 - 6.0', 4, 6), t('Total Cholesterol', 214, 'mg/dL', '< 200', null, 200),
    t('HDL Cholesterol', 46, 'mg/dL', '> 40', 40, null), t('Triglycerides', 162, 'mg/dL', '< 150', null, 150),
    t('TSH', 2.8, 'µIU/mL', '0.4 - 4.0', 0.4, 4), t('Serum Creatinine', 0.8, 'mg/dL', '0.6 - 1.1', 0.6, 1.1),
  ],
}
function unfamiliar() {
  const p = UNF.pii
  return `<style>body{font-family:Helvetica,Arial,sans-serif;font-size:13px;margin:28px;color:#1b2a3a}h1{margin:0;font-size:22px;color:#1d5b8f}
  .who{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;background:#eef4fa;border-radius:8px;padding:10px 14px;margin:12px 0}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.card{border:1px solid #c9d8e6;border-radius:10px;padding:10px 14px}
  .n{font-weight:bold;font-size:14px}.v{font-size:20px;margin:4px 0}.r{color:#555}.f{color:#b03a2e;font-weight:bold}</style>
  <h1>${UNF.lab_name}</h1><div>Plot 9, Placeholder Park, Jaipur 302000</div>
  <div class="who"><div>Patient: ${p.patient_name}</div><div>Visit ID: ${p.patient_id}</div><div>${p.age} yrs, ${p.sex}</div><div>Phone: ${p.phone}</div><div>Referred by: ${p.doctor_name}</div><div>Report date: 22/11/2026</div></div>
  <div class="grid">${UNF.tests.map((g) => `<div class="card"><div class="n">${g.name}</div><div class="v">${fmt(g.value)} ${g.unit}${g.printed_flag ? ` <span class="f">${flagWord(g)}</span>` : ''}</div><div class="r">Expected: ${g.ref_text}</div></div>`).join('')}</div>${SYNTH}`
}

const only = process.argv[2] // optional: generate just this id
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage()
for (const [r, html] of ([[P1, p1()], [P2, p2()], [P3, p3()], [DEMO, demo()], [UNF, unfamiliar()]] as const).filter(([r]) => !only || r.id === only)) {
  await page.setContent(`<!doctype html><meta charset="utf-8"><title>${r.lab_name}, synthetic sample report</title><body>${html}</body>`) // the title is what a PDF viewer shows (otherwise "about:blank")
  await page.pdf({ path: join(OUT, 'reports', `${r.id}.pdf`), format: 'A4', printBackground: true })
  writeFileSync(join(OUT, 'ground-truth', `${r.id}.json`), JSON.stringify({ id: r.id, layout: r.id, note: r.note, lab_name: r.lab_name, tests: r.tests, pii: r.pii }, null, 2) + '\n', 'utf-8')
  console.log(`${r.id}: ${r.tests.length} tests`)
}
// r7-photo: same phone-photo treatment as generate.ts (rotation, tilt, blur, uneven light, JPEG q60).
if (!only || only === 'r7-photo') {
await page.setViewportSize({ width: 900, height: 600 })
await page.setContent(`<!doctype html><meta charset="utf-8"><body>${r7()}</body>`)
const png = (await page.screenshot({ fullPage: true })).toString('base64')
await page.setViewportSize({ width: 1100, height: 1200 })
await page.setContent(`<!doctype html><body style="margin:0;background:#5f5242;width:1100px;height:1200px;display:grid;place-items:center;overflow:hidden">
  <div style="perspective:1400px"><div style="position:relative;transform:rotateX(6deg) rotateY(-5deg) rotate(-3deg);box-shadow:0 18px 40px rgba(0,0,0,.55)">
    <img src="data:image/png;base64,${png}" style="display:block;max-width:960px;filter:blur(0.7px) contrast(.92)">
    <div style="position:absolute;inset:0;background:radial-gradient(circle at 60% 30%,rgba(255,250,235,.25),rgba(0,0,0,.35) 75%)"></div>
  </div></div></body>`)
await page.screenshot({ path: join(OUT, 'reports', 'r7-photo.jpg'), type: 'jpeg', quality: 60 })
writeFileSync(join(OUT, 'ground-truth', 'r7-photo.json'), JSON.stringify({ id: 'r7-photo', layout: 'r7', note: R7.note, lab_name: R7.lab_name, tests: R7.tests, pii: R7.pii }, null, 2) + '\n', 'utf-8')
console.log('r7-photo: unlabelled name, rotate -3deg, tilt 6/-5, blur 0.7px, JPEG q60')
}
await browser.close()
