import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { runLegacyProjectsMigration } from './lib/docsNavigation'

// Antes do primeiro render: readInitialMode() (inicializador de useState) e o
// restore do PagesContext leem localStorage direto — precisam ver as chaves da
// era pós-'projects' já reescritas.
runLegacyProjectsMigration()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
