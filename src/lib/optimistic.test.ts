import { describe, expect, it, vi } from 'vitest'
import {
  fieldsUnchanged,
  findInGroups,
  firstError,
  mapWriteError,
  pickFields,
  reinsertAt,
  requireRows,
  revertFields,
  runGuarded,
  runOptimistic,
} from './optimistic'
import { getT } from '../i18n/translations'

const t = getT('pt-BR')

interface Card {
  id: string
  title: string
  due_date: string | null
  checkpoints: { id: string }[]
  updated_at: string
}

const card = (id: string, over: Partial<Card> = {}): Card => ({
  id,
  title: id,
  due_date: null,
  checkpoints: [],
  updated_at: '2026-01-01T00:00:00.000Z',
  ...over,
})

const denied = { message: 'permission denied for table study_cards', code: '42501' }

describe('runOptimistic', () => {
  it('reinsere a linha na posicao original quando o write falha, e reporta', async () => {
    let list = [card('a'), card('b'), card('c')]
    const removed = list[1]
    const showToast = vi.fn()

    const ok = await runOptimistic({
      apply: () => { list = list.filter(c => c.id !== 'b') },
      write: async () => ({ data: null, error: denied }),
      revert: () => { list = reinsertAt(list, removed, 1) },
      onError: error => showToast('error', mapWriteError(error, t, 'study_error_delete')),
    })

    expect(ok).toBe(false)
    expect(list.map(c => c.id)).toEqual(['a', 'b', 'c'])
    expect(list[1]).toBe(removed) // mesma referencia: nada foi reconstruido
    expect(showToast).toHaveBeenCalledWith('error', 'Você não tem permissão para fazer isso.')
  })

  it('mantem o estado otimista e nunca reverte quando o write passa', async () => {
    let list = [card('a'), card('b')]
    const revert = vi.fn()

    const ok = await runOptimistic({
      apply: () => { list = list.filter(c => c.id !== 'b') },
      write: async () => ({ data: [{ id: 'b' }], error: null }),
      revert,
    })

    expect(ok).toBe(true)
    expect(revert).not.toHaveBeenCalled()
    expect(list.map(c => c.id)).toEqual(['a'])
  })

  it('reverte tambem quando o thenable rejeita (rede caiu)', async () => {
    const revert = vi.fn()
    const messages: string[] = []

    const ok = await runOptimistic({
      apply: () => {},
      write: () => Promise.reject(new TypeError('Failed to fetch')),
      revert,
      onError: error => messages.push(mapWriteError(error, t, 'study_error_delete')),
    })

    expect(ok).toBe(false)
    expect(revert).toHaveBeenCalledOnce()
    expect(messages).toEqual(['Falha de rede. Verifique sua conexão e tente novamente.'])
  })

  it('trata um array de writes como falho se QUALQUER um falhou', async () => {
    const revert = vi.fn()
    const ok = await runOptimistic({
      apply: () => {},
      write: async () => [{ data: [{ id: 'a' }], error: null }, { data: null, error: denied }],
      revert,
    })
    expect(ok).toBe(false)
    expect(revert).toHaveBeenCalledOnce()
  })

  it('so chama onError depois do revert, para o toast nunca preceder o estado', async () => {
    const order: string[] = []
    await runOptimistic({
      apply: () => order.push('apply'),
      write: async () => ({ data: null, error: denied }),
      revert: () => { order.push('revert') },
      onError: () => order.push('onError'),
    })
    expect(order).toEqual(['apply', 'revert', 'onError'])
  })
})

describe('runGuarded', () => {
  it('devolve os dados em sucesso e nao reporta nada', async () => {
    const onError = vi.fn()
    const res = await runGuarded(async () => ({ data: { id: 'x' }, error: null }), { onError })
    expect(res).toEqual({ ok: true, data: { id: 'x' } })
    expect(onError).not.toHaveBeenCalled()
  })

  it('normaliza a falha e reporta', async () => {
    const onError = vi.fn()
    const res = await runGuarded(async () => ({ data: null, error: denied }), { onError })
    expect(res.ok).toBe(false)
    expect(onError).toHaveBeenCalledWith(denied)
  })

  it('converte um throw em WriteError em vez de propagar', async () => {
    const res = await runGuarded(() => Promise.reject(new Error('boom')))
    expect(res).toEqual({ ok: false, error: { message: 'boom' } })
  })
})

describe('requireRows', () => {
  it('trata write de 0 linhas (RLS) como falha', () => {
    expect(requireRows({ data: [], error: null }).error?.code).toBe('PGRST_NO_ROWS')
  })

  it('passa direto quando alguma linha foi escrita', () => {
    expect(requireRows({ data: [{ id: 'x' }], error: null }).error).toBeNull()
  })

  it('preserva o erro original em vez de mascarar com PGRST_NO_ROWS', () => {
    expect(requireRows<{ id: string }>({ data: null, error: denied }).error).toBe(denied)
  })
})

describe('revertFields + fieldsUnchanged', () => {
  it('restaura os campos que este write tocou', () => {
    const list = [card('c1', { title: 'v1', updated_at: 'T1' })]
    const out = revertFields(list, 'c1', { title: 'v0', updated_at: 'T0' })
    expect(out[0].title).toBe('v0')
    expect(out).not.toBe(list)
  })

  it('nao desfaz uma edicao mais nova que pousou durante o write', () => {
    // updateCard('c1', {title:'v1'}) em voo; o usuario digitou 'v2' no meio.
    const applied = { title: 'v1', updated_at: 'T1' }
    const list = [card('c1', { title: 'v2', updated_at: 'T2' })]
    const out = revertFields(list, 'c1', { title: 'v0', updated_at: 'T0' }, {
      onlyIf: current => fieldsUnchanged(current, applied),
    })
    expect(out).toBe(list) // mesma referencia: no-op
    expect(out[0].title).toBe('v2')
  })

  it('devolve a mesma lista quando o id ja nao existe', () => {
    const list = [card('a')]
    expect(revertFields(list, 'sumiu', { title: 'x' })).toBe(list)
  })

  it('compara campos de array por referencia', () => {
    const checkpoints = [{ id: 'p1' }]
    const current = card('c1', { checkpoints })
    expect(fieldsUnchanged(current, { checkpoints })).toBe(true)
    expect(fieldsUnchanged(current, { checkpoints: [{ id: 'p1' }] })).toBe(false)
  })
})

describe('reinsertAt', () => {
  it('recoloca no indice original', () => {
    expect(reinsertAt([card('a'), card('c')], card('b'), 1).map(c => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('e idempotente — nao ressuscita nem duplica um id que ja voltou', () => {
    const list = [card('a')]
    expect(reinsertAt(list, card('a'), 0)).toBe(list)
  })

  it('grampeia indices fora da faixa em vez de abrir buracos', () => {
    expect(reinsertAt([card('a')], card('z'), 99).map(c => c.id)).toEqual(['a', 'z'])
    expect(reinsertAt([card('a')], card('z'), -5).map(c => c.id)).toEqual(['z', 'a'])
  })
})

describe('pickFields', () => {
  it('copia so as chaves do shape, mais os extras', () => {
    const source = card('c1', { title: 'v1', due_date: '2026-03-01' })
    expect(pickFields(source, { title: 'novo' }, ['updated_at'])).toEqual({
      title: 'v1',
      updated_at: '2026-01-01T00:00:00.000Z',
    })
  })

  it('ignora chaves do shape que a linha nao tem', () => {
    expect(pickFields(card('c1'), { inexistente: 1 })).toEqual({})
  })
})

describe('findInGroups', () => {
  const groups = { t1: [card('a'), card('b')], t2: [card('c')] }

  it('devolve grupo, indice e linha', () => {
    expect(findInGroups(groups, 'c')).toEqual({ groupId: 't2', index: 0, row: groups.t2[0] })
    expect(findInGroups(groups, 'b')?.index).toBe(1)
  })

  it('devolve null quando o id nao esta em nenhum grupo', () => {
    expect(findInGroups(groups, 'zzz')).toBeNull()
  })
})

describe('firstError', () => {
  it('devolve o primeiro erro do lote, ou null', () => {
    expect(firstError([{ error: null }, { error: denied }, { error: null }])).toBe(denied)
    expect(firstError([{ error: null }])).toBeNull()
  })
})

describe('mapWriteError', () => {
  it('reconhece falta de permissao por codigo e por mensagem', () => {
    const permission = 'Você não tem permissão para fazer isso.'
    expect(mapWriteError(denied, t, 'study_error_generic')).toBe(permission)
    expect(mapWriteError({ message: 'x', code: 'PGRST_NO_ROWS' }, t, 'study_error_generic')).toBe(permission)
    expect(mapWriteError({ message: 'new row violates row-level security policy' }, t, 'study_error_generic')).toBe(permission)
  })

  it('reconhece falha de rede', () => {
    expect(mapWriteError({ message: 'TypeError: Failed to fetch' }, t, 'study_error_generic'))
      .toBe('Falha de rede. Verifique sua conexão e tente novamente.')
  })

  it('cai no fallback da operacao quando a causa nao e reconhecivel', () => {
    expect(mapWriteError({ message: 'duplicate key value', code: '23505' }, t, 'study_error_delete'))
      .toBe('Não foi possível excluir. Tente novamente.')
  })
})
