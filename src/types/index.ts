export type PageType = 'note' | 'drawing' | 'both' | 'todo'

// Slice of another user's profile attached to shares/members/presence rows.
// Avatar fields are optional so older query results keep type-checking.
export interface ProfileBadge {
  email: string
  display_name: string | null
  avatar_emoji?: string | null
  avatar_color?: string | null
  avatar_url?: string | null
}

// ─── Finance Module ──────────────────────────────────────────────────────────

export type FinanceAccountType = 'checking' | 'savings' | 'credit' | 'cash'
export type FinanceTxType = 'income' | 'expense'

export interface FinanceAccount {
  id: string
  user_id: string
  name: string
  type: FinanceAccountType
  initial_balance: number
  color: string
  icon: string
  /** Credit card limit in cents; only meaningful when type === 'credit'. */
  credit_limit?: number | null
  workspace_id?: string | null
  created_at: string
}

export interface FinanceCategory {
  id: string
  user_id: string
  name: string
  color: string
  icon: string
  type: FinanceTxType
  is_default: boolean
  workspace_id?: string | null
  created_at: string
}

export interface FinanceTransaction {
  id: string
  user_id: string
  account_id: string | null
  category_id: string | null
  type: FinanceTxType
  amount: number
  description: string
  date: string
  shared_with_user_id: string | null
  workspace_id?: string | null
  created_at: string
  photo_url?: string | null
}

export interface FinanceBudget {
  id: string
  user_id: string
  category_id: string
  month: string
  amount_limit: number
  shared_with_user_id: string | null
  workspace_id?: string | null
  created_at: string
}

export type FinanceGoalStatus = 'active' | 'completed' | 'cancelled'

export interface FinanceGoal {
  id: string
  user_id: string
  name: string
  icon: string
  color: string
  target_amount: number
  deadline: string
  account_id: string | null
  status: FinanceGoalStatus
  workspace_id?: string | null
  created_at: string
}

export interface FinanceGoalShare {
  id: string
  goal_id: string
  owner_id: string
  shared_with_user_id: string
  created_at: string
  profile?: ProfileBadge
}

export interface FinanceGoalContribution {
  id: string
  goal_id: string
  user_id: string
  amount: number
  note: string
  date: string
  created_at: string
  contributor_profile?: ProfileBadge
}

export interface FinanceRecurring {
  id: string
  user_id: string
  type: FinanceTxType
  description: string
  amount: number | null
  is_variable: boolean
  category_id: string | null
  account_id: string | null
  day_of_month: number
  active: boolean
  total_installments: number | null
  workspace_id?: string | null
  created_at: string
}

export type FinanceRecurringEntryStatus = 'pending' | 'paid' | 'skipped'

export interface FinanceRecurringEntry {
  id: string
  user_id: string
  recurring_id: string
  due_date: string
  status: FinanceRecurringEntryStatus
  amount: number | null
  transaction_id: string | null
  created_at: string
}

// ─── Workspace (Family Sharing) ─────────────────────────────────────────────

export type WorkspaceMemberRole = 'owner' | 'member'
export type WorkspaceInviteStatus = 'pending' | 'accepted' | 'declined'

export interface FinanceWorkspace {
  id: string
  name: string
  owner_id: string
  created_at: string
}

export interface FinanceWorkspaceMember {
  id: string
  workspace_id: string
  user_id: string
  role: WorkspaceMemberRole
  joined_at: string
  profile?: ProfileBadge
}

export interface FinanceWorkspaceInvite {
  id: string
  workspace_id: string
  invited_by: string
  invited_email: string
  invited_user_id: string | null
  status: WorkspaceInviteStatus
  created_at: string
  responded_at: string | null
  inviter_profile?: ProfileBadge
}

// ─── Finance: anexos ────────────────────────────────────────────────────────
// Coleção embutida (jsonb) apontando para objetos de um bucket privado. `path`
// é a chave do Storage, resolvida sob demanda com resolveSignedUrl(). Nasceu
// com Obras; hoje só a Loja usa, via `ui/AttachmentField`.
export interface FinanceAttachment {
  id: string
  path: string
  name: string
  mime: string
  size: number
  uploaded_at: string
}

// ─── Finance Store / Loja ───────────────────────────────────────────────────
// Estoque de revenda (hardware etc.), pipeline de venda e clientes. O estoque
// disponível é DERIVADO (comprado − vendido − reservado) em
// src/lib/financeStoreCalc.ts; sale_items guardam snapshot de preço/custo para
// o lucro histórico não mudar com edições no produto. Valores em centavos.

// Fornecedor de uma compra. Veio de Obras e sobreviveu à remoção dela: a Loja
// cria e lê as mesmas linhas de `finance_suppliers`.
export interface FinanceSupplier {
  id: string
  user_id: string
  workspace_id: string | null
  name: string
  phone: string
  website: string
  notes: string
  created_at: string
  updated_at: string
}

export type FinanceStoreProductKind = 'unique' | 'stock'
export type FinanceStoreCondition = 'new' | 'used'
export type FinanceStoreSaleStatus = 'negotiating' | 'sold' | 'shipped' | 'delivered' | 'cancelled'
export type FinanceStoreChannel =
  | 'olx' | 'mercado_livre' | 'facebook' | 'whatsapp' | 'referral' | 'in_person' | 'other'

export interface FinanceStoreProduct {
  id: string
  user_id: string
  workspace_id: string | null
  kind: FinanceStoreProductKind
  name: string
  /** Categoria livre ('GPU', 'CPU'...), sugerida por datalist. */
  category: string
  condition: FinanceStoreCondition
  /** Relevante para kind='unique'; vazio em produtos de estoque. */
  serial_number: string
  notes: string
  /** Preço de venda pretendido em centavos. 0 = indefinido. */
  target_price: number
  archived: boolean
  attachments: FinanceAttachment[]
  created_at: string
  updated_at: string
}

/** Funil da compra. Só `quoting` NÃO conta estoque nem custo médio. */
export type FinanceStorePurchaseStatus = 'quoting' | 'purchased' | 'received'

export interface FinanceStorePurchase {
  id: string
  user_id: string
  workspace_id: string | null
  product_id: string
  supplier_id: string | null
  /** quoting = intenção · purchased = pago, a caminho · received = na prateleira. */
  status: FinanceStorePurchaseStatus
  /** Sempre 1 para kind='unique' (garantido no cliente). */
  quantity: number
  /** Custo unitário em centavos. */
  unit_cost: number
  /** Frete/taxas da compra em centavos, sobre o lote inteiro. */
  other_costs: number
  date: string
  account_id: string | null
  /** Despesa gerada em finance_transactions (FK ON DELETE SET NULL). */
  transaction_id: string | null
  notes: string
  attachments: FinanceAttachment[]
  created_at: string
  updated_at: string
}

export interface FinanceStoreCustomer {
  id: string
  user_id: string
  workspace_id: string | null
  name: string
  /** Telefone/WhatsApp livre. */
  phone: string
  city: string
  channel: FinanceStoreChannel
  notes: string
  created_at: string
  updated_at: string
}

export interface FinanceStoreSale {
  id: string
  user_id: string
  workspace_id: string | null
  customer_id: string | null
  status: FinanceStoreSaleStatus
  channel: FinanceStoreChannel
  /** Setada quando o status vira 'sold'; data da transação de receita. */
  sold_on: string | null
  shipping_method: string
  tracking_code: string
  expected_delivery_on: string | null
  delivered_on: string | null
  /** Frete cobrado do cliente (entra na receita), em centavos. */
  shipping_charged: number
  /** Frete pago por mim (sai do lucro), em centavos. */
  shipping_cost: number
  /** Taxas do canal (ML etc.), em centavos. */
  fees: number
  account_id: string | null
  /** Receita gerada em finance_transactions — sempre 1 por venda (FK SET NULL). */
  transaction_id: string | null
  notes: string
  attachments: FinanceAttachment[]
  created_at: string
  updated_at: string
}

export interface FinanceStoreSaleItem {
  id: string
  user_id: string
  workspace_id: string | null
  sale_id: string
  product_id: string | null
  /** Snapshot: o histórico da venda sobrevive à exclusão do produto. */
  product_name: string
  quantity: number
  /** Preço unitário negociado, em centavos. */
  unit_price: number
  /** Snapshot do custo médio no momento da venda, em centavos. */
  unit_cost_at_sale: number
  created_at: string
  updated_at: string
}

// ─── Notifications ──────────────────────────────────────────────────────────

export type NotificationType =
  | 'workspace_invite'
  | 'invite_accepted'
  | 'invite_declined'
  | 'member_joined'
  | 'member_left'

export interface AppNotification {
  id: string
  user_id: string
  type: NotificationType
  title: string
  body: string
  data: Record<string, unknown>
  read: boolean
  created_at: string
}

// ─── Page Sharing ───────────────────────────────────────────────────────────

export type PageShareRole = 'viewer' | 'editor' | 'co_owner'

export interface PageShare {
  id: string
  page_id: string
  owner_id: string
  shared_with_user_id: string
  role: PageShareRole
  created_at: string
  profile?: ProfileBadge
}

export interface PagePresence {
  id: string
  page_id: string
  user_id: string
  last_seen_at: string
  profile?: {
    email: string
    display_name: string | null
  }
}

export type TodoPriority = 'low' | 'medium' | 'high'

export interface Todo {
  id: string
  page_id: string
  user_id: string
  text: string
  completed: boolean
  due_date: string | null
  priority: TodoPriority
  sort_order: number
  created_at: string
  updated_at: string
}

export interface Page {
  id: string
  user_id: string
  title: string
  icon: string
  type: PageType
  parent_id: string | null
  sort_order: number
  is_favorite: boolean
  created_at: string
  updated_at: string
  children?: Page[]
  share_role?: PageShareRole
  is_shared?: boolean
}

// ─── Projects Module (Kanban) ────────────────────────────────────────────────

export type ProjectCardPriority = 'low' | 'medium' | 'high' | 'urgent'
export type ProjectShareRole = 'viewer' | 'editor'

export interface ProjectBoard {
  id: string
  user_id: string
  name: string
  icon: string
  color: string
  description: string
  sort_order: number
  created_at: string
  updated_at: string
  // client-only
  share_role?: ProjectShareRole | 'owner'
  is_shared?: boolean
}

export interface ProjectColumn {
  id: string
  board_id: string
  name: string
  color: string
  wip_limit: number | null
  sort_order: number
  created_at: string
}

export interface ProjectCardChecklistItem {
  id: string
  text: string
  completed: boolean
}

export interface ProjectCardAttachment {
  id: string
  url: string
  name: string
}

export interface ProjectCardLink {
  id: string
  url: string
  title: string
}

export interface ProjectCard {
  id: string
  board_id: string
  column_id: string
  title: string
  description: string
  priority: ProjectCardPriority
  start_date: string | null
  due_date: string | null
  estimated_days: number
  assignee_user_id: string | null
  labels: string[]
  linked_page_id: string | null
  parent_card_id: string | null
  depends_on: string[]
  completed: boolean
  checklist: ProjectCardChecklistItem[]
  attachments: ProjectCardAttachment[]
  links: ProjectCardLink[]
  sort_order: number
  created_at: string
  updated_at: string
  assignee_profile?: ProfileBadge
}

export interface ProjectShare {
  id: string
  board_id: string
  owner_id: string
  shared_with_user_id: string
  role: ProjectShareRole
  created_at: string
  profile?: ProfileBadge
}

// ─── Quick Notes (dashboard sticky notes) ────────────────────────────────────

export type QuickNoteColor = 'yellow' | 'green' | 'pink' | 'blue' | 'purple'

export interface QuickNoteLinkedItem {
  id: string
  type: 'page' | 'card'
  targetId: string
  // Title/board are snapshots taken when the link is created; access is
  // re-validated at navigation time (RLS may have revoked it since).
  title: string
  boardId?: string
}

export interface QuickNote {
  id: string
  user_id: string
  content: string
  color: QuickNoteColor
  linked_items: QuickNoteLinkedItem[]
  created_at: string
  updated_at: string
}

// ─── Study Module ("Estudos") ────────────────────────────────────────────────

export type StudyTopicStatus = 'planned' | 'studying' | 'paused' | 'completed'

export interface StudyCheckpoint {
  id: string
  text: string
  completed: boolean
  // Free-form user annotation shown under the checkpoint; absent = no note.
  note?: string
}

export interface StudyResource {
  id: string
  title: string
  url: string
}

// Stored in Portuguese as data (same rationale as STUDY_LEVELS — the value is
// embedded in the parsed .md); the UI translates via i18n.
export type StudyQuizAnswer = 'certo' | 'errado'

// Certo/Errado question. `kind` is optional so rows saved before the mixed
// format (which have no `kind` in the JSONB) deserialize as-is — absence
// means 'boolean'.
export interface StudyQuizBooleanQuestion {
  kind?: 'boolean'
  id: string
  statement: string
  answer: StudyQuizAnswer
  // null = not answered yet; persisted so the score survives reloads.
  userAnswer: StudyQuizAnswer | null
  // Short rationale shown after answering; absent in legacy quizzes.
  explanation?: string
}

export interface StudyQuizChoiceQuestion {
  kind: 'choice'
  id: string
  statement: string
  // 2-5 alternatives in generated order (typically 4, rendered A-D).
  options: string[]
  // Index of the correct alternative in `options`.
  answer: number
  userAnswer: number | null
  explanation?: string
}

export type StudyQuizQuestion = StudyQuizBooleanQuestion | StudyQuizChoiceQuestion

export interface StudyTopic {
  id: string
  user_id: string
  title: string
  area: string
  level: string
  objective: string
  status: StudyTopicStatus
  // 'YYYY-MM-DD' — compared as a local date string, never via new Date()
  // (UTC parsing would shift the day in UTC-3).
  target_date: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface StudyCard {
  id: string
  user_id: string
  topic_id: string
  title: string
  description: string
  // "Por que agora" — why this roadmap step follows the previous one; '' when unset.
  rationale: string
  checkpoints: StudyCheckpoint[]
  resources: StudyResource[]
  quiz: StudyQuizQuestion[]
  sort_order: number
  // 'YYYY-MM-DD' — same local date-string comparison rule as target_date.
  due_date: string | null
  created_at: string
  updated_at: string
}

export interface StudyLog {
  id: string
  user_id: string
  topic_id: string
  content: string
  created_at: string
}

export interface SiteBackup {
  id: string
  created_at: string
  created_by: string | null
  type: 'manual' | 'automatic' | 'pre_restore'
  status: 'running' | 'completed' | 'failed'
  storage_path: string
  size_bytes: number
  tables_summary: Record<string, number>
  error_message?: string | null
}

export interface SiteBackupSettings {
  auto_enabled: boolean
  interval_days: number
  last_auto_at: string | null
  restore_in_progress: boolean
  restore_started_at: string | null
}

export interface NoteContent {
  id: string
  page_id: string
  content: unknown[]
  updated_at: string
}

export interface DrawingContent {
  id: string
  page_id: string
  elements: unknown[]
  app_state: Record<string, unknown>
  files: Record<string, unknown>
  updated_at: string
}

