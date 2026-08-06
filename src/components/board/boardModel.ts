// Modelo puro do board genérico. Sem React e sem nenhum tipo de domínio: o
// board só enxerga `{ id, columnId, amount?, searchText? }` extraídos pelos
// getters que o chamador passa.
//
// Está separado do componente para poder ser testado — a suíte roda no ambiente
// `node` (vite.config.ts), onde não há DOM.

/** Uma coluna do board. `limit` em centavos vira barra de teto no cabeçalho. */
export interface BoardColumnDef {
  id: string
  label: string
  color?: string
  /** Teto (centavos ou contagem). Null/undefined = sem teto. */
  limit?: number | null
  /** false = coluna derivada/terminal que não aceita drop. Default: true. */
  droppable?: boolean
}

/** Números do cabeçalho de uma coluna. */
export interface ColumnAggregate {
  count: number
  total: number
  /** total / limit, ou null quando a coluna não tem teto. */
  pct: number | null
  over: boolean
}

/** Prefixo do id do droppable de coluna — mesma convenção do ProjectsPanel. */
export const COLUMN_DROPPABLE_PREFIX = 'col:'

export function columnDroppableId(columnId: string): string {
  return `${COLUMN_DROPPABLE_PREFIX}${columnId}`
}

/**
 * Coluna de destino de um drop. O `over.id` do dnd-kit pode ser tanto o
 * droppable da coluna quanto um card dentro dela — nos dois casos o destino é a
 * mesma coluna. Adaptado de `resolveColumnId` (ProjectsPanel.tsx:556).
 *
 * Devolve null quando o id não é reconhecido, e o chamador ignora o drop.
 */
export function resolveDropColumnId<T>(
  overId: string,
  items: T[],
  getId: (item: T) => string,
  getColumnId: (item: T) => string,
): string | null {
  if (overId.startsWith(COLUMN_DROPPABLE_PREFIX)) {
    return overId.slice(COLUMN_DROPPABLE_PREFIX.length)
  }
  const hit = items.find(i => getId(i) === overId)
  return hit ? getColumnId(hit) : null
}

/**
 * Agrupa os itens por coluna. Colunas sem item aparecem como array vazio (o
 * board precisa renderizar a coluna vazia para poder receber um drop nela), e
 * itens cuja coluna não existe na definição são DESCARTADOS — quem quiser
 * mostrá-los declara uma coluna para eles (é o que a obra faz com "Sem etapa").
 */
export function groupByColumn<T>(
  columns: BoardColumnDef[],
  items: T[],
  getColumnId: (item: T) => string,
): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const col of columns) out.set(col.id, [])
  for (const item of items) {
    const bucket = out.get(getColumnId(item))
    if (bucket) bucket.push(item)
  }
  return out
}

/** Contagem, soma e situação do teto de uma coluna. */
export function aggregate<T>(
  items: T[],
  limit: number | null | undefined,
  getAmount?: (item: T) => number,
): ColumnAggregate {
  const total = getAmount ? items.reduce((sum, i) => sum + getAmount(i), 0) : 0
  const hasLimit = typeof limit === 'number' && limit > 0
  return {
    count: items.length,
    total,
    pct: hasLimit ? total / limit : null,
    over: hasLimit && total > limit,
  }
}

/** Faixa de marcas de acento combinantes que o NFD separa das letras. */
const COMBINING_MARKS = /[̀-ͯ]/g

/** Normaliza para busca insensível a caixa e a acento ("café" casa "cafe"). */
export function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase().trim()
}

/**
 * Filtro de busca. Cada palavra digitada precisa aparecer no texto do item
 * (AND, não frase exata) — "rtx joao" acha a venda da RTX para o João mesmo com
 * o nome antes do produto no texto.
 */
export function filterBySearch<T>(
  items: T[],
  query: string,
  getSearchText?: (item: T) => string,
): T[] {
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0 || !getSearchText) return items
  return items.filter(item => {
    const haystack = normalizeSearch(getSearchText(item))
    return terms.every(term => haystack.includes(term))
  })
}

/** Colunas que o usuário não escondeu, na ordem declarada. */
export function visibleColumns(columns: BoardColumnDef[], hidden: ReadonlySet<string>): BoardColumnDef[] {
  return columns.filter(c => !hidden.has(c.id))
}

/**
 * Coluna vizinha para os botões ‹ ›. Navega sobre as colunas VISÍVEIS e
 * droppables: pular para uma coluna escondida moveria o card para fora da
 * vista, e o usuário não teria como desfazer sem revelar a coluna.
 *
 * Devolve null nas pontas.
 */
export function neighborColumnId(
  columns: BoardColumnDef[],
  hidden: ReadonlySet<string>,
  fromColumnId: string,
  direction: -1 | 1,
): string | null {
  const usable = visibleColumns(columns, hidden).filter(c => c.droppable !== false)
  const index = usable.findIndex(c => c.id === fromColumnId)
  if (index === -1) return null
  const target = usable[index + direction]
  return target ? target.id : null
}

// O movimento otimista pendente NÃO vive aqui: o board não sabe escrever num
// `T` opaco, então ele projeta o pending interceptando o próprio `getColumnId`
// (ver `columnIdOf` em KanbanBoard.tsx). Nada é mutado, e o card volta sozinho
// quando `onMove` recusa.
