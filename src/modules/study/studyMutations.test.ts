import { describe, expect, it, vi } from 'vitest'
import type { StudySave } from '../../lib/data/study'
import type { StudyCard } from '../../types'
import {
  addCheckpointLocal, addResourceLocal, answerQuizLocal, compareCardOrder, editCheckpointLocal, fieldConflict,
  isNewerVersion, mergeRefetch, removeCheckpointLocal, removeResourceLocal, resetQuizLocal, saveWithRetry,
  STUDY_SAVE_ATTEMPTS, StudyFieldBases, StudyLedger, StudyWriteTracker, toggleCheckpointLocal,
} from './studyMutations'

// API-029: a lógica pura das gravações de Estudos. Os espelhos fazem na tela
// o que a RPC fará no servidor; o livro adota a linha mais nova e reaplica as
// pendentes; o refetch não pisa no que esta aba gravou no meio (as três
// corridas reproduzidas pela crítica, em scratchpad l06/API-029/critic).

const card = (extra: Partial<StudyCard> = {}): StudyCard => ({
  id: 'c1', user_id: 'u1', topic_id: 't1', title: 'Card', description: '', rationale: '',
  checkpoints: [{ id: 'p1', text: 'Ler', completed: false, note: 'nota' }],
  resources: [{ id: 'r1', title: 'Docs', url: 'https://docs.rs' }],
  quiz: [
    { id: 'q1', statement: 'S', answer: 'certo', userAnswer: null },
    { kind: 'choice', id: 'q2', statement: 'E', options: ['a', 'b'], answer: 1, userAnswer: null },
  ],
  sort_order: 0, due_date: null, created_at: '2026-10-12T10:00:00+00:00', updated_at: 'v1', ...extra,
})

describe('espelhos locais das RPCs', () => {
  it('ponto: soma no fim sem progresso, sem repetir o id; edita texto e nota (nota vazia tira a chave); marca; remove', () => {
    const added = addCheckpointLocal(card(), { id: 'p2', text: 'Novo' })
    expect(added.checkpoints.map(p => [p.id, p.completed])).toEqual([['p1', false], ['p2', false]])
    expect(addCheckpointLocal(added, { id: 'p2', text: 'Outro' })).toBe(added)
    expect(editCheckpointLocal(card(), 'p1', { text: 'Ler tudo' }).checkpoints[0]).toEqual({ id: 'p1', text: 'Ler tudo', completed: false, note: 'nota' })
    expect(editCheckpointLocal(card(), 'p1', { note: 'outra' }).checkpoints[0].note).toBe('outra')
    expect(editCheckpointLocal(card(), 'p1', { note: '' }).checkpoints[0]).not.toHaveProperty('note')
    expect(toggleCheckpointLocal(card(), 'p1', true).checkpoints[0].completed).toBe(true)
    expect(removeCheckpointLocal(card(), 'p1').checkpoints).toEqual([])
  })

  it('recurso: soma sem repetir o id e remove', () => {
    const added = addResourceLocal(card(), { id: 'r2', title: 'B', url: 'https://b.example' })
    expect(added.resources.map(r => r.id)).toEqual(['r1', 'r2'])
    expect(addResourceLocal(added, { id: 'r2', title: 'C', url: 'https://c.example' })).toBe(added)
    expect(removeResourceLocal(card(), 'r1').resources).toEqual([])
  })

  it('quiz: só a primeira resposta conta, com o tipo da pergunta; reiniciar zera tudo ou só as erradas', () => {
    let c = answerQuizLocal(card(), 'q1', 'errado')
    c = answerQuizLocal(c, 'q1', 'certo')
    c = answerQuizLocal(c, 'q2', 1)
    expect(c.quiz.map(q => q.userAnswer)).toEqual(['errado', 1])
    expect(answerQuizLocal(card(), 'q1', 0).quiz[0].userAnswer).toBeNull()
    expect(answerQuizLocal(card(), 'q2', 'certo').quiz[1].userAnswer).toBeNull()
    expect(resetQuizLocal(c, true).quiz.map(q => q.userAnswer)).toEqual([null, 1])
    expect(resetQuizLocal(c, false).quiz.map(q => q.userAnswer)).toEqual([null, null])
  })
})

describe('ordem e versão', () => {
  it('compareCardOrder: sort_order, depois created_at e id (sort_order antigo repetido)', () => {
    const a = card({ id: 'b', sort_order: 1, created_at: '2026-10-12T10:00:00.5+00:00' })
    const b = card({ id: 'a', sort_order: 1, created_at: '2026-10-12T10:00:00.5+00:00' })
    const c = card({ id: 'c', sort_order: 1, created_at: '2026-10-12T10:00:00+00:00' })
    const d = card({ id: 'd', sort_order: 0, created_at: '2026-10-13T00:00:00+00:00' })
    expect([a, b, c, d].sort(compareCardOrder).map(x => x.id)).toEqual(['d', 'c', 'a', 'b'])
    expect(compareCardOrder(a, a)).toBe(0)
  })

  it('isNewerVersion: o texto do servidor com a fração cortada se ordena certo (localeCompare erraria)', () => {
    const whole = '2026-10-12T23:26:03+00:00'
    const half = '2026-10-12T23:26:03.5+00:00'
    const more = '2026-10-12T23:26:03.73934+00:00'
    expect(isNewerVersion(half, whole)).toBe(true)
    expect(isNewerVersion(more, half)).toBe(true)
    expect(isNewerVersion(whole, more)).toBe(false)
    expect(isNewerVersion(more, more)).toBe(false)
    expect(isNewerVersion(whole, undefined)).toBe(true)
    // O que o localeCompare faz com as mesmas strings: '.' antes de '+'.
    expect(half.localeCompare(whole)).toBeLessThan(0)
  })

  it('fieldConflict: só quando o campo do patch mudou desde a base e não ficou igual ao patch', () => {
    const server = card({ title: 'Deles', description: 'mudou' })
    expect(fieldConflict(server, { title: 'Meu antigo' }, { title: 'Meu novo' })).toBe(true)
    expect(fieldConflict(server, { title: 'Deles' }, { title: 'Meu novo' })).toBe(false)
    expect(fieldConflict(server, { title: 'Meu antigo' }, { title: 'Deles' })).toBe(false)
    expect(fieldConflict(card({ due_date: null }), { due_date: undefined }, { due_date: '2026-11-01' })).toBe(false)
  })
})

describe('saveWithRetry', () => {
  const row = (updated_at: string, title: string) => card({ updated_at, title })

  it('refaz com a versão nova quando só outro campo mudou, e para com conflito quando o campo mudou', async () => {
    const save = vi.fn<(version: string) => Promise<StudySave<StudyCard>>>()
      .mockResolvedValueOnce({ status: 'conflict', current: row('v2', 'A') })
      .mockResolvedValueOnce({ status: 'saved', row: row('v3', 'B') })
    const fresh: string[] = []
    const result = await saveWithRetry(save, 'v1', { title: 'B' }, { title: 'A' }, current => fresh.push(current.updated_at))
    expect(result).toEqual({ status: 'saved', row: row('v3', 'B') })
    expect(save.mock.calls.map(([version]) => version)).toEqual(['v1', 'v2'])
    expect(fresh).toEqual(['v2'])

    const conflict = vi.fn<(version: string) => Promise<StudySave<StudyCard>>>()
      .mockResolvedValue({ status: 'conflict', current: row('v2', 'Deles') })
    expect(await saveWithRetry(conflict, 'v1', { title: 'B' }, { title: 'A' }, () => {})).toMatchObject({ status: 'conflict' })
    expect(conflict).toHaveBeenCalledTimes(1)
  })

  it('tem fim: depois de STUDY_SAVE_ATTEMPTS versões novas seguidas, erro explícito', async () => {
    let n = 1
    const save = vi.fn(() => Promise.resolve<StudySave<StudyCard>>({ status: 'conflict', current: row(`v${++n}`, 'A') }))
    const result = await saveWithRetry(save, 'v1', { title: 'B' }, { title: 'A' }, () => {})
    expect(result).toMatchObject({ status: 'error', error: { code: 'STUDY_RETRY_LIMIT' } })
    expect(save).toHaveBeenCalledTimes(STUDY_SAVE_ATTEMPTS)
  })

  it('sem base (campo gravado no onChange), a última gravação vale: refaz mesmo com o campo mudado', async () => {
    const save = vi.fn<(version: string) => Promise<StudySave<StudyCard>>>()
      .mockResolvedValueOnce({ status: 'conflict', current: card({ updated_at: 'v2', due_date: '2026-11-02' }) })
      .mockResolvedValueOnce({ status: 'saved', row: card({ updated_at: 'v3', due_date: '2026-11-03' }) })
    expect(await saveWithRetry(save, 'v1', { due_date: '2026-11-03' }, undefined, () => {})).toMatchObject({ status: 'saved' })
  })

  it('gone, denied e error saem direto', async () => {
    for (const result of [{ status: 'gone' }, { status: 'denied' }, { status: 'error', error: { message: 'x' } }] as StudySave<StudyCard>[]) {
      const save = vi.fn(() => Promise.resolve(result))
      expect(await saveWithRetry(save, 'v1', { title: 'B' }, { title: 'A' }, () => {})).toBe(result)
      expect(save).toHaveBeenCalledTimes(1)
    }
  })

  it('a base pode ser escolhida com cada linha relida', async () => {
    const save = vi.fn<(version: string) => Promise<StudySave<StudyCard>>>()
      .mockResolvedValueOnce({ status: 'conflict', current: row('v2', 'A2') })
      .mockResolvedValueOnce({ status: 'saved', row: row('v3', 'A3') })
    const seen: string[] = []
    const pick = (current: StudyCard) => {
      seen.push(current.title)
      return current.title === 'A2' ? { title: 'A2' } : { title: 'Card' }
    }
    expect(await saveWithRetry(save, 'v1', { title: 'A3' }, pick, () => {})).toMatchObject({ status: 'saved' })
    expect(seen).toEqual(['A2'])
  })
})

// 2ª revisão do lote 06 (#3 e #4): a herança presa ao texto que falhou.
describe('StudyFieldBases', () => {
  const at = (title: string) => card({ title })
  const failedA2 = { base: { title: 'Card' }, value: { title: 'A2' }, own: { title: 'Card' } }

  it('sem herança, ou com o servidor na base própria, vale a própria', () => {
    const bases = new StudyFieldBases()
    expect(bases.pick('c1:f:title', at('Card'), { title: 'A2' }, { title: 'A3' })).toEqual({ title: 'A2' })
    bases.settle('c1:f:title', failedA2)
    expect(bases.pick('c1:f:title', at('A2'), { title: 'A2' }, { title: 'A3' })).toEqual({ title: 'A2' })
    expect(bases.pick('c1:f:title', at('Card'), undefined, { title: 'A3' })).toBeUndefined()
  })

  it('herda só quem partiu do texto que falhou, ou da mesma base dela (o rascunho que voltou)', () => {
    const bases = new StudyFieldBases()
    bases.settle('c1:f:title', { base: { title: 'Card' }, value: { title: 'A3' }, own: { title: 'A2' } })
    expect(bases.pick('c1:f:title', at('Card'), { title: 'A3' }, { title: 'A4' })).toEqual({ title: 'Card' })
    expect(bases.pick('c1:f:title', at('Card'), { title: 'A2' }, { title: 'A3' })).toEqual({ title: 'Card' })
    expect(bases.pick('c1:f:title', at('Card'), { title: 'Deles' }, { title: 'Meu' })).toEqual({ title: 'Deles' })
    // Outra chave (outro campo, outra linha) não herda.
    expect(bases.pick('c2:f:title', at('Card'), { title: 'A3' }, { title: 'A4' })).toEqual({ title: 'A3' })
  })

  it('o rascunho que voltou, editado ou não, confere com o servidor que tem o texto que falhou', () => {
    const bases = new StudyFieldBases()
    bases.settle('c1:f:title', failedA2)
    // A resposta se perdeu depois do commit: lá está 'A2', o texto da pessoa.
    expect(bases.pick('c1:f:title', at('A2'), { title: 'Card' }, { title: 'A2 e mais' })).toEqual({ title: 'A2' })
    // Outro texto lá: vale a base herdada (e é conflito).
    expect(bases.pick('c1:f:title', at('Deles'), { title: 'Card' }, { title: 'A2 e mais' })).toEqual({ title: 'Card' })
  })

  it('settle sem falha apaga; seen troca a base herdada pelo valor que falhou quando o servidor o tem', () => {
    const bases = new StudyFieldBases()
    bases.settle('c1:f:title', failedA2)
    bases.settle('c1:f:title')
    expect(bases.pick('c1:f:title', at('Card'), { title: 'A2' }, { title: 'A3' })).toEqual({ title: 'A2' })
    bases.settle('c1:f:title', failedA2)
    bases.seen('c1', at('Card'))
    bases.seen('c10', at('A2'))
    expect(bases.pick('c1:f:title', at('Card'), { title: 'A2' }, { title: 'A3' })).toEqual({ title: 'Card' })
    bases.seen('c1', at('A2'))
    expect(bases.pick('c1:f:title', at('Card'), { title: 'A2' }, { title: 'A3' })).toEqual({ title: 'A2' })
    expect(bases.pick('c1:f:title', at('Deles'), { title: 'Card' }, { title: 'A3' })).toEqual({ title: 'A2' })
  })
})

describe('StudyLedger', () => {
  it('view = servidor + pendentes; a resposta fora de ordem não volta a versão', () => {
    const ledger = new StudyLedger<StudyCard>()
    ledger.replace(card({ updated_at: 'v1' }))
    const toggle = { apply: (c: StudyCard) => toggleCheckpointLocal(c, 'p1', true) }
    const title = { apply: (c: StudyCard) => ({ ...c, title: 'Novo' }) }
    ledger.push('c1', toggle)
    ledger.push('c1', title)
    expect(ledger.view('c1')).toMatchObject({ title: 'Novo', checkpoints: [{ completed: true }] })
    expect(ledger.base('c1')?.title).toBe('Card')
    // O título gravou primeiro (v3, já com o ponto marcado); o toggle volta depois com v2.
    ledger.pop('c1', title)
    expect(ledger.adopt(card({ updated_at: 'v3', title: 'Novo', checkpoints: [{ id: 'p1', text: 'Ler', completed: true }] }))).toBe(true)
    ledger.pop('c1', toggle)
    expect(ledger.adopt(card({ updated_at: 'v2', checkpoints: [{ id: 'p1', text: 'Ler', completed: true }] }))).toBe(false)
    expect(ledger.view('c1')).toMatchObject({ title: 'Novo', updated_at: 'v3', checkpoints: [{ completed: true }] })
    // O refetch (restore do backup) entra mesmo mais velho.
    ledger.replace(card({ updated_at: 'v0' }))
    expect(ledger.view('c1')?.updated_at).toBe('v0')
    ledger.forget('c1')
    expect(ledger.view('c1')).toBeUndefined()
  })
})

describe('StudyWriteTracker', () => {
  it('serial: a mesma chave espera a anterior (que pode falhar), chave diferente sai na hora', async () => {
    const tracker = new StudyWriteTracker()
    const order: string[] = []
    let releaseFirst: () => void = () => {}
    const first = tracker.serial('c1:cp:p1', () => new Promise<void>((_, reject) => {
      releaseFirst = () => { order.push('1'); reject(new Error('rede')) }
    }))
    const second = tracker.serial('c1:cp:p1', () => { order.push('2'); return Promise.resolve('ok') })
    const other = tracker.serial('c1:cp:p2', () => { order.push('outra'); return Promise.resolve('ok') })
    await other
    expect(order).toEqual(['outra'])
    releaseFirst()
    await expect(first).rejects.toThrow('rede')
    expect(await second).toBe('ok')
    expect(order).toEqual(['outra', '1', '2'])
  })

  it('keepLocal: em voo, ou gravado depois do início do refetch; removido até um refetch posterior', () => {
    const tracker = new StudyWriteTracker()
    tracker.mark('antes')
    const since = tracker.now()
    expect(tracker.keepLocal('antes', since)).toBe(false)
    tracker.begin('voo')
    expect(tracker.keepLocal('voo', since)).toBe(true)
    tracker.end('voo')
    expect(tracker.keepLocal('voo', since)).toBe(true)
    expect(tracker.keepLocal('voo', tracker.now())).toBe(false)
    tracker.removing('x')
    tracker.expireRemoved(tracker.now())
    expect(tracker.isRemoved('x')).toBe(true)
    tracker.removed('x')
    const after = tracker.now()
    tracker.expireRemoved(after - 1)
    expect(tracker.isRemoved('x')).toBe(true)
    tracker.expireRemoved(after)
    expect(tracker.isRemoved('x')).toBe(false)
    tracker.removing('y')
    tracker.restored('y')
    expect(tracker.isRemoved('y')).toBe(false)
  })
})

describe('mergeRefetch: refetch que saiu antes de uma gravação e voltou depois dela', () => {
  type Row = { id: string; v: string; title: string }
  const s0: Row[] = [{ id: 'c1', v: 'v1', title: 'A' }, { id: 'c2', v: 'v1', title: 'B' }]

  // A guarda vem do registro de escritas, como no hook.
  function race(during: (tracker: StudyWriteTracker) => void) {
    const tracker = new StudyWriteTracker()
    const since = tracker.now()
    during(tracker)
    return { keepLocal: (id: string) => tracker.keepLocal(id, since), removed: (id: string) => tracker.isRemoved(id) }
  }

  it('card criado por esta aba durante o refetch fica', () => {
    const guard = race(tracker => tracker.mark('c3'))
    const local = [...s0, { id: 'c3', v: 'v1', title: '' }]
    expect(mergeRefetch(local, s0, guard).rows.map(r => r.id)).toEqual(['c3', 'c1', 'c2'])
  })

  it('card excluído por esta aba durante o refetch não volta', () => {
    const guard = race(tracker => { tracker.removing('c2'); tracker.removed('c2') })
    expect(mergeRefetch([s0[0]], s0, guard).rows.map(r => r.id)).toEqual(['c1'])
  })

  it('ponto marcado e confirmado durante o refetch não é desfeito (a linha v1 não passa por cima da v2)', () => {
    const guard = race(tracker => { tracker.begin('c1'); tracker.end('c1') })
    const local = [{ id: 'c1', v: 'v2', title: 'A' }, s0[1]]
    expect(mergeRefetch(local, s0, guard).rows[0].v).toBe('v2')
  })

  it('sem escrita no meio: adota o servidor, entra o novo e sai o que foi excluído em outra aba', () => {
    const guard = race(() => {})
    const local = [{ id: 'c1', v: 'v1', title: 'velho' }, { id: 'c9', v: 'v1', title: 'apagado lá' }]
    const server = [{ id: 'c1', v: 'v0', title: 'restaurado' }, { id: 'c5', v: 'v1', title: 'novo' }]
    const merged = mergeRefetch(local, server, guard)
    expect(merged.rows).toEqual(server)
    expect(merged.gone.map(r => r.id)).toEqual(['c9'])
  })
})
