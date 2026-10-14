// API-001: catálogo de permissões da API (docs/api-arquitetura.md §6 e Apêndice A).
// Fonte canônica. O banco tem a cópia em private.api_scope_catalog, e
// catalogParity.test.ts compara as duas. Nada de Deno aqui: o Vitest e o app
// (src/) importam este arquivo direto, como _shared/scrub.ts.

export type ScopeLevel = 'read' | 'write' | 'delete'

export type SectionKey = 'perfil' | 'documentos' | 'estudos' | 'projetos' | 'financas' | 'compartilhamento' | 'admin'

export interface ScopeSection {
  key: SectionKey
  label: string
}

export interface ScopeSubsection {
  /** `secao.subsecao`, a chave guardada em api_tokens.scopes. */
  key: string
  section: SectionKey
  /** "Seção › Subseção", como aparece nas mensagens de permissão. */
  label: string
  maxLevel: ScopeLevel
  adminOnly: boolean
}

/** Leitura composta: sem nível próprio, cada bloco sai com a leitura da subseção de origem. */
export interface CompositeView {
  key: string
  label: string
  /** Subseções que alimentam a visão (`requires.anyOf` de leitura). Vazio = sempre permitida. */
  anyOf: readonly string[]
}

/** Em ordem crescente: excluir ⊃ escrever ⊃ ler. */
export const SCOPE_LEVELS: readonly ScopeLevel[] = ['read', 'write', 'delete']

export const LEVEL_LABELS: Record<ScopeLevel, string> = { read: 'Ler', write: 'Escrever', delete: 'Excluir' }

export const SECTIONS: readonly ScopeSection[] = [
  { key: 'perfil', label: 'Perfil' },
  { key: 'documentos', label: 'Documentos' },
  { key: 'estudos', label: 'Estudos' },
  { key: 'projetos', label: 'Projetos' },
  { key: 'financas', label: 'Finanças' },
  { key: 'compartilhamento', label: 'Compartilhamento' },
  { key: 'admin', label: 'Administração' },
]

export const SUBSECTIONS: readonly ScopeSubsection[] = [
  { key: 'perfil.dados', section: 'perfil', label: 'Perfil › Dados e preferências', maxLevel: 'write', adminOnly: false },
  { key: 'perfil.notificacoes', section: 'perfil', label: 'Perfil › Notificações', maxLevel: 'delete', adminOnly: false },
  { key: 'perfil.convites', section: 'perfil', label: 'Perfil › Convites', maxLevel: 'write', adminOnly: false },
  { key: 'documentos.paginas', section: 'documentos', label: 'Documentos › Páginas', maxLevel: 'delete', adminOnly: false },
  { key: 'documentos.notas', section: 'documentos', label: 'Documentos › Conteúdo de notas', maxLevel: 'write', adminOnly: false },
  { key: 'documentos.desenhos', section: 'documentos', label: 'Documentos › Desenhos', maxLevel: 'write', adminOnly: false },
  { key: 'documentos.tarefas', section: 'documentos', label: 'Documentos › Tarefas (listas)', maxLevel: 'delete', adminOnly: false },
  { key: 'documentos.notas_rapidas', section: 'documentos', label: 'Documentos › Notas rápidas', maxLevel: 'delete', adminOnly: false },
  { key: 'estudos.conteudo', section: 'estudos', label: 'Estudos › Tópicos e roteiros', maxLevel: 'delete', adminOnly: false },
  { key: 'estudos.progresso', section: 'estudos', label: 'Estudos › Progresso (checkpoints e quiz)', maxLevel: 'write', adminOnly: false },
  { key: 'estudos.diario', section: 'estudos', label: 'Estudos › Diário', maxLevel: 'delete', adminOnly: false },
  { key: 'projetos.quadros', section: 'projetos', label: 'Projetos › Quadros e colunas', maxLevel: 'delete', adminOnly: false },
  { key: 'projetos.cards', section: 'projetos', label: 'Projetos › Cards', maxLevel: 'delete', adminOnly: false },
  { key: 'projetos.fila', section: 'projetos', label: 'Projetos › Fila de desenvolvimento', maxLevel: 'write', adminOnly: false },
  { key: 'projetos.validacao', section: 'projetos', label: 'Projetos › Validação (aprovar/reprovar)', maxLevel: 'write', adminOnly: false },
  { key: 'financas.transacoes', section: 'financas', label: 'Finanças › Transações', maxLevel: 'delete', adminOnly: false },
  { key: 'financas.contas', section: 'financas', label: 'Finanças › Contas', maxLevel: 'delete', adminOnly: false },
  { key: 'financas.categorias', section: 'financas', label: 'Finanças › Categorias', maxLevel: 'delete', adminOnly: false },
  { key: 'financas.orcamentos_metas', section: 'financas', label: 'Finanças › Orçamentos e metas', maxLevel: 'delete', adminOnly: false },
  { key: 'financas.recorrentes', section: 'financas', label: 'Finanças › Recorrentes', maxLevel: 'delete', adminOnly: false },
  { key: 'financas.loja', section: 'financas', label: 'Finanças › Loja', maxLevel: 'delete', adminOnly: false },
  { key: 'financas.emprestimos', section: 'financas', label: 'Finanças › Empréstimos', maxLevel: 'delete', adminOnly: false },
  { key: 'compartilhamento.pessoas', section: 'compartilhamento', label: 'Compartilhamento › Pessoas e conteúdo compartilhado', maxLevel: 'delete', adminOnly: false },
  { key: 'admin.usuarios', section: 'admin', label: 'Administração › Usuários', maxLevel: 'read', adminOnly: true },
  { key: 'admin.convites', section: 'admin', label: 'Administração › Convites e cotas', maxLevel: 'read', adminOnly: true },
  { key: 'admin.auditoria', section: 'admin', label: 'Administração › Auditoria', maxLevel: 'read', adminOnly: true },
  { key: 'admin.backups', section: 'admin', label: 'Administração › Backups', maxLevel: 'read', adminOnly: true },
]

export const COMPOSITE_VIEWS: readonly CompositeView[] = [
  // meta.token.obter e meta.acoes.listar: sempre permitidas.
  { key: 'meta', label: 'Sobre o token e as ações', anyOf: [] },
  {
    key: 'painel',
    label: 'Painel inicial',
    anyOf: ['documentos.paginas', 'documentos.tarefas', 'documentos.notas_rapidas', 'financas.transacoes', 'financas.contas', 'projetos.cards', 'perfil.notificacoes'],
  },
  {
    key: 'documentos.rede',
    label: 'Documentos › Rede',
    anyOf: ['documentos.paginas', 'documentos.notas', 'documentos.notas_rapidas', 'projetos.quadros', 'projetos.cards'],
  },
  {
    key: 'financas.relatorios',
    label: 'Finanças › Relatórios',
    anyOf: ['financas.transacoes', 'financas.contas', 'financas.categorias', 'financas.orcamentos_metas', 'financas.recorrentes', 'financas.loja', 'financas.emprestimos'],
  },
]

/**
 * Preset dos tokens criados sem escopos (a tela de antes do API-009) e dos
 * tokens migrados: o que o /fila usa. Sem projetos.validacao, porque quem
 * valida é o usuário. Igual a private.api_legacy_scopes() na migration.
 */
export const LEGACY_SCOPES: Readonly<Record<string, ScopeLevel>> = {
  'projetos.quadros': 'read',
  'projetos.cards': 'read',
  'projetos.fila': 'write',
}

/** Validades aceitas ao criar um token, em dias. */
export const TOKEN_EXPIRY_DAYS: readonly number[] = [7, 30, 90, 365]
/** Teto de validade de um token com Escrever ou Excluir em alguma subseção. */
export const MAX_DAYS_WITH_WRITE = 90
/** Teto de validade de um token com alguma subseção admin.*. */
export const MAX_DAYS_WITH_ADMIN = 30
export const MAX_ACTIVE_TOKENS = 20

const BY_KEY = new Map(SUBSECTIONS.map(s => [s.key, s]))

export function getSubsection(key: string): ScopeSubsection | undefined {
  return BY_KEY.get(key)
}

/** "Projetos › Validação (aprovar/reprovar): Escrever". */
export function describeScope(key: string, level: ScopeLevel): string {
  return `${getSubsection(key)?.label ?? key}: ${LEVEL_LABELS[level]}`
}
