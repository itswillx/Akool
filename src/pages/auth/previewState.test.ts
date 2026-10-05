import { describe, expect, it } from 'vitest'
import { PREVIEW_MONTHS } from '../../i18n/appPreviewContent'
import {
  INITIAL_PREVIEW,
  barHeight,
  cardsIn,
  monthKpis,
  navOf,
  previewMoney,
  reducePreview,
  variantOf,
  wipOf,
} from './previewState'

describe('previewState', () => {
  it('começa com 2 / 2 / 1 cards, no kanban e no último mês', () => {
    expect([0, 1, 2].map(column => cardsIn(INITIAL_PREVIEW, column).length)).toEqual([2, 2, 1])
    expect(INITIAL_PREVIEW.view).toBe('kanban')
    expect(INITIAL_PREVIEW.month).toBe(PREVIEW_MONTHS.length - 1)
  })

  it('mover leva à próxima coluna, da última à primeira, sem mexer no estado anterior', () => {
    const moved = reducePreview(INITIAL_PREVIEW, { type: 'move', id: 'backups' })
    expect(moved.columns.backups).toBe(0)
    expect(INITIAL_PREVIEW.columns.backups).toBe(2)
    expect(reducePreview(INITIAL_PREVIEW, { type: 'move', id: 'copy' }).columns.copy).toBe(1)
  })

  it('WIP: 3/3 é normal, 4/3 avisa; coluna sem limite nunca avisa', () => {
    expect(wipOf(INITIAL_PREVIEW, 1)).toEqual({ count: 2, limit: 3, over: false })
    const full = reducePreview(INITIAL_PREVIEW, { type: 'move', id: 'copy' })
    expect(wipOf(full, 1)).toEqual({ count: 3, limit: 3, over: false })
    const over = reducePreview(full, { type: 'move', id: 'mobile' })
    expect(wipOf(over, 1)).toEqual({ count: 4, limit: 3, over: true })
    expect(wipOf(over, 0)).toEqual({ count: 0, limit: null, over: false })
  })

  it('visão, tarefas, pontos e mês', () => {
    expect(reducePreview(INITIAL_PREVIEW, { type: 'view', view: 'list' }).view).toBe('list')
    expect(reducePreview(INITIAL_PREVIEW, { type: 'task', index: 2 }).tasks).toEqual([true, true, true])
    expect(reducePreview(INITIAL_PREVIEW, { type: 'point', index: 0 }).points).toEqual([false, true, false])
    expect(reducePreview(INITIAL_PREVIEW, { type: 'month', index: 1 }).month).toBe(1)
  })

  it.each([
    ['overview', 'dashboard'],
    ['pages', 'documents'],
    ['study', 'documents'],
    ['projects', 'projects'],
    ['finance', 'finance'],
  ] as const)('%s acende %s na barra lateral', (variant, nav) => {
    expect(navOf(variant)).toBe(nav)
  })

  it.each([
    ['dashboard', 'overview'],
    ['documents', 'pages'],
    ['projects', 'projects'],
    ['finance', 'finance'],
  ] as const)('%s abre %s', (nav, variant) => {
    expect(variantOf(nav)).toBe(variant)
  })

  it('totais do mês, inclusive saldo negativo, e a altura das barras', () => {
    expect(monthKpis(5)).toEqual({ income: 9850, expense: 6120, balance: 3730 })
    expect(monthKpis(2).balance).toBeLessThan(0)
    expect(barHeight(9850)).toBe(90)
    expect(barHeight(0)).toBe(0)
  })

  it('valores em reais no formato de cada idioma', () => {
    expect(previewMoney('pt-BR', 3730)).toMatch(/^R\$\s3\.730$/)
    expect(previewMoney('en', 3730)).toMatch(/^R\$\s?3,730$/)
  })
})
