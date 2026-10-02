import { lazy, Suspense, useRef, useState } from 'react'
import { Database, Gift, KeyRound, Lock, LogOut, ScrollText, ShieldCheck, User, Users, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { useIsMobile } from '@/shared/hooks/useIsMobile'
import { useDialog } from '@/shared/hooks/useDialog'
import ApiTokensSection from './ApiTokensSection'
import MfaSection from './MfaSection'
import ProfileTab from './settings/ProfileTab'
import PasswordTab from './settings/PasswordTab'
import MyInvitesTab from './settings/MyInvitesTab'
import { PanelFallback, TabBtn } from './settings/settingsUi'

// ARCH-008: a casca das Configurações (cabeçalho, abas, rodapé). Cada aba é
// um componente em settings/; os painéis de admin carregam sob demanda.
//
// O App monta o modal só enquanto está aberto e o desmonta ao fechar: cada
// abertura nasce na aba de perfil, com formulários e mensagens zerados. Nada
// aqui depende de `profile`: a troca de senha reautentica e troca o objeto do
// perfil no meio do caminho, o que antes devolvia a aba ao perfil e engolia a
// mensagem.

const UserManagementPanel = lazy(() => import('./UserManagementPanel'))
const BackupPanel = lazy(() => import('../modules/backup'))
const AuditLogPanel = lazy(() => import('../modules/audit'))

interface Props {
  open: boolean
  onClose: () => void
}

type Tab = 'profile' | 'password' | 'security' | 'invites' | 'api' | 'users' | 'backup' | 'audit'

export default function UserSettingsModal({ open, onClose }: Props) {
  const { user, isAdmin, signOut } = useAuth()
  const { t } = useLanguage()
  // O fundo fecha (clique fora), então o Esc também (UX-003).
  const { titleId, dialogProps } = useDialog({ open, onClose, closeOnEsc: true })
  const isMobile = useIsMobile()
  const [tab, setTab] = useState<Tab>('profile')
  const overlayRef = useRef<HTMLDivElement>(null)

  if (!open) return null

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose()
  }

  // Os painéis de admin precisam de uma casca bem mais larga e alta do que as
  // abas da conta, que ficam compactas.
  const wideTab = tab === 'users' || tab === 'backup' || tab === 'audit'

  return (
    <div role="presentation"
      ref={overlayRef}
      onClick={handleOverlayClick}
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? 12 : 24 }}
    >
      <div {...dialogProps} style={{ backgroundColor: 'var(--color-surface)', borderRadius: 16, boxShadow: '0 8px 40px rgba(0,0,0,0.24)', width: '100%', maxWidth: wideTab ? (isMobile ? '100%' : 980) : 460, height: wideTab ? 'calc(100dvh - 48px)' : undefined, maxHeight: 'calc(100dvh - 48px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 0' }}>
          <div>
            <h2 id={titleId} style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-text)' }}>{t('settings_title')}</h2>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>{user?.email}</p>
          </div>
          <button type="button" aria-label={t('dialog_close')} onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
            <X size={15} />
          </button>
        </div>

        <div className="finance-hide-scrollbar" style={{ display: 'flex', gap: 3, padding: '16px 24px 0', flexWrap: 'nowrap', overflowX: 'auto' }}>
          <TabBtn active={tab === 'profile'} onClick={() => setTab('profile')} icon={<User size={13} />} label={t('settings_tab_profile')} />
          <TabBtn active={tab === 'password'} onClick={() => setTab('password')} icon={<Lock size={13} />} label={t('settings_tab_password')} />
          <TabBtn active={tab === 'security'} onClick={() => setTab('security')} icon={<ShieldCheck size={13} />} label={t('settings_tab_security')} />
          <TabBtn active={tab === 'invites'} onClick={() => setTab('invites')} icon={<Gift size={13} />} label={t('settings_tab_invites')} />
          <TabBtn active={tab === 'api'} onClick={() => setTab('api')} icon={<KeyRound size={13} />} label={t('settings_tab_api')} />
          {isAdmin && <TabBtn active={tab === 'users'} onClick={() => setTab('users')} icon={<Users size={13} />} label={t('sidebar_users')} />}
          {isAdmin && <TabBtn active={tab === 'backup'} onClick={() => setTab('backup')} icon={<Database size={13} />} label={t('sidebar_backup')} />}
          {isAdmin && <TabBtn active={tab === 'audit'} onClick={() => setTab('audit')} icon={<ScrollText size={13} />} label={t('sidebar_audit')} />}
        </div>

        <div style={{ height: 1, backgroundColor: 'var(--color-border)', margin: '12px 0 0' }} />

        <div style={wideTab
          ? { flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }
          : { padding: '20px 24px 24px', overflowY: 'auto', minHeight: 0, flex: 1 }}>
          {tab === 'users' && <Suspense fallback={<PanelFallback />}><UserManagementPanel /></Suspense>}
          {tab === 'backup' && <Suspense fallback={<PanelFallback />}><BackupPanel /></Suspense>}
          {tab === 'audit' && <Suspense fallback={<PanelFallback />}><AuditLogPanel /></Suspense>}
          {tab === 'api' && <ApiTokensSection />}
          {tab === 'security' && <MfaSection />}
          {tab === 'profile' && <ProfileTab />}
          {tab === 'password' && <PasswordTab />}
          {tab === 'invites' && <MyInvitesTab />}
        </div>

        {/* Rodapé fixo, fora do corpo que rola: sair fica junto da conta. */}
        <div style={{ borderTop: '1px solid var(--color-border)', padding: '12px 24px', flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => { onClose(); void signOut() }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-error)', fontSize: 13, fontWeight: 600, padding: '6px 4px' }}
          >
            <LogOut size={14} />
            {t('sidebar_signout')}
          </button>
        </div>
      </div>
    </div>
  )
}
