// Deterministic avatar helpers: an initial + a stable color derived from a seed
// (usually the user's email). Shared by the topbar account button and elsewhere.

// Also the palette offered in the settings avatar picker. Growing it shifts
// which fallback color a given seed lands on — harmless, purely cosmetic.
export const AVATAR_COLORS = [
  '#4f6ef7', '#2563eb', '#06b6d4', '#0d9488', '#43c59e', '#22c55e',
  '#84cc16', '#f0a500', '#f97316', '#ef4444', '#e96c6c', '#ec4899',
  '#d946ef', '#9b59b6', '#7c3aed', '#64748b', '#78716c', '#1f2937',
]

export function initials(name: string): string {
  return (name || '?').trim()[0]?.toUpperCase() ?? '?'
}

export function avatarColor(seed: string): string {
  const s = seed || '?'
  const code = (s.charCodeAt(0) || 0) + (s.charCodeAt(s.length - 1) || 0)
  return AVATAR_COLORS[code % AVATAR_COLORS.length]
}
