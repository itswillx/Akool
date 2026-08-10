import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary'
import { useLanguage } from './i18n/LanguageContext'
import { runLegacyProjectsMigration } from './lib/docsNavigation'

// Antes do primeiro render: readInitialMode() (inicializador de useState) e o
// restore do PagesContext leem localStorage direto — precisam ver as chaves da
// era pós-'projects' já reescritas.
runLegacyProjectsMigration()

// Última linha de defesa: pega qualquer erro que escape dos ErrorBoundaries
// internos (ex. um provider de contexto quebrando antes de montar). useLanguage()
// é seguro aqui mesmo sem LanguageProvider como ancestral, pois o contexto tem
// um valor default real (ver LanguageContext.tsx).
function RootFallback() {
  const { t } = useLanguage()
  return (
    <div style={{ padding: 24, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, minHeight: '100vh', justifyContent: 'center' }}>
      <p style={{ margin: 0, fontSize: 14 }}>{t('common_error_fatal')}</p>
      <button
        onClick={() => window.location.reload()}
        style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #ccc', background: 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
      >
        {t('common_error_reload')}
      </button>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fallback={<RootFallback />}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
