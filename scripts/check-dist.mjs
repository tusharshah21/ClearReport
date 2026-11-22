// Fails `npm run build` if dev-only secrets or dev-only code reached dist/.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv } from 'vite'

const token = loadEnv('development', process.cwd()).VITE_APPCHECK_DEBUG_TOKEN || loadEnv('production', process.cwd()).VITE_APPCHECK_DEBUG_TOKEN
// (The global name FIREBASE_APPCHECK_DEBUG_TOKEN itself is read by the App Check SDK, so it is not banned.)
const banned = ['VITE_APPCHECK_DEBUG_TOKEN', '/__runs', ...(token ? [token] : [])]

const files = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]))
const hits = files('dist').flatMap((f) => banned.filter((b) => readFileSync(f, 'latin1').includes(b)).map((b) => `${f}: ${b === token ? '<debug token value>' : b}`))

if (hits.length) {
  console.error('check-dist FAILED, dev-only content in dist/:\n  ' + hits.join('\n  '))
  process.exit(1)
}
console.log(`check-dist ok: ${banned.length} banned strings absent from dist/ (debug token ${token ? 'checked' : 'not set'})`)
