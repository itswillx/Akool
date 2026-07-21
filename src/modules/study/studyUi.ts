import { useState } from 'react'
import type { StudyTopicStatus } from '../../types'
import type { TranslationKey } from '../../i18n/translations'

// Non-component UI helpers of the study module (kept out of StudyBits.tsx so
// component files only export components — react-refresh friendly).

export const STATUS_LABEL_KEY: Record<StudyTopicStatus, TranslationKey> = {
  planned: 'study_status_planned',
  studying: 'study_status_studying',
  paused: 'study_status_paused',
  completed: 'study_status_completed',
}

export const STATUS_COLOR: Record<StudyTopicStatus, string> = {
  planned: '#94a3b8',
  studying: '#6366f1',
  paused: '#f59e0b',
  completed: '#22c55e',
}

export const STATUS_ORDER: StudyTopicStatus[] = ['planned', 'studying', 'paused', 'completed']

const AVATAR_COLORS = ['yellow', 'green', 'pink', 'blue', 'purple'] as const

// Deterministic pastel background for a topic avatar, reusing the existing
// sticky-note theme variables so light/dark mode both work.
export function avatarBg(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return `var(--sticky-${AVATAR_COLORS[h % AVATAR_COLORS.length]}-bg)`
}

export function initialsOf(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

// 'YYYY-MM-DD' → localized short date without going through new Date()
// (UTC parsing would shift the day in UTC-3).
export function formatDateISO(dateISO: string, lang: string): string {
  const [y, m, d] = dateISO.split('-')
  if (!y || !m || !d) return dateISO
  return lang === 'en' ? `${m}/${d}/${y}` : `${d}/${m}/${y}`
}

export function formatTimestamp(ts: string, lang: string): string {
  return new Date(ts).toLocaleString(lang === 'en' ? 'en-US' : 'pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export function useHover(): [boolean, { onMouseEnter: () => void; onMouseLeave: () => void }] {
  const [hov, setHov] = useState(false)
  return [hov, { onMouseEnter: () => setHov(true), onMouseLeave: () => setHov(false) }]
}
