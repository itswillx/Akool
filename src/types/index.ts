export type PageType = 'note' | 'drawing' | 'both' | 'todo'

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
  profile?: { email: string; display_name: string | null }
}

export interface FinanceGoalContribution {
  id: string
  goal_id: string
  user_id: string
  amount: number
  note: string
  date: string
  created_at: string
  contributor_profile?: { email: string; display_name: string | null }
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
  profile?: { email: string; display_name: string | null }
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
  inviter_profile?: { email: string; display_name: string | null }
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
  profile?: {
    email: string
    display_name: string | null
  }
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

export interface ProjectCard {
  id: string
  board_id: string
  column_id: string
  title: string
  description: string
  priority: ProjectCardPriority
  start_date: string | null
  due_date: string | null
  assignee_user_id: string | null
  labels: string[]
  linked_page_id: string | null
  parent_card_id: string | null
  depends_on: string[]
  completed: boolean
  checklist: ProjectCardChecklistItem[]
  attachments: ProjectCardAttachment[]
  sort_order: number
  created_at: string
  updated_at: string
  assignee_profile?: { email: string; display_name: string | null }
}

export interface ProjectShare {
  id: string
  board_id: string
  owner_id: string
  shared_with_user_id: string
  role: ProjectShareRole
  created_at: string
  profile?: { email: string; display_name: string | null }
}

export interface SiteBackup {
  id: string
  created_at: string
  created_by: string | null
  type: 'manual' | 'automatic'
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

