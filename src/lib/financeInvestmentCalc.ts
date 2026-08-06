// Pure calculations for the Investimentos submodule. Money is in integer cents
// everywhere, so sums never accumulate float drift.
//
// The central design decision, borrowed from the Loja submodule: a position's
// applied amount is DERIVED, never stored. It is `opening_balance` plus the
// signed sum of its movements, so deleting or re-importing a movement restores
// the number by itself — there is no cached total to drift.
//
// Two independent sign tables live here, and keeping them apart is the whole
// point of the module:
//   • how a movement changes the POSITION (what is invested)
//   • how it changes the CHECKING ACCOUNT (what is in the bank)
// A contribution moves both, in opposite directions. A yield credited to the
// account moves only the account. A yield capitalized inside the product moves
// only the position. Collapsing the two tables into one is what made the app
// report a checking balance that did not match the bank.
//
// Dates are 'YYYY-MM-DD' strings compared and sliced as text, never parsed with
// `new Date(string)` (UTC shift in UTC-3).

import type { FinanceInvestment, FinanceInvestmentMovement } from '../types'

type MovementLike = Pick<
  FinanceInvestmentMovement,
  'investment_id' | 'kind' | 'amount' | 'settles_in_account'
>

/** Movement fields needed to reconcile a checking account balance. */
export type AccountMovementLike = Pick<
  FinanceInvestmentMovement,
  'account_id' | 'kind' | 'amount' | 'settles_in_account'
>

type DatedMovementLike = MovementLike & Pick<FinanceInvestmentMovement, 'date'>

// ─── Sign tables ──────────────────────────────────────────────────────────────

/** How much this movement adds to the invested position, in cents (may be < 0). */
export function positionDelta(mov: MovementLike): number {
  switch (mov.kind) {
    case 'contribution':
      return mov.amount
    case 'redemption':
      return -mov.amount
    // Credited to the account, the yield left the product; capitalized, it grew
    // the position. Same for taxes and fees, mirrored.
    case 'yield':
      return mov.settles_in_account ? 0 : mov.amount
    case 'tax':
    case 'fee':
      return mov.settles_in_account ? 0 : -mov.amount
  }
}

/** How much this movement adds to the checking account balance, in cents. */
export function accountDelta(mov: AccountMovementLike): number {
  if (!mov.settles_in_account) return 0
  switch (mov.kind) {
    case 'contribution':
      return -mov.amount
    case 'redemption':
    case 'yield':
      return mov.amount
    case 'tax':
    case 'fee':
      return -mov.amount
  }
}

/** Net effect of every movement of one account. Movements of other accounts,
 *  and movements with no account, contribute nothing. */
export function accountInvestmentFlow(
  accountId: string,
  movements: AccountMovementLike[],
): number {
  let total = 0
  for (const mov of movements) {
    if (mov.account_id !== accountId) continue
    total += accountDelta(mov)
  }
  return total
}

// ─── Positions ────────────────────────────────────────────────────────────────

/** Applied amount of one position: opening balance plus its signed movements.
 *  This is cost/principal, not market value — a checking-account statement
 *  cannot see the product capitalizing internally. */
export function positionApplied(
  investment: Pick<FinanceInvestment, 'id' | 'opening_balance'>,
  movements: MovementLike[],
): number {
  let total = investment.opening_balance
  for (const mov of movements) {
    if (mov.investment_id !== investment.id) continue
    total += positionDelta(mov)
  }
  return total
}

/** Applied amount across every non-archived position. The number the overview
 *  adds to net worth. */
export function totalApplied(
  investments: Pick<FinanceInvestment, 'id' | 'opening_balance' | 'archived'>[],
  movements: MovementLike[],
): number {
  let total = 0
  for (const inv of investments) {
    if (inv.archived) continue
    total += positionApplied(inv, movements)
  }
  return total
}

export interface PositionBreakdown {
  applied: number
  /** Everything ever put in, opening balance included. */
  contributed: number
  redeemed: number
  /** Yields credited to the account plus yields capitalized in the product. */
  earned: number
  /** Taxes and fees, whichever side they settled on. */
  costs: number
  movementCount: number
}

// Per-position detail for the expandable list. `applied` matches
// positionApplied by construction: contributed − redeemed + earned − costs.
export function positionBreakdown(
  investment: Pick<FinanceInvestment, 'id' | 'opening_balance'>,
  movements: MovementLike[],
): PositionBreakdown {
  const out: PositionBreakdown = {
    applied: investment.opening_balance,
    contributed: investment.opening_balance,
    redeemed: 0,
    earned: 0,
    costs: 0,
    movementCount: 0,
  }
  for (const mov of movements) {
    if (mov.investment_id !== investment.id) continue
    out.movementCount += 1
    out.applied += positionDelta(mov)
    if (mov.kind === 'contribution') out.contributed += mov.amount
    else if (mov.kind === 'redemption') out.redeemed += mov.amount
    else if (mov.kind === 'yield') out.earned += mov.amount
    else out.costs += mov.amount
  }
  return out
}

// ─── Period aggregates ────────────────────────────────────────────────────────

export interface InvestmentTotals {
  contributed: number
  redeemed: number
  earned: number
  costs: number
  /** contributed − redeemed: how much the position grew from cash flow alone. */
  net: number
}

/** Consolidated movements of one 'YYYY-MM'. */
export function investmentTotals(
  ym: string,
  movements: (MovementLike & Pick<FinanceInvestmentMovement, 'date'>)[],
): InvestmentTotals {
  const out: InvestmentTotals = { contributed: 0, redeemed: 0, earned: 0, costs: 0, net: 0 }
  for (const mov of movements) {
    if (mov.date.slice(0, 7) !== ym) continue
    if (mov.kind === 'contribution') out.contributed += mov.amount
    else if (mov.kind === 'redemption') out.redeemed += mov.amount
    else if (mov.kind === 'yield') out.earned += mov.amount
    else out.costs += mov.amount
  }
  out.net = out.contributed - out.redeemed
  return out
}

export interface InvestmentSeries {
  /** Applied amount at the END of each month, cumulative. */
  applied: number[]
  /** Contributed cost at the end of each month, cumulative. The gap between
   *  the two series IS the accumulated yield. */
  contributed: number[]
}

// Cumulative series aligned to `months` ('YYYY-MM'), for the 12-month trend.
// Movements before the first month fold into the opening value so the line
// starts at the real balance instead of zero.
export function investmentMonthlySeries(
  months: string[],
  movements: DatedMovementLike[],
  openingTotal = 0,
): InvestmentSeries {
  const applied: number[] = []
  const contributed: number[] = []
  if (months.length === 0) return { applied, contributed }

  const first = months[0]
  let runningApplied = openingTotal
  let runningContributed = openingTotal
  for (const mov of movements) {
    if (mov.date.slice(0, 7) >= first) continue
    runningApplied += positionDelta(mov)
    if (mov.kind === 'contribution') runningContributed += mov.amount
    else if (mov.kind === 'redemption') runningContributed -= mov.amount
  }

  for (const ym of months) {
    for (const mov of movements) {
      if (mov.date.slice(0, 7) !== ym) continue
      runningApplied += positionDelta(mov)
      if (mov.kind === 'contribution') runningContributed += mov.amount
      else if (mov.kind === 'redemption') runningContributed -= mov.amount
    }
    applied.push(runningApplied)
    contributed.push(runningContributed)
  }
  return { applied, contributed }
}

// ─── Distribution ─────────────────────────────────────────────────────────────

export interface AppliedSlice {
  key: string
  label: string
  value: number
}

// Applied amount grouped by institution or asset class, for the donut. Empty
// and negative slices are dropped: a chart cannot draw them, and a position
// redeemed past its opening balance is a data problem, not a slice.
export function appliedByGroup(
  investments: Pick<FinanceInvestment, 'id' | 'opening_balance' | 'archived' | 'institution' | 'asset_class'>[],
  movements: MovementLike[],
  by: 'institution' | 'asset_class',
): AppliedSlice[] {
  const groups = new Map<string, AppliedSlice>()
  for (const inv of investments) {
    if (inv.archived) continue
    const applied = positionApplied(inv, movements)
    if (applied <= 0) continue
    const key = by === 'institution' ? (inv.institution || 'OUTROS') : inv.asset_class
    const slice = groups.get(key)
    if (slice) slice.value += applied
    else groups.set(key, { key, label: key, value: applied })
  }
  return [...groups.values()].sort((a, b) => b.value - a.value)
}
