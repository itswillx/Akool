import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../i18n/LanguageContext'
import { bestQuote, quoteTotal } from '../../../lib/financeProjectCalc'
import type { FinanceAccount, FinanceProject, FinanceProjectItem } from '../../../types'
import { primaryBtnStyle } from '../ui'
import { ExpenseModal, type ExpenseDraft } from './ExpenseModal'
import { ProjectDetail } from './ProjectDetail'
import { ProjectList } from './ProjectList'
import { ProjectModal } from './ProjectModal'
import { useFinanceProjects } from './useFinanceProjects'

// Which obra is open survives a reload, the same way the finance tab and layout
// already do. An id pointing at a deleted obra simply falls back to the list.
const OPEN_KEY = 'finance_project_open_id'

// Entry point of the works ("Obras") submodule: a list of projects that opens
// into a detail view. Rendered as a tab of FinancePanel, inside its mobile
// context provider — the shared Modal depends on it.
export default function FinanceProjectsTab({ workspaceId, accounts }: {
  workspaceId: string | null
  accounts: FinanceAccount[]
}) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const store = useFinanceProjects(user?.id, workspaceId)
  const [openId, setOpenId] = useState<string | null>(() => localStorage.getItem(OPEN_KEY))

  useEffect(() => {
    if (openId) localStorage.setItem(OPEN_KEY, openId)
    else localStorage.removeItem(OPEN_KEY)
  }, [openId])
  const [projectModal, setProjectModal] = useState<{ open: boolean; project?: FinanceProject }>({ open: false })
  // Set when the user buys a shopping item: seeds the expense form.
  const [buying, setBuying] = useState<{ project: FinanceProject; prefill: Partial<ExpenseDraft> } | null>(null)

  const open = openId ? store.projects.find(p => p.id === openId) ?? null : null

  // Turning a planned item into a real expense: carry over the description,
  // stage and the price we settled on (chosen quote, else cheapest, else the
  // user's own estimate) so the form opens essentially filled in.
  const startPurchase = (project: FinanceProject, item: FinanceProjectItem) => {
    const own = store.quotes.filter(q => q.item_id === item.id)
    const picked = own.find(q => q.id === item.chosen_quote_id) ?? bestQuote(own, item)
    const amount = picked ? quoteTotal(picked, item) : Math.round(item.quantity * item.estimated_unit_price)
    setBuying({
      project,
      prefill: {
        item_id: item.id,
        stage_id: item.stage_id,
        supplier_id: picked?.supplier_id ?? null,
        description: item.name,
        amount,
        attachments: [],
      },
    })
  }

  if (store.loading) {
    return <div style={{ padding: 24, color: 'var(--color-text-muted)', fontSize: 13 }}>{t('finance_loading')}</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {store.error && (
        <div style={{ padding: '9px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', color: 'var(--color-error)', fontSize: 12.5 }}>
          {store.error}
        </div>
      )}

      {open ? (
        <ProjectDetail
          project={open}
          store={store}
          accounts={accounts}
          onBack={() => setOpenId(null)}
          onEdit={() => setProjectModal({ open: true, project: open })}
          onBuyItem={item => startPurchase(open, item)}
        />
      ) : (
        <>
          {store.projects.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button style={primaryBtnStyle} onClick={() => setProjectModal({ open: true })}>
                <Plus size={15} />{t('finance_proj_new')}
              </button>
            </div>
          )}
          <ProjectList store={store} onOpen={p => setOpenId(p.id)} onNew={() => setProjectModal({ open: true })} />
        </>
      )}

      {projectModal.open && (
        <ProjectModal
          project={projectModal.project}
          // Only the obra's owner decides its sharing; for a member editing a
          // shared obra the toggle is hidden and the current value preserved.
          workspaceId={!projectModal.project || projectModal.project.user_id === user?.id ? workspaceId : null}
          onClose={() => setProjectModal({ open: false })}
          onSave={async form => {
            if (projectModal.project) await store.updateProject(projectModal.project.id, form)
            else {
              const created = await store.createProject(form)
              if (created) setOpenId(created.id)
            }
          }}
          onDelete={projectModal.project
            ? async () => { await store.deleteProject(projectModal.project!.id); setOpenId(null) }
            : undefined}
        />
      )}

      {buying && (
        <ExpenseModal
          project={buying.project}
          store={store}
          prefill={buying.prefill}
          accounts={accounts}
          onClose={() => setBuying(null)}
          onSave={async draft => { await store.createExpense({ ...draft, project_id: buying.project.id }) }}
        />
      )}
    </div>
  )
}
