import { createContext, useContext, useState, useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import { normalizeWorkspaceMode, WORKSPACE_MODE_KEY, type WorkspaceMode } from '../lib/docsNavigation'

// Top-level "workspace mode" that selects which shell the app renders:
//  - 'all'       → everything as before (projects + docs + finance together).
//  - 'finance'   → only the finance module (FinancePanel), projects hidden.
//  - 'documents' → same shell as 'all' (full sidebar) but lands on the Documents
//                  page; content is still driven by activePanel/activePage.
//
// O modo 'projects' foi absorvido por 'documents': Projetos virou uma seção do
// DocumentsPanel. A união e a migração das chaves legadas moram em
// lib/docsNavigation (rodada uma vez no main.tsx, antes do primeiro render).
//
// This is a cosmetic UI selector — NOT a security boundary. Data access stays
// gated by Supabase RLS server-side; switching modes only changes what mounts.
export type { WorkspaceMode }

const STORAGE_KEY = WORKSPACE_MODE_KEY

function readInitialMode(): WorkspaceMode {
  try {
    return normalizeWorkspaceMode(localStorage.getItem(STORAGE_KEY))
  } catch {
    /* localStorage unavailable — fall back to default */
  }
  return 'all'
}

interface WorkspaceModeContextType {
  mode: WorkspaceMode
  setMode: (mode: WorkspaceMode) => void
}

const WorkspaceModeContext = createContext<WorkspaceModeContextType | undefined>(undefined)

export function WorkspaceModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeRaw] = useState<WorkspaceMode>(readInitialMode)

  const setMode = useCallback((next: WorkspaceMode) => {
    setModeRaw(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* ignore */ }
  }, [])

  const value = useMemo<WorkspaceModeContextType>(() => ({ mode, setMode }), [mode, setMode])

  return (
    <WorkspaceModeContext.Provider value={value}>
      {children}
    </WorkspaceModeContext.Provider>
  )
}

export function useWorkspaceMode() {
  const ctx = useContext(WorkspaceModeContext)
  if (!ctx) throw new Error('useWorkspaceMode must be used within WorkspaceModeProvider')
  return ctx
}
