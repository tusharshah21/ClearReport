// Copies the Tesseract.js worker, WASM engine and English data into public/ocr/ so OCR runs
// entirely from this site (no CDN, nothing about the user's photo leaves the device).
import { copyFileSync, mkdirSync } from 'node:fs'

const files = {
  'node_modules/tesseract.js/dist/worker.min.js': 'worker.min.js',
  'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js': 'tesseract-core-simd-lstm.wasm.js',
  'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js': 'tesseract-core-lstm.wasm.js', // CPUs without SIMD
  'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js': 'tesseract-core-relaxedsimd-lstm.wasm.js',
  'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz': 'eng.traineddata.gz',
}
mkdirSync('public/ocr', { recursive: true })
for (const [from, to] of Object.entries(files)) copyFileSync(from, `public/ocr/${to}`)
console.log(`copy-ocr: ${Object.keys(files).length} files in public/ocr/`)
