import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { mkdirSync, writeFileSync } from 'node:fs'

// Dev-only endpoint: the spike page POSTs each synthetic run here; eval.ts scores the files.
const saveRuns: Plugin = {
  name: 'save-runs',
  configureServer(server) {
    server.middlewares.use('/__runs', (req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const run = JSON.parse(body)
        if (!/^r\d$/.test(run.report) || !['device', 'cloud'].includes(run.mode)) return res.writeHead(400).end()
        mkdirSync('test-data/runs', { recursive: true })
        writeFileSync(`test-data/runs/${run.report}.${run.mode}.${run.strategy}.json`, JSON.stringify(run, null, 2) + '\n', 'utf-8')
        res.end('ok')
      })
    })
  },
}

export default defineConfig({ plugins: [react(), saveRuns] })
