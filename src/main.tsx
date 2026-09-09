import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'

// Phosphor icon fonts (regular / bold / fill) — referenced by name throughout.
import '@phosphor-icons/web/regular'
import '@phosphor-icons/web/bold'
import '@phosphor-icons/web/fill'

import './theme.css'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { startInstallSupport } from './lib/pwa-install'
import { registerServiceWorker } from './lib/register-service-worker'

startInstallSupport()
registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
)
