// API-020: a grade de ocupação das tabelas do BlockNote 0.50
// (api/blockManipulation/tables/tables.ts), emulada sem alocar além dos tetos
// de TABLE_LIMITS. O validador (schema.ts) a usa na entrada parcial; o
// normalize, de novo na forma completa (a largura muda quando toda célula
// conta o colspan).

import { TABLE_LIMITS } from './spec.ts'

type Segments = (string | number)[]

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Passos da emulação da grade de ocupação (uma tabela adversária não trava a edge). */
const GRID_BUDGET = 2_000_000

/** Como o BlockNote mede a largura (getColspan): só a célula completa (props e content) conta o colspan. */
export function widthSpan(cell: unknown, fullCells: boolean): number {
  if (!isPlainObject(cell) || cell.type !== 'tableCell') return 1
  if (!fullCells && (cell.props === undefined || cell.content === undefined)) return 1
  const props = isPlainObject(cell.props) ? cell.props : {}
  return typeof props.colspan === 'number' ? props.colspan : 1
}

/** Como o BlockNote ocupa a grade (mapTableCell): qualquer tableCell com props conta. */
function spans(cell: unknown): { colspan: number; rowspan: number } {
  if (!isPlainObject(cell) || cell.type !== 'tableCell' || !isPlainObject(cell.props)) return { colspan: 1, rowspan: 1 }
  const { colspan, rowspan } = cell.props
  return { colspan: typeof colspan === 'number' ? colspan : 1, rowspan: typeof rowspan === 'number' ? rowspan : 1 }
}

/** Largura da grade: a maior soma de colspans de uma linha (como o BlockNote mede). */
export function tableWidth(rows: readonly { cells: readonly unknown[] }[], fullCells: boolean): number {
  let width = 0
  for (const row of rows) width = Math.max(width, row.cells.reduce<number>((sum, cell) => sum + widthSpan(cell, fullCells), 0))
  return width
}

export interface GridProblem {
  keyword: 'maxColumns' | 'maxCells' | 'table'
  message: string
  /** Ponteiro relativo à tabela (`/rows/1/cells/0`), ou '' para a tabela toda. */
  at: Segments
}

/**
 * Emula a grade de ocupação do BlockNote (getTableCellOccupancyGrid, chamada
 * pelo tableContentToNodes): largura = maior soma de colspans de uma linha,
 * altura = número de linhas, e cada célula vai para a próxima posição livre a
 * partir de (linha, índice da célula). Pede linhas e células já conferidas.
 * `fullCells`: a largura de toda célula conta o colspan (a forma do normalize).
 */
export function tableGridProblem(rows: readonly { cells: readonly unknown[] }[], fullCells = false): GridProblem | null {
  const height = rows.length
  const width = tableWidth(rows, fullCells)
  if (width > TABLE_LIMITS.maxColumns) return { keyword: 'maxColumns', message: `A tabela passa de ${TABLE_LIMITS.maxColumns} colunas`, at: [] }
  if (height * width > TABLE_LIMITS.maxCells) return { keyword: 'maxCells', message: `A tabela passa de ${TABLE_LIMITS.maxCells} células`, at: [] }

  const taken = new Uint8Array(height * width)
  let budget = GRID_BUDGET
  for (let r = 0; r < height; r++) {
    const cells = rows[r].cells
    for (let c = 0; c < cells.length; c++) {
      const at: Segments = ['rows', r, 'cells', c]
      let start: { row: number; col: number } | null = null
      // findNextAvailable: em cada linha, recomeça do índice da célula (não do zero).
      for (let i = r; i < height && !start; i++) {
        for (let j = c; j < width; j++) {
          if (--budget < 0) return { keyword: 'table', message: 'Tabela complexa demais', at: [] }
          if (!taken[i * width + j]) {
            start = { row: i, col: j }
            break
          }
        }
      }
      if (!start) return { keyword: 'table', message: 'A célula não cabe na grade da tabela', at }
      const { colspan, rowspan } = spans(cells[c])
      for (let i = start.row; i < start.row + rowspan; i++) {
        if (i >= height) return { keyword: 'table', message: 'rowspan passa da última linha', at }
        for (let j = start.col; j < start.col + colspan; j++) {
          // Além da largura o BlockNote não lança, mas a tabela sai torta: fica de fora.
          if (j >= width) return { keyword: 'table', message: 'colspan passa da largura da tabela', at }
          if (taken[i * width + j]) return { keyword: 'table', message: 'Célula sobreposta a outra (colspan/rowspan)', at }
          taken[i * width + j] = 1
        }
      }
    }
  }
  return null
}
