import { useMemo, useRef, useState } from 'react'
import { Upload, AlertTriangle, CheckCircle2, FileText, ChevronDown, ChevronRight } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext'
import type { TranslationKey } from '../../../i18n/translations'
import { formatBRL } from '../../../lib/money'
import type { FinanceAccount, FinanceCategory, FinanceTransaction, FinanceWorkspace } from '../../../types'
import {
  buildExistingTxIndex, buildHistorySuggestions, groupForCategorization, groupKeyFor,
  isLikelyDuplicate, type InternalReason, type ParsedStatement, type ParsedTx,
} from '../../../lib/statementImport'
import {
  classifyInvestment, investmentImportKey, type InvestmentMatch,
} from '../../../lib/investmentClassifier'
import { parseStatementFile, type ParseFileError } from './parseStatementFile'
import {
  Modal, ScopePicker, useFinanceMobile,
  inputStyle, labelStyle, tabularNums, primaryBtnStyle, ghostBtnStyle,
  FIN_ACCENT, FIN_POS, FIN_NEG, FIN_NEG_SOFT, FIN_WARN,
} from '../ui'

// Multi-step statement import: pick a file → (password, if the PDF is
// protected) → review the parsed rows → decide whether to categorize now or
// later → single bulk insert. Parsing lives in ./parseStatementFile; this
// component only owns the flow, the selection and the category assignment.

type Step =
  | { step: 'pick' }
  | { step: 'password'; file: File; wrong: boolean }
  | { step: 'parsing' }
  | { step: 'preview' }
  | { step: 'categorize' }
  | { step: 'saving' }
  | { step: 'done'; count: number }
  | { step: 'error'; error: ParseFileError | 'generic' }

// Where a statement line is headed. Investment rows do NOT become
// transactions — that is the whole point: they would inflate the month's
// income/expense. They go to finance_investment_movements instead, which the
// account balance subtracts explicitly, so the money stops vanishing.
type RowTarget = 'transaction' | 'investment' | 'skip'

interface PreviewRow {
  tx: ParsedTx
  selected: boolean
  duplicate: boolean
  /** Set when the classifier recognized an investment in the description. */
  invest?: InvestmentMatch
  target: RowTarget
}

/** One row headed to finance_investment_movements, resolved by the caller. */
export interface ParsedInvestmentMovement {
  match: InvestmentMatch
  date: string
  amount: number
  description: string
  importKey: string
}

const ERROR_KEYS: Record<ParseFileError | 'generic', TranslationKey> = {
  needs_password: 'finance_import_err_generic',
  wrong_password: 'finance_import_wrong_password',
  unrecognized: 'finance_import_err_unrecognized',
  invalid_ofx: 'finance_import_err_invalid_ofx',
  empty: 'finance_import_err_empty',
  generic: 'finance_import_err_generic',
}

const INTERNAL_KEYS: Record<InternalReason, TranslationKey> = {
  card_payment: 'finance_import_internal_card_payment',
  investment: 'finance_import_internal_investment',
  refund: 'finance_import_internal_refund',
  fee: 'finance_import_internal_fee',
}

// Parser warnings arrive as `code: payload` (and `c6_incomplete_tx (reason):
// payload`), where the payload is the raw statement line or a line number.
// Until now they were collected and never rendered, so lines the parser gave up
// on vanished without a trace — the user saw a total that did not match the
// bank and had no way to know why.
const WARNING_KEYS: Record<string, TranslationKey> = {
  c6_bad_amount: 'finance_import_warn_c6_bad_amount',
  c6_incomplete_tx: 'finance_import_warn_c6_incomplete_tx',
  c6_tx_before_section: 'finance_import_warn_c6_tx_before_section',
  c6_unknown_kind: 'finance_import_warn_c6_unknown_kind',
  ofx_skipped: 'finance_import_warn_ofx_skipped',
  ofx_duplicate_fitid: 'finance_import_warn_ofx_duplicate_fitid',
}

const MOVEMENT_KIND_KEYS: Record<InvestmentMatch['movementKind'], TranslationKey> = {
  contribution: 'finance_invest_kind_contribution',
  redemption: 'finance_invest_kind_redemption',
  yield: 'finance_invest_kind_yield',
  tax: 'finance_invest_kind_tax',
  fee: 'finance_invest_kind_fee',
}

function parseWarning(warning: string): { key: TranslationKey; detail: string } {
  const sep = warning.indexOf(':')
  const head = (sep === -1 ? warning : warning.slice(0, sep)).trim()
  const detail = sep === -1 ? '' : warning.slice(sep + 1).trim()
  // `c6_incomplete_tx (new_tx)` — the parenthetical reason is parser internals,
  // useful in the detail line but not part of the lookup.
  const code = head.replace(/\s*\(.*\)$/, '')
  const suffix = head.slice(code.length).trim()
  return {
    key: WARNING_KEYS[code] ?? 'finance_import_warn_unknown',
    detail: [suffix, detail].filter(Boolean).join(' '),
  }
}

export default function ImportStatementModal({
  accounts, workspaceAccounts, categories, workspaceCategories, workspace,
  existingTransactions, onImport, onClose,
}: {
  accounts: FinanceAccount[]
  workspaceAccounts: FinanceAccount[]
  categories: FinanceCategory[]
  workspaceCategories: FinanceCategory[]
  workspace?: FinanceWorkspace | null
  existingTransactions: FinanceTransaction[]
  onImport: (
    rows: Omit<FinanceTransaction, 'id' | 'user_id' | 'created_at'>[],
    investments: ParsedInvestmentMovement[],
    context: { accountId: string | null; workspaceId: string | null },
  ) => Promise<void>
  onClose: () => void
}) {
  const { t } = useLanguage()
  const isMobile = useFinanceMobile()
  const fileRef = useRef<HTMLInputElement>(null)

  const [state, setState] = useState<Step>({ step: 'pick' })
  const [statement, setStatement] = useState<ParsedStatement | null>(null)
  const [rows, setRows] = useState<PreviewRow[]>([])
  const [password, setPassword] = useState('')
  const [scope, setScope] = useState<string | null>(null)
  const [accountId, setAccountId] = useState('')
  const [groupCategories, setGroupCategories] = useState<Record<string, string>>({})
  const [showWarnings, setShowWarnings] = useState(false)

  const scopedAccounts = scope ? workspaceAccounts : accounts
  const scopedCategories = scope ? workspaceCategories : categories

  // Category suggestions look at every transaction the user has, not just the
  // visible month, so merchant history works across the whole account.
  //
  // The dedup index is NOT memoized on purpose: it counts occurrences and is
  // consumed as rows are flagged, so each parse needs a fresh one. Memoizing it
  // would leave a second file picked in the same session comparing against an
  // already-drained index.
  const suggestions = useMemo(() => buildHistorySuggestions(existingTransactions), [existingTransactions])

  // Only plain transactions reach the categorize step: asking for a category
  // for a CDB contribution makes no sense, and it never becomes a transaction.
  const selectedIdx = useMemo(
    () => new Set(rows.flatMap((r, i) => (r.selected && r.target === 'transaction' ? [i] : []))),
    [rows],
  )
  const selectedCount = selectedIdx.size
  const selectedTotal = rows.reduce((s, r) => (r.selected && r.target === 'transaction' ? s + r.tx.amount : s), 0)

  // Rendered in two sections, but `rows` stays a single array so the checkbox
  // handlers keep addressing rows by their original index.
  const indexed = rows.map((row, i) => ({ row, i }))
  const txRows = indexed.filter(r => r.row.target !== 'investment')
  const investRows = indexed.filter(r => r.row.target === 'investment')
  const investIn = investRows.reduce(
    (s, { row }) => (row.selected && row.invest?.movementKind === 'contribution' ? s + row.tx.amount : s), 0)
  const investOut = investRows.reduce(
    (s, { row }) => (row.selected && row.invest && row.invest.movementKind !== 'contribution' ? s + row.tx.amount : s), 0)
  const investCount = investRows.filter(r => r.row.selected).length
  // A statement with nothing but investment movements is a normal case, so
  // "Importar sem categorias" must stay enabled when only those are selected.
  const nothingToImport = selectedCount === 0 && investCount === 0

  const groups = useMemo(
    () => (state.step === 'categorize' ? groupForCategorization(rows.map(r => r.tx), selectedIdx, suggestions) : []),
    [state.step, rows, selectedIdx, suggestions],
  )

  const runParse = async (file: File, pwd?: string) => {
    setState({ step: 'parsing' })
    const result = await parseStatementFile(file, pwd)
    if (!result.ok) {
      if (result.error === 'needs_password') { setState({ step: 'password', file, wrong: false }); return }
      if (result.error === 'wrong_password') { setState({ step: 'password', file, wrong: true }); return }
      setState({ step: 'error', error: result.error })
      return
    }
    setStatement(result.statement)
    const dupIndex = buildExistingTxIndex(existingTransactions)
    setRows(result.statement.txs.map(tx => {
      const duplicate = isLikelyDuplicate(tx, dupIndex)
      const invest = classifyInvestment(tx.description, tx.sourceKind, tx.type) ?? undefined
      if (invest) {
        // Duplicate detection compares against transactions, which an
        // investment row never becomes — the movement table has its own, real
        // uniqueness (investment_id + import_key), so the flag is meaningless
        // here. Only low-confidence guesses arrive unchecked, for the user to
        // confirm.
        return { tx, duplicate: false, invest, target: 'investment' as const, selected: invest.confidence === 'high' }
      }
      return {
        tx,
        duplicate,
        target: (tx.internal || duplicate ? 'skip' : 'transaction') as RowTarget,
        selected: !tx.internal && !duplicate,
      }
    }))
    setAccountId(prev => prev || accounts[0]?.id || '')
    setState({ step: 'preview' })
  }

  const doImport = async (withCategories: boolean) => {
    setState({ step: 'saving' })
    const payload = rows.flatMap(r => {
      if (!r.selected || r.target !== 'transaction') return []
      const categoryId = withCategories ? (groupCategories[groupKeyFor(r.tx)] || null) : null
      return [{
        account_id: accountId || null,
        category_id: categoryId,
        type: r.tx.type,
        amount: r.tx.amount,
        description: r.tx.description,
        date: r.tx.date,
        shared_with_user_id: null,
        workspace_id: scope,
      }]
    })
    const investPayload = rows.flatMap<ParsedInvestmentMovement>(r => {
      if (!r.selected || r.target !== 'investment' || !r.invest) return []
      return [{
        match: r.invest,
        date: r.tx.date,
        amount: r.tx.amount,
        description: r.tx.description,
        importKey: investmentImportKey(r.tx.date, r.invest.movementKind, r.tx.amount, r.tx.description),
      }]
    })
    try {
      await onImport(payload, investPayload, { accountId: accountId || null, workspaceId: scope })
      setState({ step: 'done', count: payload.length + investPayload.length })
      setTimeout(onClose, 1400)
    } catch {
      setState({ step: 'error', error: 'generic' })
    }
  }

  const goToCategorize = () => {
    // Seed each group with its history suggestion so the selects open pre-filled.
    const seeded: Record<string, string> = { ...groupCategories }
    for (const g of groupForCategorization(rows.map(r => r.tx), selectedIdx, suggestions)) {
      if (!seeded[g.key] && g.suggestedCategoryId) seeded[g.key] = g.suggestedCategoryId
    }
    setGroupCategories(seeded)
    setState({ step: 'categorize' })
  }

  const setAllSelected = (value: boolean) => setRows(rs => rs.map(r => ({ ...r, selected: value })))
  const toggleRow = (i: number) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, selected: !r.selected } : r)))

  // Changing the destination also arms the row: picking "Lançamento" for a
  // movement the classifier got wrong should not require a second click on the
  // checkbox, and picking "Ignorar" should not leave it armed.
  const setRowTarget = (i: number, target: RowTarget) => setRows(rs => rs.map((r, j) =>
    (j === i ? { ...r, target, selected: target !== 'skip' } : r)))

  const chipStyle = (bg: string, color: string): React.CSSProperties => ({
    fontSize: 10.5, fontWeight: 600, padding: '2px 6px', borderRadius: 5,
    background: bg, color, whiteSpace: 'nowrap',
  })

  const body = () => {
    switch (state.step) {
      case 'pick':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
              {t('finance_import_pick_desc')}
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.ofx,application/pdf"
              hidden
              onChange={e => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) { setPassword(''); runParse(file) }
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                border: '1.5px dashed var(--color-border)', borderRadius: 10, padding: '28px 16px',
                background: 'var(--color-surface)', color: 'var(--color-text-subtle)', cursor: 'pointer',
              }}
            >
              <Upload size={22} style={{ color: FIN_ACCENT }} />
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text)' }}>{t('finance_import_pick_file')}</span>
              <span style={{ fontSize: 12, textAlign: 'center', lineHeight: 1.45 }}>{t('finance_import_formats_hint')}</span>
            </button>
          </div>
        )

      case 'password':
        return (
          <form
            onSubmit={e => { e.preventDefault(); if (password) runParse(state.file, password) }}
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--color-text)' }}>
              <FileText size={16} style={{ color: FIN_ACCENT, flexShrink: 0 }} />
              <span>{t('finance_import_password_title')}</span>
            </div>
            <div>
              <label style={labelStyle}>{t('finance_import_password_label')}</label>
              <input
                type="password"
                autoFocus
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={inputStyle}
              />
            </div>
            {state.wrong && (
              <div style={{ background: FIN_NEG_SOFT, color: FIN_NEG, borderRadius: 8, padding: '8px 11px', fontSize: 12.5 }}>
                {t('finance_import_wrong_password')}
              </div>
            )}
            <button type="submit" disabled={!password} style={{ ...primaryBtnStyle, justifyContent: 'center', opacity: password ? 1 : 0.55 }}>
              {t('finance_import_password_submit')}
            </button>
          </form>
        )

      case 'parsing':
      case 'saving':
        return (
          <div style={{ padding: '32px 0', textAlign: 'center', fontSize: 13.5, color: 'var(--color-text-muted)' }}>
            {t(state.step === 'parsing' ? 'finance_import_parsing' : 'finance_import_saving')}
          </div>
        )

      case 'done':
        return (
          <div style={{ padding: '28px 0', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <CheckCircle2 size={30} style={{ color: FIN_POS }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
              {t('finance_import_success', { n: state.count })}
            </span>
          </div>
        )

      case 'error':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 9, background: FIN_NEG_SOFT, color: FIN_NEG, borderRadius: 8, padding: '11px 13px', fontSize: 12.5, lineHeight: 1.5 }}>
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{t(ERROR_KEYS[state.error])}</span>
            </div>
            <button onClick={() => setState({ step: 'pick' })} style={{ ...ghostBtnStyle, justifyContent: 'center' }}>
              {t('finance_import_back')}
            </button>
          </div>
        )

      case 'preview':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--color-text-muted)' }}>
              <span>
                {t('finance_import_found', {
                  n: rows.length,
                  period: statement?.periodStart && statement?.periodEnd
                    ? `${statement.periodStart.split('-').reverse().join('/')} – ${statement.periodEnd.split('-').reverse().join('/')}`
                    : (statement?.accountHint ?? ''),
                })}
              </span>
              <div style={{ flex: 1 }} />
              <button onClick={() => setAllSelected(true)} style={{ ...ghostBtnStyle, padding: '5px 9px', fontSize: 12 }}>{t('finance_import_select_all')}</button>
              <button onClick={() => setAllSelected(false)} style={{ ...ghostBtnStyle, padding: '5px 9px', fontSize: 12 }}>{t('finance_import_deselect_all')}</button>
            </div>

            <div style={{ border: '1px solid var(--color-border)', borderRadius: 9, maxHeight: isMobile ? '42vh' : 300, overflowY: 'auto' }}>
              {txRows.map(({ row, i }, pos) => (
                <label
                  key={`${row.tx.date}-${i}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9, padding: '7px 11px', cursor: 'pointer',
                    borderBottom: pos === txRows.length - 1 ? 'none' : '1px solid var(--color-border)',
                    opacity: row.selected ? 1 : 0.62,
                  }}
                >
                  <input type="checkbox" checked={row.selected} onChange={() => toggleRow(i)} style={{ flexShrink: 0, cursor: 'pointer' }} />
                  <span style={{ fontSize: 11.5, color: 'var(--color-text-subtle)', flexShrink: 0, ...tabularNums }}>
                    {row.tx.date.slice(8)}/{row.tx.date.slice(5, 7)}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.tx.description}
                  </span>
                  {row.tx.internal && row.tx.internalReason && (
                    <span style={chipStyle('var(--color-active)', 'var(--color-text-muted)')} title={t('finance_import_internal_badge')}>
                      {t(INTERNAL_KEYS[row.tx.internalReason])}
                    </span>
                  )}
                  {row.duplicate && (
                    <span style={chipStyle(FIN_NEG_SOFT, FIN_NEG)}>{t('finance_import_duplicate_badge')}</span>
                  )}
                  <span style={{ fontSize: 12.5, fontWeight: 600, flexShrink: 0, color: row.tx.type === 'income' ? FIN_POS : FIN_NEG, ...tabularNums }}>
                    {row.tx.type === 'income' ? '+' : '−'}{formatBRL(row.tx.amount)}
                  </span>
                </label>
              ))}
            </div>

            <div style={{ fontSize: 11.5, color: 'var(--color-text-subtle)', lineHeight: 1.45 }}>
              {t('finance_import_internal_hint')}
            </div>

            {investRows.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text)' }}>
                    {t('finance_import_invest_section')}
                  </span>
                  <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)', ...tabularNums }}>
                    {t('finance_import_invest_totals', { inflow: formatBRL(investIn), outflow: formatBRL(investOut) })}
                  </span>
                </div>
                <span style={{ fontSize: 11.5, color: 'var(--color-text-subtle)', lineHeight: 1.45 }}>
                  {t('finance_import_invest_hint')}
                </span>
                <div style={{ border: `1px solid ${FIN_ACCENT}`, borderRadius: 9, maxHeight: isMobile ? '34vh' : 220, overflowY: 'auto' }}>
                  {investRows.map(({ row, i }, pos) => (
                    <div
                      key={`inv-${row.tx.date}-${i}`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 9, padding: '7px 11px', flexWrap: 'wrap',
                        borderBottom: pos === investRows.length - 1 ? 'none' : '1px solid var(--color-border)',
                        opacity: row.selected ? 1 : 0.62,
                      }}
                    >
                      <input type="checkbox" checked={row.selected} onChange={() => toggleRow(i)} style={{ flexShrink: 0, cursor: 'pointer' }} />
                      <span style={{ fontSize: 11.5, color: 'var(--color-text-subtle)', flexShrink: 0, ...tabularNums }}>
                        {row.tx.date.slice(8)}/{row.tx.date.slice(5, 7)}
                      </span>
                      <span style={{ flex: 1, minWidth: 110, fontSize: 12.5, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.tx.description}
                      </span>
                      {row.invest && (
                        <span style={chipStyle('var(--color-active)', 'var(--color-text-muted)')}>
                          {[row.invest.institution, row.invest.product].filter(Boolean).join(' · ') || t('finance_import_internal_investment')}
                        </span>
                      )}
                      {row.invest && (
                        <span style={chipStyle('var(--color-active)', 'var(--color-text-muted)')}>
                          {t(MOVEMENT_KIND_KEYS[row.invest.movementKind])}
                        </span>
                      )}
                      <span style={{
                        fontSize: 12.5, fontWeight: 600, flexShrink: 0, ...tabularNums,
                        color: row.invest?.movementKind === 'contribution' ? FIN_NEG : FIN_POS,
                      }}>
                        {row.invest?.movementKind === 'contribution' ? '−' : '+'}{formatBRL(row.tx.amount)}
                      </span>
                      <select
                        value={row.target}
                        onChange={e => setRowTarget(i, e.target.value as RowTarget)}
                        style={{ ...inputStyle, cursor: 'pointer', width: isMobile ? '100%' : 150, padding: '5px 8px', fontSize: 12 }}
                      >
                        <option value="investment">{t('finance_import_target_investment')}</option>
                        <option value="transaction">{t('finance_import_target_transaction')}</option>
                        <option value="skip">{t('finance_import_target_skip')}</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(statement?.warnings.length ?? 0) > 0 && (
              <div style={{ border: `1px solid ${FIN_WARN}`, borderRadius: 9, overflow: 'hidden' }}>
                <button
                  onClick={() => setShowWarnings(v => !v)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 11px',
                    border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left',
                    fontSize: 12.5, fontWeight: 600, color: FIN_WARN,
                  }}
                >
                  <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{t('finance_import_warnings_title', { n: statement!.warnings.length })}</span>
                  {showWarnings ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                </button>
                {showWarnings && (
                  <div style={{ padding: '0 11px 10px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)', lineHeight: 1.45 }}>
                      {t('finance_import_warnings_hint')}
                    </span>
                    {statement!.warnings.map((w, i) => {
                      const { key, detail } = parseWarning(w)
                      return (
                        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span style={{ fontSize: 12, color: 'var(--color-text)' }}>{t(key)}</span>
                          {detail && (
                            <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--color-text-subtle)', wordBreak: 'break-all' }}>
                              {detail}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {workspace && (
              <ScopePicker
                value={scope}
                onChange={ws => { setScope(ws); setAccountId(''); setGroupCategories({}) }}
                workspaceId={workspace.id}
                workspaceName={workspace.name}
              />
            )}

            <div>
              <label style={labelStyle}>{t('finance_import_account_label')}</label>
              <select value={accountId} onChange={e => setAccountId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="">{t('finance_import_account_placeholder')}</option>
                {scopedAccounts.map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
              </select>
              {scopedAccounts.length === 0 && (
                <div style={{ marginTop: 6, fontSize: 12, color: FIN_NEG }}>{t('finance_import_no_accounts')}</div>
              )}
            </div>

            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text)', ...tabularNums }}>
                  {t('finance_import_selected_sum', { n: selectedCount, total: formatBRL(selectedTotal) })}
                </span>
                {investCount > 0 && (
                  <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)', ...tabularNums }}>
                    {t('finance_import_invest_selected', { n: investCount })}
                  </span>
                )}
              </div>
              <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>{t('finance_import_now_or_later_hint')}</span>
              <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
                <button
                  onClick={() => doImport(false)}
                  disabled={nothingToImport || !accountId}
                  style={{ ...ghostBtnStyle, flex: 1, justifyContent: 'center', opacity: nothingToImport || !accountId ? 0.55 : 1 }}
                >
                  {t('finance_import_without_categories')}
                </button>
                <button
                  onClick={goToCategorize}
                  disabled={selectedCount === 0 || !accountId}
                  style={{ ...primaryBtnStyle, flex: 1, justifyContent: 'center', opacity: selectedCount === 0 || !accountId ? 0.55 : 1 }}
                >
                  {t('finance_import_categorize_now')}
                </button>
              </div>
            </div>
          </div>
        )

      case 'categorize':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
              {t('finance_import_categorize_hint')}
            </span>
            <div style={{ border: '1px solid var(--color-border)', borderRadius: 9, maxHeight: isMobile ? '48vh' : 340, overflowY: 'auto' }}>
              {groups.map((g, i) => (
                <div
                  key={g.key}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', flexWrap: 'wrap',
                    borderBottom: i === groups.length - 1 ? 'none' : '1px solid var(--color-border)',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 150 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {g.label}
                    </div>
                    <div style={{ fontSize: 11.5, color: g.type === 'income' ? FIN_POS : 'var(--color-text-subtle)', ...tabularNums }}>
                      {t(g.txIndexes.length === 1 ? 'finance_import_group_txs' : 'finance_import_group_txs_plural', {
                        n: g.txIndexes.length, total: formatBRL(g.total),
                      })}
                    </div>
                  </div>
                  <select
                    value={groupCategories[g.key] ?? ''}
                    onChange={e => setGroupCategories(prev => ({ ...prev, [g.key]: e.target.value }))}
                    style={{ ...inputStyle, cursor: 'pointer', width: isMobile ? '100%' : 190 }}
                  >
                    <option value="">{t('finance_import_no_category')}</option>
                    {scopedCategories.filter(c => c.type === g.type).map(c => (
                      <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 9 }}>
              <button onClick={() => setState({ step: 'preview' })} style={{ ...ghostBtnStyle, justifyContent: 'center' }}>
                {t('finance_import_back')}
              </button>
              <button onClick={() => doImport(true)} style={{ ...primaryBtnStyle, flex: 1, justifyContent: 'center' }}>
                {t('finance_import_confirm', { n: selectedCount })}
              </button>
            </div>
          </div>
        )
    }
  }

  return (
    <Modal
      title={t(state.step === 'categorize' ? 'finance_import_categorize_title' : 'finance_import_title')}
      onClose={onClose}
      width={640}
    >
      {body()}
    </Modal>
  )
}
