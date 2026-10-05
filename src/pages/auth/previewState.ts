import {
  PREVIEW_CARDS,
  PREVIEW_MONTHS,
  PREVIEW_POINTS_DONE,
  PREVIEW_TASKS_DONE,
  PREVIEW_WIP,
} from '../../i18n/appPreviewContent'
import type { PreviewCardId, PreviewCardSpec } from '../../i18n/appPreviewContent'
import { localeOf } from '../../i18n/translations'
import type { Lang } from '../../i18n/translations'

// Estado da demonstração da prévia do app (AppPreview): em que coluna está cada
// card, a visão do quadro, as tarefas e os pontos marcados e o mês do gráfico.
// Puro, para testar sem montar nada. Indexado por ids comuns aos dois idiomas.

export type AppPreviewVariant = 'overview' | 'pages' | 'projects' | 'finance' | 'study'
export type PreviewNav = 'dashboard' | 'documents' | 'projects' | 'finance'
export type PreviewView = 'kanban' | 'timeline' | 'list'

export const PREVIEW_NAV: readonly PreviewNav[] = ['dashboard', 'documents', 'projects', 'finance']
export const PREVIEW_VIEWS: readonly PreviewView[] = ['kanban', 'timeline', 'list']
export const PREVIEW_COLUMNS = 3

export interface PreviewState {
  columns: Record<PreviewCardId, number>
  view: PreviewView
  tasks: readonly boolean[]
  points: readonly boolean[]
  month: number
}

export type PreviewAction =
  | { type: 'move'; id: PreviewCardId }
  | { type: 'view'; view: PreviewView }
  | { type: 'task'; index: number }
  | { type: 'point'; index: number }
  | { type: 'month'; index: number }

export const INITIAL_PREVIEW: PreviewState = {
  columns: Object.fromEntries(PREVIEW_CARDS.map(card => [card.id, card.column])) as Record<PreviewCardId, number>,
  view: 'kanban',
  tasks: PREVIEW_TASKS_DONE,
  points: PREVIEW_POINTS_DONE,
  month: PREVIEW_MONTHS.length - 1,
}

const flip = (list: readonly boolean[], index: number) => list.map((done, i) => (i === index ? !done : done))

/** O card vai para a próxima coluna; da última volta à primeira. */
export const nextColumn = (column: number) => (column + 1) % PREVIEW_COLUMNS

export function reducePreview(state: PreviewState, action: PreviewAction): PreviewState {
  switch (action.type) {
    case 'move': return { ...state, columns: { ...state.columns, [action.id]: nextColumn(state.columns[action.id]) } }
    case 'view': return { ...state, view: action.view }
    case 'task': return { ...state, tasks: flip(state.tasks, action.index) }
    case 'point': return { ...state, points: flip(state.points, action.index) }
    case 'month': return { ...state, month: action.index }
  }
}

/** Qual item da barra lateral acende em cada módulo (Estudos fica em Documentos, como no app). */
export function navOf(variant: AppPreviewVariant): PreviewNav {
  if (variant === 'overview') return 'dashboard'
  if (variant === 'pages' || variant === 'study') return 'documents'
  return variant
}

export function variantOf(nav: PreviewNav): AppPreviewVariant {
  if (nav === 'dashboard') return 'overview'
  if (nav === 'documents') return 'pages'
  return nav
}

export function cardsIn(state: PreviewState, column: number): PreviewCardSpec[] {
  return PREVIEW_CARDS.filter(card => state.columns[card.id] === column)
}

/** Cards na coluna e o limite; `over` só acima do limite (como no app: 3/3 é normal, 4/3 avisa). */
export function wipOf(state: PreviewState, column: number): { count: number; limit: number | null; over: boolean } {
  const count = cardsIn(state, column).length
  const limit = PREVIEW_WIP[column] ?? null
  return { count, limit, over: limit !== null && count > limit }
}

export function monthKpis(index: number): { income: number; expense: number; balance: number } {
  const [income, expense] = PREVIEW_MONTHS[index]
  return { income, expense, balance: income - expense }
}

const MAX_VALUE = Math.max(...PREVIEW_MONTHS.flat())

/** Altura da barra (% do gráfico), com folga em cima. */
export const barHeight = (value: number) => Math.round((value / MAX_VALUE) * 90)

const moneyFormat = (lang: Lang) => new Intl.NumberFormat(localeOf(lang), { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 })
const MONEY: Record<Lang, Intl.NumberFormat> = { 'pt-BR': moneyFormat('pt-BR'), en: moneyFormat('en') }

export const previewMoney = (lang: Lang, value: number) => MONEY[lang].format(value)
