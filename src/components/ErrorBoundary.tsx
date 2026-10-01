import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useLanguage } from '../i18n/LanguageContext'
import { isChunkLoadError } from '../lib/chunkReload'
import { reportError } from '../lib/observability'

const fallbackStyle = { padding: 24, textAlign: 'center', color: 'var(--color-text-muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 } as const
const buttonStyle = { padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text)', cursor: 'pointer', fontSize: 13, fontWeight: 600 } as const

// Default fallback UI. A function component so it can read the current language;
// the retry button asks the boundary to re-mount its children.
function DefaultFallback({ onRetry }: { onRetry: () => void }) {
  const { t } = useLanguage()
  return (
    <div style={fallbackStyle}>
      <p style={{ margin: 0, fontSize: 14 }}>{t('common_error_section')}</p>
      <button onClick={onRetry} style={buttonStyle}>{t('common_error_retry')}</button>
    </div>
  )
}

// A chunk that failed to load can't be retried in place: React.lazy keeps the
// rejected import, and after a deploy the file is gone from the server anyway.
// Only a reload (which picks up the current index.html) gets the section back.
function ChunkErrorFallback() {
  const { t } = useLanguage()
  return (
    <div style={fallbackStyle}>
      <p style={{ margin: 0, fontSize: 14 }}>{t('common_error_chunk')}</p>
      <button onClick={() => window.location.reload()} style={buttonStyle}>{t('common_error_reload')}</button>
    </div>
  )
}

interface Props {
  children: ReactNode
  // Optional custom fallback; when omitted the translated default is shown.
  fallback?: ReactNode
  // When it changes (e.g. the open page), the error is dropped without
  // remounting the children — for boundaries that outlive what they wrap.
  resetKey?: unknown
}

interface State {
  hasError: boolean
  chunkError: boolean
}

// Catches render/runtime errors in a subtree so a failure in one section (e.g.
// the finance module) degrades gracefully instead of blanking the whole app.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, chunkError: false }

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, chunkError: isChunkLoadError(error) }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, info.componentStack)
    // REL-011: o SDK não vê erro que um boundary capturou; reporta aqui.
    reportError(error, { componentStack: info.componentStack, chunkError: this.state.chunkError })
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && !Object.is(prevProps.resetKey, this.props.resetKey)) this.reset()
  }

  private reset = () => this.setState({ hasError: false, chunkError: false })

  render() {
    if (!this.state.hasError) return this.props.children
    if (this.props.fallback !== undefined) return this.props.fallback
    return this.state.chunkError ? <ChunkErrorFallback /> : <DefaultFallback onRetry={this.reset} />
  }
}

export default ErrorBoundary
