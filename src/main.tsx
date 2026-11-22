import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Flow from './Flow'
import { loadConfig } from './remote'

// ?spike opens the dev evaluation page (synthetic reports only). It is not part of the production build.
const spike = import.meta.env.DEV && new URLSearchParams(location.search).has('spike')
const Page = spike ? (await import('./Spike')).default : Flow

await loadConfig() // at most 3 s; defaults otherwise
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)
