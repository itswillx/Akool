import { useId } from 'react'
import type { ComponentType, CSSProperties, ReactNode } from 'react'
import { FileText, KeyRound, Lock, LogIn, ShieldCheck, Smartphone, SquareKanban, Ticket, Wallet } from 'lucide-react'
import { authContent } from '../../i18n/authContent'
import type { AuthPanel, AuthPanelContext } from '../../i18n/authContent'
import type { Lang } from '../../i18n/translations'
import { AppPreview } from './AppPreview'
import type { Translate } from './authView'

// O painel ao lado do cartão (≥ 960 px) ou embaixo dele: muda com a tela. Em
// Entrar, a prévia do app e o que espera a pessoa; em Criar conta, os passos
// com o convite; em Recuperar, no MFA e na senha nova, como funciona. O texto
// fica em authContent.ts. Sem links nem títulos repetidos do cartão (o
// formulário continua sendo o único lugar com Entrar / Criar conta).

type Icon = ComponentType<{ size?: number; 'aria-hidden'?: boolean; style?: CSSProperties }>

const POINT_ICONS: Partial<Record<AuthPanelContext, [Icon, Icon, Icon]>> = {
  signin: [FileText, SquareKanban, Wallet],
  reset: [KeyRound, Lock, ShieldCheck],
}

const NOTE_ICONS: Record<AuthPanelContext, Icon> = {
  signin: ShieldCheck,
  signup: Ticket,
  forgot: Lock,
  mfa: Smartphone,
  reset: LogIn,
}

const BADGE: CSSProperties = {
  width: 32, height: 32, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  backgroundColor: 'var(--color-accent-soft)', color: 'var(--color-accent)', fontSize: 13, fontWeight: 700,
}

function Items({ panel, icons }: { panel: AuthPanel; icons?: [Icon, Icon, Icon] }) {
  const steps = panel.kind === 'steps'
  const items: ReactNode[] = panel.items.map((item, i) => {
    const ItemIcon = icons?.[i]
    return (
      <li key={item.title} style={{ position: 'relative', display: 'flex', gap: 12, alignItems: 'flex-start', paddingBottom: steps && i < 2 ? 14 : 0 }}>
        {/* Nos passos, uma linha liga um número ao próximo. */}
        {steps && i < 2 && <span aria-hidden="true" style={{ position: 'absolute', left: 15.5, top: 34, bottom: 0, width: 1, backgroundColor: 'var(--color-border-strong)' }} />}
        <span aria-hidden="true" style={{ ...BADGE, borderRadius: steps ? 999 : 9 }}>
          {ItemIcon ? <ItemIcon size={16} /> : i + 1}
        </span>
        <span style={{ paddingTop: 5 }}>
          <strong style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{item.title}</strong>
          <span style={{ display: 'block', marginTop: 2, fontSize: 13, lineHeight: 1.5, color: 'var(--color-text-muted)' }}>{item.text}</span>
        </span>
      </li>
    )
  })
  const listStyle: CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: steps ? 0 : 14 }
  return steps ? <ol style={listStyle}>{items}</ol> : <ul style={listStyle}>{items}</ul>
}

export function AuthContextPanel({ lang, t, context, wide }: {
  lang: Lang
  t: Translate
  context: AuthPanelContext
  /** Ao lado do cartão (com a prévia em Entrar); senão, embaixo e mais compacto. */
  wide: boolean
}) {
  const titleId = useId()
  const panel = authContent[lang][context]
  const NoteIcon = NOTE_ICONS[context]
  return (
    <aside aria-labelledby={titleId} className="auth-stagger" style={{ display: 'flex', flexDirection: 'column', gap: wide ? 18 : 14, maxWidth: wide ? 480 : undefined, order: wide ? -1 : undefined }}>
      <h2 id={titleId} style={{ margin: 0, fontSize: wide ? 24 : 18, fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.02em', color: 'var(--color-text)' }}>
        {panel.title}
      </h2>
      <p style={{ margin: 0, fontSize: wide ? 15 : 14, lineHeight: 1.55, color: 'var(--color-text-muted)' }}>{panel.lead}</p>
      {wide && context === 'signin' && <AppPreview lang={lang} t={t} variant="overview" size="sm" />}
      <Items panel={panel} icons={POINT_ICONS[context]} />
      <p style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: 0, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', fontSize: 13, lineHeight: 1.5, color: 'var(--color-text-subtle)' }}>
        <NoteIcon size={15} aria-hidden style={{ flexShrink: 0, marginTop: 2, color: 'var(--color-accent)' }} />
        {panel.note}
      </p>
    </aside>
  )
}
