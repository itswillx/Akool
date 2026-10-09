// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, userEvent } from '../../test/rtl'
import type { StudyCard } from '../../types'
import StudyCardItem from './StudyCardItem'

// API-021: o servidor passou a recusar o que sai da forma. O card limpa os
// campos de adicionar só depois de gravar (antes, uma recusa revertia o item e
// o texto digitado se perdia), tirando do campo só o que foi gravado (o que a
// pessoa digitou durante a gravação fica), não manda o mesmo ponto duas vezes,
// não deixa digitar além dos limites do servidor e avisa da URL longa demais em
// vez de cortá-la.

vi.mock('../../i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key, lang: 'pt-BR' }) }))

const card: StudyCard = {
  id: 'c1', user_id: 'u1', topic_id: 't1', title: 'Card', description: '', rationale: '',
  checkpoints: [{ id: 'p1', text: 'Ler', completed: false }], resources: [], quiz: [],
  sort_order: 0, due_date: null, created_at: '', updated_at: '',
}

function renderCard(onUpdate: (patch: unknown) => unknown) {
  render(
    <StudyCardItem card={card} onUpdate={onUpdate} onToggleCheckpoint={vi.fn()} onRequestDelete={vi.fn()} onRequestRemoveCheckpoint={vi.fn()} />,
  )
}

const flush = () => act(async () => { await Promise.resolve() })

// Gravação que só termina quando o teste manda.
function pendingSave() {
  let finish: (ok: boolean) => void = () => {}
  const onUpdate = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
  return { onUpdate, finish: async (ok: boolean) => { await act(async () => { finish(ok); await Promise.resolve() }) } }
}

describe('StudyCardItem: novo ponto de estudo', () => {
  it('recusado pelo servidor: o texto continua no campo, e Enter seguido de blur grava uma vez só', async () => {
    const onUpdate = vi.fn<(patch: unknown) => Promise<boolean>>(() => Promise.resolve(false))
    renderCard(onUpdate)
    const input = screen.getByPlaceholderText<HTMLInputElement>('study_add_checkpoint_placeholder')
    fireEvent.change(input, { target: { value: 'Novo ponto' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
    await flush()
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate.mock.calls[0][0]).toEqual({ checkpoints: [card.checkpoints[0], expect.objectContaining({ text: 'Novo ponto', completed: false })] })
    expect(input.value).toBe('Novo ponto')
  })

  it('gravado: o campo limpa', async () => {
    const onUpdate = vi.fn(() => Promise.resolve(true))
    renderCard(onUpdate)
    const input = screen.getByPlaceholderText<HTMLInputElement>('study_add_checkpoint_placeholder')
    fireEvent.change(input, { target: { value: 'Outro' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await flush()
    expect(input.value).toBe('')
  })

  it('digitar durante a gravação: o próximo ponto não gruda no anterior', async () => {
    const save = pendingSave()
    renderCard(save.onUpdate)
    const input = screen.getByPlaceholderText<HTMLInputElement>('study_add_checkpoint_placeholder')
    fireEvent.change(input, { target: { value: 'Primeiro' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: 'PrimeiroSegundo' } })
    await save.finish(true)
    expect(input.value).toBe('Segundo')
    expect(save.onUpdate).toHaveBeenCalledTimes(1)
  })

  it('digitar durante a gravação que falha: o campo fica como a pessoa deixou', async () => {
    const save = pendingSave()
    renderCard(save.onUpdate)
    const input = screen.getByPlaceholderText<HTMLInputElement>('study_add_checkpoint_placeholder')
    fireEvent.change(input, { target: { value: 'Primeiro' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: 'Primeiro ponto' } })
    await save.finish(false)
    expect(input.value).toBe('Primeiro ponto')
  })

  it('não passa do limite do servidor no texto e na nota', () => {
    renderCard(vi.fn())
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
    renderCard(vi.fn())
    openForm()
    const url = screen.getByPlaceholderText<HTMLInputElement>('study_resource_url_placeholder')
    expect(screen.getByPlaceholderText<HTMLInputElement>('study_resource_title_placeholder').maxLength).toBe(2048)
    fireEvent.change(url, { target: { value: 'https://exemplo.com/a b' } })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'study_add_resource' }).disabled).toBe(true)
    fireEvent.change(url, { target: { value: 'https://' } })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'study_add_resource' }).disabled).toBe(true)
  })

  it('domínio sem esquema vira https:// e o título vem da URL; recusado, o formulário fica preenchido', async () => {
    const onUpdate = vi.fn<(patch: unknown) => Promise<boolean>>(() => Promise.resolve(false))
    renderCard(onUpdate)
    openForm()
    const url = screen.getByPlaceholderText<HTMLInputElement>('study_resource_url_placeholder')
    fireEvent.change(url, { target: { value: 'docs.rs' } })
    fireEvent.click(screen.getByRole('button', { name: 'study_add_resource' }))
    await flush()
    expect(onUpdate.mock.calls[0][0]).toEqual({ resources: [expect.objectContaining({ title: 'docs.rs', url: 'https://docs.rs' })] })
    expect(screen.getByPlaceholderText<HTMLInputElement>('study_resource_url_placeholder').value).toBe('docs.rs')
  })

  it('URL com 2100 caracteres: fica inteira no campo, com aviso, e o botão desabilitado', () => {
    renderCard(vi.fn())
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
    renderCard(save.onUpdate)
    openForm()
    const title = screen.getByPlaceholderText<HTMLInputElement>('study_resource_title_placeholder')
    const url = screen.getByPlaceholderText<HTMLInputElement>('study_resource_url_placeholder')
    fireEvent.change(title, { target: { value: 'Docs' } })
    fireEvent.change(url, { target: { value: 'https://a.example' } })
    fireEvent.keyDown(url, { key: 'Enter' })
    fireEvent.change(url, { target: { value: 'https://b.example' } })
    await save.finish(true)
    expect(save.onUpdate.mock.calls[0]).toEqual([{ resources: [expect.objectContaining({ title: 'Docs', url: 'https://a.example' })] }])
    expect(screen.getByPlaceholderText<HTMLInputElement>('study_resource_url_placeholder').value).toBe('https://b.example')
    // O título era do recurso gravado.
    expect(screen.getByPlaceholderText<HTMLInputElement>('study_resource_title_placeholder').value).toBe('')
  })

  it('gravado: o formulário fecha', async () => {
    renderCard(vi.fn(() => Promise.resolve(true)))
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
    renderCard(save.onUpdate)
    const input = screen.getByPlaceholderText<HTMLInputElement>('study_add_checkpoint_placeholder')
    await user.type(input, 'Capítulo 1{Enter}')
    selectAll(input)
    await user.paste('Capítulo 10')
    await save.finish(true)
    expect(input.value).toBe('Capítulo 10')
    await user.keyboard('{Enter}')
    expect(save.onUpdate.mock.calls.at(-1)).toEqual([{ checkpoints: [card.checkpoints[0], expect.objectContaining({ text: 'Capítulo 10' })] }])
  })

  it('ponto: "Capítulo 1" → selecionar tudo e digitar "Capítulo 10" fica inteiro', async () => {
    const user = userEvent.setup()
    const save = pendingSave()
    renderCard(save.onUpdate)
    const input = screen.getByPlaceholderText<HTMLInputElement>('study_add_checkpoint_placeholder')
    await user.type(input, 'Capítulo 1{Enter}')
    await user.type(input, 'Capítulo 10', { initialSelectionStart: 0, initialSelectionEnd: input.value.length })
    await save.finish(true)
    expect(input.value).toBe('Capítulo 10')
  })

  it('ponto: apagar dentro do texto enviado (Backspace) e redigitar o fim fica inteiro', async () => {
    const user = userEvent.setup()
    const save = pendingSave()
    renderCard(save.onUpdate)
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
    renderCard(save.onUpdate)
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
    renderCard(save.onUpdate)
    await user.click(screen.getByRole('button', { name: 'study_add_resource' }))
    const url = screen.getByPlaceholderText<HTMLInputElement>('study_resource_url_placeholder')
    await user.type(url, 'https://docs.python.org/3/{Enter}')
    selectAll(url)
    await user.paste('https://docs.python.org/3/library.html')
    await save.finish(true)
    expect(url.value).toBe('https://docs.python.org/3/library.html')
    await user.click(screen.getByRole('button', { name: 'study_add_resource' }))
    expect(save.onUpdate.mock.calls.at(-1)).toEqual([{ resources: [expect.objectContaining({ title: 'docs.python.org/3/library.html', url: 'https://docs.python.org/3/library.html' })] }])
  })

  it('título e URL: "Docs" → "Docs avançado" digitado por cima e a URL colada por cima ficam inteiros', async () => {
    const user = userEvent.setup()
    const save = pendingSave()
    renderCard(save.onUpdate)
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
    expect(save.onUpdate.mock.calls[0]).toEqual([{ resources: [expect.objectContaining({ title: 'Docs', url: 'https://a.example' })] }])
    expect(title.value).toBe('Docs avançado')
    expect(url.value).toBe('https://a.example/avancado')
  })
})
