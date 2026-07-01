import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useLanguage } from '../i18n/LanguageContext'

// Default fallback UI. A function component so it can read the current language;
// the retry button asks the boundary to re-mount its children.
function DefaultFallback({ onRetry }: { onRetry: () => void }) {
  const { t } = useLanguage()
  return (
    <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <p style={{ margin: 0, fontSize: 14 }}>{t('common_error_section')}</p>
      <button
        onClick={onRetry}
        style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
      >
        {t('common_error_retry')}
      </button>
    </div>
  )
}

interface Props {
  children: ReactNode
  // Optional custom fallback; when omitted the translated default is shown.
  fallback?: ReactNode
}

interface State {
  hasError: boolean
}

// Catches render/runtime errors in a subtree so a failure in one section (e.g.
// the finance module) degrades gracefully instead of blanking the whole app.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, info.componentStack)
  }

  private reset = () => this.setState({ hasError: false })

  render() {
    if (!this.state.hasError) return this.props.children
    if (this.props.fallback !== undefined) return this.props.fallback
    return <DefaultFallback onRetry={this.reset} />
  }
}

export default ErrorBoundary
