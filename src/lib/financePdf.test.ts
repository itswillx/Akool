import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FinanceAccount, FinanceBudget, FinanceCategory, FinanceGoal, FinanceGoalContribution, FinanceRecurring, FinanceTransaction } from '../types'
import { formatBRL } from './money'
import { MARGIN } from './pdf/layout'

// PERF-006: o relatório do financeiro em PDF. O jsPDF e o canvas são falsos e
// gravam o que foi escrito (texto, cor, página) e desenhado nos gráficos, para
// conferir os números do mês, a ordem das linhas e a quebra de página.

type Rgb = [number, number, number]
interface Written { text: string; x: number; y: number; page: number; color: Rgb }

const pdf = vi.hoisted(() => ({
  texts: [] as Written[],
  images: 0,
  pages: 1,
  saved: [] as string[],
  canvases: [] as string[][],
}))

vi.mock('jspdf', () => ({
  jsPDF: class {
    private color: Rgb = [0, 0, 0]
    setTextColor(r: number, g: number, b: number) { this.color = [r, g, b] }
    text(text: string, x: number, y: number) { pdf.texts.push({ text, x, y, page: pdf.pages, color: this.color }) }
    splitTextToSize(text: string) { return [text] }
    getTextWidth(text: string) { return text.length }
    addPage() { pdf.pages++ }
    addImage() { pdf.images++ }
    save(name: string) { pdf.saved.push(name) }
    setFont() {} setFontSize() {} setFillColor() {} setDrawColor() {} setLineWidth() {}
    line() {} rect() {} roundedRect() {}
  },
}))

// Canvas 2D falso: cada gráfico ganha um canvas; o fillText guarda os rótulos.
function fakeCanvas() {
  const texts: string[] = []
  pdf.canvases.push(texts)
  const noop = () => {}
  const ctx = {
    fillStyle: '', strokeStyle: '', font: '', textAlign: '', textBaseline: '', globalAlpha: 1, lineWidth: 1,
    scale: noop, fillRect: noop, beginPath: noop, moveTo: noop, lineTo: noop, arc: noop, closePath: noop,
    fill: noop, stroke: noop, roundRect: noop,
    fillText: (text: string) => { texts.push(text) },
  }
  return { width: 0, height: 0, getContext: () => ctx, toDataURL: () => 'data:image/png;base64,' }
}
vi.stubGlobal('document', { createElement: () => fakeCanvas() })

const { exportFinanceToPdf } = await import('./financePdf')

const tx = (id: string, date: string, type: 'income' | 'expense', amount: number, extra: Partial<FinanceTransaction> = {}): FinanceTransaction => ({
  id, user_id: 'u1', account_id: null, category_id: null, type, amount, description: `tx ${id}`, date, shared_with_user_id: null, created_at: '', ...extra,
})
const category = (id: string, name: string): FinanceCategory => ({ id, user_id: 'u1', name, color: '#123456', icon: '', type: 'expense', is_default: false, created_at: '' })

const empty = {
  transactions: [] as FinanceTransaction[],
  accounts: [] as FinanceAccount[],
  categories: [] as FinanceCategory[],
  budgets: [] as FinanceBudget[],
  goals: [] as FinanceGoal[],
  contributions: [] as FinanceGoalContribution[],
  recurring: [] as FinanceRecurring[],
  month: '2026-03',
  userName: 'Ana',
}

const texts = () => pdf.texts.map(w => w.text)
const written = (text: string) => pdf.texts.find(w => w.text === text)
/** Linhas escritas depois do título da seção (e antes da seção seguinte). */
function section(title: string): string[] {
  const all = texts()
  const start = all.indexOf(title)
  expect(start, `seção ${title}`).toBeGreaterThanOrEqual(0)
  const titles = ['Resumo Mensal', 'Visao Geral do Mes', 'Top Gastos por Categoria', 'Evolucao Mensal (6 meses)', 'Transacoes do Mes', 'Orcamentos', 'Contas', 'Metas', 'Recorrentes Ativas']
  const end = all.findIndex((t, i) => i > start && titles.includes(t))
  return all.slice(start + 1, end === -1 ? undefined : end)
}

beforeEach(() => {
  pdf.texts = []
  pdf.images = 0
  pdf.pages = 1
  pdf.saved = []
  pdf.canvases = []
})

describe('exportFinanceToPdf', () => {
  it('resume só o mês pedido e salva como financas-<mês>.pdf', () => {
    exportFinanceToPdf({
      ...empty,
      transactions: [
        tx('a', '2026-03-02', 'income', 500000),
        tx('b', '2026-03-10', 'expense', 120050),
        tx('c', '2026-02-27', 'expense', 999900), // mês anterior: fora do resumo
      ],
    })
    expect(pdf.saved).toEqual(['financas-2026-03.pdf'])
    expect(section('Resumo Mensal')).toEqual(['Receitas', formatBRL(500000), 'Despesas', formatBRL(120050), 'Saldo', formatBRL(379950)])
    expect(written(formatBRL(379950))!.color).toEqual([37, 99, 235])
  })

  it('saldo negativo sai em vermelho', () => {
    exportFinanceToPdf({ ...empty, transactions: [tx('a', '2026-03-02', 'income', 100), tx('b', '2026-03-03', 'expense', 300)] })
    expect(written(formatBRL(-200))!.color).toEqual([220, 38, 38])
  })

  it('lista as transações do mês por data, com dd/mm/aaaa, R/D e a categoria', () => {
    exportFinanceToPdf({
      ...empty,
      categories: [category('food', 'Mercado')],
      transactions: [
        tx('late', '2026-03-20', 'expense', 1500, { category_id: 'food', description: 'Feira' }),
        tx('early', '2026-03-01', 'income', 90000, { description: 'Salário' }),
      ],
    })
    const rows = section('Transacoes do Mes')
    expect(rows.slice(0, 5)).toEqual(['Data', 'Descricao', 'Categoria', 'T', 'Valor'])
    expect(rows.slice(5)).toEqual([
      '01/03/2026', 'Salário', '-', 'R', formatBRL(90000),
      '20/03/2026', 'Feira', 'Mercado', 'D', formatBRL(1500),
    ])
    expect(written('Feira')!.color).toEqual([220, 38, 38])
    expect(written('Salário')!.color).toEqual([22, 163, 74])
    // Valor alinhado à direita: termina na borda da coluna (x + w - 2). O
    // mesmo valor aparece antes no card de despesas; a linha é a última.
    const amount = pdf.texts.filter(w => w.text === formatBRL(1500)).at(-1)!
    expect(amount.x + formatBRL(1500).length).toBe(MARGIN + 150 + 30 - 2)
  })

  it('mês vazio: avisa na tabela e não desenha gráfico nem seções opcionais', () => {
    exportFinanceToPdf({ ...empty, transactions: [tx('old', '2025-09-15', 'expense', 100)] }) // 7 meses antes
    expect(texts()).toContain('Nenhuma transacao neste periodo.')
    expect(pdf.images).toBe(0)
    for (const title of ['Visao Geral do Mes', 'Top Gastos por Categoria', 'Evolucao Mensal (6 meses)', 'Orcamentos', 'Contas', 'Metas', 'Recorrentes Ativas']) {
      expect(texts()).not.toContain(title)
    }
  })

  it('gráficos: soma por categoria, ordena do maior gasto e chama de "Outros" o que não tem categoria', () => {
    exportFinanceToPdf({
      ...empty,
      categories: [category('food', 'Mercado'), category('fun', 'Lazer')],
      transactions: [
        tx('1', '2026-03-01', 'expense', 1000, { category_id: 'fun' }),
        tx('2', '2026-03-02', 'expense', 4000, { category_id: 'food' }),
        tx('3', '2026-03-03', 'expense', 2000, { category_id: 'food' }),
        tx('4', '2026-03-04', 'expense', 3000),
        tx('5', '2026-03-05', 'income', 7000), // receita não entra nas categorias
      ],
    })
    expect(pdf.images).toBe(3) // rosca, barras por categoria e evolução
    const [donut, bars] = pdf.canvases
    expect(donut).toEqual([
      'Despesas', 'por categ.',
      'Mercado', `60.0%  ${formatBRL(6000)}`,
      'Outros', `30.0%  ${formatBRL(3000)}`,
      'Lazer', `10.0%  ${formatBRL(1000)}`,
    ])
    expect(bars).toEqual(['Categoria', 'Total gasto', 'Mercado', formatBRL(6000), 'Outros', formatBRL(3000), 'Lazer', formatBRL(1000)])
  })

  it('o gráfico de barras mostra só as 8 categorias de maior gasto', () => {
    const categories = Array.from({ length: 10 }, (_, i) => category(`c${i}`, `Cat ${i}`))
    exportFinanceToPdf({
      ...empty,
      categories,
      transactions: categories.map((c, i) => tx(c.id, '2026-03-05', 'expense', (i + 1) * 100, { category_id: c.id })),
    })
    const bars = pdf.canvases[1]
    const labels = bars.filter(t => t.startsWith('Cat '))
    expect(labels).toEqual(['Cat 9', 'Cat 8', 'Cat 7', 'Cat 6', 'Cat 5', 'Cat 4', 'Cat 3', 'Cat 2'])
  })

  it('despesa de valor zero não quebra a rosca', () => {
    exportFinanceToPdf({ ...empty, transactions: [tx('z', '2026-03-05', 'expense', 0)] })
    expect(pdf.canvases[0]).toEqual([]) // rosca em branco, sem divisão por zero
    expect(pdf.canvases[1]).toContain('Outros')
  })

  it('evolução de 6 meses atravessa a virada do ano', () => {
    exportFinanceToPdf({
      ...empty,
      month: '2026-02',
      transactions: [tx('dez', '2025-12-10', 'income', 250000), tx('set', '2025-09-01', 'expense', 1000)],
    })
    // Só a evolução: o mês pedido (fevereiro) não tem despesa.
    expect(pdf.images).toBe(1)
    const chart = pdf.canvases[0]
    const months = [[2025, 8], [2025, 9], [2025, 10], [2025, 11], [2026, 0], [2026, 1]]
      .map(([y, m]) => new Date(y, m, 1).toLocaleDateString('pt-BR', { month: 'short' }))
    const monthLabels = chart.filter(t => months.includes(t))
    expect(monthLabels).toEqual(months)
    // Eixo em milhares a partir de 1000 (centavos), de 0 ao maior valor.
    expect(chart.slice(0, 5)).toEqual(['0', '62.5k', '125.0k', '187.5k', '250.0k'])
    expect(chart.slice(-2)).toEqual(['Receitas', 'Despesas'])
  })

  it('orçamentos só do mês: gasto da categoria e restante em vermelho quando estoura', () => {
    exportFinanceToPdf({
      ...empty,
      categories: [category('food', 'Mercado'), category('fun', 'Lazer')],
      budgets: [
        { id: 'b1', user_id: 'u1', category_id: 'food', month: '2026-03', amount_limit: 5000, shared_with_user_id: null, created_at: '' },
        { id: 'b2', user_id: 'u1', category_id: 'fun', month: '2026-03', amount_limit: 2000, shared_with_user_id: null, created_at: '' },
        { id: 'b3', user_id: 'u1', category_id: 'fun', month: '2026-04', amount_limit: 1, shared_with_user_id: null, created_at: '' },
      ],
      transactions: [
        tx('1', '2026-03-03', 'expense', 7000, { category_id: 'food' }),
        tx('2', '2026-03-04', 'expense', 500, { category_id: 'fun' }),
        tx('3', '2026-03-05', 'income', 9999, { category_id: 'fun' }), // receita não conta como gasto
      ],
    })
    expect(section('Orcamentos')).toEqual([
      'Categoria', 'Limite', 'Gasto', 'Restante',
      'Mercado', formatBRL(5000), formatBRL(7000), formatBRL(-2000),
      'Lazer', formatBRL(2000), formatBRL(500), formatBRL(1500),
    ])
    expect(written(formatBRL(-2000))!.color).toEqual([220, 38, 38])
    expect(written(formatBRL(1500))!.color).toEqual([0, 0, 0])
  })

  it('contas: saldo de todas as datas, tipo por extenso e ícone fora do Latin-1 removido', () => {
    const account = (id: string, name: string, type: string, initial: number, icon = ''): FinanceAccount =>
      ({ id, user_id: 'u1', name, type: type as FinanceAccount['type'], initial_balance: initial, color: '', icon, created_at: '' })
    exportFinanceToPdf({
      ...empty,
      accounts: [account('nu', 'Nubank', 'checking', 10000, '💳'), account('cc', 'Visa', 'credit', 0), account('x', 'Cofre', 'investment', 500)],
      transactions: [
        tx('1', '2025-01-01', 'income', 2500, { account_id: 'nu' }),
        tx('2', '2026-03-02', 'expense', 3000, { account_id: 'cc' }),
      ],
    })
    const rows = section('Contas')
    expect(rows).toEqual([
      'Conta', 'Tipo', 'Saldo',
      ' Nubank', 'Conta corrente', formatBRL(12500),
      'Visa', 'Cartao credito', formatBRL(-3000),
      'Cofre', 'investment', formatBRL(500),
    ])
    expect(rows.join('')).not.toContain('💳')
    expect(written(formatBRL(-3000))!.color).toEqual([220, 38, 38])
  })

  it('metas: % das contribuições e status por extenso; alvo zero dá 0%', () => {
    const goal = (id: string, name: string, target: number, status: FinanceGoal['status']): FinanceGoal =>
      ({ id, user_id: 'u1', name, icon: '', color: '', target_amount: target, deadline: '2026-12-31', account_id: null, status, created_at: '' })
    const contribution = (goal_id: string, amount: number): FinanceGoalContribution =>
      ({ id: `${goal_id}-${amount}`, goal_id, user_id: 'u1', amount, note: '', date: '2026-01-01', created_at: '' })
    exportFinanceToPdf({
      ...empty,
      goals: [goal('trip', 'Viagem', 10000, 'active'), goal('car', 'Carro', 0, 'completed'), goal('tv', 'TV', 3000, 'cancelled')],
      contributions: [contribution('trip', 2500), contribution('trip', 1000), contribution('tv', 1000)],
    })
    expect(section('Metas')).toEqual([
      'Meta', 'Alvo', 'Acumulado', '%', 'Status',
      'Viagem', formatBRL(10000), formatBRL(3500), '35%', 'Ativa',
      'Carro', formatBRL(0), formatBRL(0), '0%', 'Concluida',
      'TV', formatBRL(3000), formatBRL(1000), '33%', 'Cancelada',
    ])
  })

  it('recorrentes: só as ativas, com valor variável ou sem valor', () => {
    const rec = (id: string, extra: Partial<FinanceRecurring>): FinanceRecurring => ({
      id, user_id: 'u1', type: 'expense', description: id, amount: 1000, is_variable: false, category_id: null,
      account_id: null, day_of_month: 5, active: true, total_installments: null, created_at: '', ...extra,
    })
    exportFinanceToPdf({
      ...empty,
      recurring: [
        rec('Aluguel', { amount: 150000, day_of_month: 10 }),
        rec('Salário', { type: 'income', amount: 500000, day_of_month: 1 }),
        rec('Luz', { is_variable: true }),
        rec('Doação', { amount: null }),
        rec('Academia', { active: false }),
      ],
    })
    expect(section('Recorrentes Ativas')).toEqual([
      'Descricao', 'Tipo', 'Valor', 'Dia',
      'Aluguel', 'Despesa', formatBRL(150000), 'Dia 10',
      'Salário', 'Receita', formatBRL(500000), 'Dia 1',
      'Luz', 'Despesa', 'Variavel', 'Dia 5',
      'Doação', 'Despesa', '-', 'Dia 5',
    ])
  })

  it('cabeçalho com o mês por extenso e o nome sem caracteres fora do Latin-1', () => {
    exportFinanceToPdf({ ...empty, userName: 'Ana 🚀 Souza', lang: 'en' })
    const header = texts().find(t => t.includes('Por:'))!
    expect(header.startsWith('March 2026  |  Gerado em ')).toBe(true)
    expect(header.endsWith('Por: Ana  Souza')).toBe(true)
  })

  it('muitas transações quebram a página e continuam do topo', () => {
    const many = Array.from({ length: 80 }, (_, i) => tx(`t${i}`, `2026-03-${String((i % 28) + 1).padStart(2, '0')}`, 'income', 100 + i, { description: `linha ${i}` }))
    exportFinanceToPdf({ ...empty, transactions: many })
    expect(pdf.pages).toBeGreaterThan(1)
    const rows = pdf.texts.filter(w => w.text.startsWith('linha '))
    expect(rows).toHaveLength(80)
    const firstOnPage2 = rows.find(w => w.page === 2)!
    expect(firstOnPage2.y).toBe(MARGIN)
    expect(rows.every(w => w.y <= 297 - MARGIN)).toBe(true)
  })
})
