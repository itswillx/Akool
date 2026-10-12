import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CARD_LABEL_MAX_LENGTH, CARD_LABELS_MAX } from './cardLabels.ts'
import { ATTACHMENTS_MAX, CHECKLIST_MAX_ITEMS, CHECKLIST_MAX_TEXT, DEPENDS_ON_MAX } from './cardLimits.ts'

// API-027: os limites que a API e o app seguem são os do gatilho
// project_cards_integrity (migration do API-013). Mudou lá, este teste avisa.

const MIGRATION = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations', '20261007130000_api013_project_cards_integrity.sql')
const sql = readFileSync(MIGRATION, 'utf8')

/** O corpo de `create function private.<name>` até o `$$;` que o fecha. */
function functionBody(name: string): string {
  const start = sql.indexOf(`create function private.${name}(`)
  expect(start, name).toBeGreaterThanOrEqual(0)
  return sql.slice(start, sql.indexOf('$$;', start))
}

/** O número em `<expr> > N` (ou `not between 1 and N`) que vem logo depois de `anchor`. */
function limitAfter(body: string, anchor: RegExp): number {
  const m = anchor.exec(body)
  expect(m, String(anchor)).not.toBeNull()
  return Number(m![1])
}

describe('limites do card × migration do API-013', () => {
  it('checklist: até 500 itens de até 2000 caracteres', () => {
    const body = functionBody('card_checklist_ok')
    expect(limitAfter(body, /jsonb_array_length\(p_items\) > (\d+)/)).toBe(CHECKLIST_MAX_ITEMS)
    expect(limitAfter(body, /length\(v_item ->> 'text'\) > (\d+)/)).toBe(CHECKLIST_MAX_TEXT)
  })

  it('rótulos: até 30, de 1 a 50 caracteres', () => {
    const body = functionBody('card_labels_ok')
    expect(limitAfter(body, /jsonb_array_length\(p_labels\) > (\d+)/)).toBe(CARD_LABELS_MAX)
    expect(limitAfter(body, /length\(v_label #>> '\{\}'\) not between 1 and (\d+)/)).toBe(CARD_LABEL_MAX_LENGTH)
  })

  it('anexos: até 50', () => {
    expect(limitAfter(functionBody('card_attachments_ok'), /jsonb_array_length\(p_items\) > (\d+)/)).toBe(ATTACHMENTS_MAX)
  })

  it('dependências: até 100 por card', () => {
    expect(limitAfter(sql, /cardinality\(new\.depends_on\) > (\d+)/)).toBe(DEPENDS_ON_MAX)
  })
})
