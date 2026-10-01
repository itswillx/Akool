import type { Database as GeneratedDatabase } from './database'
import type {
  AppNotification, FinanceAccountType, FinanceAttachment, FinanceGoalStatus,
  FinanceRecurringEntryStatus, FinanceStoreChannel, FinanceStoreCondition,
  FinanceStoreProductKind, FinanceStorePurchaseStatus, FinanceStoreSaleStatus,
  FinanceTxType, PageShareRole, PageType, ProjectCardAttachment,
  ProjectCardChecklistItem, ProjectCardLink, ProjectCardPriority, ProjectShareRole,
  QuickNoteColor, QuickNoteLinkedItem, SiteBackup, StudyCheckpoint,
  StudyQuizQuestion, StudyResource, StudyTopicStatus, TodoPriority,
  WorkspaceInviteStatus, WorkspaceMemberRole,
} from './index'

// ARCH-004: o schema que o cliente do Supabase enxerga. É o gerado
// (src/types/database.ts), com duas coisas que o gerador não sabe dizer:
//   • colunas jsonb com a forma que o app grava (o gerador diz só `Json`);
//   • colunas text com CHECK (… = ANY (ARRAY[…])) como união de literais.
// Cada ajuste aqui precisa ser verdade no banco: jsonb escrito só pelo app, ou
// um CHECK que restringe os valores. Uma coluna que não existe na tabela
// gerada é erro de compilação (veja `Patch`), então renomear/remover uma
// coluna no banco quebra o build até este arquivo acompanhar.

type Generated = GeneratedDatabase['public']
type GeneratedTables = Generated['Tables']
type GeneratedFunctions = Generated['Functions']

/** Tabela ou coluna que não existe no schema gerado pede `never`: erro aqui. */
type Overrides<O extends {
  [T in keyof O]: T extends keyof GeneratedTables
    ? { [K in keyof O[T]]: K extends keyof GeneratedTables[T]['Row'] ? unknown : never }
    : never
}> = O

/** Mapeamento homomórfico: preserva o `?` das colunas opcionais no Insert/Update. */
type Patch<T, P> = { [K in keyof T]: K extends keyof P ? P[K] : T[K] }

type PatchTable<T extends GeneratedTables[keyof GeneratedTables], P> = {
  Row: Patch<T['Row'], P>
  Insert: Patch<T['Insert'], P>
  Update: Patch<T['Update'], P>
  Relationships: T['Relationships']
}

type TableOverrides = Overrides<{
  audit_log: { details: Record<string, unknown> }
  drawing_contents: {
    elements: unknown[] | null
    app_state: Record<string, unknown> | null
    files: Record<string, unknown> | null
  }
  finance_accounts: { type: FinanceAccountType }
  finance_categories: { type: FinanceTxType }
  finance_goals: { status: FinanceGoalStatus }
  finance_recurring: { type: FinanceTxType }
  finance_recurring_entries: { status: FinanceRecurringEntryStatus }
  finance_store_customers: { channel: FinanceStoreChannel }
  finance_store_products: {
    kind: FinanceStoreProductKind
    condition: FinanceStoreCondition
    attachments: FinanceAttachment[]
  }
  finance_store_purchases: { status: FinanceStorePurchaseStatus; attachments: FinanceAttachment[] }
  finance_store_sales: {
    status: FinanceStoreSaleStatus
    channel: FinanceStoreChannel
    attachments: FinanceAttachment[]
  }
  finance_transactions: { type: FinanceTxType }
  finance_workspace_invites: { status: WorkspaceInviteStatus }
  finance_workspace_members: { role: WorkspaceMemberRole }
  note_contents: { content: unknown[] | null }
  notifications: { data: AppNotification['data'] }
  page_shares: { role: PageShareRole }
  pages: { type: PageType }
  profiles: {
    role: 'admin' | 'standard'
    theme: 'light' | 'dark'
    finance_dashboard_view: 'simple' | 'detailed'
  }
  project_card_queue: {
    phase: 'avaliacao' | 'plano' | 'aprovado' | 'desenvolvimento' | null
    source: 'app' | 'api'
    status: 'queued' | 'in_progress' | 'review' | 'done' | 'blocked' | 'cancelled'
  }
  project_cards: {
    priority: ProjectCardPriority
    labels: string[]
    checklist: ProjectCardChecklistItem[]
    attachments: ProjectCardAttachment[]
    links: ProjectCardLink[]
  }
  project_shares: { role: ProjectShareRole }
  quick_notes: { color: QuickNoteColor; linked_items: QuickNoteLinkedItem[] }
  site_backups: {
    type: SiteBackup['type']
    status: SiteBackup['status']
    tables_summary: SiteBackup['tables_summary']
  }
  study_cards: { checkpoints: StudyCheckpoint[]; resources: StudyResource[]; quiz: StudyQuizQuestion[] }
  study_topics: { status: StudyTopicStatus }
  todos: { priority: TodoPriority }
}>

type PatchedTables = {
  [T in keyof GeneratedTables]: T extends keyof TableOverrides
    ? PatchTable<GeneratedTables[T], TableOverrides[T]>
    : GeneratedTables[T]
}

/** Argumentos jsonb das RPCs com a forma que o app manda. */
type FunctionArgOverrides = {
  reorder_project_cards: { p_moves: { id: string; column_id: string; sort_order: number }[] }
  reorder_project_columns: { p_columns: { id: string; sort_order: number }[] }
  schedule_project_cards: {
    p_patches: { id: string; start_date: string | null; due_date: string | null; depends_on: string[] }[]
  }
}

type PatchedFunctions = {
  [F in keyof GeneratedFunctions]: F extends keyof FunctionArgOverrides
    ? {
        Args: Patch<GeneratedFunctions[F]['Args'], FunctionArgOverrides[F]>
        Returns: GeneratedFunctions[F]['Returns']
      }
    : GeneratedFunctions[F]
}

export type Database = {
  __InternalSupabase: GeneratedDatabase['__InternalSupabase']
  public: {
    Tables: PatchedTables
    Views: Generated['Views']
    Functions: PatchedFunctions
    Enums: Generated['Enums']
    CompositeTypes: Generated['CompositeTypes']
  }
}

type AppTables = Database['public']['Tables']
export type TableName = keyof AppTables
/** Linha como o PostgREST devolve (com os ajustes acima). */
export type TableRow<T extends TableName> = AppTables[T]['Row']
export type TableInsert<T extends TableName> = AppTables[T]['Insert']
export type TableUpdate<T extends TableName> = AppTables[T]['Update']
