import { useState } from 'react'
import { FileText, Pencil, Layers, ChevronDown, CheckSquare, UserPlus, FileDown } from 'lucide-react'
import type { Page, PageType } from '../types'
import { usePages } from '../contexts/PagesContext'
import { useAuth } from '../contexts/AuthContext'
import { usePagePresence } from '../hooks/usePagePresence'
import { useLanguage } from '../i18n/LanguageContext'
import SharePageModal from './SharePageModal'

const ICONS = [
  '📄','📝','📋','📊','📈','📉','🗒️','🗂️','📁','📂',
  '🎨','✏️','🖊️','🖋️','✒️','🖌️','🖍️',
  '💡','🔍','🔎','🔖','📌','📍','🧩','🚀','⚡','🌟','🔥','✅',
  '🏠','🏢','🌍','🌐','💻','�','⌨️','🖥️','🖨️',
  '📚','📖','�','🗞️','📜','📃',
  '🎯','🏆','🥇','🎖️','🏅','🎗️',
  '💼','🧳','🗃️','🗄️','�️',
  '🔑','🔐','🔒','�','🛡️',
  '�','💭','🗨️','🗯️','📢','📣',
  '❤️','🧡','💛','💚','�','💜','🖤','🤍','🤎',
  '⭐','🌙','☀️','⛅','🌈','❄️','🌊','🔮','💎','�',
  '🐶','�','🐭','🦊','🐻','🐼','🐨','🐯','🦁','🐸','🦋',
  '�','🍊','🍋','🍇','🍓','🍕','☕','🍵','🎂',
  '🎵','🎶','🎸','🎹','🎺','🎻','🥁','🎤','🎧',
  '⚽','🏀','🏈','⚾','🎾','🏐','🏉','🎱','🏓','🏸',
]

interface PageHeaderProps {
  page: Page
  isMobile?: boolean
}

function useTypeOptions() {
  const { t } = useLanguage()
  return [
    { value: 'note' as PageType, label: t('page_type_note'), icon: <FileText size={14} /> },
    { value: 'drawing' as PageType, label: t('page_type_drawing'), icon: <Pencil size={14} /> },
    { value: 'both' as PageType, label: t('page_type_both'), icon: <Layers size={14} /> },
    { value: 'todo' as PageType, label: t('page_type_todo'), icon: <CheckSquare size={14} /> },
  ]
}

function PresenceAvatar({ name, email }: { name: string | null; email: string }) {
  const label = name || email
  const initial = label[0]?.toUpperCase() ?? '?'
  const [hovered, setHovered] = useState(false)
  const { t } = useLanguage()

  const colors = ['#4f6ef7', '#e96c6c', '#43c59e', '#f0a500', '#9b59b6']
  const colorIndex = (email.charCodeAt(0) + email.charCodeAt(email.length - 1)) % colors.length
  const bg = colors[colorIndex]

  return (
    <div style={{ position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        backgroundColor: bg, display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 12, fontWeight: 700,
        color: '#fff', border: '2px solid var(--color-bg)', cursor: 'default',
        flexShrink: 0,
      }}>
        {initial}
      </div>
      {hovered && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: 'var(--color-logo-bg)', color: 'var(--color-logo-text)',
          fontSize: 11, padding: '4px 8px', borderRadius: 6,
          whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 200,
        }}>
          {label} · {t('page_header_presence_editing')}
        </div>
      )}
    </div>
  )
}

export default function PageHeader({ page, isMobile = false }: PageHeaderProps) {
  const { updatePage, userShareRole } = usePages()
  const { user } = useAuth()
  const { t } = useLanguage()
  const typeOptions = useTypeOptions()
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState(page.title)
  const [showIconPicker, setShowIconPicker] = useState(false)
  const [showTypeMenu, setShowTypeMenu] = useState(false)
  const [showShare, setShowShare] = useState(false)
  const [customEmoji, setCustomEmoji] = useState('')
  const [exporting, setExporting] = useState(false)

  const activeUsers = usePagePresence(page.id)
  const role = userShareRole(page.id)
  const canShare = role === 'owner' || role === 'co_owner'
  const canEdit = role === 'owner' || role === 'co_owner' || role === 'editor'

  const handleTitleBlur = () => {
    setEditingTitle(false)
    if (titleValue.trim() && titleValue !== page.title) {
      updatePage(page.id, { title: titleValue.trim() })
    }
  }

  const handleIconSelect = (icon: string) => {
    updatePage(page.id, { icon })
    setShowIconPicker(false)
  }

  const handleTypeChange = async (type: PageType) => {
    setShowTypeMenu(false)
    if (type === page.type) return
    await updatePage(page.id, { type })
  }

  const currentTypeOption = typeOptions.find(t => t.value === page.type) ?? typeOptions[0]

  return (
    <div style={{ flexShrink: 0, padding: isMobile ? '20px 20px 12px' : '40px 80px 16px', position: 'relative' }}>
      {/* Icon picker */}
      <div style={{ position: 'relative', display: 'inline-block', marginBottom: 8 }}>
        <button
          onClick={() => canEdit && setShowIconPicker(!showIconPicker)}
          style={{ fontSize: isMobile ? 32 : 40, background: 'none', border: 'none', cursor: canEdit ? 'pointer' : 'default', padding: 0, lineHeight: 1, opacity: 1 }}
          title={t('page_header_change_icon')}
        >
          {page.icon || '📄'}
        </button>
        {showIconPicker && canEdit && (
          <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', padding: 12, zIndex: 50, width: 280 }}>
            {/* Custom emoji input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '6px 8px', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-bg-tertiary)' }}>
              <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0, minWidth: 24, textAlign: 'center' }}>
                {customEmoji || '✏️'}
              </span>
              <input
                value={customEmoji}
                onChange={e => setCustomEmoji(e.target.value)}
                placeholder={t('page_header_emoji_placeholder')}
                maxLength={8}
                style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13, color: 'var(--color-text)', backgroundColor: 'transparent', minWidth: 0 }}
              />
              <button
                onClick={() => { if (customEmoji.trim()) { handleIconSelect(customEmoji.trim()); setCustomEmoji('') } }}
                disabled={!customEmoji.trim()}
                style={{ padding: '3px 10px', borderRadius: 6, border: 'none', cursor: customEmoji.trim() ? 'pointer' : 'not-allowed', backgroundColor: customEmoji.trim() ? 'var(--color-btn-primary)' : 'var(--color-btn-disabled)', color: 'var(--color-btn-primary-text)', fontSize: 12, fontWeight: 500, flexShrink: 0 }}
              >
                {t('page_header_emoji_apply')}
              </button>
            </div>
            {/* Preset grid */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, maxHeight: 180, overflowY: 'auto' }}>
              {ICONS.map(ic => (
                <button key={ic} onClick={() => handleIconSelect(ic)} style={{ fontSize: 20, background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 6, lineHeight: 1 }}>
                  {ic}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
        {editingTitle && canEdit ? (
          <input
            autoFocus
            value={titleValue}
            onChange={e => setTitleValue(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={e => { if (e.key === 'Enter') handleTitleBlur() }}
            style={{ flex: 1, minWidth: 0, fontSize: isMobile ? 24 : 36, fontWeight: 700, color: 'var(--color-text)', background: 'none', border: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.2, padding: 0 }}
          />
        ) : (
          <h1
            onClick={() => { if (canEdit) { setEditingTitle(true); setTitleValue(page.title) } }}
            style={{ flex: 1, minWidth: 0, fontSize: isMobile ? 24 : 36, fontWeight: 700, color: page.title ? 'var(--color-text)' : 'var(--color-border-active)', cursor: canEdit ? 'text' : 'default', lineHeight: 1.2, margin: 0, wordBreak: 'break-word' }}
          >
            {page.title || t('page_header_untitled')}
          </h1>
        )}

        {/* Right-side controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginTop: 4 }}>
          {/* Presence avatars */}
          {activeUsers.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: -4 }}>
              {activeUsers.slice(0, 5).map(u => (
                <PresenceAvatar key={u.user_id} name={u.display_name} email={u.email} />
              ))}
              {activeUsers.length > 5 && (
                <div style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: 'var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', border: '2px solid var(--color-bg)' }}>
                  +{activeUsers.length - 5}
                </div>
              )}
            </div>
          )}

          {/* Export PDF button */}
          <button
            onClick={async () => {
              if (exporting) return
              setExporting(true)
              try {
                const date = new Date().toISOString().slice(0, 10)
                const safeTitle = (page.title || 'page').replace(/[^a-zA-Z0-9_-]/g, '_')
                const { exportPagesToPdf } = await import('../hooks/usePdfExport')
                await exportPagesToPdf([page], `${safeTitle}-${date}.pdf`)
              } catch (err) {
                console.error('[PageHeader] PDF export error:', err)
              } finally {
                setExporting(false)
              }
            }}
            disabled={exporting}
            title={t('export_pdf_title')}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: exporting ? 'not-allowed' : 'pointer', fontSize: 13, color: exporting ? 'var(--color-text-muted)' : 'var(--color-text-muted)', opacity: exporting ? 0.6 : 1 }}
          >
            <FileDown size={13} />
            {!isMobile && <span>{t('export_pdf_export_btn')}</span>}
          </button>

          {/* Share button */}
          {canShare && (
            <button
              onClick={() => setShowShare(true)}
              title={t('page_header_share')}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: 'pointer', fontSize: 13, color: 'var(--color-text-muted)' }}
            >
              <UserPlus size={13} />
              {!isMobile && <span>{t('page_header_share')}</span>}
            </button>
          )}

          {/* Type toggle */}
          {canEdit && (
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowTypeMenu(!showTypeMenu)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: 'pointer', fontSize: 13, color: 'var(--color-text-muted)' }}
              >
                {currentTypeOption.icon}
                {!isMobile && <span>{currentTypeOption.label}</span>}
                <ChevronDown size={12} />
              </button>
              {showTypeMenu && (
                <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', overflow: 'hidden', zIndex: 50, minWidth: 160 }}>
                  {typeOptions.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => handleTypeChange(opt.value)}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', fontSize: 13, textAlign: 'left', color: page.type === opt.value ? 'var(--color-text)' : 'var(--color-text-muted)', fontWeight: page.type === opt.value ? 600 : 400 }}
                    >
                      {opt.icon}{opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Read-only badge for viewer */}
          {role === 'viewer' && (
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', padding: '3px 8px', border: '1px solid var(--color-border)', borderRadius: 6 }}>
              {t('page_header_readonly')}
            </span>
          )}
        </div>
      </div>

      {(showIconPicker || showTypeMenu) && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => { setShowIconPicker(false); setShowTypeMenu(false) }} />
      )}

      {/* Shared indicator */}
      {page.is_shared && user && page.user_id !== user.id && (
        <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
          {t('page_header_shared_indicator')} · {role === 'viewer' ? t('page_header_role_viewer') : role === 'editor' ? t('page_header_role_editor') : t('page_header_role_co_owner')}
        </p>
      )}

      <SharePageModal
        open={showShare}
        onClose={() => setShowShare(false)}
        pageId={page.id}
        pageTitle={page.title}
      />
    </div>
  )
}
