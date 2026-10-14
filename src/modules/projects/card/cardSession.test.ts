import { describe, expect, it, vi } from 'vitest'
import type { CardBase, CardFields } from '../../../lib/data/projects'
import type { ProjectCard, ProjectCardAttachment } from '../../../types'

// API-013: as decisões da edição de um card, sem React e sem rede.

vi.mock('../../../lib/supabase', () => ({ supabase: {} }))

const { cardFormFrom } = await import('./cardDraft')
const {
  absorbForeign, attachmentsFor, confirmAttachments, contestedKeys, foreignChanges, openEditor, planPatch, resolveChoice, userEdits,
} = await import('./cardSession')

const card = (extra: Partial<ProjectCard> = {}): ProjectCard => ({
  id: 'c1', board_id: 'b1', column_id: 'col1', title: 'Título', description: 'd', priority: 'medium',
  start_date: null, due_date: null, estimated_days: 1, assignee_user_id: null, labels: [], linked_page_id: null,
  parent_card_id: null, depends_on: [], completed: false, checklist: [], attachments: [], links: [],
  sort_order: 0, created_at: '', updated_at: 'v1', ...extra,
})
const fieldsOf = (c: ProjectCard): CardFields => ({
  title: c.title, description: c.description, priority: c.priority, start_date: c.start_date, due_date: c.due_date,
  estimated_days: c.estimated_days, assignee_user_id: c.assignee_user_id, labels: c.labels, linked_page_id: c.linked_page_id,
  parent_card_id: c.parent_card_id, depends_on: c.depends_on, completed: c.completed, checklist: c.checklist, links: c.links,
  attachments: c.attachments,
})
const base = (extra: Partial<ProjectCard> = {}, version = 'v1'): CardBase => ({ version, fields: fieldsOf(card(extra)) })
const att = (id: string): ProjectCardAttachment => ({ id, url: `u/${id}.png`, name: `${id}.png` })

describe('openEditor (abertura do modal)', () => {
  it('sem rascunho: o card do servidor, com a versão dele', () => {
    const s = openEditor(card(), null)
    expect(s).toMatchObject({ base: { version: 'v1' }, pending: false, removedAttachmentIds: [] })
    expect(s.form.title).toBe('Título')
  })

  it('rascunho com base e sem mudança pendente: abre o card como está (ninguém vê a versão velha)', () => {
    const s = openEditor(card({ description: 'de outra pessoa', updated_at: 'v5' }), {
      form: cardFormFrom(base().fields), savedAt: '', removedAttachmentIds: [], base: base(),
    })
    expect(s).toMatchObject({ pending: false, base: { version: 'v5' } })
    expect(s.form.description).toBe('de outra pessoa')
  })

  it('rascunho com mudança pendente: o formulário e a base do rascunho, para gravar ao montar', () => {
    const s = openEditor(card({ description: 'de outra pessoa', updated_at: 'v5' }), {
      form: { ...cardFormFrom(base().fields), title: 'Meu título' }, savedAt: '', removedAttachmentIds: [], base: base(),
    })
    expect(s).toMatchObject({ pending: true, base: { version: 'v1' } })
    expect(s.form.title).toBe('Meu título')
  })

  it('rascunho de antes do API-013 (sem base) é descartado', () => {
    const s = openEditor(card({ updated_at: 'v5' }), { form: { ...cardFormFrom(base().fields), title: 'velho' }, savedAt: '9999', removedAttachmentIds: [] })
    expect(s).toMatchObject({ pending: false, base: { version: 'v5' } })
    expect(s.form.title).toBe('Título')
  })

  it('sem permissão de editar: o card como está, mesmo com rascunho pendente', () => {
    const s = openEditor(card({ updated_at: 'v5' }), {
      form: { ...cardFormFrom(base().fields), title: 'Meu título' }, savedAt: '', removedAttachmentIds: [], base: base(),
    }, false)
    expect(s).toMatchObject({ pending: false, base: { version: 'v5' } })
    expect(s.form.title).toBe('Título')
  })

  it('rascunho só com imagens que subiram e não entraram: pendente, com elas', () => {
    const s = openEditor(card(), { form: cardFormFrom(base().fields), savedAt: '', removedAttachmentIds: [], base: base(), uploaded: [att('up')] })
    expect(s).toMatchObject({ pending: true, uploaded: [att('up')] })
  })

  it('card novo: o rascunho dele, sem base', () => {
    const s = openEditor(null, { form: { ...cardFormFrom(null), title: 'Novo' }, savedAt: '', removedAttachmentIds: [] })
    expect(s).toMatchObject({ base: null, pending: false })
    expect(s.form.title).toBe('Novo')
  })
})

describe('planPatch e attachmentsFor', () => {
  it('manda só o que difere da base', () => {
    const b = base()
    expect(planPatch(b, b, { ...cardFormFrom(b.fields), title: 'Novo' }, [], [])).toEqual({ title: 'Novo' })
    expect(planPatch(b, b, cardFormFrom(b.fields), [], [])).toEqual({})
  })

  it('depois de um refazer, só as mudanças da pessoa vão: o valor velho do formulário não desfaz a outra (A3)', () => {
    const editsBase = base()
    const current = base({ description: 'dela' }, 'v2')
    const sent = { ...cardFormFrom(editsBase.fields), title: 'Meu' }
    expect(planPatch(editsBase, current, sent, [], [])).toEqual({ title: 'Meu' })
    // Mudança que já está igual na versão nova não vai de novo.
    expect(planPatch(editsBase, base({ title: 'Meu' }, 'v2'), sent, [], [])).toEqual({})
  })

  it('anexos pela intenção: o que outra pessoa pôs fica; remover o que já sumiu não faz nada', () => {
    expect(attachmentsFor([att('a'), att('dela')], ['a', 'sumiu'], [att('meu')])).toEqual([att('dela'), att('meu')])
    // Formulário com a lista velha (sem o "dela"): a gravação não o apaga.
    const b = base({ attachments: [att('a'), att('dela')] })
    const form = { ...cardFormFrom(base({ attachments: [att('a')] }).fields) }
    expect(planPatch(b, b, form, [], [])).toEqual({})
    expect(planPatch(b, b, form, [], [att('meu')])).toEqual({ attachments: [att('a'), att('dela'), att('meu')] })
  })

  it('userEdits não conta anexos', () => {
    const b = base({ attachments: [att('a')] })
    expect(userEdits(b, { ...cardFormFrom(b.fields), attachments: [], title: 'x' })).toEqual({ title: 'x' })
  })
})

describe('disputa e mudanças da outra pessoa', () => {
  it('contestedKeys: outro campo, mesmo valor e valor diferente (A7)', () => {
    const b = fieldsOf(card())
    expect(contestedKeys(b, fieldsOf(card({ description: 'dela' })), { title: 'meu' })).toEqual([])
    expect(contestedKeys(b, fieldsOf(card({ completed: true })), { completed: true })).toEqual([])
    expect(contestedKeys(b, fieldsOf(card({ title: 'dela' })), { title: 'meu' })).toEqual(['title'])
  })

  it('foreignChanges deixa de fora os campos desta gravação e os anexos', () => {
    const current = fieldsOf(card({ title: 'meu', description: 'dela', attachments: [att('x')] }))
    expect(foreignChanges(fieldsOf(card()), current, { title: 'meu' })).toEqual({ description: 'dela' })
  })

  it('absorbForeign adota o campo que a pessoa não mexeu e acusa o que ela mexeu no meio (1e)', () => {
    const sent = cardFormFrom(fieldsOf(card()))
    const typed = { ...sent, description: 'digitei no meio' }
    expect(absorbForeign(sent, sent, { description: 'dela' })).toMatchObject({ form: { description: 'dela' }, contested: [] })
    expect(absorbForeign(typed, sent, { description: 'dela' })).toMatchObject({ form: { description: 'digitei no meio' }, contested: ['description'] })
    // Digitou o mesmo valor dela: nada em disputa.
    expect(absorbForeign({ ...sent, description: 'dela' }, sent, { description: 'dela' }).contested).toEqual([])
    // Datas vêm do banco como null e voltam ao formulário como vazio.
    expect(absorbForeign({ ...sent, due_date: '' }, { ...sent, due_date: '' }, { due_date: null }).form.due_date).toBe('')
  })

  it('confirmAttachments: remoção e pendente saem só quando a base confirma', () => {
    const pending = [{ id: 'p1', file: new Blob() as File, preview: 'x' }, { id: 'p2', file: new Blob() as File, preview: 'y' }]
    const uploads = new Map([['p1', att('up1')]])
    const r = confirmAttachments(fieldsOf(card({ attachments: [att('a'), att('up1')] })), ['a', 'b'], pending, uploads)
    expect(r.attachments.map(a => a.id)).toEqual(['a', 'up1'])
    expect(r.removedIds).toEqual(['a']) // 'b' já saiu da base; 'a' ainda está (remoção feita no meio)
    expect(r.pending.map(p => p.id)).toEqual(['p2'])
    expect(r.confirmed).toEqual(['p1'])
  })
})

describe('resolveChoice (escolha no aviso)', () => {
  const editsBase = base()
  const theirs = base({ title: 'Título dela', description: 'nota dela' }, 'v3')
  const form = { ...cardFormFrom(editsBase.fields), title: 'Meu título', priority: 'high' as const }

  it('"Manter a minha": a versão salva com tudo o que a pessoa mudou', () => {
    const r = resolveChoice('mine', { theirs, fields: ['title'], editsBase }, form)
    expect(r.form).toMatchObject({ title: 'Meu título', priority: 'high', description: 'nota dela' })
    expect(r.base.version).toBe('v3')
  })

  it('"Carregar a versão salva": só os campos em disputa voltam; as outras mudanças continuam (U9)', () => {
    const r = resolveChoice('theirs', { theirs, fields: ['title'], editsBase }, form)
    expect(r.form).toMatchObject({ title: 'Título dela', priority: 'high', description: 'nota dela' })
  })
})
