import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import type { Page, PageType, PageShareRole } from '../types'
import { supabase } from '../lib/supabase'
import {
  deletePageRow, insertDrawingContent, insertNoteContent, insertPage, listOwnPages, listPagesOfOwners,
  listSharesWithPages, updatePageColumns,
} from '../lib/data/pages'
import { normalizeActivePanel, type ActivePanel } from '../lib/docsNavigation'
import { mapWriteError, requireRows, runGuarded } from '../lib/optimistic'
import { useAuth } from './AuthContext'
import { useToast } from './ToastContext'
import { useLanguage } from '../i18n/LanguageContext'
import type { TranslationKey } from '../i18n/translations'
import { buildTree, findPage, reconcileTree } from '../lib/pageTree'
import {
  PageActionsContext, PageNavigationContext, PagesDataContext,
  type PageActionsContextType, type PageNavigationContextType, type PagesDataContextType,
} from './pagesState'

// 'projects' saiu da união de painéis: Projetos é uma seção do DocumentsPanel.
// A migração da chave legada roda no boot (main.tsx → lib/docsNavigation).

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

// Inserts newNode under parentId at any depth. Falls back to inserting as a
// root when parentId is absent or not found in this tree (mirrors what a
// full refetch would do when the parent isn't part of the caller's own tree).
function addNodeToTree(list: Page[], parentId: string | null | undefined, newNode: Page): { tree: Page[]; inserted: boolean } {
  if (!parentId) return { tree: [...list, newNode], inserted: true }
  let inserted = false
  const tree = list.map(p => {
    if (inserted) return p
    if (p.id === parentId) {
      inserted = true
      return { ...p, children: [...(p.children ?? []), newNode] }
    }
    if (p.children?.length) {
      const res = addNodeToTree(p.children, parentId, newNode)
      if (res.inserted) { inserted = true; return { ...p, children: res.tree } }
    }
    return p
  })
  return { tree, inserted }
}

export function PagesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const { t } = useLanguage()
  // O aviso de falha de leitura sai por ref: o refreshPages não muda de
  // identidade (e não recarrega tudo) quando o idioma troca.
  const notifyRef = useRef({ t, showToast })
  useEffect(() => { notifyRef.current = { t, showToast } }, [t, showToast])
  // PERF-007: as ações avisam por aqui, para continuarem estáveis (sem isso,
  // trocar o idioma re-renderizava todo item da árvore).
  const notify = useCallback((error: Parameters<typeof mapWriteError>[0], key: TranslationKey, dedupeKey: string) => {
    const { showToast: show, t: translate } = notifyRef.current
    show('error', mapWriteError(error, translate, key), { dedupeKey })
  }, [])
  const [pages, setPages] = useState<Page[]>([])
  const [sharedPages, setSharedPages] = useState<Page[]>([])
  const [loading, setLoading] = useState(true)
  // PERF-007: guarda o id; o objeto sai da árvore (ver `activePage` abaixo). A
  // cópia fica só como reserva para uma página aberta que não está na árvore.
  const [activePageId, setActivePageId] = useState<string | null>(null)
  const [activePageFallback, setActivePageFallback] = useState<Page | null>(null)
  const [activePanel, setActivePanelRaw] = useState<ActivePanel | null>(null)
  const restoredRef = useRef(false)
  // Only the very first load per session shows the loading state — subsequent
  // refreshes (create/update/realtime) update the tree silently.
  const hasLoadedOnceRef = useRef(false)
  const realtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const ACTIVE_PAGE_KEY = 'excalinotion_active_page_id'
  const ACTIVE_PANEL_KEY = 'excalinotion_active_panel'

  const setActivePage = useCallback((page: Page | null) => {
    setActivePanelRaw(null)
    setActivePageId(page?.id ?? null)
    setActivePageFallback(page)
    if (page) {
      localStorage.setItem(ACTIVE_PAGE_KEY, page.id)
      localStorage.removeItem(ACTIVE_PANEL_KEY)
    } else {
      localStorage.removeItem(ACTIVE_PAGE_KEY)
    }
  }, [])

  const setActivePanel = useCallback((panel: ActivePanel | null) => {
    setActivePanelRaw(panel)
    if (panel !== null) {
      setActivePageId(null)
      setActivePageFallback(null)
      localStorage.removeItem(ACTIVE_PAGE_KEY)
      localStorage.setItem(ACTIVE_PANEL_KEY, panel)
    } else {
      localStorage.removeItem(ACTIVE_PANEL_KEY)
    }
  }, [])

  const refreshPages = useCallback(async () => {
    const userId = user?.id
    if (!userId) { setPages([]); setSharedPages([]); setLoading(false); hasLoadedOnceRef.current = false; return }
    if (!hasLoadedOnceRef.current) setLoading(true)

    // REL-003: páginas paginadas (o PostgREST corta em 1000 sem erro).
    const [{ data: ownData, error: ownError }, { data: shareData, error: shareError }] = await Promise.all([
      listOwnPages(userId),
      listSharesWithPages(userId),
    ])

    // PERF-007: falha de leitura não apaga a árvore da tela. Avisa e mantém a
    // última versão carregada.
    const readError = ownError ?? shareError
    if (readError) {
      console.error('refreshPages error:', readError)
      notifyRef.current.showToast('error', notifyRef.current.t('pages_load_error'), { dedupeKey: 'pages:load' })
      setLoading(false)
      return
    }

    const ownPages: Page[] = ownData ?? []

    // Map of directly shared page_id → role
    const directShareRole = new Map<string, PageShareRole>()
    const rawShared: Page[] = []
    if (shareData) {
      for (const { role, page: p } of shareData) {
        if (!p) continue
        directShareRole.set(p.id, role)
        rawShared.push({ ...p, share_role: role, is_shared: true })
      }
    }

    // Co-owner pages go into the user's own tree
    const coOwnerPages = rawShared.filter(p => p.share_role === 'co_owner')
    const allOwn = [...ownPages, ...coOwnerPages].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    setPages(prev => reconcileTree(prev, buildTree(allOwn)))

    // Viewer / editor shares: fetch ALL pages owned by the share-owners so that
    // descendants of shared pages are included (RLS now grants access recursively).
    const viewerEditorShares = rawShared.filter(p => p.share_role !== 'co_owner')
    const ownerIds = [...new Set(viewerEditorShares.map(p => p.user_id))]

    let sharedTrees: Page[] = []
    if (ownerIds.length > 0) {
      const { data: ownerPagesData, error: ownerError } = await listPagesOfOwners(ownerIds)
      if (ownerError) {
        console.error('refreshPages shared owners error:', ownerError)
        notifyRef.current.showToast('error', notifyRef.current.t('pages_load_error'), { dedupeKey: 'pages:load' })
        setLoading(false)
        return
      }

      const ownerPages: Page[] = ownerPagesData ?? []

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

    setSharedPages(prev => reconcileTree(prev, sharedTrees))
    setLoading(false)
    hasLoadedOnceRef.current = true
  }, [user?.id])

  useEffect(() => { refreshPages() }, [refreshPages])

  // Keeps the tree in sync when a collaborator creates/renames a page we can
  // see (RLS on `pages_select` already scopes which rows reach this client).
  // DELETE is intentionally not subscribed: Postgres Changes DELETE events
  // bypass row-level RLS filtering and can't be filtered by column, so every
  // subscriber would receive every deleted page's id across all users. Our
  // own deletes already update locally in `deletePage`; a collaborator's
  // delete is picked up on the next natural refresh instead.
  useEffect(() => {
    if (!user?.id) return
    const scheduleRefresh = () => {
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current)
      realtimeDebounceRef.current = setTimeout(() => { refreshPages() }, 400)
    }
    const channel = supabase
      .channel('pages_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pages' }, scheduleRefresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pages' }, scheduleRefresh)
      .subscribe()
    return () => {
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current)
      supabase.removeChannel(channel)
    }
  }, [user?.id, refreshPages])

  useEffect(() => {
    if (!loading && !restoredRef.current) {
      restoredRef.current = true
      // A migração no boot já reescreveu chaves legadas; o normalize aqui é
      // cinto e suspensório para valores gravados por builds antigos.
      const savedPanel = normalizeActivePanel(localStorage.getItem(ACTIVE_PANEL_KEY))
      if (savedPanel) {
        setActivePanelRaw(savedPanel)
      } else {
        const savedId = localStorage.getItem(ACTIVE_PAGE_KEY)
        if (savedId) {
          if (findPage([pages, sharedPages], savedId)) setActivePageId(savedId)
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
    if (!user?.id) return null
    return roleMap.get(pageId) ?? null
  }, [user?.id, roleMap])

  const createPage = useCallback(async (opts?: { parent_id?: string; type?: PageType }) => {
    const userId = user?.id
    if (!userId) return null
    const { data, error } = await insertPage({
      user_id: userId,
      title: opts?.type === 'todo' ? 'To-do list' : 'Untitled',
      icon: opts?.type === 'drawing' ? '🎨' : opts?.type === 'todo' ? '✅' : '📄',
      type: opts?.type ?? 'note',
      parent_id: opts?.parent_id ?? null,
      sort_order: Date.now(),
    })
    if (error || !data) {
      console.error('createPage error:', error)
      notify(error ?? { message: 'no row returned' }, 'pages_error_save', 'pages:save')
      return null
    }
    // Sem estes guards a pagina nasce sem linha de conteudo: existe na arvore e
    // abre vazia, sem nada indicando que a gravacao caiu pela metade.
    const contentToast = { label: 'createPage content', onError: (e: Parameters<typeof mapWriteError>[0]) =>
      notify(e, 'pages_error_save', 'pages:save') }
    if (data.type === 'note' || data.type === 'both') {
      await runGuarded(() => insertNoteContent(data.id), contentToast)
    }
    if (data.type === 'drawing' || data.type === 'both') {
      await runGuarded(() => insertDrawingContent(data.id), contentToast)
    }
    const newPage: Page = { ...data, children: [] }
    setPages(prev => {
      const { tree, inserted } = addNodeToTree(prev, opts?.parent_id, newPage)
      return inserted ? tree : [...prev, newPage]
    })
    return newPage
  }, [user?.id, notify])

  const updatePage = useCallback(async (id: string, updates: Partial<Page>) => {
    // `children`/`share_role`/`is_shared` sao campos de cliente (buildTree e
    // refreshPages), nao colunas — nunca devem ir no update.
    const { children: _children, share_role: _shareRole, is_shared: _isShared, ...columns } = updates
    const res = await runGuarded(
      // .select('id') porque um UPDATE barrado por RLS resolve com error: null e
      // zero linhas; aplicar isso na arvore e exatamente a divergencia do REL-002.
      async () => requireRows(await updatePageColumns(id, columns)),
      {
        label: 'updatePage',
        onError: error => notify(error, 'pages_error_save', 'pages:save'),
      },
    )
    if (!res.ok) return
    // Structural changes (reparenting) require a full rebuild; everything else
    // (rename, favorite, icon, type, sort) can be applied optimistically in place.
    if ('parent_id' in updates) {
      await refreshPages()
    } else {
      setPages(prev => updateNodeInTree(prev, id, updates))
      setSharedPages(prev => updateNodeInTree(prev, id, updates))
    }
    // A página aberta sai da árvore; a reserva só vale fora dela.
    setActivePageFallback(prev => (prev?.id === id ? { ...prev, ...updates } : prev))
  }, [refreshPages, notify])

  const deletePage = useCallback(async (id: string) => {
    // Sem .select() aqui: 0 linhas num delete e ambiguo (RLS barrou vs. alguem
    // ja apagou), e tratar como falha faria a pagina "voltar" num caso legitimo.
    const res = await runGuarded(
      () => deletePageRow(id),
      {
        label: 'deletePage',
        onError: error => notify(error, 'pages_error_delete', 'pages:delete'),
      },
    )
    if (!res.ok) return
    setActivePageId(prev => (prev === id ? null : prev))
    setActivePageFallback(prev => (prev?.id === id ? null : prev))
    // O realtime NAO assina DELETE (ver comentario acima), entao esta remocao
    // local e a unica correcao possivel — nada a conserta depois.
    setPages(prev => removeNodeFromTree(prev, id))
    setSharedPages(prev => removeNodeFromTree(prev, id))
  }, [notify])

  const activePage = useMemo(() => {
    if (!activePageId) return null
    return findPage([pages, sharedPages], activePageId)
      ?? (activePageFallback?.id === activePageId ? activePageFallback : null)
  }, [activePageId, activePageFallback, pages, sharedPages])

  const data = useMemo<PagesDataContextType>(
    () => ({ pages, sharedPages, loading, userShareRole }),
    [pages, sharedPages, loading, userShareRole],
  )
  const navigation = useMemo<PageNavigationContextType>(
    () => ({ activePage, setActivePage, activePanel, setActivePanel }),
    [activePage, setActivePage, activePanel, setActivePanel],
  )
  const actions = useMemo<PageActionsContextType>(
    () => ({ createPage, updatePage, deletePage, refreshPages }),
    [createPage, updatePage, deletePage, refreshPages],
  )

  return (
    <PagesDataContext.Provider value={data}>
      <PageNavigationContext.Provider value={navigation}>
        <PageActionsContext.Provider value={actions}>
          {children}
        </PageActionsContext.Provider>
      </PageNavigationContext.Provider>
    </PagesDataContext.Provider>
  )
}

// Compatibilidade: os 19 consumidores antigos importam daqui. Os hooks estreitos
// (usePagesData, usePageNavigation, usePageActions) vêm de ./pagesState.
export { usePages } from './pagesState'
