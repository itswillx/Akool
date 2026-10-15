import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { ScheduleCard } from '../../supabase/functions/_domain/autoSchedule'
import type { ProjectCardPriority as SnapshotPriority } from '../../supabase/functions/_domain/blocknote/projectCard'
import type { CardMarkdownKey, CardMarkdownSource } from '../../supabase/functions/_domain/cardMarkdown'
import { DOMAIN_PT_BR, tPtBR, type DomainKey, type DomainTFor } from '../../supabase/functions/_domain/i18n.pt-BR'
import {
  backlogIssueText, importIssueText, importWarningText, type BacklogIssueKey, type ImportIssueCode, type ImportIssueKey,
  type ImportWarningCode, type ImportWarningKey,
} from '../../supabase/functions/_domain/importPlan'
import type { StatsCard } from '../../supabase/functions/_domain/projectStats'
import type {
  ProjectCardAttachmentItem,
  ProjectCardLinkItem,
  ProjectCardPriority as DomainPriority,
  ProjectChecklistItem,
} from '../../supabase/functions/_domain/projectTypes'
import { getT } from '../i18n/translations'
import { ptBR, type TranslationKey } from '../i18n/translations.pt-BR'
import type { ProjectCard, ProjectCardAttachment, ProjectCardChecklistItem, ProjectCardLink, ProjectCardPriority } from '../types'
import type { BacklogIssueCode } from './backlogMarkdownParser'
import { formatCardAsMarkdown } from './cardMarkdown'
import { createdDayLocal, createdPerWeek } from './projectStats'

// API-027: _domain não importa src/types nem src/i18n, então tem os seus tipos
// (projectTypes.ts) e o seu dicionário (i18n.pt-BR.ts). Este teste trava a
// deriva: os tipos pelo tsc (expectTypeOf, conferido no `tsc -b`) e os textos
// em tempo de execução.

describe('tipos de _domain × src/types', () => {
  it('o card do app serve onde o domínio pede um card', () => {
    expectTypeOf<ProjectCard>().toExtend<ScheduleCard>()
    expectTypeOf<ProjectCard>().toExtend<StatsCard>()
    expectTypeOf<ProjectCard>().toExtend<CardMarkdownSource>()
  })

  it('prioridade, checklist, link e anexo são os mesmos', () => {
    expectTypeOf<DomainPriority>().toEqualTypeOf<ProjectCardPriority>()
    expectTypeOf<SnapshotPriority>().toEqualTypeOf<ProjectCardPriority>()
    expectTypeOf<ProjectChecklistItem>().toEqualTypeOf<ProjectCardChecklistItem>()
    expectTypeOf<ProjectCardLinkItem>().toEqualTypeOf<ProjectCardLink>()
    expectTypeOf<ProjectCardAttachmentItem>().toEqualTypeOf<ProjectCardAttachment>()
  })

  it('o `t` do app serve onde o domínio pede um `t`', () => {
    expectTypeOf<DomainKey>().toExtend<TranslationKey>()
    expectTypeOf(getT('pt-BR')).toExtend<DomainTFor<CardMarkdownKey>>()
    expectTypeOf(getT('pt-BR')).toExtend<DomainTFor<BacklogIssueKey>>()
    expectTypeOf<`projects_import_issue_${BacklogIssueCode}`>().toEqualTypeOf<BacklogIssueKey>()
    expectTypeOf(getT('pt-BR')).toExtend<DomainTFor<ImportWarningKey>>()
    expectTypeOf<`projects_import_warning_${ImportWarningCode}`>().toEqualTypeOf<ImportWarningKey>()
    expectTypeOf(getT('pt-BR')).toExtend<DomainTFor<ImportIssueKey>>()
    expectTypeOf<`projects_import_error_${ImportIssueCode}`>().toEqualTypeOf<ImportIssueKey>()
  })
})

describe('textos de _domain × src/i18n (pt-BR)', () => {
  const shared = Object.keys(DOMAIN_PT_BR) as (DomainKey & TranslationKey)[]

  it('toda chave do domínio existe no app com o mesmo texto', () => {
    expect(shared.length).toBeGreaterThanOrEqual(37)
    expect(shared.filter(k => !(k in ptBR))).toEqual([])
    expect(shared.filter(k => DOMAIN_PT_BR[k] !== ptBR[k])).toEqual([])
  })

  it('tPtBR interpola igual ao getT do app', () => {
    const t = getT('pt-BR')
    const vars = { id: 'AB-001', detail: 'AB-002', name: 'x.png', title: 'Card', max: 500 }
    expect(shared.filter(k => tPtBR(k, vars) !== t(k, vars))).toEqual([])
  })

  it('o Markdown do card sai igual com o tPtBR e com o t do app', () => {
    const card: CardMarkdownSource = {
      title: '', description: 'Descrição **forte**', priority: 'urgent', start_date: '2026-08-12', due_date: '2026-08-20',
      estimated_days: 3, labels: ['a', ' b '], completed: true,
      checklist: [{ id: '1', text: 'feito', completed: true }, { id: '2', text: 'falta', completed: false }],
      links: [{ id: 'l1', url: 'https://www.exemplo.com/x', title: '' }],
      attachments: [{ id: 'f1', url: 'u/b/c/print.png', name: 'print.png' }],
    }
    const ctx = { columnName: 'Fazendo', assigneeName: ' ', parentTitle: 'Pai', dependencyTitles: ['D1', ''] }
    const md = formatCardAsMarkdown(card, ctx, tPtBR)
    expect(md).toBe(formatCardAsMarkdown(card, ctx, getT('pt-BR')))
    expect(md).toContain('# Novo card')
    expect(md).toContain('- **Responsável:** Sem responsável')
  })

  it('os avisos da importação saem como na tela (ImportCardsModal)', () => {
    const t = getT('pt-BR')
    const codes: BacklogIssueCode[] = [
      'invalid_heading', 'id_mismatch', 'no_subtasks', 'no_priority', 'no_effort', 'no_topic', 'duplicate_id', 'no_cards',
      'invalid_dependency', 'self_dependency',
    ]
    for (const code of codes) {
      const issue = { code, cardId: 'AB-001', detail: 'AB-002' }
      const screen = t(`projects_import_issue_${issue.code}`, { id: issue.cardId ?? '', detail: issue.detail ?? '' })
      expect(backlogIssueText(issue, tPtBR)).toBe(screen)
      expect(backlogIssueText(issue, t)).toBe(screen)
    }
  })

  it('os avisos de dependência (API-033) saem iguais com o tPtBR e com o t do app', () => {
    const t = getT('pt-BR')
    const codes: ImportWarningCode[] = ['dependency_not_found', 'dependency_not_applied']
    for (const code of codes) {
      const warning = { code, cardId: 'AB-001', detail: 'AB-002, AB-003' }
      expect(importWarningText(warning, tPtBR)).toBe(importWarningText(warning, t))
      expect(importWarningText(warning, t)).toContain('AB-002, AB-003')
    }
  })

  it('o que impede a importação (API-033) sai igual com o tPtBR e com o t do app', () => {
    const t = getT('pt-BR')
    const codes: ImportIssueCode[] = ['no_column', 'checklist_too_many', 'checklist_text_too_long', 'dependency_cycle', 'depends_on_too_many']
    for (const code of codes) {
      const issue = { code, cardId: 'AB-001', detail: 'AB-001 → AB-002 → AB-001' }
      expect(importIssueText(issue, tPtBR)).toBe(importIssueText(issue, t))
      expect(importIssueText(issue, t)).toMatch(/^AB-001: [^{}]+$/)
    }
  })
})

// Fusos com offsets a 1 h ou mais um do outro (nenhum muda de horário em março
// de 2025). Em UTC (o CI) o dia local e o dia UTC coincidem, e só São Paulo não
// separa "fuso do aparelho" de "UTC−3 fixo".
const DEVICE_ZONES = [
  { tz: 'America/Sao_Paulo', offset: 180 },
  { tz: 'America/Manaus', offset: 240 },
  { tz: 'Asia/Tokyo', offset: -540 },
]

describe('createdPerWeek no app: o dia de criação é o do fuso do aparelho', () => {
  // Os instantes são montados em hora local, dos dois lados da meia-noite. O
  // dia UTC (o slice do created_at) ou um offset fixo só acertam os dois num
  // fuso a menos de meia hora do seu, então algum dos fusos acima os pega.
  // O stubEnv grava no process.env, e o Node relê o TZ (o pool do vitest é forks).
  afterEach(() => { vi.unstubAllEnvs() })

  const sundayAndMonday = (tz: string, offset: number) => {
    vi.stubEnv('TZ', tz)
    const sunday = new Date(2025, 2, 9, 23, 30)
    const monday = new Date(2025, 2, 10, 0, 30)
    // Pré-condição: o fuso fixado vale; sem ela o caso rodaria no fuso do processo.
    expect([sunday.getTimezoneOffset(), monday.getTimezoneOffset()]).toEqual([offset, offset])
    return { sunday: sunday.toISOString(), monday: monday.toISOString() }
  }

  it.each(DEVICE_ZONES)('createdDayLocal: domingo 23:30 e segunda 00:30 locais ficam em dias diferentes ($tz)', ({ tz, offset }) => {
    const { sunday, monday } = sundayAndMonday(tz, offset)
    expect(createdDayLocal(sunday)).toBe('2025-03-09')
    expect(createdDayLocal(monday)).toBe('2025-03-10')
    // O created_at do PostgREST vem com microssegundos e +00:00.
    expect(createdDayLocal(sunday.replace(/\.\d{3}Z$/, '.123456+00:00'))).toBe('2025-03-09')
  })

  it.each(DEVICE_ZONES)('o card de domingo 23:30 fica na semana do domingo, e o de segunda 00:30 na seguinte ($tz)', ({ tz, offset }) => {
    const { sunday, monday } = sundayAndMonday(tz, offset)
    const card = (created_at: string) => ({ column_id: 'c', priority: 'low' as const, due_date: null, completed: false, assignee_user_id: null, created_at })
    expect(createdPerWeek([card(sunday), card(monday)], 2, '2025-03-12'))
      .toEqual([{ weekStart: '2025-03-03', count: 1 }, { weekStart: '2025-03-10', count: 1 }])
  })
})
