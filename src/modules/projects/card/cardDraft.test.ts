// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Rascunho do card e estado do modal no sessionStorage, e as imagens do card
// (uma a uma: o editor guarda o que subiu e apaga o que não entrou no card).

const storage = vi.hoisted(() => ({ uploads: [] as string[], removed: [] as string[][], failPaths: /$^/ }))
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: async (path: string) => {
          storage.uploads.push(path)
          return { error: storage.failPaths.test(path) ? { message: 'boom' } : null }
        },
        remove: async (paths: string[]) => {
          storage.removed.push(paths)
          return { error: null }
        },
      }),
    },
  },
}))

const {
  cardFormFrom, clearCardDraft, clearCardModalState, draftKeyFor, formFields, formPatchFrom, loadCardDraft, loadCardModalState,
  removeCardImages, saveCardDraft, saveCardModalState, uploadCardImage,
} = await import('./cardDraft')
type CardForm = ReturnType<typeof cardFormFrom>

const form = (attachments: CardForm['attachments'] = []): CardForm => ({
  title: 't', description: '', priority: 'medium', start_date: '', due_date: '', estimated_days: 1,
  assignee_user_id: null, labels: [], linked_page_id: null, parent_card_id: null, depends_on: [],
  completed: false, checklist: [], attachments, links: [],
})
const png = (name: string) => new File(['x'], name, { type: 'image/png' })

beforeEach(() => {
  sessionStorage.clear()
  storage.uploads = []
  storage.removed = []
  storage.failPaths = /$^/
})

describe('rascunho do card', () => {
  it('a chave distingue quadro e card; a coluna só conta no card novo (API-013)', () => {
    expect(draftKeyFor('b1', 'c1')).not.toBe(draftKeyFor('b1', 'c2'))
    expect(draftKeyFor('b1', null, 'col')).not.toBe(draftKeyFor('b1', null))
    // O mesmo card aberto pela coluna ou pelo quadro é o mesmo rascunho.
    expect(draftKeyFor('b1', 'c1', 'col')).toBe(draftKeyFor('b1', 'c1'))
  })

  it('grava, lê e apaga', () => {
    const key = draftKeyFor('b1', 'c1')
    expect(loadCardDraft(key)).toBeNull()
    saveCardDraft(key, { form: form(), savedAt: '2026-10-01T10:00:00Z', removedAttachmentIds: ['a'] })
    expect(loadCardDraft(key)?.removedAttachmentIds).toEqual(['a'])
    clearCardDraft(key)
    expect(loadCardDraft(key)).toBeNull()
  })

  it('conteúdo corrompido lê como nulo', () => {
    const key = draftKeyFor('b1', 'c1')
    sessionStorage.setItem(key, '{nope')
    expect(loadCardDraft(key)).toBeNull()
  })
})

describe('estado do modal', () => {
  it('grava, lê e apaga', () => {
    expect(loadCardModalState()).toBeNull()
    saveCardModalState({ open: true, boardId: 'b1', cardId: null, columnId: 'col' })
    expect(loadCardModalState()).toEqual({ open: true, boardId: 'b1', cardId: null, columnId: 'col' })
    clearCardModalState()
    expect(loadCardModalState()).toBeNull()
  })
})

describe('imagens do card', () => {
  it('sobe para <quem envia>/<quadro>/<card>/ e devolve o anexo', async () => {
    const att = await uploadCardImage('u', 'b', 'c', { id: 'p1', file: png('a.png'), preview: '' })
    expect(storage.uploads).toHaveLength(1)
    expect(storage.uploads[0]).toMatch(/^u\/b\/c\/\d+-p1\.png$/)
    expect(att).toEqual({ id: expect.any(String) as string, url: storage.uploads[0], name: 'a.png' })
  })

  it('arquivo inválido ou falha no upload: null', async () => {
    expect(await uploadCardImage('u', 'b', 'c', { id: 'p2', file: new File(['x'], 'a.txt', { type: 'text/plain' }), preview: '' })).toBeNull()
    storage.failPaths = /./
    expect(await uploadCardImage('u', 'b', 'c', { id: 'p1', file: png('a.png'), preview: '' })).toBeNull()
  })

  it('apaga as que não entraram no card (nada a apagar não chama o storage)', async () => {
    await removeCardImages([])
    expect(storage.removed).toEqual([])
    await removeCardImages(['u/b/c/1-p1.png'])
    expect(storage.removed).toEqual([['u/b/c/1-p1.png']])
  })
})

// API-013: o formulário e os campos do banco são os mesmos, com duas
// diferenças (data vazia × null, título com espaço nas pontas). A versão
// compara os campos do banco, então a ida e a volta não podem inventar mudança.
describe('formulário ↔ campos do card', () => {
  it('formFields guarda como o banco: título sem pontas e data vazia como null', () => {
    const fields = formFields({ ...form(), title: '  Título  ', due_date: '2026-10-07' })
    expect(fields).toMatchObject({ title: 'Título', start_date: null, due_date: '2026-10-07' })
    expect(Object.keys(fields).sort()).toEqual(Object.keys(form()).sort())
  })

  it('ida e volta sem mudança', () => {
    const fields = formFields({ ...form(), start_date: '2026-10-01' })
    expect(formFields(cardFormFrom(fields))).toEqual(fields)
    expect(cardFormFrom(null)).toMatchObject({ title: '', priority: 'medium', estimated_days: 1, labels: [] })
  })

  it('formPatchFrom só converte as datas que vieram', () => {
    expect(formPatchFrom({ due_date: null, title: 'x' })).toEqual({ due_date: '', title: 'x' })
    expect(formPatchFrom({ labels: ['a'] })).toEqual({ labels: ['a'] })
  })
})
