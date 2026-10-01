import type { WriteError } from './optimistic'

// REL-003: o PostgREST devolve no máximo `max_rows` linhas por pedido (1000,
// em supabase/config.toml e no projeto) e corta o resto SEM erro. Leitura de
// coleção que pode crescer passa por aqui: pede páginas com .range() até vir
// uma incompleta.
//
// A ordem da consulta precisa ser total, terminando numa coluna única (em
// geral `.order('id')`): com empate, uma linha pode trocar de página entre um
// pedido e outro e aparecer duas vezes ou nenhuma.

/** Não pode passar do `max_rows` do PostgREST (o teste de repo-hygiene confere). */
export const FETCH_PAGE_SIZE = 1000

export type ReadError = WriteError

export type AllRowsResult<T> = { data: T[]; error: null } | { data: null; error: ReadError }

/**
 * `page(from, to)` monta a consulta de uma página, já com `.range(from, to)`.
 * O primeiro erro interrompe e volta como erro: nunca vira lista parcial nem
 * vazia.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: ReadError | null }>,
  pageSize = FETCH_PAGE_SIZE,
): Promise<AllRowsResult<T>> {
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1)
    if (error) return { data: null, error }
    const chunk = data ?? []
    for (const row of chunk) rows.push(row)
    if (chunk.length < pageSize) return { data: rows, error: null }
  }
}

/** Converte as linhas de um resultado (o erro passa igual). */
export function mapAllRows<T, U>(result: AllRowsResult<T>, map: (row: T) => U): AllRowsResult<U> {
  return result.error ? result : { data: result.data.map(map), error: null }
}
