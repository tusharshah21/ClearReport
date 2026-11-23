// Fails `npm run build` if dev-only secrets or dev-only code reached dist/.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv } from 'vite'

const token = loadEnv('development', process.cwd()).VITE_APPCHECK_DEBUG_TOKEN || loadEnv('production', process.cwd()).VITE_APPCHECK_DEBUG_TOKEN
// (The global name FIREBASE_APPCHECK_DEBUG_TOKEN itself is read by the App Check SDK, so it is not banned.)
const banned = ['VITE_APPCHECK_DEBUG_TOKEN', '/__runs', ...(token ? [token] : [])]

const files = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]))
const hits = files('dist').flatMap((f) => banned.filter((b) => readFileSync(f, 'latin1').includes(b)).map((b) => `${f}: ${b === token ? '<debug token value>' : b}`))

// Documents and images that may be deployed: the synthetic sample report, the landing page images and the favicon only.
// Real reports (test-data/real-samples), other test data and run files must never reach dist/.
const media = files('dist').map((f) => f.replace(/\\/g, '/')).filter((f) => /\.(pdf|png|jpe?g|webp|gif|svg)$/i.test(f))
for (const f of media) if (!/^dist\/(samples\/demo\.pdf|favicon\.svg|landing\/[a-z0-9-]+\.(jpg|png|webp))$/.test(f)) hits.push(`${f}: not an allowed public file`)
if (files('dist').some((f) => /test-data|real-samples|WM1[45]/i.test(f))) hits.push('dist/: test data path')
if (!readFileSync('dist/samples/demo.pdf').equals(readFileSync('test-data/reports/demo.pdf'))) hits.push('dist/samples/demo.pdf: differs from test-data/reports/demo.pdf')

if (hits.length) {
  console.error('check-dist FAILED, dev-only content in dist/:\n  ' + hits.join('\n  '))
  process.exit(1)
}
console.log(`check-dist ok: ${banned.length} banned strings absent from dist/ (debug token ${token ? 'checked' : 'not set'}); public files: ${media.map((f) => f.slice(5)).join(', ')}`)
