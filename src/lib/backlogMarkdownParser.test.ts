import { describe, expect, it } from 'vitest'
import { parseBacklogMarkdown } from './backlogMarkdownParser'

const SEC001_BLOCK = `## Tópico: Segurança

### CARD SEC-001 — Versionar schema completo e políticas RLS

| Campo | Valor |
| --- | --- |
| **ID** | SEC-001 |
| **Prioridade** | P0 |
| **Esforço** | L |
| **Labels** | segurança, supabase, migrations |
| **Arquivos** | \`supabase/migrations/\` |

**Problema:** Apenas uma migration existe no repo. RLS não é revisável no Git.

**Subtarefas Kanban:**

- [ ] Rodar supabase db pull
- [ ] Exportar policies RLS para migrations
- [ ] Adicionar migration check no CI
`

const NOTION_LIST_BLOCK = `## Tópico: Performance

### CARD PERF-001 — Paginar transações financeiras

- **ID:** PERF-001
- **Prioridade:** P1
- **Esforço:** M
- **Labels:** performance, finance
- **Arquivos:** \`src/modules/finance/FinancePanel.tsx\`

**Problema:** Select sem limite carrega todas as transações.

**Subtarefas Kanban:**

- [ ] Filtrar por mês na UI
- [ ] Adicionar paginação com range
- [ ] Benchmark com 10k transações
`

describe('parseBacklogMarkdown', () => {
  it('parses a full table-format card (SEC-001)', () => {
    const result = parseBacklogMarkdown(SEC001_BLOCK)
    expect(result.cards).toHaveLength(1)

    const card = result.cards[0]
    expect(card.externalId).toBe('SEC-001')
    expect(card.title).toBe('Versionar schema completo e políticas RLS')
    expect(card.fullTitle).toBe('SEC-001 — Versionar schema completo e políticas RLS')
    expect(card.topic).toBe('Segurança')
    expect(card.priority).toBe('urgent')
    expect(card.effort).toBe('L')
    expect(card.labels).toContain('segurança')
    expect(card.labels).toContain('esforço:l')
    expect(card.labels).toContain('segurança')
    expect(card.files).toContain('supabase/migrations/')
    expect(card.description).toContain('**Problema:**')
    expect(card.checklist).toHaveLength(3)
    expect(card.checklist[0].completed).toBe(false)
    expect(result.topics).toContain('Segurança')
  })

  it('parses list-format metadata (Notion export)', () => {
    const result = parseBacklogMarkdown(NOTION_LIST_BLOCK)
    expect(result.cards).toHaveLength(1)

    const card = result.cards[0]
    expect(card.externalId).toBe('PERF-001')
    expect(card.priority).toBe('high')
    expect(card.effort).toBe('M')
    expect(card.labels).toContain('performance')
    expect(card.checklist).toHaveLength(3)
  })

  it('emits warnings for malformed cards', () => {
    const source = `### CARD BAD — Card sem ID válido

| Campo | Valor |
| --- | --- |
| **Prioridade** | P2 |

**Subtarefas Kanban:**

- [ ] Uma subtarefa só
`
    const result = parseBacklogMarkdown(source)
    expect(result.cards).toHaveLength(0)
    expect(result.warnings.some(w => w.includes('Nenhum card'))).toBe(true)
  })

  it('ignores duplicate IDs and emits warning', () => {
    const source = `${SEC001_BLOCK}

### CARD SEC-001 — Duplicate card

| Campo | Valor |
| --- | --- |
| **Prioridade** | P1 |
| **Esforço** | S |

**Subtarefas Kanban:**

- [ ] Duplicate task
`
    const result = parseBacklogMarkdown(source)
    expect(result.cards).toHaveLength(1)
    expect(result.warnings.some(w => w.includes('SEC-001: ID duplicado'))).toBe(true)
  })

  it('warns when table ID differs from heading', () => {
    const source = `## Tópico: Segurança

### CARD SEC-002 — Mismatch test

| Campo | Valor |
| --- | --- |
| **ID** | SEC-999 |
| **Prioridade** | P1 |
| **Esforço** | S |

**Subtarefas Kanban:**

- [ ] Task one
`
    const result = parseBacklogMarkdown(source)
    expect(result.cards).toHaveLength(1)
    expect(result.warnings.some(w => w.includes('SEC-002: ID na tabela (SEC-999) difere do heading'))).toBe(true)
  })

  it('emits warnings for missing priority, effort, and topic', () => {
    const source = `### CARD ORPH-001 — Card without topic

| Campo | Valor |
| --- | --- |
| **ID** | ORPH-001 |

**Subtarefas Kanban:**

- [ ] Orphan task
`
    const result = parseBacklogMarkdown(source)
    expect(result.cards).toHaveLength(1)
    expect(result.warnings.some(w => w.includes('ORPH-001: prioridade ausente'))).toBe(true)
    expect(result.warnings.some(w => w.includes('ORPH-001: esforço ausente'))).toBe(true)
    expect(result.warnings.some(w => w.includes('ORPH-001: sem seção Tópico'))).toBe(true)
  })

  it('parses multiple topics and cards in one file', () => {
    const source = `${SEC001_BLOCK}

${NOTION_LIST_BLOCK}
`
    const result = parseBacklogMarkdown(source)
    expect(result.cards).toHaveLength(2)
    expect(result.topics).toEqual(['Segurança', 'Performance'])
    expect(result.cards.map(c => c.externalId)).toEqual(['SEC-001', 'PERF-001'])
  })
})
