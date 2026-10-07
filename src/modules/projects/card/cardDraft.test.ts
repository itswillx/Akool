// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Rascunho do card e estado do modal no sessionStorage, e o upload das imagens
// pendentes ao salvar (as inválidas ficam de fora; só falha se nenhuma subiu).

const storage = vi.hoisted(() => ({ uploads: [] as string[], failPaths: /$^/ }))
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: async (path: string) => {
          storage.uploads.push(path)
          return { error: storage.failPaths.test(path) ? { message: 'boom' } : null }
        },
      }),
    },
  },
}))

const {
  cardFormFrom, clearCardDraft, clearCardModalState, formFields, formPatchFrom, getDraftKey, loadCardDraft, loadCardModalState,
  persistCardAttachments, saveCardDraft, saveCardModalState,
} = await import('./cardDraft')
type CardForm = Parameters<typeof persistCardAttachments>[3]

const form = (attachments: CardForm['attachments'] = []): CardForm => ({
  title: 't', description: '', priority: 'medium', start_date: '', due_date: '', estimated_days: 1,
  assignee_user_id: null, labels: [], linked_page_id: null, parent_card_id: null, depends_on: [],
  completed: false, checklist: [], attachments, links: [],
})
const png = (name: string) => new File(['x'], name, { type: 'image/png' })

beforeEach(() => {
  sessionStorage.clear()
  storage.uploads = []
  storage.failPaths = /$^/
})

describe('rascunho do card', () => {
  it('a chave distingue quadro, card e coluna', () => {
    expect(getDraftKey('b1', 'c1')).not.toBe(getDraftKey('b1', 'c2'))
    expect(getDraftKey('b1', null, 'col')).not.toBe(getDraftKey('b1', null))
    expect(getDraftKey('b1', 'c1')).toBe(getDraftKey('b1', 'c1'))
  })

  it('grava, lê e apaga', () => {
    const key = getDraftKey('b1', 'c1')
    expect(loadCardDraft(key)).toBeNull()
    saveCardDraft(key, { form: form(), savedAt: '2026-10-01T10:00:00Z', removedAttachmentIds: ['a'] })
    expect(loadCardDraft(key)?.removedAttachmentIds).toEqual(['a'])
    clearCardDraft(key)
    expect(loadCardDraft(key)).toBeNull()
  })

  it('conteúdo corrompido lê como nulo', () => {
    const key = getDraftKey('b1', 'c1')
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

describe('persistCardAttachments', () => {
  it('sem pendentes, só remove os anexos marcados', async () => {
    const kept = { id: 'k', url: 'u/k', name: 'k.png' }
    const result = await persistCardAttachments('u', 'b', 'c', form([kept, { id: 'r', url: 'u/r', name: 'r.png' }]), { pendingFiles: [], removedAttachmentIds: ['r'] })
    expect(result).toEqual({ attachments: [kept], uploadedPendingIds: [] })
    expect(storage.uploads).toEqual([])
  })

  it('sobe as imagens válidas e ignora as inválidas', async () => {
    const result = await persistCardAttachments('u', 'b', 'c', form(), {
      pendingFiles: [
        { id: 'p1', file: png('a.png'), preview: '' },
        { id: 'p2', file: new File(['x'], 'a.txt', { type: 'text/plain' }), preview: '' },
      ],
      removedAttachmentIds: [],
    })
    expect(storage.uploads).toHaveLength(1)
    expect(storage.uploads[0]).toMatch(/^u\/b\/c\/\d+-p1\.png$/)
    expect(result.uploadedPendingIds).toEqual(['p1'])
    expect(result.attachments).toEqual([{ id: expect.any(String) as string, url: storage.uploads[0], name: 'a.png' }])
  })

  it('falha quando nenhuma imagem subiu', async () => {
    storage.failPaths = /./
    await expect(persistCardAttachments('u', 'b', 'c', form(), {
      pendingFiles: [{ id: 'p1', file: png('a.png'), preview: '' }], removedAttachmentIds: [],
    })).rejects.toThrow('upload_failed')
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
