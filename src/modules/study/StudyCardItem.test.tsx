// @vitest-environment happy-dom
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, userEvent } from '../../test/rtl'
import type { StudyCard } from '../../types'
import StudyCardItem from './StudyCardItem'
import type { StudyFieldOutcome } from './studyMutations'
import type { StudyCardOps } from './useStudyTopics'

// API-021: o servidor passou a recusar o que sai da forma. O card limpa os
// campos de adicionar só depois de gravar (antes, uma recusa revertia o item e
// o texto digitado se perdia), tirando do campo só o que foi gravado (o que a
// pessoa digitou durante a gravação fica), não manda o mesmo ponto duas vezes,
// não deixa digitar além dos limites do servidor e avisa da URL longa demais em
// vez de cortá-la. API-029: as listas vão item a item pelas `ops` (RPCs), com
// o id do item novo estável por rascunho; o título segue o servidor sem foco.

vi.mock('../../i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key, lang: 'pt-BR' }) }))

const card: StudyCard = {
  id: 'c1', user_id: 'u1', topic_id: 't1', title: 'Card', description: '', rationale: '',
  checkpoints: [{ id: 'p1', text: 'Ler', completed: false }], resources: [], quiz: [],
  sort_order: 0, due_date: null, created_at: '', updated_at: '',
}

type AddCheckpoint = StudyCardOps['addCheckpoint']
type AddResource = StudyCardOps['addResource']

function makeOps(overrides: Partial<StudyCardOps> = {}): StudyCardOps {
  return {
    addCheckpoint: vi.fn<AddCheckpoint>(() => Promise.resolve(true)),
    editCheckpoint: vi.fn(() => Promise.resolve(true)),
    toggleCheckpoint: vi.fn(() => Promise.resolve(true)),
    addResource: vi.fn<AddResource>(() => Promise.resolve(true)),
    removeResource: vi.fn(() => Promise.resolve(true)),
    answerQuiz: vi.fn(() => Promise.resolve(true)),
    resetQuiz: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  }
}

type OnUpdate = ComponentProps<typeof StudyCardItem>['onUpdate']

function renderCard(ops: StudyCardOps = makeOps(), extra: { onUpdate?: OnUpdate; card?: StudyCard; listsDisabled?: boolean } = {}) {
  const onUpdate = extra.onUpdate ?? vi.fn()
  const view = render(
    <StudyCardItem card={extra.card ?? card} onUpdate={onUpdate} ops={ops} listsDisabled={extra.listsDisabled} onRequestDelete={vi.fn()} onRequestRemoveCheckpoint={vi.fn()} />,
  )
  return { ...view, onUpdate, ops }
}

const flush = () => act(async () => { await Promise.resolve() })

// Gravação que só termina quando o teste manda.
function pendingSave() {
  let finish: (ok: boolean) => void = () => {}
  const save = () => new Promise<boolean>(resolve => { finish = resolve })
  const addCheckpoint = vi.fn<AddCheckpoint>(save)
  const addResource = vi.fn<AddResource>(save)
  return {
    ops: makeOps({ addCheckpoint, addResource }),
    addCheckpoint,
    addResource,
    finish: async (ok: boolean) => { await act(async () => { finish(ok); await Promise.resolve() }) },
  }
}

describe('StudyCardItem: novo ponto de estudo', () => {
  it('recusado pelo servidor: o texto continua no campo, e Enter seguido de blur grava uma vez só', async () => {
    const addCheckpoint = vi.fn<AddCheckpoint>(() => Promise.resolve(false))
    renderCard(makeOps({ addCheckpoint }))
    const input = screen.getByPlaceholderText<HTMLInputElement>('study_add_checkpoint_placeholder')
    fireEvent.change(input, { target: { value: 'Novo ponto' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
    await flush()
    expect(addCheckpoint).toHaveBeenCalledTimes(1)
    expect(addCheckpoint.mock.calls[0]).toEqual(['Novo ponto', expect.any(String)])
    expect(input.value).toBe('Novo ponto')
  })

  it('gravado: o campo limpa', async () => {
    renderCard()
    const input = screen.getByPlaceholderText<HTMLInputElement>('study_add_checkpoint_placeholder')
    fireEvent.change(input, { target: { value: 'Outro' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await flush()
    expect(input.value).toBe('')
  })

  it('digitar durante a gravação: o próximo ponto não gruda no anterior', async () => {
    const save = pendingSave()
    renderCard(save.ops)
    const input = screen.getByPlaceholderText<HTMLInputElement>('study_add_checkpoint_placeholder')
    fireEvent.change(input, { target: { value: 'Primeiro' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: 'PrimeiroSegundo' } })
    await save.finish(true)
    expect(input.value).toBe('Segundo')
    expect(save.addCheckpoint).toHaveBeenCalledTimes(1)
  })

  it('digitar durante a gravação que falha: o campo fica como a pessoa deixou', async () => {
    const save = pendingSave()
    renderCard(save.ops)
    const input = screen.getByPlaceholderText<HTMLInputElement>('study_add_checkpoint_placeholder')
    fireEvent.change(input, { target: { value: 'Primeiro' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: 'Primeiro ponto' } })
    await save.finish(false)
    expect(input.value).toBe('Primeiro ponto')
  })

  it('não passa do limite do servidor no texto e na nota', () => {
    renderCard()
    expect(screen.getByPlaceholderText<HTMLInputElement>('study_add_checkpoint_placeholder').maxLength).toBe(2000)
    fireEvent.click(screen.getByText('Ler'))
    expect(screen.getByDisplayValue<HTMLTextAreaElement>('Ler').maxLength).toBe(2000)
    fireEvent.click(screen.getByTitle('study_checkpoint_note_add'))
    expect(screen.getByPlaceholderText<HTMLTextAreaElement>('study_checkpoint_note_placeholder').maxLength).toBe(5000)
  })
})

describe('StudyCardItem: novo recurso', () => {
  const openForm = () => fireEvent.click(screen.getByRole('button', { name: 'study_add_resource' }))

  it('URL com espaço deixa o botão desabilitado (o servidor recusaria)', () => {
    renderCard()
    openForm()
    const url = screen.getByPlaceholderText<HTMLInputElement>('study_resource_url_placeholder')
    expect(screen.getByPlaceholderText<HTMLInputElement>('study_resource_title_placeholder').maxLength).toBe(2048)
    fireEvent.change(url, { target: { value: 'https://exemplo.com/a b' } })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'study_add_resource' }).disabled).toBe(true)
    fireEvent.change(url, { target: { value: 'https://' } })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'study_add_resource' }).disabled).toBe(true)
  })

  it('domínio sem esquema vira https:// e o título vem da URL; recusado, o formulário fica preenchido', async () => {
    const addResource = vi.fn<AddResource>(() => Promise.resolve(false))
    renderCard(makeOps({ addResource }))
    openForm()
    const url = screen.getByPlaceholderText<HTMLInputElement>('study_resource_url_placeholder')
    fireEvent.change(url, { target: { value: 'docs.rs' } })
    fireEvent.click(screen.getByRole('button', { name: 'study_add_resource' }))
    await flush()
    expect(addResource.mock.calls[0][0]).toEqual(expect.objectContaining({ title: 'docs.rs', url: 'https://docs.rs' }))
    expect(typeof addResource.mock.calls[0][0].id).toBe('string')
    expect(screen.getByPlaceholderText<HTMLInputElement>('study_resource_url_placeholder').value).toBe('docs.rs')
  })

  it('URL com 2100 caracteres: fica inteira no campo, com aviso, e o botão desabilitado', () => {
    renderCard()
    openForm()
    const url = screen.getByPlaceholderText<HTMLInputElement>('study_resource_url_placeholder')
    expect(url.hasAttribute('maxlength')).toBe(false)
    const long = `https://exemplo.com/${'x'.repeat(2100 - 'https://exemplo.com/'.length)}`
    fireEvent.change(url, { target: { value: long } })
    expect(url.value).toHaveLength(2100)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'study_add_resource' }).disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toBe('study_resource_url_too_long')
    expect(url.getAttribute('aria-invalid')).toBe('true')
    // Domínio sem esquema: conta o https:// que o app põe.
    fireEvent.change(url, { target: { value: `exemplo.com/${'x'.repeat(2048 - 'https://exemplo.com/'.length)}` } })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'study_add_resource' }).disabled).toBe(false)
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.change(url, { target: { value: `exemplo.com/${'x'.repeat(2049 - 'https://exemplo.com/'.length)}` } })
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('digitar o próximo recurso durante a gravação: ele fica no formulário, que continua aberto', async () => {
    const save = pendingSave()
    renderCard(save.ops)
    openForm()
    const title = screen.getByPlaceholderText<HTMLInputElement>('study_resource_title_placeholder')
    const url = screen.getByPlaceholderText<HTMLInputElement>('study_resource_url_placeholder')
    fireEvent.change(title, { target: { value: 'Docs' } })
    fireEvent.change(url, { target: { value: 'https://a.example' } })
    fireEvent.keyDown(url, { key: 'Enter' })
    fireEvent.change(url, { target: { value: 'https://b.example' } })
    await save.finish(true)
    expect(save.addResource.mock.calls[0]).toEqual([expect.objectContaining({ title: 'Docs', url: 'https://a.example' })])
    expect(screen.getByPlaceholderText<HTMLInputElement>('study_resource_url_placeholder').value).toBe('https://b.example')
    // O título era do recurso gravado.
    expect(screen.getByPlaceholderText<HTMLInputElement>('study_resource_title_placeholder').value).toBe('')
  })

  it('gravado: o formulário fecha', async () => {
    renderCard()
    openForm()
    fireEvent.change(screen.getByPlaceholderText('study_resource_url_placeholder'), { target: { value: 'https://example.com' } })
    fireEvent.keyDown(screen.getByPlaceholderText('study_resource_url_placeholder'), { key: 'Enter' })
    await flush()
    expect(screen.queryByPlaceholderText('study_resource_url_placeholder')).toBeNull()
  })
})

// R4 (segunda revisão do API-021): durante a gravação o campo ainda mostra o
// texto enviado. Quem seleciona tudo e cola ou digita por cima algo que começa
// igual não pode ter o começo cortado na limpeza ('Capítulo 10' virava '0', e
// 'https://docs.python.org/3/library.html' virava 'library.html', que o
// normalizeUrl aceitava como https://library.html).
describe('StudyCardItem: edição por cima do texto que está gravando', () => {
  const selectAll = (input: HTMLInputElement) => { input.setSelectionRange(0, input.value.length) }

  it('ponto: "Capítulo 1" → selecionar tudo e colar "Capítulo 10" fica inteiro, e Enter grava "Capítulo 10"', async () => {
    const user = userEvent.setup()
    const save = pendingSave()
    renderCard(save.ops)
    const input = screen.getByPlaceholderText<HTMLInputElement>('study_add_checkpoint_placeholder')
    await user.type(input, 'Capítulo 1{Enter}')
    selectAll(input)
    await user.paste('Capítulo 10')
    await save.finish(true)
    expect(input.value).toBe('Capítulo 10')
    await user.keyboard('{Enter}')
    expect(save.addCheckpoint.mock.calls.at(-1)).toEqual(['Capítulo 10', expect.any(String)])
  })

  it('ponto: "Capítulo 1" → selecionar tudo e digitar "Capítulo 10" fica inteiro', async () => {
    const user = userEvent.setup()
    const save = pendingSave()
    renderCard(save.ops)
    const input = screen.getByPlaceholderText<HTMLInputElement>('study_add_checkpoint_placeholder')
    await user.type(input, 'Capítulo 1{Enter}')
    await user.type(input, 'Capítulo 10', { initialSelectionStart: 0, initialSelectionEnd: input.value.length })
    await save.finish(true)
    expect(input.value).toBe('Capítulo 10')
  })

  it('ponto: apagar dentro do texto enviado (Backspace) e redigitar o fim fica inteiro', async () => {
    const user = userEvent.setup()
    const save = pendingSave()
    renderCard(save.ops)
    const input = screen.getByPlaceholderText<HTMLInputElement>('study_add_checkpoint_placeholder')
    await user.type(input, 'Capítulo 1{Enter}')
    await user.type(input, '1')
    // Caret entre os dois '1': o Backspace apaga o '1' que estava gravando.
    await user.type(input, '{Backspace}', { initialSelectionStart: 10, initialSelectionEnd: 10 })
    await user.type(input, '0')
    expect(input.value).toBe('Capítulo 10')
    await save.finish(true)
    expect(input.value).toBe('Capítulo 10')
  })

  it('ponto: digitar no fim continua tirando só o que gravou ("PrimeiroSegundo" → "Segundo")', async () => {
    const user = userEvent.setup()
    const save = pendingSave()
    renderCard(save.ops)
    const input = screen.getByPlaceholderText<HTMLInputElement>('study_add_checkpoint_placeholder')
    await user.type(input, 'Primeiro{Enter}')
    await user.type(input, 'Segundo')
    await user.paste(' e mais')
    await save.finish(true)
    expect(input.value).toBe('Segundo e mais')
  })

  it('URL: https://docs.python.org/3/ → colar .../3/library.html por cima fica inteira, e grava essa URL', async () => {
    const user = userEvent.setup()
    const save = pendingSave()
    renderCard(save.ops)
    await user.click(screen.getByRole('button', { name: 'study_add_resource' }))
    const url = screen.getByPlaceholderText<HTMLInputElement>('study_resource_url_placeholder')
    await user.type(url, 'https://docs.python.org/3/{Enter}')
    selectAll(url)
    await user.paste('https://docs.python.org/3/library.html')
    await save.finish(true)
    expect(url.value).toBe('https://docs.python.org/3/library.html')
    await user.click(screen.getByRole('button', { name: 'study_add_resource' }))
    expect(save.addResource.mock.calls.at(-1)).toEqual([expect.objectContaining({ title: 'docs.python.org/3/library.html', url: 'https://docs.python.org/3/library.html' })])
  })

  it('título e URL: "Docs" → "Docs avançado" digitado por cima e a URL colada por cima ficam inteiros', async () => {
    const user = userEvent.setup()
    const save = pendingSave()
    renderCard(save.ops)
    await user.click(screen.getByRole('button', { name: 'study_add_resource' }))
    const title = screen.getByPlaceholderText<HTMLInputElement>('study_resource_title_placeholder')
    const url = screen.getByPlaceholderText<HTMLInputElement>('study_resource_url_placeholder')
    await user.type(title, 'Docs')
    await user.type(url, 'https://a.example{Enter}')
    await user.type(title, 'Docs avançado', { initialSelectionStart: 0, initialSelectionEnd: 4 })
    await user.click(url)
    selectAll(url)
    await user.paste('https://a.example/avancado')
    await save.finish(true)
    expect(save.addResource.mock.calls[0]).toEqual([expect.objectContaining({ title: 'Docs', url: 'https://a.example' })])
    expect(title.value).toBe('Docs avançado')
    expect(url.value).toBe('https://a.example/avancado')
  })
})

// API-029: o id do item novo é estável por rascunho (o reenvio depois de uma
// falha não duplica) e o título acompanha o servidor sem pisar no rascunho.
describe('StudyCardItem: ops por item (API-029)', () => {
  it('reenvio do mesmo ponto depois de uma falha leva o mesmo id; depois de gravar, o mesmo texto é outro ponto', async () => {
    const addCheckpoint = vi.fn<AddCheckpoint>().mockResolvedValueOnce(false).mockResolvedValue(true)
    renderCard(makeOps({ addCheckpoint }))
    const input = screen.getByPlaceholderText<HTMLInputElement>('study_add_checkpoint_placeholder')
    const send = async (text: string) => {
      fireEvent.change(input, { target: { value: text } })
      fireEvent.keyDown(input, { key: 'Enter' })
      await flush()
    }
    await send('Ler o cap. 1')
    expect(input.value).toBe('Ler o cap. 1')
    await send('Ler o cap. 1')
    expect(input.value).toBe('')
    await send('Ler o cap. 1')
    const ids = addCheckpoint.mock.calls.map(([, id]) => id)
    expect(ids[0]).toBe(ids[1])
    expect(ids[2]).not.toBe(ids[0])
  })

  it('o mesmo vale para o recurso', async () => {
    const addResource = vi.fn<AddResource>().mockResolvedValueOnce(false).mockResolvedValue(true)
    renderCard(makeOps({ addResource }))
    fireEvent.click(screen.getByRole('button', { name: 'study_add_resource' }))
    const url = screen.getByPlaceholderText<HTMLInputElement>('study_resource_url_placeholder')
    fireEvent.change(url, { target: { value: 'https://a.example' } })
    fireEvent.keyDown(url, { key: 'Enter' })
    await flush()
    fireEvent.keyDown(url, { key: 'Enter' })
    await flush()
    expect(addResource.mock.calls[0][0].id).toBe(addResource.mock.calls[1][0].id)
  })

  it('marcar, editar texto e nota, tirar recurso e responder o quiz vão pelas ops', async () => {
    const ops = makeOps()
    const quizCard: StudyCard = {
      ...card,
      resources: [{ id: 'r1', title: 'Docs', url: 'https://docs.rs' }],
      quiz: [{ id: 'q1', statement: 'Afirmação', answer: 'certo', userAnswer: null }],
    }
    renderCard(ops, { card: quizCard })
    fireEvent.click(screen.getByRole('checkbox'))
    expect(ops.toggleCheckpoint).toHaveBeenCalledWith('p1')
    fireEvent.click(screen.getByText('Ler'))
    const text = screen.getByDisplayValue<HTMLTextAreaElement>('Ler')
    fireEvent.change(text, { target: { value: 'Ler tudo' } })
    fireEvent.blur(text)
    expect(ops.editCheckpoint).toHaveBeenCalledWith('p1', { text: 'Ler tudo' })
    fireEvent.click(screen.getByTitle('study_checkpoint_note_add'))
    const note = screen.getByPlaceholderText<HTMLTextAreaElement>('study_checkpoint_note_placeholder')
    fireEvent.change(note, { target: { value: ' nota ' } })
    fireEvent.blur(note)
    expect(ops.editCheckpoint).toHaveBeenCalledWith('p1', { note: 'nota' })
    fireEvent.click(screen.getByRole('button', { name: 'a11y_remove_resource' }))
    expect(ops.removeResource).toHaveBeenCalledWith('r1')
    fireEvent.click(screen.getByText('study_quiz'))
    fireEvent.click(screen.getByRole('button', { name: 'study_quiz_false' }))
    expect(ops.answerQuiz).toHaveBeenCalledWith('q1', 'errado')
  })

  it('reiniciar o quiz (todas ou só as erradas) vai pelas ops', () => {
    const ops = makeOps()
    const answered: StudyCard = {
      ...card,
      quiz: [
        { id: 'q1', statement: 'A', answer: 'certo', userAnswer: 'errado' },
        { kind: 'choice', id: 'q2', statement: 'B', options: ['x', 'y'], answer: 1, userAnswer: 1 },
      ],
    }
    renderCard(ops, { card: answered })
    fireEvent.click(screen.getByText('study_quiz'))
    fireEvent.click(screen.getByText('study_quiz_retry_wrong'))
    fireEvent.click(screen.getByText('study_quiz_retry'))
    expect(ops.resetQuiz).toHaveBeenNthCalledWith(1, true)
    expect(ops.resetQuiz).toHaveBeenNthCalledWith(2, false)
    // Respondida não responde de novo.
    fireEvent.click(screen.getByRole('button', { name: 'study_quiz_true' }))
    expect(ops.answerQuiz).not.toHaveBeenCalled()
  })

  it('servidor sem as RPCs: listas só para ler', () => {
    const ops = makeOps()
    renderCard(ops, { card: { ...card, quiz: [{ id: 'q1', statement: 'A', answer: 'certo', userAnswer: null }] }, listsDisabled: true })
    expect(screen.getByRole<HTMLInputElement>('checkbox').disabled).toBe(true)
    expect(screen.getByPlaceholderText<HTMLInputElement>('study_add_checkpoint_placeholder').disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'study_add_resource' })).toBeNull()
    expect(screen.queryByTitle('study_checkpoint_note_add')).toBeNull()
    fireEvent.click(screen.getByText('Ler'))
    expect(screen.queryByDisplayValue('Ler')).toBeNull()
    fireEvent.click(screen.getByText('study_quiz'))
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'study_quiz_true' }).disabled).toBe(true)
  })

  it('título: segue o servidor sem foco, guarda o rascunho com foco e grava com a base do foco', () => {
    const onUpdate = vi.fn()
    const { rerender } = renderCard(makeOps(), { onUpdate })
    const input = screen.getByPlaceholderText<HTMLInputElement>('study_card_title_placeholder')
    const show = (title: string) => rerender(
      <StudyCardItem card={{ ...card, title }} onUpdate={onUpdate} ops={makeOps()} onRequestDelete={vi.fn()} onRequestRemoveCheckpoint={vi.fn()} />,
    )
    // O refetch trouxe o título de outra aba: sem foco, o campo mostra.
    show('Da outra aba')
    expect(input.value).toBe('Da outra aba')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Meu título ' } })
    // Outro refetch no meio da digitação não pisa no rascunho.
    show('Mais uma')
    expect(input.value).toBe('Meu título ')
    fireEvent.blur(input)
    expect(onUpdate).toHaveBeenCalledWith({ title: 'Meu título' }, { title: 'Da outra aba' })
    // Foco e blur sem mudar nada não gravam.
    fireEvent.focus(input)
    fireEvent.blur(input)
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  // Revisão do lote 06 (#6): o rascunho sumia quando a gravação falhava.
  describe('título: o rascunho depois da gravação', () => {
    // Gravações que só terminam quando o teste manda, na ordem em que saíram.
    function pendingUpdates() {
      const finish: ((outcome: StudyFieldOutcome) => void)[] = []
      const onUpdate = vi.fn<OnUpdate>(() => new Promise<StudyFieldOutcome>(resolve => { finish.push(resolve) }))
      const end = async (i: number, outcome: StudyFieldOutcome) => { await act(async () => { finish[i](outcome); await Promise.resolve() }) }
      return { onUpdate, end }
    }
    const setup = (onUpdate: OnUpdate) => {
      const view = renderCard(makeOps(), { onUpdate })
      const input = screen.getByPlaceholderText<HTMLInputElement>('study_card_title_placeholder')
      // O card na tela (o hook mostra o valor pendente por cima do servidor).
      const show = (title: string) => view.rerender(
        <StudyCardItem card={{ ...card, title }} onUpdate={onUpdate} ops={makeOps()} onRequestDelete={vi.fn()} onRequestRemoveCheckpoint={vi.fn()} />,
      )
      const type = (value: string) => {
        fireEvent.focus(input)
        fireEvent.change(input, { target: { value } })
        fireEvent.blur(input)
      }
      return { input, show, type }
    }

    it('falhou: o texto fica no campo sem foco (o refetch não pisa nele), e a próxima saída tenta de novo com a mesma base', async () => {
      const updates = pendingUpdates()
      const { input, show, type } = setup(updates.onUpdate)
      type('Meu título')
      show('Meu título')
      await updates.end(0, 'failed')
      show('Card')
      expect(input.value).toBe('Meu título')
      show('Da outra aba')
      expect(input.value).toBe('Meu título')
      fireEvent.focus(input)
      fireEvent.blur(input)
      expect(updates.onUpdate).toHaveBeenCalledTimes(2)
      expect(updates.onUpdate).toHaveBeenLastCalledWith({ title: 'Meu título' }, { title: 'Card' })
      await updates.end(1, 'saved')
      show('Meu título')
      expect(input.value).toBe('Meu título')
    })

    it('conflito: o rascunho não volta (o servidor vence; o aviso traz "Copiar meu texto")', async () => {
      const updates = pendingUpdates()
      const { input, show, type } = setup(updates.onUpdate)
      type('Meu título')
      await updates.end(0, 'conflict')
      show('Deles')
      expect(input.value).toBe('Deles')
    })

    it('só a última gravação devolve o rascunho: a anterior que falha com a seguinte enviada não volta o texto velho', async () => {
      const updates = pendingUpdates()
      const { input, show, type } = setup(updates.onUpdate)
      type('A2')
      show('A2')
      type('A3')
      expect(updates.onUpdate).toHaveBeenLastCalledWith({ title: 'A3' }, { title: 'A2' })
      show('A3')
      await updates.end(0, 'failed')
      expect(input.value).toBe('A3')
      await updates.end(1, 'saved')
      expect(input.value).toBe('A3')
    })

    it('de volta ao campo com a gravação em voo: se ela falha, a base passa a ser a de antes dela', async () => {
      const updates = pendingUpdates()
      const { input, show, type } = setup(updates.onUpdate)
      type('A2')
      show('A2')
      // Foca de novo: a base é o que a tela mostra, o valor que ainda grava.
      fireEvent.focus(input)
      await updates.end(0, 'failed')
      show('Card')
      expect(input.value).toBe('A2')
      // Sair sem mexer grava 'A2' com a base de antes da falha.
      fireEvent.blur(input)
      expect(updates.onUpdate).toHaveBeenCalledTimes(2)
      expect(updates.onUpdate).toHaveBeenLastCalledWith({ title: 'A2' }, { title: 'Card' })
    })

    // 2ª revisão do lote 06 (#1): a saída que não grava contava como envio, e
    // a falha da gravação em voo deixava de devolver o rascunho.
    it('entrar e sair sem mudar com a gravação em voo não conta como envio: na falha, o texto volta', async () => {
      const updates = pendingUpdates()
      const { input, show, type } = setup(updates.onUpdate)
      type('A2')
      show('A2')
      fireEvent.focus(input)
      fireEvent.blur(input)
      expect(updates.onUpdate).toHaveBeenCalledTimes(1)
      await updates.end(0, 'failed')
      show('Card')
      expect(input.value).toBe('A2')
      // A próxima saída grava de novo, com a base de antes da falha.
      fireEvent.focus(input)
      fireEvent.blur(input)
      expect(updates.onUpdate).toHaveBeenCalledTimes(2)
      expect(updates.onUpdate).toHaveBeenLastCalledWith({ title: 'A2' }, { title: 'Card' })
    })

    it('entrar e sair sem mudar, e voltar ao campo antes da falha: a base vira a de antes e a saída grava', async () => {
      const updates = pendingUpdates()
      const { input, show, type } = setup(updates.onUpdate)
      type('A2')
      show('A2')
      fireEvent.focus(input)
      fireEvent.blur(input)
      fireEvent.focus(input)
      await updates.end(0, 'failed')
      show('Card')
      expect(input.value).toBe('A2')
      fireEvent.blur(input)
      expect(updates.onUpdate).toHaveBeenCalledTimes(2)
      expect(updates.onUpdate).toHaveBeenLastCalledWith({ title: 'A2' }, { title: 'Card' })
    })
  })

  it('descrição: grava com a base de quando abriu, mesmo que o card mude enquanto está aberta', () => {
    const onUpdate = vi.fn()
    const { rerender } = renderCard(makeOps(), { onUpdate, card: { ...card, description: 'Antes' } })
    fireEvent.click(screen.getByText('study_card_edit_description'))
    rerender(<StudyCardItem card={{ ...card, description: 'Mudou lá' }} onUpdate={onUpdate} ops={makeOps()} onRequestDelete={vi.fn()} onRequestRemoveCheckpoint={vi.fn()} />)
    const area = screen.getByPlaceholderText<HTMLTextAreaElement>('study_card_description_placeholder')
    expect(area.value).toBe('Antes')
    fireEvent.change(area, { target: { value: 'Minha' } })
    fireEvent.blur(area)
    expect(onUpdate).toHaveBeenCalledWith({ description: 'Minha' }, { description: 'Antes' })
  })

  it('prazo: gravado no onChange, sem base (a última gravação vale)', () => {
    const onUpdate = vi.fn()
    renderCard(makeOps(), { onUpdate })
    fireEvent.click(screen.getByTitle('study_card_due_set'))
    const date = document.querySelector<HTMLInputElement>('input[type="date"]')!
    fireEvent.change(date, { target: { value: '2026-11-01' } })
    expect(onUpdate).toHaveBeenCalledWith({ due_date: '2026-11-01' })
  })
})
