import { describe, expect, it } from 'vitest'
import { classifySupabaseError, mapSupabaseError } from './supabaseErrors'
import { getT } from '../i18n/translations'

const t = getT('pt-BR')

describe('classifySupabaseError (ARCH-003)', () => {
  it.each([
    [{ code: '42501', message: 'x' }, 'permission'],
    [{ code: 'PGRST_NO_ROWS', message: 'No rows affected' }, 'permission'],
    [{ message: 'new row violates row-level security policy for table "pages"' }, 'permission'],
    [{ code: 'PGRST301', message: 'JWT expired' }, 'session'],
    [{ message: 'invalid JWT: unable to parse' }, 'session'],
    [{ message: 'TypeError: Failed to fetch' }, 'network'],
    [{ code: '23505', message: 'duplicate key value violates unique constraint' }, 'duplicate'],
    [{ code: '23503', message: 'insert or update violates foreign key constraint' }, 'reference'],
    [{ code: '23514', message: 'violates check constraint' }, 'invalid'],
    [{ code: '22P02', message: 'invalid input syntax for type uuid' }, 'invalid'],
    [{ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, 'not_found'],
    [{ code: '57014', message: 'canceling statement due to statement timeout' }, 'timeout'],
    [{ code: 'XX000', message: 'internal error' }, 'unknown'],
    [null, 'unknown'],
  ] as const)('%o → %s', (error, kind) => {
    expect(classifySupabaseError(error)).toBe(kind)
  })
})

describe('mapSupabaseError', () => {
  it('gives the reason when it is recognizable, with the code', () => {
    expect(mapSupabaseError({ code: '23505', message: 'dup' }, t, 'toast_error_save')).toEqual({
      kind: 'duplicate', code: '23505', message: 'Isso já existe.',
    })
  })

  it('falls back to the operation message otherwise', () => {
    expect(mapSupabaseError({ code: 'XX000', message: '?' }, t, 'toast_error_delete').message)
      .toBe('Não foi possível excluir. Tente novamente.')
  })

  it('speaks the reader language', () => {
    const en = mapSupabaseError({ code: '57014', message: 'timeout' }, getT('en'), 'toast_error_save')
    // O dicionário em inglês baixa sob demanda; sem ele, o getT cai no pt-BR.
    expect(['The server took too long to respond. Try again.', 'O servidor demorou demais para responder. Tente de novo.']).toContain(en.message)
  })
})
