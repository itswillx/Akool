import { useId, useState } from 'react'
import { useLanguage } from '../../i18n/LanguageContext'
import { CATEGORY_LABELS, NOTIFICATION_CATEGORIES } from '../../lib/notificationKinds'
import type { NotificationCategory } from '../../lib/notificationKinds'
import { readNotificationPrefs, writeNotificationPrefs } from '../../lib/notificationPrefs'

// Configurações → Notificações (NOTIF-001): quais categorias mostram o aviso no
// canto quando chega uma notificação nova. Desligar não esconde a notificação:
// ela continua na central. Vale neste aparelho (src/lib/notificationPrefs.ts).
export function NotificationPrefsTab() {
  const { t } = useLanguage()
  const titleId = useId()
  const [muted, setMuted] = useState<NotificationCategory[]>(() => readNotificationPrefs().muted)

  const toggle = (category: NotificationCategory) => {
    const next = muted.includes(category) ? muted.filter(c => c !== category) : [...muted, category]
    setMuted(next)
    writeNotificationPrefs({ muted: next })
  }

  return (
    <section aria-labelledby={titleId}>
      <h3 id={titleId} style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>{t('notif_prefs_title')}</h3>
      <p style={{ margin: '6px 0 16px', fontSize: 13, lineHeight: 1.5, color: 'var(--color-text-muted)' }}>{t('notif_prefs_desc')}</p>
      <div role="group" aria-labelledby={titleId} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {NOTIFICATION_CATEGORIES.map(category => (
          <label
            key={category}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--color-border)', cursor: 'pointer', fontSize: 14, color: 'var(--color-text)' }}
          >
            <input type="checkbox" checked={!muted.includes(category)} onChange={() => toggle(category)} style={{ width: 16, height: 16, accentColor: 'var(--color-accent)' }} />
            {t(CATEGORY_LABELS[category])}
          </label>
        ))}
      </div>
    </section>
  )
}
