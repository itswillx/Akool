// QA-006: o inventário das chaves que o app guarda no navegador, num lugar só e
// todas sob o prefixo `akool:`. Antes eram ~30 chaves em 35 arquivos, com 5
// prefixos (excalinotion_, projects_, finance_, akool_, akool:) e strings
// soltas; o logout (SEC-017) não tinha como saber o que era do aparelho e o
// que era do usuário. Chave nova entra aqui; a trava de higiene recusa string
// literal em localStorage/sessionStorage fora deste arquivo.

const NS = 'akool:'

/** Chaves fixas do localStorage. */
export const LOCAL_KEYS = {
  // Aparelho: sobrevivem ao logout (tela de login e controle técnico).
  authLang: `${NS}auth.lang`,
  theme: `${NS}theme`,
  chunkReloadAt: `${NS}chunk-reload-at`,
  // Usuário: apagadas no logout.
  workspaceMode: `${NS}workspace.mode`,
  pagesActive: `${NS}pages.active`,
  pagesPanel: `${NS}pages.panel`,
  pagesExpanded: `${NS}pages.expanded`,
  sidebarFooter: `${NS}sidebar.footer`,
  sidebarSections: `${NS}sidebar.sections`,
  docsRailCollapsed: `${NS}docs.rail-collapsed`,
  docsSelected: `${NS}docs.selected`,
  projectsActiveBoard: `${NS}projects.active-board`,
  projectsView: `${NS}projects.view`,
  projectsOpenCard: `${NS}projects.open-card`,
  financeTab: `${NS}finance.tab`,
  financeLayout: `${NS}finance.layout`,
  financeMyprojectsSection: `${NS}finance.myprojects-section`,
  financeStoreSection: `${NS}finance.store-section`,
  financeStoreSalesMode: `${NS}finance.store-sales-mode`,
} as const

/** Chaves do localStorage com uma parte variável (usuário, quadro). */
export const localKey = {
  onboardingSeen: (userId: string) => `${NS}onboarding.seen:${userId}`,
  projectFilters: (boardId: string) => `${NS}projects.filters:${boardId}`,
  ganttZoom: (boardId: string) => `${NS}projects.gantt-zoom:${boardId}`,
  ganttDeadline: (boardId: string) => `${NS}projects.gantt-deadline:${boardId}`,
  /** Preferências de um kanban (visão, colunas escondidas, ordenação), por nome. */
  boardPrefs: (name: string) => ({
    view: `${NS}board.${name}.view`,
    hidden: `${NS}board.${name}.hidden`,
    sort: `${NS}board.${name}.sort`,
  }),
}

/** Chaves do sessionStorage (morrem com a aba; o logout limpa tudo). */
export const SESSION_KEYS = {
  recoveryPending: `${NS}auth.recovery-pending`,
  cardModalState: `${NS}projects.card-modal-state`,
} as const

export const sessionKey = {
  compactColumn: (boardId: string) => `${NS}projects.compact-column:${boardId}`,
  cardDraft: (boardId: string, cardId: string | null, columnId?: string) =>
    `${NS}projects.card-draft:${boardId}:${cardId ?? 'new'}:${columnId ?? ''}`,
}

/** O que sobrevive ao logout (SEC-017): só o que é do aparelho, não do usuário. */
export const KEEP_ON_SIGN_OUT: ReadonlySet<string> = new Set([
  LOCAL_KEYS.authLang,
  LOCAL_KEYS.theme,
  LOCAL_KEYS.chunkReloadAt,
])

// ── Migração dos nomes antigos ──────────────────────────────────────────────

/** Chave antiga → nova (fixas). */
const LEGACY_FIXED: Record<string, string> = {
  excalinotion_auth_lang: LOCAL_KEYS.authLang,
  excalinotion_theme: LOCAL_KEYS.theme,
  'akool:chunk-reload-at': LOCAL_KEYS.chunkReloadAt,
  akool_workspace_mode: LOCAL_KEYS.workspaceMode,
  excalinotion_active_page_id: LOCAL_KEYS.pagesActive,
  excalinotion_active_panel: LOCAL_KEYS.pagesPanel,
  excalinotion_expanded_pages: LOCAL_KEYS.pagesExpanded,
  excalinotion_sidebar_footer_expanded: LOCAL_KEYS.sidebarFooter,
  excalinotion_sidebar_sections: LOCAL_KEYS.sidebarSections,
  excalinotion_docs_rail_collapsed: LOCAL_KEYS.docsRailCollapsed,
  excalinotion_docs_selected_id: LOCAL_KEYS.docsSelected,
  projects_active_board: LOCAL_KEYS.projectsActiveBoard,
  projects_view: LOCAL_KEYS.projectsView,
  projects_open_card: LOCAL_KEYS.projectsOpenCard,
  finance_active_tab: LOCAL_KEYS.financeTab,
  finance_layout: LOCAL_KEYS.financeLayout,
  finance_myprojects_section: LOCAL_KEYS.financeMyprojectsSection,
  finance_store_section: LOCAL_KEYS.financeStoreSection,
  finance_store_sales_mode: LOCAL_KEYS.financeStoreSalesMode,
}

/** Prefixo antigo → construtor da chave nova (parte variável depois do prefixo). */
const LEGACY_PREFIXED: [prefix: string, build: (rest: string) => string][] = [
  ['akool_onboarding_seen_', localKey.onboardingSeen],
  ['projects_filters:', localKey.projectFilters],
  ['projects_gantt_zoom:', localKey.ganttZoom],
  ['projects_gantt_target_deadline:', localKey.ganttDeadline],
]

/** `finance_board_<nome>:<view|hidden|sort>` → `boardPrefs('finance-<nome>')`. */
const LEGACY_BOARD_PREFS = /^finance_board_([a-z]+):(view|hidden|sort)$/

/** Chaves antigas sem dono: só apagar. */
const LEGACY_DROP = new Set(['finance_view_mode'])

/** A chave nova para uma chave antiga, ou `null` se não é nossa. */
export function legacyKeyTarget(key: string): string | null {
  if (key in LEGACY_FIXED) return LEGACY_FIXED[key]
  for (const [prefix, build] of LEGACY_PREFIXED) {
    if (key.startsWith(prefix) && key.length > prefix.length) return build(key.slice(prefix.length))
  }
  const board = LEGACY_BOARD_PREFS.exec(key)
  if (board) return localKey.boardPrefs(`finance-${board[1]}`)[board[2] as 'view' | 'hidden' | 'sort']
  return null
}

/**
 * Renomeia as chaves antigas para o namespace `akool:`, copiando o valor e
 * apagando a antiga. Roda no boot (main.tsx), antes de qualquer leitura, e é
 * idempotente: sem chave antiga, não faz nada. Varre sempre, em vez de marcar
 * "já migrei", para aguentar um rollback que grave nomes antigos de novo. Uma
 * chave nova já existente vence a antiga (o app novo gravou depois). Nunca
 * lança: storage bloqueado só pula a migração.
 */
export function migrateLocalKeys(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'> = localStorage): number {
  let moved = 0
  try {
    const keys: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i)
      if (k !== null) keys.push(k)
    }
    for (const key of keys) {
      if (LEGACY_DROP.has(key)) { storage.removeItem(key); moved++; continue }
      const target = legacyKeyTarget(key)
      if (!target || target === key) continue
      const value = storage.getItem(key)
      if (value !== null && storage.getItem(target) === null) storage.setItem(target, value)
      storage.removeItem(key)
      moved++
    }
  } catch { /* storage indisponível: nada a migrar */ }
  return moved
}
