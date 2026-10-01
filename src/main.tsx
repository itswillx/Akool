import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary'
import { useLanguage } from './i18n/LanguageContext'
import { isLangLoaded, loadLang, toLang } from './i18n/translations'
import type { Lang } from './i18n/translations'
import { runLegacyProjectsMigration } from './lib/docsNavigation'
import { installChunkReload } from './lib/chunkReload'
import { initObservability, reportError } from './lib/observability'
import { missingEnv } from './lib/env'
import ConfigErrorScreen from './components/ConfigErrorScreen'

// Antes do primeiro render: readInitialMode() (inicializador de useState) e o
// restore do PagesContext leem localStorage direto — precisam ver as chaves da
// era pós-'projects' já reescritas.
runLegacyProjectsMigration()

// SEC-009: fontes do Excalidraw servidas pelo próprio app (sem o CDN esm.sh).
window.EXCALIDRAW_ASSET_PATH = __EXCALIDRAW_ASSET_PATH__

// Chunk que sumiu depois de um deploy: recarrega uma vez na versão nova.
installChunkReload(window, import.meta.env.BASE_URL)

// Erros de produção no Sentry (REL-011); sem VITE_SENTRY_DSN no build, no-op.
initObservability()

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

// PERF-009: só o pt-BR vem no boot. Com outro idioma salvo, o dicionário chega
// antes do 1º render, para não abrir em português e trocar em seguida. Falhou
// ou passou de 3 s? Abre em pt-BR, e o LanguageProvider troca quando chegar.
const savedLang = toLang(localStorage.getItem('excalinotion_auth_lang'))
const langReady = Promise.race([
  loadLang(savedLang).catch(() => {}),
  new Promise<void>(resolve => setTimeout(resolve, 3000)),
])

void langReady.then(() => {
  // UX-006: leitor de tela e tradutor do navegador leem o idioma daqui.
  const lang: Lang = isLangLoaded(savedLang) ? savedLang : 'pt-BR'
  document.documentElement.lang = lang
  const root = createRoot(document.getElementById('root')!)
  // DEV-003: build sem a configuração do Supabase explica o que falta, em vez
  // de tela branca (o createClient quebrava na importação).
  if (missingEnv.length > 0) {
    reportError(new Error(`Configuração ausente no build: ${missingEnv.join(', ')}`))
    root.render(<StrictMode><ConfigErrorScreen missing={missingEnv} lang={lang} /></StrictMode>)
    return
  }
  root.render(
    <StrictMode>
      <ErrorBoundary fallback={<RootFallback />}>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
})
