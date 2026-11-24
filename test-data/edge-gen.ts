// Synthetic edge-case files for scripts/edge.ts, into test-data/edge/. Every identity is fake.
// Run: npx tsx test-data/edge-gen.ts   (needs ffmpeg on PATH for the 12 MP photo)
import { chromium } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const OUT = 'test-data/edge'
mkdirSync(OUT, { recursive: true })
const SYNTH = `<p style="margin-top:20px;text-align:center;font-weight:bold;color:#b00;border:2px dashed #b00;padding:6px">SYNTHETIC TEST DATA. NOT A REAL PATIENT. NOT FOR MEDICAL USE.</p>`
const STYLE = `<style>body{font-family:Arial,sans-serif;font-size:13px;margin:30px;color:#111}h1{margin:0;font-size:21px;color:#123}
  table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border-bottom:1px solid #bbb;padding:6px;text-align:left}.pb{page-break-after:always}</style>`
const header = (age = 'Age/Sex: 47 Y / Male') => `<h1>Edgecase Path Labs</h1><div>4 Nowhere Lane, Testville 400000</div><hr>
  <div>Patient Name: Mr. Rohan Unrealname &nbsp;&nbsp; Lab No: EPL-EDGE-30871 &nbsp;&nbsp; ${age}</div>
  <div>Mobile: +91 90000 00031 &nbsp;&nbsp; Ref. By: Dr. Fictional Rao &nbsp;&nbsp; Reported: 21/11/2026</div><hr>`
const table = (rows: string[][]) => `<table><tr><th>Test</th><th>Result</th><th>Unit</th><th>Reference Interval</th><th>Flag</th></tr>
  ${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`
const LIPIDS = [['Total Cholesterol', '236', 'mg/dL', '&lt; 200', 'H'], ['HDL Cholesterol', '38', 'mg/dL', '&gt; 40', 'L'], ['Glucose Fasting (FBS)', '104', 'mg/dL', '70 - 110', '']]

const pdfs: Record<string, string> = {
  'one-test': header() + table([['Glucose Fasting (FBS)', '104', 'mg/dL', '70 - 110', '']]) + SYNTH,
  'unknown-test': header() + table([...LIPIDS, ['Serum Zorblin Index', '7.4', 'zu/mL', '2.0 - 6.0', 'H']]) + SYNTH,
  'no-age-sex': header('') + table(LIPIDS) + SYNTH,
  'invoice': `<h1>Brightmart Electronics</h1><div>Tax invoice INV-2026-0042, 21/11/2026</div><hr>
    <div>Bill to: Mr. Rohan Unrealname, +91 90000 00031</div>
    <table><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>
    <tr><td>USB-C cable 1.5 m</td><td>2</td><td>249.00</td><td>498.00</td></tr><tr><td>Phone case</td><td>1</td><td>399.00</td><td>399.00</td></tr>
    <tr><td>GST 18%</td><td></td><td></td><td>161.46</td></tr><tr><td><b>Total</b></td><td></td><td></td><td><b>1058.46</b></td></tr></table>${SYNTH}`,
  // 20 pages: results on page 1, then 19 pages of notes (no results), as long lab PDFs do.
  'pages-20': `<div class="pb">${header()}${table(LIPIDS)}${SYNTH}</div>` + Array.from({ length: 19 }, (_, i) =>
    `<div${i < 18 ? ' class="pb"' : ''}><h2>Notes and terms, page ${i + 2}</h2><p>${'Results relate only to the sample tested. Reference intervals depend on age, sex and method. Please consult your doctor to interpret these results. '.repeat(12)}</p></div>`).join(''),
}

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage()
for (const [id, html] of Object.entries(pdfs)) {
  await page.setContent(`<!doctype html><meta charset="utf-8"><body>${STYLE}${html}</body>`)
  await page.pdf({ path: `${OUT}/${id}.pdf`, format: 'A4', printBackground: true })
}
// Scanned: the r2 report as a picture inside a PDF, so the PDF has no text layer.
const r2 = readFileSync('test-data/reports/r2.png').toString('base64')
await page.setContent(`<!doctype html><body style="margin:0"><img src="data:image/png;base64,${r2}" style="width:100%"></body>`)
await page.pdf({ path: `${OUT}/scanned.pdf`, format: 'A4' })
await browser.close()

// Password-protected: a minimal PDF with a Standard security handler whose /U does not match the empty password,
// which is what a reader sees for a PDF that needs a password to open (the content itself does not matter).
{
  const hex = (n: number, seed: number) => Array.from({ length: n }, (_, i) => ((i * 37 + seed) % 256).toString(16).padStart(2, '0')).join('')
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>',
    `<< /Filter /Standard /V 1 /R 2 /O <${hex(32, 11)}> /U <${hex(32, 99)}> /P -44 >>`]
  let body = '%PDF-1.4\n', offs: number[] = []
  objs.forEach((o, i) => { offs.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const x = body.length
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Encrypt 4 0 R /ID [<${hex(16, 5)}> <${hex(16, 5)}>] >>\nstartxref\n${x}\n%%EOF\n`
  writeFileSync(`${OUT}/password.pdf`, body, 'latin1')
}
writeFileSync(`${OUT}/empty.pdf`, '')
writeFileSync(`${OUT}/text-renamed.pdf`, 'Glucose Fasting 104 mg/dL 70 - 110\nThis is a plain text file renamed to .pdf.\n')
// A .docx is a zip; only its signature matters here (the app must refuse it clearly, not read it).
writeFileSync(`${OUT}/report.docx`, Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.alloc(200)]))
// HEIC: Chrome on desktop cannot decode HEIC at all, so a file with a HEIC header behaves like a real iPhone photo here.
writeFileSync(`${OUT}/iphone.heic`, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic\0\0\0\0mif1heic', 'latin1'), Buffer.alloc(400)]))
// About 12 MP: r6-photo scaled to 4000x3000.
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', 'test-data/reports/r6-photo.jpg', '-vf', 'scale=4000:3000', '-q:v', '3', `${OUT}/photo-12mp.jpg`])
console.log('edge files in', OUT)
