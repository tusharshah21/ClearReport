import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Flow from './Flow'
import Spike from './Spike'

// ?spike opens the dev evaluation page (synthetic reports only).
const Page = new URLSearchParams(location.search).has('spike') ? Spike : Flow

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)
