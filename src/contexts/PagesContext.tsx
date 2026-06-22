import { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import type { Page, PageType, PageShareRole } from '../types'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

interface PagesContextType {
  pages: Page[]
  sharedPages: Page[]
  loading: boolean
  activePage: Page | null
  setActivePage: (page: Page | null) => void
  activePanel: 'users' | 'finance' | 'projects' | 'help' | null
  setActivePanel: (panel: 'users' | 'finance' | 'projects' | 'help' | null) => void
  createPage: (opts?: { parent_id?: string; type?: PageType }) => Promise<Page | null>
  updatePage: (id: string, updates: Partial<Page>) => Promise<void>
  deletePage: (id: string) => Promise<void>
  refreshPages: () => Promise<void>
  userShareRole: (pageId: string) => PageShareRole | 'owner' | null
}

const PagesContext = createContext<PagesContextType | undefined>(undefined)

function updateNodeInTree(list: Page[], id: string, updates: Partial<Page>): Page[] {
  return list.map(p => {
    if (p.id === id) return { ...p, ...updates }
    if (p.children?.length) return { ...p, children: updateNodeInTree(p.children, id, updates) }
    return p
  })
}

function removeNodeFromTree(list: Page[], id: string): Page[] {
  return list
    .filter(p => p.id !== id)
    .map(p => (p.children?.length ? { ...p, children: removeNodeFromTree(p.children, id) } : p))
}

function buildTree(flat: Page[]): Page[] {
  const map: Record<string, Page> = {}
  const roots: Page[] = []
  flat.forEach(p => { map[p.id] = { ...p, children: [] } })
  flat.forEach(p => {
    if (p.parent_id && map[p.parent_id]) {
      map[p.parent_id].children!.push(map[p.id])
    } else {
      roots.push(map[p.id])
    }
  })
  return roots
}

export function PagesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [pages, setPages] = useState<Page[]>([])
  const [sharedPages, setSharedPages] = useState<Page[]>([])
  const [loading, setLoading] = useState(true)
  const [activePage, setActivePageRaw] = useState<Page | null>(null)
  const [activePanel, setActivePanelRaw] = useState<'users' | 'finance' | 'projects' | 'help' | null>(null)
  const restoredRef = useRef(false)

  const ACTIVE_PAGE_KEY = 'excalinotion_active_page_id'
  const ACTIVE_PANEL_KEY = 'excalinotion_active_panel'

  const setActivePage = useCallback((page: Page | null) => {
    setActivePanelRaw(null)
    setActivePageRaw(page)
    if (page) {
      localStorage.setItem(ACTIVE_PAGE_KEY, page.id)
      localStorage.removeItem(ACTIVE_PANEL_KEY)
    } else {
      localStorage.removeItem(ACTIVE_PAGE_KEY)
    }
  }, [])

  const setActivePanel = useCallback((panel: 'users' | 'finance' | 'projects' | 'help' | null) => {
    setActivePanelRaw(panel)
    if (panel !== null) {
      setActivePageRaw(null)
      localStorage.removeItem(ACTIVE_PAGE_KEY)
      localStorage.setItem(ACTIVE_PANEL_KEY, panel)
    } else {
      localStorage.removeItem(ACTIVE_PANEL_KEY)
    }
  }, [])

  const refreshPages = useCallback(async () => {
    if (!user) { setPages([]); setSharedPages([]); setLoading(false); return }
    setLoading(true)

    const [{ data: ownData, error: ownError }, { data: shareData, error: shareError }] = await Promise.all([
      supabase.from('pages').select('*').eq('user_id', user.id).order('sort_order', { ascending: true }),
      supabase
        .from('page_shares')
        .select('role, pages(*)')
        .eq('shared_with_user_id', user.id),
    ])

    if (ownError) console.error('refreshPages own error:', ownError)
    if (shareError) console.error('refreshPages share error:', shareError)

    const ownPages: Page[] = (ownData as Page[]) ?? []

    // Map of directly shared page_id → role
    const directShareRole = new Map<string, PageShareRole>()
    const rawShared: Page[] = []
    if (shareData) {
      for (const row of shareData) {
        const p = row.pages as unknown as Page
        if (!p) continue
        directShareRole.set(p.id, row.role as PageShareRole)
        rawShared.push({ ...p, share_role: row.role as PageShareRole, is_shared: true })
      }
    }

    // Co-owner pages go into the user's own tree
    const coOwnerPages = rawShared.filter(p => p.share_role === 'co_owner')
    const allOwn = [...ownPages, ...coOwnerPages].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    setPages(buildTree(allOwn))

    // Viewer / editor shares: fetch ALL pages owned by the share-owners so that
    // descendants of shared pages are included (RLS now grants access recursively).
    const viewerEditorShares = rawShared.filter(p => p.share_role !== 'co_owner')
    const ownerIds = [...new Set(viewerEditorShares.map(p => p.user_id))]

    let sharedTrees: Page[] = []
    if (ownerIds.length > 0) {
      const { data: ownerPagesData } = await supabase
        .from('pages')
        .select('*')
        .in('user_id', ownerIds)
        .order('sort_order', { ascending: true })

      const ownerPages: Page[] = (ownerPagesData as Page[]) ?? []

      // Build a full tree from all accessible owner pages, then keep only
      // roots that are directly shared (viewer/editor).
      const map: Record<string, Page> = {}
      ownerPages.forEach(p => {
        map[p.id] = {
          ...p,
          is_shared: true,
          share_role: directShareRole.get(p.id),
          children: [],
        }
      })
      const candidateRoots: Page[] = []
      ownerPages.forEach(p => {
        if (p.parent_id && map[p.parent_id]) {
          map[p.parent_id].children!.push(map[p.id])
        } else {
          candidateRoots.push(map[p.id])
        }
      })
      // Only expose roots that the current user directly shares (viewer/editor)
      sharedTrees = candidateRoots.filter(p => directShareRole.has(p.id) && directShareRole.get(p.id) !== 'co_owner')
    }

    setSharedPages(sharedTrees)
    setLoading(false)
  }, [user])

  useEffect(() => { refreshPages() }, [refreshPages])

  useEffect(() => {
    if (!loading && !restoredRef.current) {
      restoredRef.current = true
      const savedPanel = localStorage.getItem(ACTIVE_PANEL_KEY)
      if (savedPanel === 'users' || savedPanel === 'finance' || savedPanel === 'projects' || savedPanel === 'help') {
        setActivePanelRaw(savedPanel)
      } else {
        const savedId = localStorage.getItem(ACTIVE_PAGE_KEY)
        if (savedId) {
          const flatPages = (ps: Page[]): Page[] => ps.flatMap(p => [p, ...flatPages(p.children ?? [])])
          const all = [...flatPages(pages), ...flatPages(sharedPages)]
          const found = all.find(p => p.id === savedId)
          if (found) setActivePageRaw(found)
        }
      }
    }
  }, [loading, pages, sharedPages])

  // Precompute a pageId -> role map once per tree change instead of walking the
  // tree on every userShareRole() call (called per render in several components).
  const roleMap = useMemo(() => {
    const map = new Map<string, PageShareRole | 'owner'>()
    const walkOwn = (ps: Page[]) => {
      for (const p of ps) {
        map.set(p.id, p.share_role ?? 'owner')
        if (p.children?.length) walkOwn(p.children)
      }
    }
    walkOwn(pages)
    // Shared trees inherit their role from the directly-shared root.
    const walkShared = (ps: Page[], inherited: PageShareRole | undefined) => {
      for (const p of ps) {
        const effective = p.share_role ?? inherited
        if (effective && !map.has(p.id)) map.set(p.id, effective)
        if (p.children?.length) walkShared(p.children, effective)
      }
    }
    walkShared(sharedPages, undefined)
    return map
  }, [pages, sharedPages])

  const userShareRole = useCallback((pageId: string): PageShareRole | 'owner' | null => {
    if (!user) return null
    return roleMap.get(pageId) ?? null
  }, [user, roleMap])

  const createPage = useCallback(async (opts?: { parent_id?: string; type?: PageType }) => {
    if (!user) return null
    const { data, error } = await supabase
      .from('pages')
      .insert({
        user_id: user.id,
        title: opts?.type === 'todo' ? 'To-do list' : 'Untitled',
        icon: opts?.type === 'drawing' ? '🎨' : opts?.type === 'todo' ? '✅' : '📄',
        type: opts?.type ?? 'note',
        parent_id: opts?.parent_id ?? null,
        sort_order: Date.now(),
      })
      .select()
      .single()
    if (error || !data) { console.error('createPage error:', error); return null }
    if (data.type === 'note' || data.type === 'both') {
      await supabase.from('note_contents').insert({ page_id: data.id, content: [] })
    }
    if (data.type === 'drawing' || data.type === 'both') {
      await supabase.from('drawing_contents').insert({ page_id: data.id, elements: [], app_state: {}, files: {} })
    }
    await refreshPages()
    return data as Page
  }, [user, refreshPages])

  const updatePage = useCallback(async (id: string, updates: Partial<Page>) => {
    await supabase.from('pages').update(updates).eq('id', id)
    // Structural changes (reparenting) require a full rebuild; everything else
    // (rename, favorite, icon, type, sort) can be applied optimistically in place.
    if ('parent_id' in updates) {
      await refreshPages()
    } else {
      setPages(prev => updateNodeInTree(prev, id, updates))
      setSharedPages(prev => updateNodeInTree(prev, id, updates))
    }
    if (activePage?.id === id) setActivePageRaw(prev => prev ? { ...prev, ...updates } : null)
  }, [activePage, refreshPages])

  const deletePage = useCallback(async (id: string) => {
    await supabase.from('pages').delete().eq('id', id)
    if (activePage?.id === id) setActivePageRaw(null)
    setPages(prev => removeNodeFromTree(prev, id))
    setSharedPages(prev => removeNodeFromTree(prev, id))
  }, [activePage])

  const value = useMemo<PagesContextType>(() => ({
    pages, sharedPages, loading, activePage, setActivePage, activePanel, setActivePanel,
    createPage, updatePage, deletePage, refreshPages, userShareRole,
  }), [pages, sharedPages, loading, activePage, setActivePage, activePanel, setActivePanel, createPage, updatePage, deletePage, refreshPages, userShareRole])

  return (
    <PagesContext.Provider value={value}>
      {children}
    </PagesContext.Provider>
  )
}

export function usePages() {
  const ctx = useContext(PagesContext)
  if (!ctx) throw new Error('usePages must be used within PagesProvider')
  return ctx
}
