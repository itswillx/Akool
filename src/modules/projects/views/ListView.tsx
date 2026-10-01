// ARCH-002: saiu do ProjectsPanel.tsx sem mudança de lógica.
import {
Check,
Copy
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useToast } from '../../../contexts/ToastContext'
import { useLanguage } from '../../../i18n/LanguageContext'
import {
byOrder
} from '../../../lib/boardMoves'
import { formatCardAsMarkdown } from '../../../lib/cardMarkdown'
import { copyToClipboard } from '../../../lib/clipboard'
import type { ProjectCard, ProjectColumn } from '../../../types'
import { todayStr } from '../projectsShared'
import { PriorityBadge } from '../ui'

// ─── List view ────────────────────────────────────────────────────────────────

export function ListView({ columns, cards, allCards, totalCount, onCardClick }: { columns: ProjectColumn[]; cards: ProjectCard[]; allCards: ProjectCard[]; totalCount: number; onCardClick: (c: ProjectCard) => void }) {
  const { t } = useLanguage()
  const { showToast } = useToast()
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current) }, [])
  const colName = (id: string) => columns.find(c => c.id === id)?.name ?? '—'
  // Resolve contra o quadro inteiro: o pai/dependência pode estar fora do filtro.
  const cardTitleById = (id: string) => allCards.find(c => c.id === id)?.title || t('projects_new_card')

  const copyCard = async (card: ProjectCard) => {
    const md = formatCardAsMarkdown(card, {
      columnName: columns.find(c => c.id === card.column_id)?.name,
      assigneeName: card.assignee_profile
        ? (card.assignee_profile.display_name || card.assignee_profile.email)
        : null,
      parentTitle: card.parent_card_id ? cardTitleById(card.parent_card_id) : null,
      dependencyTitles: (card.depends_on ?? []).map(cardTitleById),
    }, t)
    if (!await copyToClipboard(md)) {
      showToast('error', t('projects_copy_error'))
      return
    }
    setCopiedId(card.id)
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => setCopiedId(null), 2000)
  }

  const sorted = [...cards].sort(byOrder)
  if (totalCount === 0) return <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('projects_no_cards')}</p>
  if (sorted.length === 0) return <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('projects_empty_filter')}</p>
  const th: React.CSSProperties = { textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '8px 12px' }
  const td: React.CSSProperties = { padding: '10px 12px', fontSize: 13, color: 'var(--color-text)', borderTop: '1px solid var(--color-border)' }
  return (
    <div>
      <div style={{ border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden', backgroundColor: 'var(--color-surface)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
            <th style={th}>{t('projects_table_card')}</th>
            <th style={th}>{t('projects_table_column')}</th>
            <th style={th}>{t('projects_table_priority')}</th>
            <th style={th}>{t('projects_table_assignee')}</th>
            <th style={th}>{t('projects_table_due')}</th>
            <th style={{ ...th, width: 40 }} aria-label={t('projects_copy_card')} />
          </tr></thead>
          <tbody>
            {sorted.map(c => (
              // A linha abre o card no clique; no teclado, o botão do título.
              <tr key={c.id} data-kbd="inner" onClick={() => onCardClick(c)} style={{ cursor: 'pointer' }}>
                <td style={{ ...td, fontWeight: 600, textDecoration: c.completed ? 'line-through' : 'none', opacity: c.completed ? 0.6 : 1 }}>
                  <button type="button" onClick={e => { e.stopPropagation(); onCardClick(c) }}
                    style={{ background: 'none', border: 'none', padding: 0, margin: 0, font: 'inherit', color: 'inherit', textAlign: 'left', textDecoration: 'inherit', cursor: 'pointer' }}>
                    {c.title}
                  </button>
                </td>
                <td style={td}>{colName(c.column_id)}</td>
                <td style={td}><PriorityBadge priority={c.priority} label={t(`projects_priority_${c.priority}`)} /></td>
                <td style={td}>{c.assignee_profile ? (c.assignee_profile.display_name || c.assignee_profile.email) : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}</td>
                <td style={{ ...td, color: c.due_date && !c.completed && c.due_date < todayStr() ? '#ef4444' : 'var(--color-text)' }}>{c.due_date || '—'}</td>
                <td style={{ ...td, textAlign: 'right' }}>
                  {/* stopPropagation: a linha inteira abre o modal do card. */}
                  <button type="button" title={t('projects_copy_card')}
                    onClick={e => { e.stopPropagation(); void copyCard(c) }}
                    style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: copiedId === c.id ? '#22c55e' : 'var(--color-text-muted)', cursor: 'pointer', padding: 0 }}>
                    {copiedId === c.id ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
