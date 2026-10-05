import { useId, useReducer } from 'react'
import { flushSync } from 'react-dom'
import { appPreviewContent } from '../../i18n/appPreviewContent'
import type { PreviewCardId } from '../../i18n/appPreviewContent'
import type { Lang } from '../../i18n/translations'
import type { Translate } from './authView'
import { Board, Finance, Overview, Page, Sidebar, Study } from './previewParts'
import type { PartProps } from './previewParts'
import { INITIAL_PREVIEW, reducePreview, variantOf } from './previewState'
import type { AppPreviewVariant, PreviewAction, PreviewNav } from './previewState'
import './appPreview.css'

export type { AppPreviewVariant } from './previewState'

// Prévia do app nas telas públicas: uma janela do Akool desenhada em código
// (sem imagens, então segue o tema e o idioma). Dois modos:
// - ilustração (padrão; painel do login): aria-hidden + inert, nada focável;
// - demonstração (`interactive`; hero e vitrine da landing): barra lateral,
//   visões do quadro, cards que andam de coluna, tarefas, pontos de estudo e
//   meses do gráfico funcionam, sem sair dali.
// O módulo mostrado é controlado por quem usa (`variant` + `onVariantChange`:
// a vitrine troca a aba junto); o resto do estado fica aqui (previewState.ts).
// Medidas em em (appPreview.css): o tamanho só muda o font-size.

function body(variant: AppPreviewVariant, props: PartProps) {
  if (variant === 'overview') return <Overview {...props} />
  if (variant === 'pages') return <Page {...props} />
  if (variant === 'finance') return <Finance {...props} />
  if (variant === 'study') return <Study {...props} />
  return <Board {...props} />
}

export function AppPreview({ lang, t, variant, size = 'md', interactive = false, onVariantChange, onInteract }: {
  lang: Lang
  t: Translate
  variant: AppPreviewVariant
  /** md: com a barra lateral (landing); sm: só o conteúdo (painel do login). */
  size?: 'md' | 'sm'
  interactive?: boolean
  /** A barra lateral pediu outro módulo. */
  onVariantChange?: (variant: AppPreviewVariant) => void
  /** Qualquer interação (a vitrine pausa a troca automática). */
  onInteract?: () => void
}) {
  const c = appPreviewContent[lang]
  const uid = useId()
  const [s, dispatch] = useReducer(reducePreview, INITIAL_PREVIEW)

  const act = (action: PreviewAction) => {
    dispatch(action)
    onInteract?.()
  }
  // O botão do card remonta na coluna nova: o foco vai junto (como no Tabs).
  const move = (id: PreviewCardId) => {
    flushSync(() => dispatch({ type: 'move', id }))
    onInteract?.()
    document.getElementById(`${uid}-card-${id}`)?.focus()
  }
  const nav = (next: PreviewNav) => {
    onInteract?.()
    onVariantChange?.(variantOf(next))
  }

  const props: PartProps = { c, t, lang, s, uid, act: interactive ? act : undefined, move: interactive ? move : undefined }
  const chrome = (
    <div className="pv-chrome">
      <span className="pv-dot" />
      <span className="pv-dot" />
      <span className="pv-dot" />
      <span className="pv-chrome-title">Akool</span>
      {interactive && <span className="pv-hint">{c.demo.hint}</span>}
    </div>
  )
  const content = (
    <div className="pv-body">
      {size === 'md' && <Sidebar c={c} uid={uid} variant={variant} onNav={interactive ? nav : undefined} />}
      <div className="pv-main">{body(variant, props)}</div>
    </div>
  )

  if (!interactive) {
    return (
      <div className={`pv pv-${size}`} aria-hidden="true" inert>
        {chrome}
        {content}
      </div>
    )
  }
  return (
    <div className={`pv pv-${size} pv-live`} role="group" aria-label={c.demo.label}>
      {chrome}
      {content}
    </div>
  )
}
