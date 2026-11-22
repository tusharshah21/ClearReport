// Range-check table for saved cloud runs. Run: npm run ranges [-- r1 r2 ...]
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { checkAll } from '../src/guidelines'
import { toPayload } from '../src/privacy'

const ids = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync('test-data/ground-truth').map((f) => f.replace('.json', '')).sort()
for (const id of ids) {
  const f = ['single', 'split', 'pages'].map((s) => `test-data/runs/${id}.cloud.${s}.json`).find(existsSync)
  const run = f && JSON.parse(readFileSync(f, 'utf-8'))
  if (!run?.ok) { console.log(`\n## ${id}: no successful cloud run`); continue }
  const { payload } = toPayload(run.output)
  console.log(`\n## ${id} (${payload.sex ?? 'sex not read'}, ${payload.age_band ?? 'age not read'})\n`)
  console.log('| test | value | lab | guideline | outcome | message | range note |\n|---|---|---|---|---|---|---|')
  for (const c of checkAll(payload)) console.log(`| ${c.test} | ${c.value} | ${c.lab ?? '-'} | ${c.guideline ?? '-'} | ${c.outcome} | ${c.message} | ${c.range_note ?? ''} |`)
}
