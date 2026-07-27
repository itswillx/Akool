import { useState } from 'react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { inputStyle, labelStyle } from './tokens'

const EMOJI_QUICK_PICKS = [
  '🍔','🍕','☕','🛒','🍺','🍽️','🥗','🍰',
  '🚗','✈️','🚌','⛽','🚂','🛵','🚲','🛺',
  '🏠','💡','🔑','🛋️','🧹','🏡','🪴','🛁',
  '❤️','💊','🏥','💪','🧘','🏋️','🩺','🧬',
  '🎮','🎬','🎵','📺','🎸','🎭','🎲','🃏',
  '📚','🎓','💻','📝','🔬','📐','🖊️','📖',
  '👕','👟','💍','🛍️','👜','🧴','🧣','💄',
  '💰','💵','💳','📈','🐷','🏦','💼','📊',
  '🎯','🏆','🌴','🚀','⭐','🌟','🎁','🎊',
  '📦','🌿','🧩','🎪','🪙','🔧','🏗️','⚡',
]

export function EmojiInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)

  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 40, height: 40, borderRadius: 8, border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, backgroundColor: 'var(--color-surface)', flexShrink: 0 }}>
          {value || '?'}
        </div>
        <input
          style={{ ...inputStyle, flex: 1 }}
          type="text"
          value={value}
          onChange={e => onChange(e.target.value.trim())}
          placeholder={t('finance_emoji_placeholder')}
          maxLength={8}
        />
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 12, flexShrink: 0 }}
        >
          {open ? '▲' : '▼'}
        </button>
      </div>
      {open && (
        <div style={{ marginTop: 8, padding: 10, border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-surface)' }}>
          <p style={{ margin: '0 0 8px', fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600 }}>{t('finance_emoji_suggestions')}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {EMOJI_QUICK_PICKS.map(em => (
              <button
                key={em}
                type="button"
                onClick={() => { onChange(em); setOpen(false) }}
                style={{ width: 32, height: 32, border: value === em ? '2px solid var(--color-text)' : '1px solid var(--color-border)', borderRadius: 6, backgroundColor: value === em ? 'var(--color-active)' : 'transparent', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}
              >
                {em}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
