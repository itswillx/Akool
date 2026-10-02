import { WifiOff } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'
import { useOnlineStatus } from '../lib/connectivity'

// REL-012: faixa no topo do app enquanto não há conexão. As edições de notas,
// desenhos e quick notes ficam num rascunho local e são reenviadas sozinhas.
export default function OfflineBanner() {
  const online = useOnlineStatus()
  const { t } = useLanguage()
  if (online) return null
  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', flexShrink: 0,
        fontSize: 12.5, fontWeight: 600, color: 'var(--color-text)',
        backgroundColor: 'color-mix(in srgb, var(--color-warning) 18%, var(--color-bg))',
        borderBottom: '1px solid color-mix(in srgb, var(--color-warning) 45%, transparent)',
      }}
    >
      <WifiOff size={14} style={{ color: 'var(--color-warning)', flexShrink: 0 }} />
      {t('offline_banner')}
    </div>
  )
}
