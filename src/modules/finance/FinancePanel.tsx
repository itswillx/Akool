import { ChevronLeft, ChevronRight, FileDown, PanelLeft, PanelTop, Plus, Users, Wallet } from 'lucide-react'
import { useModuleTour } from '../../hooks/useModuleTour'
import { onAppEvent } from '../../lib/appEvents'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Tabs } from '../../components/Tabs'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useLanguage } from '../../i18n/LanguageContext'
import {
    balancesByAccount,
    transactionsInMonth
} from '../../lib/financeCalc'
import { lastNMonths } from '../../lib/financeGraph'
import { tabPanelProps } from '../../lib/tabs'

// Shared primitives (modal/drawer/emoji picker, mobile context, design tokens)
// live in ./ui so the works submodule reuses them instead of duplicating.
import { currentYM, monthLabel, nextMonth, prevMonth } from './financeFormat'
import { FinanceModals } from './FinanceModals'
import { FinanceSidebar, MobileBottomNav, MoreMenuSheet } from './nav/FinanceNav'
import { FINANCE_NAV_ICON, FINANCE_TAB_IDS, tabLabelKey } from './nav/navItems'
import { AccountsTab } from './tabs/AccountsTab'
import { BudgetsTab } from './tabs/BudgetsTab'
import { CategoriesTab } from './tabs/CategoriesTab'
import { GoalsTab } from './tabs/GoalsTab'
import { OverviewTab } from './tabs/OverviewTab'
import { RecurringTab } from './tabs/RecurringTab'
import { TransactionsTab } from './tabs/TransactionsTab'
import {
    FIN_ACCENT, FIN_ACCENT_TEXT,
    FIN_NEG,
    FinanceMobileContext,
    ghostBtnStyle,
    MOBILE_NAV_HEIGHT,
    segBtnStyle,
    segTrackStyle
} from './ui'
import { useAutoRecurringBudgets } from './useAutoRecurringBudgets'
import { useFinanceActions } from './useFinanceActions'
import { fetchFullHistoryTx, useFinanceData } from './useFinanceData'
import { useFinanceModals } from './useFinanceModals'
import { useFinanceNavigation } from './useFinanceNavigation'

// Obras, Investimentos e Loja deixaram de ser abas irmãs: viraram sub-abas de
// "Projetos", que é quem faz o lazy import de cada uma agora.
const MyProjectsTab = lazy(() => import('./myprojects/MyProjectsTab'))

// Lazy pelo mesmo motivo: o layout de força e o SVG do grafo só entram no
// bundle quando alguém abre a aba Rede.
const NetworkTab = lazy(() => import('./network/NetworkTab'))


// Puro e minúsculo: a resolução da aba acontece no primeiro render, antes de
// qualquer chunk lazy, então não pode depender de um.

// Static (non-lazy) on purpose: it is the default overview and pulls no new
// dependency, so a Suspense flash would cost more than it saves.
import CoworkspaceOverviewTab from './tabs/CoworkspaceOverviewTab'
import OverviewDetailedTab from './tabs/OverviewDetailedTab'

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function FinancePanel({ isMobile: isMobileProp }: { isMobile?: boolean } = {}) {
  const { user, profile } = useAuth()
  const { t, lang } = useLanguage()
  useModuleTour('finance')
  const { showToast } = useToast()
  const isMobileHook = useIsMobile()
  const isMobile = isMobileProp ?? isMobileHook
  const financeData = useFinanceData()
  const {
    accounts, categories, transactions, budgets, goals, contributions, goalShares, incomingGoalShares, sharedTransactions, sharedBudgets, partnerProfiles, recurring, recurringEntries, workspace, workspaceMembers, pendingInvitesForMe, familyTransactions, familyBudgets, familyAccounts, familyCategories, txAggOwn, txAggWorkspace, loading, loadError, reload, ensureMonthLoaded, ensureMonthsLoaded,
    refetchTransactions,
  } = financeData

  const [month, setMonth] = useState(currentYM())

  // Keeps the loaded transaction window centered on whatever month is being
  // viewed, fetching the extra month(s) on demand when the user navigates past
  // the currently loaded range. Gated on `!loading`: on first mount the hook's
  // own initial load already covers `month` (±1), and firing this before that
  // resolves would race it with a narrower single-month fetch.
  useEffect(() => {
    if (!loading) ensureMonthLoaded(month)
  }, [month, loading, ensureMonthLoaded])

  const [exporting, setExporting] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [wsModalOpen, setWsModalOpen] = useState(false)

  const { tab, setTab, projSection, setProjSection, navigateTo, direction, setDirection } = useFinanceNavigation()

  // The Rede tab has its own 1/3/6/12-month filter anchored at today, independent
  // of `month` — make sure the window covers the widest of those (12 months)
  // before/while the tab is open.
  useEffect(() => {
    if (tab === 'network' && !loading) ensureMonthsLoaded(lastNMonths(currentYM(), 12))
  }, [tab, loading, ensureMonthsLoaded])

  // The store submodule writes to finance_transactions on its own (linked
  // income/expense of a sale/purchase) and announces it here, so the
  // Transactions tab reflects the change without an F5. Silent: a full reload
  // would flip `loading` and unmount the tab the user is standing on.
  useEffect(() => onAppEvent('finance_transactions_changed', () => { refetchTransactions() }), [refetchTransactions])

  useAutoRecurringBudgets({ data: financeData, month })

  // Tabs are always personal now; workspace rows appear where they belong:
  // the user's own shared rows inline (with a badge) and everyone's in the
  // Coworkspace overview. This merged set exists only to RESOLVE names of
  // workspace categories/accounts referenced by the user's own shared rows
  // (own tx can point at a workspace category the personal list lacks).
  const ownWsCategories = familyCategories.filter(c => c.user_id === user?.id)
  const resolveCategories = [...categories, ...familyCategories]
  // All-time, for CategoryModal's "in use" check — a category can be in use by
  // a transaction outside the currently loaded month window.
  const allVisibleTxsAgg = [...txAggOwn, ...txAggWorkspace.filter(tx => tx.user_id !== user?.id)]

  // Coworkspace view of the overview tab: session-only, entered via the chip
  // on the personal overviews. Falls back to personal if the workspace goes
  // away (left/removed).
  const [overviewScope, setOverviewScope] = useState<'personal' | 'workspace'>('personal')
  useEffect(() => {
    if (overviewScope === 'workspace' && !workspace) setOverviewScope('personal')
  }, [overviewScope, workspace])

  // Total balance across the user's accounts (shown in the Lateral sidebar footer).
  // All-time, so it reads the lean aggregate set rather than the month window.
  const accountsBalanceTotal = useMemo(() => {
    let sum = 0
    for (const balance of balancesByAccount(accounts, txAggOwn).values()) sum += balance
    return sum
  }, [accounts, txAggOwn])

  // Modais
  const modals = useFinanceModals()
  const { setTxModal, setAccModal, setBudgetModal, setGoalModal, setContributionGoal, setCatModal, setRecurringModal, setGoalShareModal } = modals

  const monthTxs = useMemo(() => transactionsInMonth(transactions, month), [transactions, month])

  const actions = useFinanceActions({ data: financeData, modals })
  const { openImportModal, quickAddTx, bulkDeleteTx, deleteBudget, deleteGoal, updateGoalStatus, deleteContribution, handleMarkPaid, skipEntry } = actions

  // Uma meta atravessa vários meses, então o seletor de mês só confundiria —
  // mesmo raciocínio de categorias/recorrentes. Dentro de Projetos a decisão é
  // por sub-aba: a Loja usa o mês nos seus cards de resumo, Metas e o Resumo
  // por fase não.
  const monthlessSection = projSection === 'summary' || projSection === 'goals'
  // A aba Rede tem seletor de período próprio (1m/3m/6m/12m nos filtros).
  const monthNavVisible = tab !== 'categories' && tab !== 'recurring' && tab !== 'network'
    && !(tab === 'myprojects' && monthlessSection)

  // Desktop nav arrangement (mobile always uses the bottom nav).
  const showSidebar = !isMobile && direction === 'side'
  const showTopTabs = !isMobile && direction === 'top'

  // Header subtitle shown in the Lateral layout under the tab title.
  const tabSubtitle =
    tab === 'overview' ? t('finance_subtitle_overview', { month: monthLabel(month, lang) })
    : tab === 'transactions' ? (monthTxs.length === 1 ? t('finance_subtitle_transactions', { n: 1 }) : t('finance_subtitle_transactions_plural', { n: monthTxs.length }))
    : ''

  return (
    <FinanceMobileContext.Provider value={isMobile}>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--color-bg-secondary)', overflow: 'hidden', position: 'relative' }}>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {showSidebar && (
          <FinanceSidebar tab={tab} onSelect={setTab} accountsBalance={accountsBalanceTotal} accountCount={accounts.length} />
        )}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: isMobile ? '10px 14px' : '0 24px', minHeight: 60, flexShrink: 0, backgroundColor: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
          {showTopTabs ? (
            <>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: FIN_ACCENT, color: FIN_ACCENT_TEXT, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Wallet size={17} />
              </div>
              <div style={{ fontWeight: 600, fontSize: 14.5, color: 'var(--color-text)', letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>{t('finance_title')}</div>
            </>
          ) : (
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '-0.01em' }}>{t(tabLabelKey(tab))}</div>
              {!isMobile && tabSubtitle && <div style={{ fontSize: 12.5, color: 'var(--color-text-subtle)', marginTop: -1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tabSubtitle}</div>}
            </div>
          )}
        </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {/* Month navigator — hidden on goals and categories tabs */}
          {monthNavVisible && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '3px 6px', flexShrink: 0 }}>
              <button aria-label={t('finance_prev_month')} onClick={() => setMonth(prevMonth(month))}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', padding: 4, borderRadius: 4 }}>
                <ChevronLeft size={15} />
              </button>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)', minWidth: isMobile ? 74 : 90, textAlign: 'center', textTransform: 'capitalize' }}>
                {monthLabel(month, lang)}
              </span>
              <button aria-label={t('finance_next_month')} onClick={() => setMonth(nextMonth(month))}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', padding: 4, borderRadius: 4 }}>
                <ChevronRight size={15} />
              </button>
            </div>
          )}
          {/* Workspace button */}
          <button
            onClick={() => setWsModalOpen(true)}
            title={workspace ? workspace.name : t('finance_workspace_title')}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: isMobile ? 8 : '7px 11px', borderRadius: 8, border: '1px solid var(--color-border)', background: workspace ? 'var(--color-active)' : 'var(--color-surface)', cursor: 'pointer', fontSize: 12.5, color: workspace ? 'var(--color-text)' : 'var(--color-text-subtle)', flexShrink: 0, whiteSpace: 'nowrap', fontWeight: workspace ? 600 : 500, position: 'relative' }}
          >
            <Users size={isMobile ? 16 : 14} />
            {!isMobile && <span>{t('finance_workspace_title')}</span>}
            {pendingInvitesForMe.length > 0 && (
              <span style={{ minWidth: 16, height: 16, borderRadius: 999, backgroundColor: FIN_NEG, color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                {pendingInvitesForMe.length}
              </span>
            )}
          </button>
          {/* Layout toggle — desktop only */}
          {!isMobile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, paddingLeft: 9, marginLeft: 1, borderLeft: '1px solid var(--color-border)' }}>
              <span style={{ fontSize: 10.5, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('finance_layout')}</span>
              <div style={segTrackStyle}>
                <button onClick={() => setDirection('side')} title={t('finance_layout_side')} style={segBtnStyle(direction === 'side')}><PanelLeft size={14} />{t('finance_layout_side')}</button>
                <button onClick={() => setDirection('top')} title={t('finance_layout_top')} style={segBtnStyle(direction === 'top')}><PanelTop size={14} />{t('finance_layout_top')}</button>
              </div>
            </div>
          )}
          <button
            onClick={async () => {
              if (exporting || !user) return
              setExporting(true)
              try {
                // Full lifetime history, fetched fresh here rather than kept in
                // the hook's state — the export has always covered every
                // transaction the user has, not just the loaded month window.
                const { own: exportTxs, error } = await fetchFullHistoryTx(user.id, null)
                // Nunca um PDF com só parte das transações.
                if (error) {
                  console.error('[FinancePDF] export error:', error)
                  showToast('error', t('finance_tx_load_error'), { dedupeKey: 'finance-tx-load-error' })
                  return
                }
                const { exportFinanceToPdf } = await import('../../lib/financePdf')
                exportFinanceToPdf({ transactions: exportTxs, accounts, categories, budgets, goals, contributions, recurring, month, userName: profile?.display_name || profile?.email || '' , lang })
              } catch (err) {
                console.error('[FinancePDF] export error:', err)
              } finally {
                setExporting(false)
              }
            }}
            disabled={exporting}
            title={t('finance_pdf_export_btn')}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', cursor: exporting ? 'not-allowed' : 'pointer', color: 'var(--color-text-subtle)', opacity: exporting ? 0.6 : 1, flexShrink: 0 }}
          >
            <FileDown size={16} />
          </button>
          </div>
      </div>

      {/* Top tabs — desktop, Topo layout */}
      {showTopTabs && (
        // UX-008: abas de verdade (tablist), com ←/→ entre elas e o painel ligado.
        <Tabs
          idBase="finance"
          items={FINANCE_TAB_IDS}
          selected={tab}
          onSelect={setTab}
          label={t('finance_nav_label')}
          className="finance-hide-scrollbar"
          style={{ display: 'flex', gap: 2, padding: '0 24px', backgroundColor: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', overflowX: 'auto', flexShrink: 0 }}
          renderTab={(id, tabProps, active) => (
            <button key={id} type="button" {...tabProps}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '11px 13px', border: 'none', borderBottom: active ? '2px solid var(--color-text)' : '2px solid transparent', marginBottom: -1, background: 'transparent', color: active ? 'var(--color-text)' : 'var(--color-text-subtle)', cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : 500, whiteSpace: 'nowrap', flexShrink: 0 }}>
              <span style={{ display: 'flex' }} aria-hidden="true">{FINANCE_NAV_ICON[id]}</span>{t(tabLabelKey(id))}
            </button>
          )}
        />
      )}

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', backgroundColor: 'var(--color-bg-secondary)', padding: isMobile ? '16px' : '22px 24px 48px', paddingBottom: isMobile ? MOBILE_NAV_HEIGHT + 24 : 48 }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', width: '100%' }} {...(showTopTabs ? tabPanelProps('finance', tab) : {})}>
        {loadError && !loading ? (
          // PERF-003: carga falhou; nada de saldo zero, só a opção de tentar de novo.
          <div role="alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, minHeight: 200, padding: 24, textAlign: 'center' }}>
            <p style={{ margin: 0, maxWidth: 420, fontSize: 14, color: 'var(--color-text)', lineHeight: 1.5 }}>{t('finance_load_error')}</p>
            <button type="button" onClick={() => { void reload() }} style={{ ...ghostBtnStyle, padding: '8px 16px' }}>
              {t('common_error_retry')}
            </button>
          </div>
        ) : loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: 'var(--color-text-muted)', fontSize: 14 }}>
            {t('finance_loading')}
          </div>
        ) : (
          <>
            {tab === 'overview' && (overviewScope === 'workspace' && workspace ? (
              <CoworkspaceOverviewTab
                workspace={workspace}
                members={workspaceMembers}
                transactions={familyTransactions}
                transactionsAgg={txAggWorkspace}
                budgets={familyBudgets}
                accounts={familyAccounts}
                categories={familyCategories}
                month={month}
                onBack={() => setOverviewScope('personal')}
                onManage={() => setWsModalOpen(true)}
              />
            ) : (profile?.finance_dashboard_view ?? 'detailed') === 'simple' ? (
              <OverviewTab
                transactions={transactions}
                transactionsAgg={txAggOwn}
                categories={resolveCategories}
                month={month}
                recurring={recurring}
                recurringEntries={recurringEntries}
                accounts={accounts}
                budgets={budgets}
                goals={goals}
                contributions={contributions}
                onMarkPaid={handleMarkPaid}
                onSkipEntry={skipEntry}
                onNavigate={navigateTo}
                workspaceName={workspace?.name ?? null}
                onOpenWorkspaceView={() => setOverviewScope('workspace')}
              />
            ) : (
              <OverviewDetailedTab
                transactions={transactions}
                transactionsAgg={txAggOwn}
                categories={resolveCategories}
                accounts={accounts}
                budgets={budgets}
                goals={goals}
                contributions={contributions}
                recurring={recurring}
                recurringEntries={recurringEntries}
                month={month}
                onNavigate={navigateTo}
                workspaceName={workspace?.name ?? null}
                onOpenWorkspaceView={() => setOverviewScope('workspace')}
              />
            ))}
            {tab === 'transactions' && (
              <TransactionsTab
                transactions={monthTxs}
                partnerTransactions={sharedTransactions.filter(tx => tx.date.startsWith(month))}
                partnerProfiles={partnerProfiles}
                accounts={accounts}
                categories={categories}
                workspace={workspace}
                workspaceCategories={familyCategories}
                workspaceAccounts={familyAccounts}
                month={month}
                onAdd={() => setTxModal({ open: true })}
                onEdit={tx => setTxModal({ open: true, tx })}
                onQuickAdd={quickAddTx}
                onBulkDelete={bulkDeleteTx}
                onImport={openImportModal}
              />
            )}
            {tab === 'budgets' && (
              <BudgetsTab
                budgets={budgets}
                sharedBudgets={sharedBudgets}
                transactions={transactions}
                partnerTransactions={sharedTransactions}
                partnerProfiles={partnerProfiles}
                categories={resolveCategories}
                month={month}
                onAdd={() => setBudgetModal({ open: true })}
                onEdit={budget => setBudgetModal({ open: true, budget })}
                onDeleteBudget={deleteBudget}
              />
            )}
            {tab === 'accounts' && (
              <AccountsTab
                accounts={accounts}
                transactions={txAggOwn}
                onAdd={() => setAccModal({ open: true })}
                onEdit={acc => setAccModal({ open: true, account: acc })}
              />
            )}
            {tab === 'categories' && (
              <CategoriesTab
                categories={[...categories, ...ownWsCategories]}
                transactions={txAggOwn}
                onAdd={() => setCatModal({ open: true })}
                onEdit={c => setCatModal({ open: true, category: c })}
              />
            )}
            {tab === 'recurring' && (
              <RecurringTab
                recurring={recurring}
                recurringEntries={recurringEntries}
                categories={categories}
                month={month}
                onAdd={() => setRecurringModal({ open: true })}
                onEdit={item => setRecurringModal({ open: true, item })}
                onMarkPaid={handleMarkPaid}
                onSkip={skipEntry}
              />
            )}
            {tab === 'network' && (
              <Suspense fallback={<div style={{ padding: 24, color: 'var(--color-text-muted)', fontSize: 13 }}>{t('finance_loading')}</div>}>
                <NetworkTab
                  accounts={accounts}
                  categories={workspace ? resolveCategories : categories}
                  transactions={transactions}
                  goals={goals}
                  contributions={contributions}
                />
              </Suspense>
            )}
            {tab === 'myprojects' && (
              <Suspense fallback={<div style={{ padding: 24, color: 'var(--color-text-muted)', fontSize: 13 }}>{t('finance_loading')}</div>}>
                {/* Loja e Metas numa aba só.

                    Metas vai como elemento pronto (`goalsSlot`): são treze
                    props e três modais que continuam morando aqui — encaná-los
                    pelo MyProjectsTab não daria nada em troca. */}
                <MyProjectsTab
                  section={projSection}
                  onSectionChange={setProjSection}
                  workspaceId={workspace?.id ?? null}
                  accounts={accounts}
                  categories={workspace ? resolveCategories : categories}
                  month={month}
                  goals={goals}
                  contributions={contributions}
                  goalsSlot={(
                    <GoalsTab
                      goals={goals}
                      contributions={contributions}
                      accounts={accounts}
                      goalShares={goalShares}
                      incomingGoalShares={incomingGoalShares}
                      partnerProfiles={partnerProfiles}
                      onNewGoal={() => setGoalModal({ open: true })}
                      onEditGoal={g => setGoalModal({ open: true, goal: g })}
                      onDeleteGoal={deleteGoal}
                      onAddContribution={g => setContributionGoal(g)}
                      onDeleteContribution={deleteContribution}
                      onUpdateStatus={updateGoalStatus}
                      onShareGoal={g => setGoalShareModal({ open: true, goal: g })}
                    />
                  )}
                />
              </Suspense>
            )}
          </>
        )}
        </div>
      </div>
        </div>
      </div>

      {/* Quick action fab — desktop only (mobile uses bottom nav central FAB) */}
      {!isMobile && (tab === 'transactions' || tab === 'overview') && !loading && !loadError && (
        <button
          onClick={() => setTxModal({ open: true })}
          title={t('finance_new_transaction')}
          style={{ position: 'fixed', bottom: 32, right: 32, width: 52, height: 52, borderRadius: '50%', border: 'none', backgroundColor: FIN_ACCENT, color: FIN_ACCENT_TEXT, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 20px rgba(0,0,0,0.25)', zIndex: 50 }}>
          <Plus size={22} />
        </button>
      )}

      {/* Mobile bottom navigation */}
      {isMobile && !loading && !loadError && (
        <MobileBottomNav
          tab={tab}
          onSelect={setTab}
          onMore={() => setMoreMenuOpen(true)}
          onQuickAdd={() => setTxModal({ open: true })}
        />
      )}
      {isMobile && moreMenuOpen && (
        <MoreMenuSheet current={tab} onSelect={setTab} onClose={() => setMoreMenuOpen(false)} />
      )}

      <FinanceModals
        data={financeData} modals={modals} actions={actions} month={month}
        allVisibleTxsAgg={allVisibleTxsAgg} wsModalOpen={wsModalOpen} setWsModalOpen={setWsModalOpen}
      />
    </div>
    </FinanceMobileContext.Provider>
  )
}
