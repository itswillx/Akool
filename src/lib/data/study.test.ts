import { beforeEach, describe, expect, it, vi } from 'vitest'
import migration024 from '../../../supabase/migrations/20261011120000_api024_study_rpcs.sql?raw'

// API-029: a camada de dados de Estudos. Cada item vai pela RPC do API-024
// com os argumentos certos (p_completed explícito, p_id de quem chama, nota ''
// para tirar); os campos escalares gravam sobre a versão do servidor e, com
// zero linhas, releem para separar reenvio, recusa do RLS, card apagado e
// conflito; importar com meta e reagendar mandam o dia do aparelho e, se o
// servidor o recusa (relógio errado), refazem sem ele; os erros viram a classe
// que o hook usa.

type Res = { data: unknown; error: { message: string; code?: string; hint?: string } | null }
const db = vi.hoisted(() => ({ queue: [] as Res[], calls: [] as string[], values: [] as unknown[], rpcs: [] as [string, unknown][] }))

vi.mock('../supabase', () => ({
  supabase: {
    from: (table: string) => {
      const ops: string[] = []
      const b = {
        update: (values: unknown) => { ops.push('update'); db.values.push(values); return b },
        insert: (values: unknown) => { ops.push('insert'); db.values.push(values); return b },
        delete: () => { ops.push('delete'); return b },
        select: (cols: string) => { ops.push(`select(${cols})`); return b },
        order: (col: string) => { ops.push(`order(${col})`); return b },
        single: () => b, maybeSingle: () => { ops.push('maybeSingle'); return b },
        eq: (col: string, value: unknown) => { ops.push(`${col}=${String(value)}`); return b },
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
          db.calls.push(`${table}:${ops.join(',')}`)
          return Promise.resolve(db.queue.shift() ?? { data: [], error: null }).then(resolve, reject)
        },
      }
      return b
    },
    rpc: (name: string, args: unknown) => {
      db.rpcs.push([name, args])
      return { then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(db.queue.shift() ?? { data: null, error: null }).then(resolve, reject) }
    },
  },
}))

const data = await import('./study')

const row = (extra: Record<string, unknown> = {}) => ({
  id: 'c1', user_id: 'u1', topic_id: 't1', title: 'Card', description: '', rationale: null, sort_order: 0, due_date: null,
  checkpoints: [{ id: 'p1', text: 'Ler', completed: false }], resources: null, quiz: [{ kind: 'choice', id: 'q', statement: 's', answer: 0 }],
  blocks: [], created_at: '2026-10-12T10:00:00+00:00', updated_at: 'v1', ...extra,
})
const topic = (extra: Record<string, unknown> = {}) => ({
  id: 't1', user_id: 'u1', title: 'Rust', area: '', level: '', objective: '', status: 'planned', target_date: null,
  started_at: null, completed_at: null, created_at: '', updated_at: 'v1', ...extra,
})

beforeEach(() => {
  db.queue = []
  db.calls = []
  db.values = []
  db.rpcs = []
})

describe('leitura e normalização', () => {
  it('listStudy: cards na ordem do roteiro (sort_order, created_at, id) e normalizados', async () => {
    db.queue = [{ data: [topic()], error: null }, { data: [row()], error: null }, { data: [], error: null }]
    const snapshot = await data.listStudy('u1')
    expect(db.calls[1]).toBe('study_cards:select(*),user_id=u1,order(sort_order),order(created_at),order(id)')
    expect(snapshot.error).toBeNull()
    expect(snapshot.cards[0]).toMatchObject({ rationale: '', resources: [], quiz: [] })
  })

  it('listStudy: erro de uma das leituras ou rede caída volta como error, sem lançar', async () => {
    db.queue = [{ data: [], error: null }, { data: null, error: { message: 'JWT expired', code: 'PGRST301' } }, { data: [], error: null }]
    expect((await data.listStudy('u1')).error).toEqual({ message: 'JWT expired', code: 'PGRST301' })
    db.queue = []
    const spy = vi.spyOn(Promise, 'all').mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect((await data.listStudy('u1')).error).toEqual({ message: 'Failed to fetch' })
    spy.mockRestore()
  })

  it('getStudyCard e getStudyTopic releem pelo id (maybeSingle)', async () => {
    db.queue = [{ data: row(), error: null }, { data: null, error: null }]
    expect((await data.getStudyCard('c1')).data).toMatchObject({ id: 'c1', rationale: '' })
    expect((await data.getStudyTopic('t1')).data).toBeNull()
    expect(db.calls).toEqual(['study_cards:select(*),id=c1,maybeSingle', 'study_topics:select(*),id=t1,maybeSingle'])
  })
})

describe('saveCardFields e saveTopicFields', () => {
  it('grava sobre a versão e devolve a linha inteira', async () => {
    db.queue = [{ data: [row({ title: 'Novo', updated_at: 'v2' })], error: null }]
    expect(await data.saveCardFields('c1', { title: 'Novo' }, 'v1')).toMatchObject({ status: 'saved', row: { title: 'Novo', updated_at: 'v2' } })
    expect(db.calls).toEqual(['study_cards:update,id=c1,updated_at=v1,select(*)'])
    expect(db.values).toEqual([{ title: 'Novo' }])
  })

  it('zero linhas: reenvio (saved), RLS (denied), apagado (gone) e outra versão (conflict)', async () => {
    db.queue = [{ data: [], error: null }, { data: row({ title: 'Novo', updated_at: 'v2' }), error: null }]
    expect(await data.saveCardFields('c1', { title: 'Novo' }, 'v1')).toMatchObject({ status: 'saved', row: { updated_at: 'v2' } })
    db.queue = [{ data: [], error: null }, { data: row(), error: null }]
    expect(await data.saveCardFields('c1', { title: 'Novo' }, 'v1')).toEqual({ status: 'denied' })
    db.queue = [{ data: [], error: null }, { data: null, error: null }]
    expect(await data.saveCardFields('c1', { title: 'Novo' }, 'v1')).toEqual({ status: 'gone' })
    db.queue = [{ data: [], error: null }, { data: row({ title: 'Deles', updated_at: 'v3' }), error: null }]
    expect(await data.saveCardFields('c1', { title: 'Novo' }, 'v1')).toMatchObject({ status: 'conflict', current: { title: 'Deles' } })
  })

  it('erro na gravação ou na releitura sobe como error', async () => {
    db.queue = [{ data: null, error: { message: 'falhou' } }]
    expect(await data.saveCardFields('c1', { title: 'x' }, 'v1')).toEqual({ status: 'error', error: { message: 'falhou' } })
    db.queue = [{ data: [], error: null }, { data: null, error: { message: 'releitura' } }]
    expect(await data.saveCardFields('c1', { title: 'x' }, 'v1')).toEqual({ status: 'error', error: { message: 'releitura' } })
  })

  it('tópico: sem datas nem versão no corpo; as datas do servidor voltam na linha', async () => {
    db.queue = [{ data: [topic({ status: 'studying', started_at: 'agora', updated_at: 'v2' })], error: null }]
    expect(await data.saveTopicFields('t1', { status: 'studying' }, 'v1')).toMatchObject({ status: 'saved', row: { started_at: 'agora' } })
    expect(db.values).toEqual([{ status: 'studying' }])
    expect(db.calls).toEqual(['study_topics:update,id=t1,updated_at=v1,select(*)'])
    db.queue = [{ data: [], error: null }, { data: null, error: null }]
    expect(await data.saveTopicFields('t1', { title: 'x' }, 'v1')).toEqual({ status: 'gone' })
    db.queue = [{ data: [], error: null }, { data: topic({ title: 'Deles', updated_at: 'v3' }), error: null }]
    expect(await data.saveTopicFields('t1', { title: 'x' }, 'v1')).toMatchObject({ status: 'conflict' })
    db.queue = [{ data: null, error: { message: 'x' } }]
    expect(await data.saveTopicFields('t1', { title: 'x' }, 'v1')).toMatchObject({ status: 'error' })
    db.queue = [{ data: [], error: null }, { data: null, error: { message: 'y' } }]
    expect(await data.saveTopicFields('t1', { title: 'x' }, 'v1')).toMatchObject({ status: 'error' })
  })
})

describe('tópico, card e diário sem versão', () => {
  it('insertTopic não manda datas; os deletes vão pelo id', async () => {
    await data.insertTopic('u1', { title: 'X', area: '', level: '', objective: '', target_date: null })
    expect(db.values[0]).toEqual({ user_id: 'u1', title: 'X', area: '', level: '', objective: '', target_date: null })
    await data.deleteTopic('t1')
    await data.deleteCard('c1')
    await data.insertLog('u1', 't1', 'oi')
    await data.deleteLog('l1')
    expect(db.calls).toEqual([
      'study_topics:insert,select(*)', 'study_topics:delete,id=t1', 'study_cards:delete,id=c1',
      'study_logs:insert,select(*)', 'study_logs:delete,id=l1',
    ])
  })
})

describe('RPCs por item', () => {
  it('argumentos de cada uma: p_id de quem chama, p_completed explícito, nota vazia, só o que mudou', async () => {
    db.queue = Array.from({ length: 9 }, () => ({ data: row({ updated_at: 'v2' }), error: null }))
    await data.addCheckpoint('c1', { id: 'p9', text: 'Novo' })
    await data.editCheckpoint('c1', 'p1', { text: 'Texto' })
    await data.editCheckpoint('c1', 'p1', { note: '' })
    await data.toggleCheckpoint('c1', 'p1', false)
    await data.removeCheckpoint('c1', 'p1')
    await data.addResource('c1', { id: 'r9', title: 'Docs', url: 'https://docs.rs' })
    await data.removeResource('c1', 'r1')
    await data.answerQuiz('c1', 'q', 2)
    await data.resetQuiz('c1', true)
    expect(db.rpcs).toEqual([
      ['study_checkpoint_add', { p_card: 'c1', p_text: 'Novo', p_id: 'p9' }],
      ['study_checkpoint_edit', { p_card: 'c1', p_checkpoint: 'p1', p_text: 'Texto' }],
      ['study_checkpoint_edit', { p_card: 'c1', p_checkpoint: 'p1', p_note: '' }],
      ['study_checkpoint_toggle', { p_card: 'c1', p_checkpoint: 'p1', p_completed: false }],
      ['study_checkpoint_remove', { p_card: 'c1', p_checkpoint: 'p1' }],
      ['study_resource_add', { p_card: 'c1', p_url: 'https://docs.rs', p_title: 'Docs', p_id: 'r9' }],
      ['study_resource_remove', { p_card: 'c1', p_resource: 'r1' }],
      ['study_quiz_answer', { p_card: 'c1', p_question: 'q', p_answer: 2 }],
      ['study_quiz_reset', { p_card: 'c1', p_only_wrong: true }],
    ])
  })

  it('a linha que volta é normalizada; erro volta sem linha', async () => {
    db.queue = [{ data: row({ resources: 'x' }), error: null }, { data: null, error: { message: 'Card não encontrado', code: 'P0002', hint: 'akool' } }]
    expect((await data.toggleCheckpoint('c1', 'p1', true)).data).toMatchObject({ resources: [], rationale: '' })
    expect(await data.toggleCheckpoint('c1', 'p1', true)).toEqual({ data: null, error: { message: 'Card não encontrado', code: 'P0002', hint: 'akool' } })
  })
})

describe('lote: anexar, importar e reagendar', () => {
  it('appendStudyCards manda os cards sem posição e devolve as linhas normalizadas', async () => {
    db.queue = [{ data: [row({ id: 'c2', sort_order: 3 })], error: null }]
    const res = await data.appendStudyCards('t1', [{ title: '' }])
    expect(db.rpcs).toEqual([['study_cards_append', { p_topic: 't1', p_cards: [{ title: '' }] }]])
    expect(res.data?.[0]).toMatchObject({ id: 'c2', sort_order: 3, resources: [] })
  })

  // Revisão do lote 06 (#7): o dia de São Paulo calculado no aparelho sai do
  // mesmo relógio, e a conferência de ±1 dia nunca filtrava nada; com o
  // relógio errado, toda importação (até sem meta) e o recalcular davam 22023.
  const withTarget = { topic: { title: 'X', area: '', level: '', objective: '', target_date: '2026-12-31' }, cards: [{ title: 'A' }] }
  const noTarget = { ...withTarget, topic: { ...withTarget.topic, target_date: null } }
  const todayRefused = { data: null, error: { message: 'Data de hoje (2026-10-15) a mais de 1 dia do hoje de São Paulo (2026-10-12): mande o dia do aparelho ou nada', code: '22023', hint: 'akool' } }
  const cardRefused = { data: null, error: { message: 'cards/0: x', code: '22023', hint: 'akool' } }

  it('importStudyTopic com meta: uma chamada, com o dia do aparelho como p_today; devolve tópico e cards normalizados', async () => {
    db.queue = [{ data: { topic: topic(), cards: [row()] }, error: null }]
    const res = await data.importStudyTopic(withTarget, new Date(2026, 9, 12, 12))
    expect(db.rpcs).toEqual([['study_import_topic', { p_payload: withTarget, p_today: '2026-10-12' }]])
    expect(res.data?.cards[0]).toMatchObject({ rationale: '', resources: [] })
  })

  it('importStudyTopic sem meta: sem p_today (o servidor conferiria o dia à toa)', async () => {
    db.queue = [{ data: { topic: topic(), cards: [row()] }, error: null }]
    await data.importStudyTopic(noTarget, new Date(2026, 9, 15, 12))
    expect(db.rpcs).toEqual([['study_import_topic', { p_payload: noTarget }]])
  })

  it('importStudyTopic com meta e o dia recusado pelo servidor: refaz uma vez sem p_today (vale o dia de São Paulo do servidor)', async () => {
    db.queue = [todayRefused, { data: { topic: topic(), cards: [row()] }, error: null }]
    const res = await data.importStudyTopic(withTarget, new Date(2026, 9, 15, 12))
    expect(db.rpcs).toEqual([
      ['study_import_topic', { p_payload: withTarget, p_today: '2026-10-15' }],
      ['study_import_topic', { p_payload: withTarget }],
    ])
    expect(res.error).toBeNull()
    expect(res.data?.topic.id).toBe('t1')
  })

  it('importStudyTopic com outro 22023 (card fora da forma): não refaz, e o erro sobe', async () => {
    db.queue = [cardRefused]
    expect(await data.importStudyTopic(withTarget, new Date(2026, 9, 12, 12))).toEqual(cardRefused)
    expect(db.rpcs).toHaveLength(1)
  })

  it('rescheduleStudyTopic: o dia do aparelho como p_today', async () => {
    db.queue = [{ data: [row({ due_date: '2026-11-01' })], error: null }]
    await data.rescheduleStudyTopic('t1', new Date(2026, 9, 12, 12))
    expect(db.rpcs).toEqual([['study_reschedule', { p_topic: 't1', p_today: '2026-10-12' }]])
  })

  it('rescheduleStudyTopic com o dia recusado: refaz uma vez sem p_today', async () => {
    db.queue = [todayRefused, { data: [row({ due_date: '2026-11-01' })], error: null }]
    const res = await data.rescheduleStudyTopic('t1', new Date(2026, 9, 15, 12))
    expect(db.rpcs).toEqual([['study_reschedule', { p_topic: 't1', p_today: '2026-10-15' }], ['study_reschedule', { p_topic: 't1' }]])
    expect(res.data?.[0]).toMatchObject({ due_date: '2026-11-01' })
  })

  it('o dia recusado de novo na 2ª chamada não vira laço: o erro sobe', async () => {
    db.queue = [todayRefused, todayRefused]
    expect(await data.rescheduleStudyTopic('t1', new Date(2026, 9, 15, 12))).toEqual({ data: null, error: todayRefused.error })
    expect(db.rpcs).toHaveLength(2)
  })

  // O cliente reconhece a recusa pelo texto: mudar a migration sem mudar aqui quebra.
  it('a recusa do dia é a da migration 024 nas duas RPCs: "Data de hoje", 22023 e hint akool', () => {
    const raises = migration024.match(/raise exception 'Data de hoje[^;]*;/g) ?? []
    expect(raises).toHaveLength(2)
    for (const raise of raises) expect(raise).toMatch(/using errcode = '22023', hint = 'akool';$/)
    expect(todayRefused.error.message.startsWith('Data de hoje')).toBe(true)
  })
})

describe('erros', () => {
  it('studyErrorKind classifica pelos códigos do API-024', () => {
    const kind = (code: string, hint?: string) => data.studyErrorKind({ message: 'x', code, hint })
    expect(kind('P0002')).toBe('missing')
    expect(kind('P0001')).toBe('answered')
    expect(kind('22023')).toBe('invalid')
    expect(kind('23514')).toBe('invalid')
    expect(kind('23505', 'akool')).toBe('invalid')
    expect(kind('23505')).toBe('other')
    expect(kind('PGRST202')).toBe('outdated')
    expect(kind('42883')).toBe('outdated')
    expect(kind('42501')).toBe('other')
    expect(data.studyErrorKind(null)).toBe('other')
  })

  it('importErrorCard lê "cards/N: …" e devolve o número (a partir de 1) e o título', () => {
    const cards = [{ title: 'A' }, { title: 'B' }]
    expect(data.importErrorCard({ message: 'cards/1: Recursos fora do formato: item 0: …\nlinha 2' }, cards))
      .toEqual({ n: 2, title: 'B', reason: 'Recursos fora do formato: item 0: …\nlinha 2' })
    expect(data.importErrorCard({ message: 'cards/7: x' }, cards)).toEqual({ n: 8, title: '', reason: 'x' })
    expect(data.importErrorCard({ message: 'topic/title: o título do tópico é obrigatório' }, cards)).toBeNull()
    expect(data.importErrorCard(null, cards)).toBeNull()
  })

  it('fieldsMatch compara os campos do patch, com null e ausente iguais', () => {
    expect(data.fieldsMatch({ title: 'a', due_date: null }, { due_date: undefined })).toBe(true)
    expect(data.fieldsMatch({ title: 'a' }, { title: 'b' })).toBe(false)
  })
})
