// @vitest-environment happy-dom
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '../../test/rtl'
import type { Page } from '../../types'

const pages = vi.hoisted(() => ({
  pages: [] as Page[],
  sharedPages: [] as Page[],
  setActivePage: vi.fn(),
  setActivePanel: vi.fn(),
  refreshPages: vi.fn(),
}))
vi.mock('../../contexts/PagesContext', () => ({ usePages: () => pages }))
type Mode = 'all' | 'finance' | 'documents'
const workspace = vi.hoisted((): { mode: Mode; setMode: ReturnType<typeof vi.fn> } => ({ mode: 'all', setMode: vi.fn() }))
vi.mock('../../contexts/WorkspaceModeContext', () => ({ useWorkspaceMode: () => workspace }))
const toast = vi.hoisted(() => ({ showToast: vi.fn() }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => toast }))
const getPageById = vi.hoisted(() => vi.fn())
vi.mock('../../lib/data/pages', () => ({ getPageById }))
const docs = vi.hoisted(() => ({ setDocsSelection: vi.fn() }))
vi.mock('../../lib/docsNavigation', () => docs)

import { onAppEvent } from '../../lib/appEvents'
import { LOCAL_KEYS } from '../../lib/localKeys'
import { useNotificationTarget } from './useNotificationTarget'

const page = (id: string): Page => ({ id, user_id: 'u2', title: id, icon: '📄', type: 'note', parent_id: null, sort_order: 0, is_favorite: false, created_at: null, updated_at: null })

beforeEach(() => {
  pages.pages = []
  pages.sharedPages = [page('p1')]
  workspace.mode = 'all'
  for (const fn of [pages.setActivePage, pages.setActivePanel, pages.refreshPages, workspace.setMode, toast.showToast, getPageById, docs.setDocsSelection]) fn.mockReset()
  pages.refreshPages.mockResolvedValue(undefined)
  localStorage.clear()
})

const open = async (target: Parameters<ReturnType<typeof useNotificationTarget>>[0]) => {
  const { result } = renderHook(() => useNotificationTarget())
  let ok = false
  await act(async () => { ok = await result.current(target) })
  return ok
}

describe('useNotificationTarget', () => {
  it('página já na árvore: abre na hora (saindo do modo Finanças)', async () => {
    workspace.mode = 'finance'
    expect(await open({ kind: 'page', pageId: 'p1' })).toBe(true)
    expect(workspace.setMode).toHaveBeenCalledWith('all')
    expect(pages.setActivePage).toHaveBeenCalledWith(pages.sharedPages[0])
    expect(getPageById).not.toHaveBeenCalled()
  })

  it('página recém-compartilhada: busca a linha e recarrega a árvore; sumiu, avisa', async () => {
    getPageById.mockResolvedValueOnce(page('p9'))
    expect(await open({ kind: 'page', pageId: 'p9' })).toBe(true)
    expect(pages.refreshPages).toHaveBeenCalled()
    expect(pages.setActivePage).toHaveBeenCalledWith(expect.objectContaining({ id: 'p9' }))
    getPageById.mockResolvedValueOnce(null)
    expect(await open({ kind: 'page', pageId: 'zz' })).toBe(false)
    expect(toast.showToast).toHaveBeenCalledWith('warning', 'Este item não está mais disponível.')
  })

  it('quadro e card: chaves do painel de Projetos + Documentos, e o evento para o painel já aberto', async () => {
    const projectsOpen = vi.fn()
    const offProjects = onAppEvent('projects_open', projectsOpen)
    workspace.mode = 'finance'
    await open({ kind: 'card', boardId: 'b1', cardId: 'c1' })
    expect(localStorage.getItem(LOCAL_KEYS.projectsActiveBoard)).toBe('b1')
    expect(localStorage.getItem(LOCAL_KEYS.projectsOpenCard)).toBe('c1')
    expect(docs.setDocsSelection).toHaveBeenCalledWith({ kind: 'projects' })
    expect(pages.setActivePanel).toHaveBeenCalledWith('documents')
    expect(projectsOpen).toHaveBeenLastCalledWith({ boardId: 'b1', cardId: 'c1' })
    localStorage.clear()
    workspace.mode = 'all'
    await open({ kind: 'board', boardId: 'b2' })
    expect(localStorage.getItem(LOCAL_KEYS.projectsActiveBoard)).toBe('b2')
    expect(localStorage.getItem(LOCAL_KEYS.projectsOpenCard)).toBeNull()
    expect(projectsOpen).toHaveBeenLastCalledWith({ boardId: 'b2' })
    offProjects()
  })

  it('workspace: painel de Finanças + chave e evento do modal; no modo Finanças só o modal', async () => {
    const opened = vi.fn()
    const off = onAppEvent('finance_workspace_open', opened)
    workspace.mode = 'documents'
    await open({ kind: 'finance-workspace' })
    expect(workspace.setMode).toHaveBeenCalledWith('all')
    expect(pages.setActivePanel).toHaveBeenCalledWith('finance')
    expect(localStorage.getItem(LOCAL_KEYS.financeOpenWorkspace)).toBe('1')
    expect(opened).toHaveBeenCalledTimes(1)
    pages.setActivePanel.mockReset()
    workspace.mode = 'finance'
    await open({ kind: 'finance-workspace' })
    expect(pages.setActivePanel).not.toHaveBeenCalled()
    off()
  })

  it('backup: pede as Configurações na aba Backup', async () => {
    const settings = vi.fn()
    const off = onAppEvent('settings_open', settings)
    await open({ kind: 'settings-backup' })
    expect(settings).toHaveBeenCalledWith({ tab: 'backup' })
    off()
  })
})
