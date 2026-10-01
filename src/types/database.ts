// GERADO — não editar à mão (ARCH-004).
// Tipos do schema public do Supabase (projeto nhfftophadasiezrzlsv). Depois de
// aplicar uma migration, regenere com `npm run gen:types` (Supabase CLI
// logado: `npx supabase login`). Os ajustes de jsonb e CHECK ficam em
// src/types/db.ts; scripts/database-types.test.ts falha se uma tabela das
// migrations não estiver aqui.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      api_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          last_used_at: string | null
          name: string
          prefix: string
          revoked_at: string | null
          token_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          last_used_at?: string | null
          name?: string
          prefix: string
          revoked_at?: string | null
          token_hash: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          last_used_at?: string | null
          name?: string
          prefix?: string
          revoked_at?: string | null
          token_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_label: string | null
          created_at: string
          details: Json
          error_message: string | null
          id: string
          success: boolean
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_label?: string | null
          created_at?: string
          details?: Json
          error_message?: string | null
          id?: string
          success: boolean
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_label?: string | null
          created_at?: string
          details?: Json
          error_message?: string | null
          id?: string
          success?: boolean
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      drawing_contents: {
        Row: {
          app_state: Json | null
          elements: Json | null
          files: Json | null
          id: string
          page_id: string
          updated_at: string | null
        }
        Insert: {
          app_state?: Json | null
          elements?: Json | null
          files?: Json | null
          id?: string
          page_id: string
          updated_at?: string | null
        }
        Update: {
          app_state?: Json | null
          elements?: Json | null
          files?: Json | null
          id?: string
          page_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drawing_contents_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: true
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_accounts: {
        Row: {
          color: string
          created_at: string
          credit_limit: number | null
          icon: string
          id: string
          initial_balance: number
          name: string
          type: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          color?: string
          created_at?: string
          credit_limit?: number | null
          icon?: string
          id?: string
          initial_balance?: number
          name: string
          type: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          color?: string
          created_at?: string
          credit_limit?: number | null
          icon?: string
          id?: string
          initial_balance?: number
          name?: string
          type?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "finance_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_budgets: {
        Row: {
          amount_limit: number
          category_id: string | null
          created_at: string
          id: string
          month: string
          shared_with_user_id: string | null
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          amount_limit: number
          category_id?: string | null
          created_at?: string
          id?: string
          month: string
          shared_with_user_id?: string | null
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          amount_limit?: number
          category_id?: string | null
          created_at?: string
          id?: string
          month?: string
          shared_with_user_id?: string | null
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_budgets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "finance_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_budgets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "finance_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_categories: {
        Row: {
          color: string
          created_at: string
          icon: string
          id: string
          is_default: boolean
          name: string
          type: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          color?: string
          created_at?: string
          icon?: string
          id?: string
          is_default?: boolean
          name: string
          type: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          color?: string
          created_at?: string
          icon?: string
          id?: string
          is_default?: boolean
          name?: string
          type?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_categories_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "finance_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_goal_contributions: {
        Row: {
          amount: number
          created_at: string
          date: string
          goal_id: string
          id: string
          note: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          date?: string
          goal_id: string
          id?: string
          note?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          date?: string
          goal_id?: string
          id?: string
          note?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_goal_contributions_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "finance_goals"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_goal_shares: {
        Row: {
          created_at: string | null
          goal_id: string
          id: string
          owner_id: string
          shared_with_user_id: string
        }
        Insert: {
          created_at?: string | null
          goal_id: string
          id?: string
          owner_id: string
          shared_with_user_id: string
        }
        Update: {
          created_at?: string | null
          goal_id?: string
          id?: string
          owner_id?: string
          shared_with_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_goal_shares_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "finance_goals"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_goals: {
        Row: {
          account_id: string | null
          color: string
          created_at: string
          deadline: string
          icon: string
          id: string
          name: string
          status: string
          target_amount: number
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          account_id?: string | null
          color?: string
          created_at?: string
          deadline: string
          icon?: string
          id?: string
          name: string
          status?: string
          target_amount: number
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          account_id?: string | null
          color?: string
          created_at?: string
          deadline?: string
          icon?: string
          id?: string
          name?: string
          status?: string
          target_amount?: number
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_goals_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_goals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "finance_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_loan_borrowers: {
        Row: {
          borrower_user_id: string | null
          created_at: string
          document: string
          id: string
          linked_at: string | null
          name: string
          notes: string
          phone: string
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          borrower_user_id?: string | null
          created_at?: string
          document?: string
          id?: string
          linked_at?: string | null
          name: string
          notes?: string
          phone?: string
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          borrower_user_id?: string | null
          created_at?: string
          document?: string
          id?: string
          linked_at?: string | null
          name?: string
          notes?: string
          phone?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_loan_borrowers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "finance_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_loan_collaterals: {
        Row: {
          attachments: Json
          created_at: string
          description: string
          estimated_value: number
          id: string
          kind: string
          loan_id: string
          notes: string
          received_on: string | null
          released_on: string | null
          status: string
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          attachments?: Json
          created_at?: string
          description: string
          estimated_value?: number
          id?: string
          kind?: string
          loan_id: string
          notes?: string
          received_on?: string | null
          released_on?: string | null
          status?: string
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          attachments?: Json
          created_at?: string
          description?: string
          estimated_value?: number
          id?: string
          kind?: string
          loan_id?: string
          notes?: string
          received_on?: string | null
          released_on?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_loan_collaterals_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "finance_loans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_loan_collaterals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "finance_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_loan_payments: {
        Row: {
          account_id: string | null
          amount: number
          attachments: Json
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          date: string
          id: string
          loan_id: string
          method: string
          note: string
          reported_by: string
          status: string
          transaction_id: string | null
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          account_id?: string | null
          amount: number
          attachments?: Json
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          date: string
          id?: string
          loan_id: string
          method?: string
          note?: string
          reported_by: string
          status?: string
          transaction_id?: string | null
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          account_id?: string | null
          amount?: number
          attachments?: Json
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          date?: string
          id?: string
          loan_id?: string
          method?: string
          note?: string
          reported_by?: string
          status?: string
          transaction_id?: string | null
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_loan_payments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_loan_payments_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "finance_loans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_loan_payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_loan_payments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "finance_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_loans: {
        Row: {
          account_id: string | null
          approved_by: string | null
          attachments: Json
          borrower_id: string
          created_at: string
          disbursed_on: string
          due_date: string | null
          id: string
          monthly_rate_bp: number
          notes: string
          principal: number
          purpose: string
          requested_by: string
          responded_at: string | null
          settled_on: string | null
          status: string
          term_months: number | null
          transaction_id: string | null
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          account_id?: string | null
          approved_by?: string | null
          attachments?: Json
          borrower_id: string
          created_at?: string
          disbursed_on: string
          due_date?: string | null
          id?: string
          monthly_rate_bp?: number
          notes?: string
          principal: number
          purpose?: string
          requested_by: string
          responded_at?: string | null
          settled_on?: string | null
          status?: string
          term_months?: number | null
          transaction_id?: string | null
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          account_id?: string | null
          approved_by?: string | null
          attachments?: Json
          borrower_id?: string
          created_at?: string
          disbursed_on?: string
          due_date?: string | null
          id?: string
          monthly_rate_bp?: number
          notes?: string
          principal?: number
          purpose?: string
          requested_by?: string
          responded_at?: string | null
          settled_on?: string | null
          status?: string
          term_months?: number | null
          transaction_id?: string | null
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_loans_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_loans_borrower_id_fkey"
            columns: ["borrower_id"]
            isOneToOne: false
            referencedRelation: "finance_loan_borrowers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_loans_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_loans_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "finance_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_recurring: {
        Row: {
          account_id: string | null
          active: boolean
          amount: number | null
          category_id: string | null
          created_at: string
          day_of_month: number
          description: string
          id: string
          is_variable: boolean
          total_installments: number | null
          type: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          account_id?: string | null
          active?: boolean
          amount?: number | null
          category_id?: string | null
          created_at?: string
          day_of_month: number
          description?: string
          id?: string
          is_variable?: boolean
          total_installments?: number | null
          type: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          account_id?: string | null
          active?: boolean
          amount?: number | null
          category_id?: string | null
          created_at?: string
          day_of_month?: number
          description?: string
          id?: string
          is_variable?: boolean
          total_installments?: number | null
          type?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_recurring_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_recurring_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "finance_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_recurring_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "finance_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_recurring_entries: {
        Row: {
          amount: number | null
          created_at: string
          due_date: string
          id: string
          recurring_id: string
          status: string
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          due_date: string
          id?: string
          recurring_id: string
          status?: string
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          due_date?: string
          id?: string
          recurring_id?: string
          status?: string
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_recurring_entries_recurring_id_fkey"
            columns: ["recurring_id"]
            isOneToOne: false
            referencedRelation: "finance_recurring"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_recurring_entries_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_statements: {
        Row: {
          account_id: string | null
          active: boolean
          bank: string
          created_at: string
          file_name: string
          file_path: string
          id: string
          period_end: string | null
          period_start: string | null
          tx_count: number
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          account_id?: string | null
          active?: boolean
          bank?: string
          created_at?: string
          file_name: string
          file_path: string
          id?: string
          period_end?: string | null
          period_start?: string | null
          tx_count?: number
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          account_id?: string | null
          active?: boolean
          bank?: string
          created_at?: string
          file_name?: string
          file_path?: string
          id?: string
          period_end?: string | null
          period_start?: string | null
          tx_count?: number
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_statements_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_statements_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "finance_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_store_customers: {
        Row: {
          channel: string
          city: string
          created_at: string
          id: string
          name: string
          notes: string
          phone: string
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          channel?: string
          city?: string
          created_at?: string
          id?: string
          name: string
          notes?: string
          phone?: string
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          channel?: string
          city?: string
          created_at?: string
          id?: string
          name?: string
          notes?: string
          phone?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_store_customers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "finance_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_store_products: {
        Row: {
          archived: boolean
          attachments: Json
          category: string
          condition: string
          created_at: string
          id: string
          kind: string
          name: string
          notes: string
          serial_number: string
          target_price: number
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          archived?: boolean
          attachments?: Json
          category?: string
          condition?: string
          created_at?: string
          id?: string
          kind?: string
          name: string
          notes?: string
          serial_number?: string
          target_price?: number
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          archived?: boolean
          attachments?: Json
          category?: string
          condition?: string
          created_at?: string
          id?: string
          kind?: string
          name?: string
          notes?: string
          serial_number?: string
          target_price?: number
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_store_products_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "finance_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_store_purchases: {
        Row: {
          account_id: string | null
          attachments: Json
          created_at: string
          date: string
          id: string
          notes: string
          other_costs: number
          product_id: string
          quantity: number
          status: string
          supplier_id: string | null
          transaction_id: string | null
          unit_cost: number
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          account_id?: string | null
          attachments?: Json
          created_at?: string
          date: string
          id?: string
          notes?: string
          other_costs?: number
          product_id: string
          quantity?: number
          status?: string
          supplier_id?: string | null
          transaction_id?: string | null
          unit_cost?: number
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          account_id?: string | null
          attachments?: Json
          created_at?: string
          date?: string
          id?: string
          notes?: string
          other_costs?: number
          product_id?: string
          quantity?: number
          status?: string
          supplier_id?: string | null
          transaction_id?: string | null
          unit_cost?: number
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_store_purchases_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_store_purchases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "finance_store_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_store_purchases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "finance_suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_store_purchases_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_store_purchases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "finance_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_store_sale_items: {
        Row: {
          created_at: string
          id: string
          product_id: string | null
          product_name: string
          quantity: number
          sale_id: string
          unit_cost_at_sale: number
          unit_price: number
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          product_id?: string | null
          product_name: string
          quantity?: number
          sale_id: string
          unit_cost_at_sale?: number
          unit_price?: number
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          sale_id?: string
          unit_cost_at_sale?: number
          unit_price?: number
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_store_sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "finance_store_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_store_sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "finance_store_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_store_sale_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "finance_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_store_sales: {
        Row: {
          account_id: string | null
          attachments: Json
          channel: string
          created_at: string
          customer_id: string | null
          delivered_on: string | null
          expected_delivery_on: string | null
          fees: number
          id: string
          notes: string
          shipping_charged: number
          shipping_cost: number
          shipping_method: string
          sold_on: string | null
          status: string
          tracking_code: string
          transaction_id: string | null
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          account_id?: string | null
          attachments?: Json
          channel?: string
          created_at?: string
          customer_id?: string | null
          delivered_on?: string | null
          expected_delivery_on?: string | null
          fees?: number
          id?: string
          notes?: string
          shipping_charged?: number
          shipping_cost?: number
          shipping_method?: string
          sold_on?: string | null
          status?: string
          tracking_code?: string
          transaction_id?: string | null
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          account_id?: string | null
          attachments?: Json
          channel?: string
          created_at?: string
          customer_id?: string | null
          delivered_on?: string | null
          expected_delivery_on?: string | null
          fees?: number
          id?: string
          notes?: string
          shipping_charged?: number
          shipping_cost?: number
          shipping_method?: string
          sold_on?: string | null
          status?: string
          tracking_code?: string
          transaction_id?: string | null
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_store_sales_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_store_sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "finance_store_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_store_sales_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "finance_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_store_sales_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "finance_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_suppliers: {
        Row: {
          created_at: string
          id: string
          name: string
          notes: string
          phone: string
          updated_at: string
          user_id: string
          website: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          notes?: string
          phone?: string
          updated_at?: string
          user_id: string
          website?: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          notes?: string
          phone?: string
          updated_at?: string
          user_id?: string
          website?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_suppliers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "finance_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_transactions: {
        Row: {
          account_id: string | null
          amount: number
          category_id: string | null
          created_at: string
          date: string
          description: string
          id: string
          photo_url: string | null
          shared_with_user_id: string | null
          statement_id: string | null
          type: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          account_id?: string | null
          amount: number
          category_id?: string | null
          created_at?: string
          date?: string
          description?: string
          id?: string
          photo_url?: string | null
          shared_with_user_id?: string | null
          statement_id?: string | null
          type: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          account_id?: string | null
          amount?: number
          category_id?: string | null
          created_at?: string
          date?: string
          description?: string
          id?: string
          photo_url?: string | null
          shared_with_user_id?: string | null
          statement_id?: string | null
          type?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "finance_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_transactions_statement_id_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "finance_statements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_transactions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "finance_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_workspace_invites: {
        Row: {
          created_at: string
          id: string
          invited_by: string
          invited_email: string
          invited_user_id: string | null
          responded_at: string | null
          status: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by: string
          invited_email: string
          invited_user_id?: string | null
          responded_at?: string | null
          status?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string
          invited_email?: string
          invited_user_id?: string | null
          responded_at?: string | null
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_workspace_invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "finance_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_workspace_members: {
        Row: {
          id: string
          joined_at: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          role?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "finance_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
        }
        Relationships: []
      }
      invite_codes: {
        Row: {
          code: string
          created_at: string
          created_by: string
          expires_at: string
          id: string
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by: string
          expires_at?: string
          id?: string
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: []
      }
      mindmap_contents: {
        Row: {
          edges: Json
          id: string
          nodes: Json
          page_id: string
          updated_at: string
        }
        Insert: {
          edges?: Json
          id?: string
          nodes?: Json
          page_id: string
          updated_at?: string
        }
        Update: {
          edges?: Json
          id?: string
          nodes?: Json
          page_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mindmap_contents_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: true
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      note_contents: {
        Row: {
          content: Json | null
          id: string
          page_id: string
          updated_at: string | null
        }
        Insert: {
          content?: Json | null
          id?: string
          page_id: string
          updated_at?: string | null
        }
        Update: {
          content?: Json | null
          id?: string
          page_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "note_contents_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: true
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          data: Json
          id: string
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          data?: Json
          id?: string
          read?: boolean
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          data?: Json
          id?: string
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      page_presence: {
        Row: {
          id: string
          last_seen_at: string
          page_id: string
          user_id: string
        }
        Insert: {
          id?: string
          last_seen_at?: string
          page_id: string
          user_id: string
        }
        Update: {
          id?: string
          last_seen_at?: string
          page_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "page_presence_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_presence_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      page_shares: {
        Row: {
          created_at: string
          id: string
          owner_id: string
          page_id: string
          role: string
          shared_with_user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          owner_id: string
          page_id: string
          role?: string
          shared_with_user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          owner_id?: string
          page_id?: string
          role?: string
          shared_with_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "page_shares_owner_id_profiles_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_shares_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_shares_shared_with_user_id_profiles_fkey"
            columns: ["shared_with_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pages: {
        Row: {
          created_at: string | null
          icon: string | null
          id: string
          is_favorite: boolean | null
          parent_id: string | null
          sort_order: number | null
          title: string
          type: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          icon?: string | null
          id?: string
          is_favorite?: boolean | null
          parent_id?: string | null
          sort_order?: number | null
          title?: string
          type?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          icon?: string | null
          id?: string
          is_favorite?: boolean | null
          parent_id?: string | null
          sort_order?: number | null
          title?: string
          type?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pages_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_secrets: {
        Row: {
          ai_api_key: string | null
          ai_fallback_api_key: string | null
          ai_fallback_provider: string | null
          ai_provider: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_api_key?: string | null
          ai_fallback_api_key?: string | null
          ai_fallback_provider?: string | null
          ai_provider?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_api_key?: string | null
          ai_fallback_api_key?: string | null
          ai_fallback_provider?: string | null
          ai_provider?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          ai_has_key: boolean
          avatar_color: string | null
          avatar_emoji: string | null
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string
          finance_dashboard_view: string
          id: string
          invite_slots_remaining: number
          is_active: boolean
          language: string
          last_login_date: string | null
          role: string
          theme: string
        }
        Insert: {
          ai_has_key?: boolean
          avatar_color?: string | null
          avatar_emoji?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email: string
          finance_dashboard_view?: string
          id: string
          invite_slots_remaining?: number
          is_active?: boolean
          language?: string
          last_login_date?: string | null
          role?: string
          theme?: string
        }
        Update: {
          ai_has_key?: boolean
          avatar_color?: string | null
          avatar_emoji?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string
          finance_dashboard_view?: string
          id?: string
          invite_slots_remaining?: number
          is_active?: boolean
          language?: string
          last_login_date?: string | null
          role?: string
          theme?: string
        }
        Relationships: []
      }
      project_boards: {
        Row: {
          color: string
          created_at: string
          description: string
          icon: string
          id: string
          name: string
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          description?: string
          icon?: string
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          description?: string
          icon?: string
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      project_card_queue: {
        Row: {
          board_id: string
          card_id: string
          created_at: string
          finished_at: string | null
          id: string
          note: string | null
          phase: string | null
          position: number
          requested_by: string | null
          source: string
          started_at: string | null
          status: string
        }
        Insert: {
          board_id: string
          card_id: string
          created_at?: string
          finished_at?: string | null
          id?: string
          note?: string | null
          phase?: string | null
          position?: number
          requested_by?: string | null
          source?: string
          started_at?: string | null
          status?: string
        }
        Update: {
          board_id?: string
          card_id?: string
          created_at?: string
          finished_at?: string | null
          id?: string
          note?: string | null
          phase?: string | null
          position?: number
          requested_by?: string | null
          source?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_card_queue_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "project_boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_card_queue_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "project_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      project_cards: {
        Row: {
          assignee_user_id: string | null
          attachments: Json
          board_id: string
          checklist: Json
          column_id: string
          completed: boolean
          created_at: string
          depends_on: string[]
          description: string
          due_date: string | null
          estimated_days: number
          id: string
          labels: Json
          linked_page_id: string | null
          links: Json
          parent_card_id: string | null
          priority: string
          sort_order: number
          start_date: string | null
          title: string
          updated_at: string
        }
        Insert: {
          assignee_user_id?: string | null
          attachments?: Json
          board_id: string
          checklist?: Json
          column_id: string
          completed?: boolean
          created_at?: string
          depends_on?: string[]
          description?: string
          due_date?: string | null
          estimated_days?: number
          id?: string
          labels?: Json
          linked_page_id?: string | null
          links?: Json
          parent_card_id?: string | null
          priority?: string
          sort_order?: number
          start_date?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          assignee_user_id?: string | null
          attachments?: Json
          board_id?: string
          checklist?: Json
          column_id?: string
          completed?: boolean
          created_at?: string
          depends_on?: string[]
          description?: string
          due_date?: string | null
          estimated_days?: number
          id?: string
          labels?: Json
          linked_page_id?: string | null
          links?: Json
          parent_card_id?: string | null
          priority?: string
          sort_order?: number
          start_date?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_cards_assignee_user_id_fkey"
            columns: ["assignee_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_cards_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "project_boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_cards_column_id_fkey"
            columns: ["column_id"]
            isOneToOne: false
            referencedRelation: "project_columns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_cards_linked_page_id_fkey"
            columns: ["linked_page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_cards_parent_card_id_fkey"
            columns: ["parent_card_id"]
            isOneToOne: false
            referencedRelation: "project_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      project_columns: {
        Row: {
          board_id: string
          color: string
          created_at: string
          id: string
          name: string
          sort_order: number
          wip_limit: number | null
        }
        Insert: {
          board_id: string
          color?: string
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          wip_limit?: number | null
        }
        Update: {
          board_id?: string
          color?: string
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          wip_limit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "project_columns_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "project_boards"
            referencedColumns: ["id"]
          },
        ]
      }
      project_shares: {
        Row: {
          board_id: string
          created_at: string
          id: string
          owner_id: string
          role: string
          shared_with_user_id: string
        }
        Insert: {
          board_id: string
          created_at?: string
          id?: string
          owner_id: string
          role?: string
          shared_with_user_id: string
        }
        Update: {
          board_id?: string
          created_at?: string
          id?: string
          owner_id?: string
          role?: string
          shared_with_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_shares_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "project_boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_shares_shared_with_user_id_fkey"
            columns: ["shared_with_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_notes: {
        Row: {
          color: string
          content: string
          created_at: string
          id: string
          linked_items: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string
          content?: string
          created_at?: string
          id?: string
          linked_items?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string
          content?: string
          created_at?: string
          id?: string
          linked_items?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      site_backup_settings: {
        Row: {
          auto_enabled: boolean
          id: number
          interval_days: number
          last_auto_at: string | null
          restore_in_progress: boolean
          restore_started_at: string | null
          updated_at: string
        }
        Insert: {
          auto_enabled?: boolean
          id?: number
          interval_days?: number
          last_auto_at?: string | null
          restore_in_progress?: boolean
          restore_started_at?: string | null
          updated_at?: string
        }
        Update: {
          auto_enabled?: boolean
          id?: number
          interval_days?: number
          last_auto_at?: string | null
          restore_in_progress?: boolean
          restore_started_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      site_backups: {
        Row: {
          created_at: string
          created_by: string | null
          error_message: string | null
          id: string
          size_bytes: number
          status: string
          storage_path: string
          tables_summary: Json
          type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          size_bytes?: number
          status?: string
          storage_path: string
          tables_summary?: Json
          type: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          size_bytes?: number
          status?: string
          storage_path?: string
          tables_summary?: Json
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_backups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      study_cards: {
        Row: {
          blocks: Json
          checkpoints: Json
          created_at: string
          description: string
          due_date: string | null
          id: string
          quiz: Json
          rationale: string
          resources: Json
          sort_order: number
          title: string
          topic_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          blocks?: Json
          checkpoints?: Json
          created_at?: string
          description?: string
          due_date?: string | null
          id?: string
          quiz?: Json
          rationale?: string
          resources?: Json
          sort_order?: number
          title: string
          topic_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          blocks?: Json
          checkpoints?: Json
          created_at?: string
          description?: string
          due_date?: string | null
          id?: string
          quiz?: Json
          rationale?: string
          resources?: Json
          sort_order?: number
          title?: string
          topic_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "study_cards_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "study_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      study_logs: {
        Row: {
          content: string
          created_at: string
          id: string
          topic_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          topic_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          topic_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "study_logs_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "study_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      study_lookup_cache: {
        Row: {
          action: string
          cache_key: string
          expires_at: string
          fetched_at: string
          hits: number
          payload: Json
          provider: string
        }
        Insert: {
          action: string
          cache_key: string
          expires_at: string
          fetched_at?: string
          hits?: number
          payload: Json
          provider: string
        }
        Update: {
          action?: string
          cache_key?: string
          expires_at?: string
          fetched_at?: string
          hits?: number
          payload?: Json
          provider?: string
        }
        Relationships: []
      }
      study_topics: {
        Row: {
          area: string
          completed_at: string | null
          created_at: string
          id: string
          level: string
          objective: string
          started_at: string | null
          status: string
          target_date: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          area?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          level?: string
          objective?: string
          started_at?: string | null
          status?: string
          target_date?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          area?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          level?: string
          objective?: string
          started_at?: string | null
          status?: string
          target_date?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      todos: {
        Row: {
          completed: boolean
          created_at: string | null
          due_date: string | null
          id: string
          page_id: string
          priority: string
          sort_order: number
          text: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          completed?: boolean
          created_at?: string | null
          due_date?: string | null
          id?: string
          page_id: string
          priority?: string
          sort_order?: number
          text?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          completed?: boolean
          created_at?: string | null
          due_date?: string | null
          id?: string
          page_id?: string
          priority?: string
          sort_order?: number
          text?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "todos_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _loan_responder_guard: {
        Args: { p_loan_id: string }
        Returns: {
          account_id: string | null
          approved_by: string | null
          attachments: Json
          borrower_id: string
          created_at: string
          disbursed_on: string
          due_date: string | null
          id: string
          monthly_rate_bp: number
          notes: string
          principal: number
          purpose: string
          requested_by: string
          responded_at: string | null
          settled_on: string | null
          status: string
          term_months: number | null
          transaction_id: string | null
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "finance_loans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _notify: {
        Args: {
          p_body: string
          p_data?: Json
          p_title: string
          p_type: string
          p_user_id: string
        }
        Returns: undefined
      }
      accept_workspace_invite: {
        Args: { p_invite_id: string }
        Returns: undefined
      }
      admin_add_invite_slots: {
        Args: { p_slots: number; p_user_id: string }
        Returns: undefined
      }
      admin_revoke_invite_code: {
        Args: { p_code_id: string }
        Returns: undefined
      }
      admin_revoke_user_sessions: {
        Args: { target_id: string }
        Returns: undefined
      }
      bootstrap_finance_categories: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      bootstrap_workspace_categories: {
        Args: { p_workspace_id: string }
        Returns: undefined
      }
      check_auto_site_backup_due: { Args: never; Returns: boolean }
      check_rate_limit: {
        Args: {
          p_bucket: string
          p_limit: number
          p_subject: string
          p_window_seconds: number
        }
        Returns: Json
      }
      cq_block: {
        Args: {
          p_actor?: string
          p_board: string
          p_card: string
          p_note: string
          p_user_items?: string[]
          p_user_refs?: string[]
        }
        Returns: Json
      }
      cq_boards: { Args: { p_actor?: string }; Returns: Json }
      cq_card: {
        Args: { p_actor?: string; p_board: string; p_card: string }
        Returns: Json
      }
      cq_cards: {
        Args: {
          p_actor?: string
          p_board: string
          p_columns?: string[]
          p_completed?: boolean
          p_labels?: string[]
          p_priorities?: string[]
        }
        Returns: Json
      }
      cq_check: {
        Args: {
          p_actor?: string
          p_board: string
          p_card: string
          p_done?: boolean
          p_items: string[]
        }
        Returns: Json
      }
      cq_complete: {
        Args: {
          p_actor?: string
          p_board: string
          p_card: string
          p_note?: string
        }
        Returns: Json
      }
      cq_enqueue: {
        Args: {
          p_actor?: string
          p_board: string
          p_cards?: string[]
          p_columns?: string[]
          p_labels?: string[]
          p_priorities?: string[]
        }
        Returns: Json
      }
      cq_list: {
        Args: { p_actor?: string; p_board: string; p_statuses?: string[] }
        Returns: Json
      }
      cq_move: {
        Args: { p_actor?: string; p_position: number; p_queue_id: string }
        Returns: undefined
      }
      cq_next: { Args: { p_actor?: string; p_board: string }; Returns: Json }
      cq_note: {
        Args: {
          p_actor?: string
          p_board: string
          p_card: string
          p_phase: string
          p_text?: string
        }
        Returns: Json
      }
      cq_release: {
        Args: {
          p_actor?: string
          p_board: string
          p_card: string
          p_note?: string
        }
        Returns: Json
      }
      cq_remove: {
        Args: { p_actor?: string; p_queue_id: string }
        Returns: undefined
      }
      cq_reprioritize: {
        Args: { p_actor?: string; p_board: string }
        Returns: Json
      }
      cq_setup_flow: {
        Args: { p_actor?: string; p_board: string }
        Returns: Json
      }
      cq_start: {
        Args: { p_actor?: string; p_board: string; p_count?: number }
        Returns: Json
      }
      cq_validate: {
        Args: {
          p_actor?: string
          p_approve: boolean
          p_board: string
          p_card: string
          p_note?: string
        }
        Returns: Json
      }
      create_api_token: {
        Args: { p_expires_in_days?: number; p_name?: string }
        Returns: Json
      }
      create_project_board: {
        Args: {
          p_color?: string
          p_description?: string
          p_icon?: string
          p_name?: string
        }
        Returns: string
      }
      create_workspace: { Args: { p_name: string }; Returns: string }
      current_user_can_share_page: {
        Args: { p_page_id: string }
        Returns: boolean
      }
      decline_workspace_invite: {
        Args: { p_invite_id: string }
        Returns: undefined
      }
      generate_invite_code: { Args: never; Returns: Json }
      invite_member: {
        Args: { p_email: string; p_workspace_id: string }
        Returns: string
      }
      is_admin: { Args: never; Returns: boolean }
      is_workspace_member: {
        Args: { p_workspace_id: string }
        Returns: boolean
      }
      leave_workspace: { Args: never; Returns: undefined }
      list_public_tables: { Args: never; Returns: string[] }
      loan_approve: {
        Args: { p_disbursed_on?: string; p_loan_id: string }
        Returns: undefined
      }
      loan_cancel_request: { Args: { p_loan_id: string }; Returns: undefined }
      loan_confirm_payment: {
        Args: { p_payment_id: string }
        Returns: undefined
      }
      loan_file_is_readable: { Args: { p_owner: string }; Returns: boolean }
      loan_is_owner: { Args: { p_loan_id: string }; Returns: boolean }
      loan_is_visible: { Args: { p_loan_id: string }; Returns: boolean }
      loan_link_borrower: {
        Args: { p_borrower_id: string; p_user_id: string }
        Returns: undefined
      }
      loan_reject: {
        Args: { p_loan_id: string; p_reason?: string }
        Returns: undefined
      }
      loan_reject_payment: {
        Args: { p_payment_id: string; p_reason?: string }
        Returns: undefined
      }
      loan_report_payment: {
        Args: {
          p_amount: number
          p_date?: string
          p_loan_id: string
          p_method?: string
          p_note?: string
        }
        Returns: string
      }
      loan_request: {
        Args: {
          p_borrower_id: string
          p_disbursed_on?: string
          p_due_date?: string
          p_monthly_rate_bp?: number
          p_principal: number
          p_purpose?: string
        }
        Returns: string
      }
      page_is_readable: { Args: { p_page_id: string }; Returns: boolean }
      page_is_writable: { Args: { p_page_id: string }; Returns: boolean }
      profile_is_related: { Args: { p_other: string }; Returns: boolean }
      remove_workspace_member: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      reorder_project_cards: {
        Args: { p_board: string; p_moves: Json }
        Returns: number
      }
      reorder_project_columns: {
        Args: { p_board: string; p_columns: Json }
        Returns: number
      }
      resolve_api_token: { Args: { p_hash: string }; Returns: string }
      restore_site_backup: { Args: { p_tables: Json }; Returns: Json }
      revoke_api_token: { Args: { p_id: string }; Returns: undefined }
      schedule_project_cards: {
        Args: { p_board: string; p_patches: Json }
        Returns: number
      }
      search_users_for_share: {
        Args: { p_term: string }
        Returns: {
          avatar_color: string
          avatar_emoji: string
          avatar_url: string
          display_name: string
          email: string
          id: string
        }[]
      }
      set_ai_credentials: {
        Args: { p_api_key: string; p_provider: string }
        Returns: undefined
      }
      study_lookup_cache_prune: { Args: never; Returns: number }
      try_cast_uuid: { Args: { p_text: string }; Returns: string }
      user_can_access_board: {
        Args: { p_board_id: string; p_min_role?: string }
        Returns: boolean
      }
      validate_invite_code: { Args: { p_code: string }; Returns: Json }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
