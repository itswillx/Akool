// Navegação da visão Documentos: qual seção/página está selecionada dentro do
// painel, e a migração das chaves legadas da época em que Projetos era um
// painel irmão (modo 'projects' + activePanel 'projects'). Projetos virou uma
// seção DE Documentos; quem tinha o painel antigo aberto precisa cair em
// Documentos → Projetos, nunca numa tela vazia.
//
// Duas metades, de propósito:
//  - funções PURAS (recebem strings cruas) — testáveis sob environment: 'node',
//    onde não existe localStorage; espelha o padrão de finance/myprojects/section.ts.
//  - um store minúsculo com subscribe — a seleção precisa ser observável de fora
//    do DocumentsPanel porque QuickNotes roda DENTRO dele: quando o usuário clica
//    num chip de card lá, o painel já está montado e setActivePanel('documents')
//    é no-op; só a notificação troca a seção.
// Sem React neste arquivo — o hook fica em hooks/useDocsSelection.ts.

export const DOCS_SELECTED_KEY = 'excalinotion_docs_selected_id'
export const ACTIVE_PANEL_KEY = 'excalinotion_active_panel'
export const WORKSPACE_MODE_KEY = 'akool_workspace_mode'

// 'projects' saiu das duas uniões abaixo — ver migrateLegacyProjects.
export type WorkspaceMode = 'all' | 'finance' | 'documents'
export type ActivePanel = 'users' | 'finance' | 'help' | 'backup' | 'documents'

export type DocsSelection =
  | { kind: 'page'; id: string }
  | { kind: 'projects' }
  | { kind: 'quick-notes' }
  | { kind: 'studies' }
  | { kind: 'network' }

/**
 * PURA — aceita o JSON atual e a string solta gravada por builds antigos
 * (que era um id de página cru).
 */
export function parseDocsSelection(raw: string | null): DocsSelection | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && 'kind' in parsed) {
      const sel = parsed as { kind: unknown; id?: unknown }
      if (sel.kind === 'projects') return { kind: 'projects' }
      if (sel.kind === 'quick-notes') return { kind: 'quick-notes' }
      if (sel.kind === 'studies') return { kind: 'studies' }
      if (sel.kind === 'network') return { kind: 'network' }
      if (sel.kind === 'page' && typeof sel.id === 'string') return { kind: 'page', id: sel.id }
      return null
    }
  } catch { /* não é JSON → id de página legado */ }
  return { kind: 'page', id: raw }
}

/** PURA — 'projects' deixou de ser um modo; vira 'documents'. */
export function normalizeWorkspaceMode(raw: string | null): WorkspaceMode {
  if (raw === 'all' || raw === 'finance' || raw === 'documents') return raw
  if (raw === 'projects') return 'documents'
  return 'all'
}

/** PURA — 'projects' deixou de ser um painel; vira 'documents'. */
export function normalizeActivePanel(raw: string | null): ActivePanel | null {
  if (raw === 'users' || raw === 'finance' || raw === 'help' || raw === 'backup' || raw === 'documents') return raw
  if (raw === 'projects') return 'documents'
  return null
}

/**
 * PURA — dado o localStorage legado, devolve os três valores novos. Quem estava
 * olhando o kanban (painel 'projects') volta no kanban, dentro de Documentos;
 * quem só tinha o modo legado ganha o modo novo sem mexer no resto. Idempotente:
 * rodar sobre um estado já migrado não muda nada.
 */
export function migrateLegacyProjects(input: {
  mode: string | null
  panel: string | null
  docsSelection: string | null
}): { mode: WorkspaceMode; panel: ActivePanel | null; docsSelection: DocsSelection | null } {
  const hadLegacyPanel = input.panel === 'projects'
  return {
    mode: normalizeWorkspaceMode(input.mode),
    panel: normalizeActivePanel(input.panel),
    docsSelection: hadLegacyPanel ? { kind: 'projects' } : parseDocsSelection(input.docsSelection),
  }
}

// ---------------------------------------------------------------------------
// Store da seleção. Leitura preguiçosa: não toca localStorage no import.

let current: DocsSelection | null | undefined // undefined = ainda não lido
const listeners = new Set<() => void>()

export function getDocsSelection(): DocsSelection | null {
  if (current === undefined) {
    try {
      current = parseDocsSelection(localStorage.getItem(DOCS_SELECTED_KEY))
    } catch {
      current = null
    }
  }
  return current
}

export function setDocsSelection(sel: DocsSelection | null): void {
  current = sel
  try {
    if (sel) localStorage.setItem(DOCS_SELECTED_KEY, JSON.stringify(sel))
    else localStorage.removeItem(DOCS_SELECTED_KEY)
  } catch { /* ignore */ }
  listeners.forEach(l => l())
}

export function subscribeDocsSelection(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Impura — chamada uma única vez pelo main.tsx ANTES do primeiro render, para
 * que readInitialMode() (inicializador de useState) e o restore do PagesContext
 * já leiam chaves reescritas. Reescreve de verdade em vez de só reinterpretar:
 * um valor legado que nada resolve vira no-op silencioso (lição do
 * finance/myprojects/README.md).
 */
export function runLegacyProjectsMigration(): void {
  try {
    const migrated = migrateLegacyProjects({
      mode: localStorage.getItem(WORKSPACE_MODE_KEY),
      panel: localStorage.getItem(ACTIVE_PANEL_KEY),
      docsSelection: localStorage.getItem(DOCS_SELECTED_KEY),
    })
    localStorage.setItem(WORKSPACE_MODE_KEY, migrated.mode)
    if (migrated.panel) localStorage.setItem(ACTIVE_PANEL_KEY, migrated.panel)
    else localStorage.removeItem(ACTIVE_PANEL_KEY)
    if (migrated.docsSelection) localStorage.setItem(DOCS_SELECTED_KEY, JSON.stringify(migrated.docsSelection))
    else localStorage.removeItem(DOCS_SELECTED_KEY)
  } catch { /* localStorage indisponível — nada a migrar */ }
}
