// ARCH-002: saiu do ProjectsPanel.tsx sem mudança de lógica.
import {
Search,
Trash2
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { UserAvatar } from '../../../components/UserAvatar'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../contexts/ToastContext'
import { useIsMobile } from '../../../hooks/useIsMobile'
import { useLanguage } from '../../../i18n/LanguageContext'
import {
addBoardShare,
listBoardShares,
removeBoardShare,
searchUsersForShare
} from '../../../lib/data/projects'
import { mapWriteError, requireRows, runGuarded } from '../../../lib/optimistic'
import { sanitizeIlikeTerm } from '../../../lib/profileSearch'
import { isRateLimited } from '../../../lib/rateLimit'
import type { ProjectBoard, ProjectColumn, ProjectShare, ProjectShareRole } from '../../../types'
import type { Member } from '../projectsShared'
import { BOARD_COLORS, BOARD_ICONS, inputStyle, labelStyle } from '../projectsShared'
import { GhostBtn, Modal, PrimaryBtn } from '../ui'

// ─── Board modal ────────────────────────────────────────────────────────────

export function BoardModal({ board, onClose, onSave }: { board: ProjectBoard | null; onClose: () => void; onSave: (data: { name: string; icon: string; color: string; description: string }) => void }) {
  const { t } = useLanguage()
  const isMobile = useIsMobile()
  const [name, setName] = useState(board?.name ?? '')
  const [icon, setIcon] = useState(board?.icon ?? '📋')
  const [color, setColor] = useState(board?.color ?? '#6366f1')
  const [description, setDescription] = useState(board?.description ?? '')
  return (
    <Modal title={board ? t('projects_edit_board') : t('projects_create_board')} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle}>{t('projects_board_name')}</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder={t('projects_board_name_placeholder')} style={inputStyle} autoFocus={!isMobile} />
        </div>
        <div>
          <label style={labelStyle}>{t('projects_board_icon')}</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {BOARD_ICONS.map(ic => (
              <button key={ic} onClick={() => setIcon(ic)} style={{ width: 34, height: 34, borderRadius: 8, border: '1.5px solid', borderColor: icon === ic ? '#6366f1' : 'var(--color-border)', background: icon === ic ? '#6366f11f' : 'var(--color-bg)', fontSize: 17, cursor: 'pointer' }}>{ic}</button>
            ))}
          </div>
        </div>
        <div>
          <label style={labelStyle}>{t('projects_board_color')}</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {BOARD_COLORS.map(c => (
              <button type="button" aria-label={t('common_color', { color: c })} aria-pressed={color === c} key={c} onClick={() => setColor(c)} style={{ width: 26, height: 26, borderRadius: '50%', border: color === c ? '3px solid var(--color-text)' : '2px solid transparent', backgroundColor: c, cursor: 'pointer' }} />
            ))}
          </div>
        </div>
        <div>
          <label style={labelStyle}>{t('projects_board_description')}</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <GhostBtn onClick={onClose}>{t('projects_cancel')}</GhostBtn>
          <PrimaryBtn onClick={() => onSave({ name, icon, color, description })} disabled={!name.trim()}>{board ? t('projects_save') : t('projects_create')}</PrimaryBtn>
        </div>
      </div>
    </Modal>
  )
}

// ─── Column modal ─────────────────────────────────────────────────────────────

export function ColumnModal({ column, onClose, onSave }: { column: ProjectColumn | null; onClose: () => void; onSave: (data: { name: string; color: string; wip_limit: number | null }) => void }) {
  const { t } = useLanguage()
  const isMobile = useIsMobile()
  const [name, setName] = useState(column?.name ?? '')
  const [color, setColor] = useState(column?.color ?? '#94a3b8')
  const [wip, setWip] = useState<string>(column?.wip_limit != null ? String(column.wip_limit) : '')
  return (
    <Modal title={column ? t('projects_rename_column') : t('projects_add_column')} onClose={onClose} width={380}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle}>{t('projects_column_name')}</label>
          <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} autoFocus={!isMobile} />
        </div>
        <div>
          <label style={labelStyle}>{t('projects_board_color')}</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {BOARD_COLORS.map(c => (
              <button type="button" aria-label={t('common_color', { color: c })} aria-pressed={color === c} key={c} onClick={() => setColor(c)} style={{ width: 24, height: 24, borderRadius: '50%', border: color === c ? '3px solid var(--color-text)' : '2px solid transparent', backgroundColor: c, cursor: 'pointer' }} />
            ))}
          </div>
        </div>
        <div>
          <label style={labelStyle}>{t('projects_wip_limit')}</label>
          <input type="number" min={0} value={wip} onChange={e => setWip(e.target.value)} style={inputStyle} placeholder="—" />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <GhostBtn onClick={onClose}>{t('projects_cancel')}</GhostBtn>
          <PrimaryBtn onClick={() => onSave({ name: name.trim() || t('projects_column_name'), color, wip_limit: wip === '' ? null : Math.max(0, parseInt(wip, 10) || 0) })} disabled={!name.trim()}>{t('projects_save')}</PrimaryBtn>
        </div>
      </div>
    </Modal>
  )
}

// ─── Share modal ──────────────────────────────────────────────────────────────

export function ShareModal({ board, onClose }: { board: ProjectBoard; onClose: () => void }) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const { showToast } = useToast()
  const [shares, setShares] = useState<ProjectShare[]>([])
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Member[]>([])
  const [role, setRole] = useState<ProjectShareRole>('editor')
  const [err, setErr] = useState<string | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    const { data } = await listBoardShares(board.id)
    if (data) {
      setShares(data.map(({ profiles, ...r }) => ({ ...r, profile: profiles ?? undefined })))
    }
  }, [board.id])

  useEffect(() => { load() }, [load])

  const search = (val: string) => {
    setQ(val)
    if (debounce.current) clearTimeout(debounce.current)
    if (!val.trim()) { setResults([]); return }
    debounce.current = setTimeout(async () => {
      const term = sanitizeIlikeTerm(val)
      if (term.length < 3) { setResults([]); return }
      const exclude = new Set([user?.id, board.user_id, ...shares.map(s => s.shared_with_user_id)])
      const { data, error } = await searchUsersForShare(term)
      // SEC-012: sem isto um 429 era indistinguível de "nenhum usuário encontrado".
      if (isRateLimited(error)) {
        showToast('warning', t('search_rate_limited'), { dedupeKey: 'user-search-rate-limited' })
        return
      }
      if (data) setResults(data.filter(m => !exclude.has(m.id)))
    }, 300)
  }

  const add = async (m: Member) => {
    if (!user) return
    setErr(null)
    const { error } = await addBoardShare({ board_id: board.id, owner_id: user.id, shared_with_user_id: m.id, role })
    if (error) { setErr(t('projects_share_not_found')); return }
    setQ(''); setResults([]); await load()
  }
  // REL-004: a falha aparece no aviso do modal; .select('id') + requireRows
  // porque o RLS recusa com 0 linhas.
  const remove = async (id: string) => {
    setErr(null)
    await runGuarded(
      async () => requireRows(await removeBoardShare(id)),
      { label: 'board share remove', onError: error => setErr(mapWriteError(error, t, 'toast_error_delete')) },
    )
    await load()
  }

  return (
    <Modal title={t('projects_share_title')} onClose={onClose}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <div className="field-box" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-bg)' }}>
          <Search size={14} style={{ color: 'var(--color-text-muted)' }} />
          <input value={q} onChange={e => search(e.target.value)} placeholder={t('projects_share_email')} style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 13, color: 'var(--color-text)' }} />
        </div>
        <select value={role} onChange={e => setRole(e.target.value as ProjectShareRole)} style={{ ...inputStyle, width: 'auto' }}>
          <option value="editor">{t('projects_share_role_editor')}</option>
          <option value="viewer">{t('projects_share_role_viewer')}</option>
        </select>
      </div>
      <p style={{ margin: '-6px 0 12px', fontSize: 11.5, color: 'var(--color-text-muted)' }}>{t('share_search_hint')}</p>
      {err && <p style={{ color: '#ef4444', fontSize: 12, margin: '0 0 10px' }}>{err}</p>}
      {results.length > 0 && (
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
          {results.map(m => (
            <button key={m.id} onClick={() => add(m)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}>
              <UserAvatar name={m.display_name || m.email} seed={m.email} emoji={m.avatar_emoji} color={m.avatar_color} url={m.avatar_url} size={26} />
              <span style={{ fontSize: 13, color: 'var(--color-text)' }}>{m.display_name || m.email}</span>
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {shares.length === 0 && <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>{t('projects_share_none')}</p>}
        {shares.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 4px' }}>
            <UserAvatar name={s.profile?.display_name || s.profile?.email || '?'} seed={s.profile?.email} emoji={s.profile?.avatar_emoji} color={s.profile?.avatar_color} url={s.profile?.avatar_url} size={30} />
            <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text)' }}>{s.profile?.display_name || s.profile?.email}</span>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{s.role === 'editor' ? t('projects_share_role_editor') : t('projects_share_role_viewer')}</span>
            <button aria-label={t('common_remove')} onClick={() => remove(s.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#ef4444', display: 'flex', padding: 4 }}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </Modal>
  )
}
