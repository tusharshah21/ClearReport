import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fonts are self-hosted (no request to Google Fonts): Latin and Devanagari subsets, the four weights in use.
import '@fontsource/noto-sans/latin-400.css'
import '@fontsource/noto-sans/latin-500.css'
import '@fontsource/noto-sans/latin-600.css'
import '@fontsource/noto-sans/latin-700.css'
import '@fontsource/noto-sans-devanagari/devanagari-400.css'
import '@fontsource/noto-sans-devanagari/devanagari-500.css'
import '@fontsource/noto-sans-devanagari/devanagari-600.css'
import '@fontsource/noto-sans-devanagari/devanagari-700.css'
import './index.css'
// Routes: "/" is the landing page (no Firebase, no AI, nothing about a report); "/app" is the tool.
// ?spike opens the dev evaluation page (synthetic reports only). It is not part of the production build.
const spike = import.meta.env.DEV && new URLSearchParams(location.search).has('spike')
const isApp = location.pathname.replace(/\/+$/, '') === '/app'
let Page: () => React.ReactNode
if (spike || isApp) {
  document.title = 'ClearReport: read your report'
  const [{ startSession }, { loadConfig }] = await Promise.all([import('./firebase'), import('./remote')])
  Page = spike ? (await import('./Spike')).default : (await import('./Flow')).default
  startSession() // not awaited: the app works while sign-in finishes
  await loadConfig() // at most 3 s; defaults otherwise
} else {
  Page = (await import('./Landing')).default
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)
