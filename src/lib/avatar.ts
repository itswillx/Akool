// Deterministic avatar helpers: an initial + a stable color derived from a seed
// (usually the user's email). Shared by the topbar account button and elsewhere.

const AVATAR_COLORS = ['#4f6ef7', '#e96c6c', '#43c59e', '#f0a500', '#9b59b6', '#06b6d4']

export function initials(name: string): string {
  return (name || '?').trim()[0]?.toUpperCase() ?? '?'
}

export function avatarColor(seed: string): string {
  const s = seed || '?'
  const code = (s.charCodeAt(0) || 0) + (s.charCodeAt(s.length - 1) || 0)
  return AVATAR_COLORS[code % AVATAR_COLORS.length]
}
