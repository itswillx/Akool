import type { ChangeEvent, KeyboardEvent, SyntheticEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { STUDY_RESOURCE_TITLE_MAX, STUDY_URL_MAX } from '../../lib/studyLimits'
import { avatarBg, createSaveGate, createSentField, formatDateISO, initialsOf, isUrlTooLong, normalizeUrl, resourceDraftAfterSave, resourceFromInput, withoutSavedLead } from './studyUi'

// API-021: a URL e o recurso que o card grava saem dentro da regra do servidor,
// e o campo de adicionar só limpa depois de gravar.

describe('normalizeUrl', () => {
  it('mantém http(s) e completa domínio sem esquema com https://', () => {
    expect(normalizeUrl('  https://example.com/a  ')).toBe('https://example.com/a')
    expect(normalizeUrl('HTTP://Example.com')).toBe('HTTP://Example.com')
    expect(normalizeUrl('docs.rs/tokio')).toBe('https://docs.rs/tokio')
  })

  it('recusa vazio, outro esquema e texto que não é endereço', () => {
    expect(normalizeUrl('   ')).toBeNull()
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('ftp://a.b')).toBeNull()
    expect(normalizeUrl('só texto')).toBeNull()
  })

  it('recusa o que o servidor recusaria: espaço no meio, controle, "https://" vazio, mais de 2048', () => {
    expect(normalizeUrl('https://a.com/x y')).toBeNull()
    expect(normalizeUrl('a.com/x y')).toBeNull()
    expect(normalizeUrl('https://a.com/\u0007')).toBeNull()
    expect(normalizeUrl('https://')).toBeNull()
    const base = 'https://a.b/'
    expect(normalizeUrl(base + 'x'.repeat(STUDY_URL_MAX - base.length))).not.toBeNull()
    expect(normalizeUrl(base + 'x'.repeat(STUDY_URL_MAX - base.length + 1))).toBeNull()
    // Sem esquema, o https:// acrescentado também conta.
    expect(normalizeUrl('a.b/' + 'x'.repeat(STUDY_URL_MAX - 4))).toBeNull()
  })
})

describe('resourceFromInput', () => {
  it('título digitado ou derivado da URL sem o esquema', () => {
    expect(resourceFromInput('  Docs ', 'https://example.com')).toEqual({ title: 'Docs', url: 'https://example.com' })
    expect(resourceFromInput('', 'example.com/x')).toEqual({ title: 'example.com/x', url: 'https://example.com/x' })
  })

  it('URL inválida não vira recurso', () => {
    expect(resourceFromInput('Docs', 'https://a b')).toBeNull()
  })

  it('URL de 2048 dá título dentro do teto, e título longo é cortado', () => {
    const url = 'https://a.b/' + 'x'.repeat(STUDY_URL_MAX - 12)
    expect(resourceFromInput('', url)?.title).toBe(url.slice(8))
    expect(resourceFromInput('t'.repeat(STUDY_RESOURCE_TITLE_MAX + 5), 'https://a.b')?.title).toHaveLength(STUDY_RESOURCE_TITLE_MAX)
  })
})

describe('isUrlTooLong', () => {
  it('conta o https:// que o domínio sem esquema ganha, e campo vazio não avisa', () => {
    const path = (n: number) => 'x'.repeat(n)
    expect(isUrlTooLong('https://a.b/' + path(STUDY_URL_MAX - 'https://a.b/'.length))).toBe(false)
    expect(isUrlTooLong('https://a.b/' + path(STUDY_URL_MAX - 'https://a.b/'.length + 1))).toBe(true)
    expect(isUrlTooLong('a.b/' + path(STUDY_URL_MAX - 'https://a.b/'.length))).toBe(false)
    expect(isUrlTooLong('a.b/' + path(STUDY_URL_MAX - 'https://a.b/'.length + 1))).toBe(true)
    expect(isUrlTooLong('   ')).toBe(false)
  })
})

describe('withoutSavedLead', () => {
  it('tira do começo o texto gravado e guarda o que foi digitado depois', () => {
    expect(withoutSavedLead('Primeiro', 'Primeiro')).toBe('')
    expect(withoutSavedLead('PrimeiroSegundo', 'Primeiro')).toBe('Segundo')
    expect(withoutSavedLead('  Primeiro  Segundo', 'Primeiro')).toBe('Segundo')
    expect(withoutSavedLead('Outro', 'Primeiro')).toBe('Outro')
    expect(withoutSavedLead('', 'Primeiro')).toBe('')
  })

  it('formulário de recurso: guarda o próximo recurso digitado e só fecha vazio', () => {
    const sent = () => ({ title: createSentField().track(' Docs '), url: createSentField().track('https://a.example') })
    expect(resourceDraftAfterSave({ title: ' Docs ', url: 'https://a.example' }, sent())).toBeNull()
    expect(resourceDraftAfterSave({ title: 'Docs', url: 'https://b.example' }, sent())).toEqual({ title: '', url: 'https://b.example' })
    expect(resourceDraftAfterSave({ title: 'Outro', url: 'https://a.example' }, sent())).toEqual({ title: 'Outro', url: '' })
    expect(resourceDraftAfterSave(null, sent())).toBeNull()
  })

  it('formulário de recurso: cada campo decide sozinho se foi substituído (R4)', () => {
    const title = createSentField()
    const url = createSentField()
    const marks = { title: title.track('Docs'), url: url.track('https://a.example') }
    url.watch('https://a.example', vi.fn()).onPaste(selection(0, 17))
    expect(resourceDraftAfterSave({ title: 'Docs', url: 'https://a.example/avancado' }, marks)).toEqual({ title: '', url: 'https://a.example/avancado' })
  })
})

// Evento com a seleção de antes da edição, como o navegador entrega.
const selection = (start: number, end = start) =>
  ({ currentTarget: { selectionStart: start, selectionEnd: end } }) as unknown as SyntheticEvent<HTMLInputElement>
const keyDown = (key: string, start: number, end = start, mods: { altKey?: boolean } = {}) =>
  ({ key, altKey: false, ctrlKey: false, metaKey: false, ...mods, preventDefault: vi.fn(), currentTarget: { selectionStart: start, selectionEnd: end } }) as unknown as KeyboardEvent<HTMLInputElement>
const change = (value: string) => ({ target: { value } }) as ChangeEvent<HTMLInputElement>

describe('createSentField (R4: limpar só o campo que ficou intacto)', () => {
  it('digitar no fim durante a gravação: o texto gravado sai e o novo fica', () => {
    const field = createSentField()
    const onValue = vi.fn()
    const sent = field.track('Primeiro')
    const watch = field.watch('Primeiro', onValue)
    watch.onBeforeInput(selection(8))
    watch.onPaste(selection(8))
    watch.onChange(change('PrimeiroSegundo'))
    expect(onValue).toHaveBeenCalledWith('PrimeiroSegundo')
    expect(sent.after('PrimeiroSegundo')).toBe('Segundo')
  })

  it('selecionar tudo e colar ou digitar algo que começa igual: o campo fica inteiro', () => {
    const point = createSentField()
    const sentPoint = point.track('Capítulo 1')
    point.watch('Capítulo 1', vi.fn()).onPaste(selection(0, 10))
    expect(sentPoint.after('Capítulo 10')).toBe('Capítulo 10')

    const url = createSentField()
    const sentUrl = url.track('https://docs.python.org/3/')
    url.watch('https://docs.python.org/3/', vi.fn()).onBeforeInput(selection(0, 26))
    expect(sentUrl.after('https://docs.python.org/3/library.html')).toBe('https://docs.python.org/3/library.html')

    const composing = createSentField()
    const sentComposing = composing.track('A')
    composing.watch('A', vi.fn()).onCompositionStart(selection(0, 1))
    expect(sentComposing.after('AB')).toBe('AB')
  })

  it('a troca de valor que passa pelo texto enviado também marca (digitar por cima, desfazer, teclado do celular)', () => {
    const field = createSentField()
    const sent = field.track('Docs')
    field.watch('Docs', vi.fn()).onChange(change('D'))
    expect(sent.after('Docs avançado')).toBe('Docs avançado')
    // Acrescentar no fim não marca.
    const other = createSentField()
    const kept = other.track('Docs')
    other.watch('Docs', vi.fn()).onChange(change('Docs '))
    expect(kept.after('Docs avançado')).toBe('avançado')
  })

  it('Backspace e Delete: marca só quando apagam dentro do texto enviado', () => {
    const cases: [KeyboardEvent<HTMLInputElement>, boolean][] = [
      [keyDown('Backspace', 10), true], // caret depois do '1' de 'Capítulo 1' (campo 'Capítulo 11')
      [keyDown('Backspace', 11), false], // apaga o '1' digitado depois
      [keyDown('Delete', 9), true],
      [keyDown('Delete', 10), false],
      [keyDown('Backspace', 0), false],
      [keyDown('Delete', 3, 11), true], // seleção que cobre parte do texto enviado
      [keyDown('Backspace', 10, 11), false],
      [keyDown('Backspace', 10, 10, { altKey: true }), false], // apagar palavra: a troca de valor decide
      [keyDown('a', 0), false],
    ]
    for (const [event, replaced] of cases) {
      const field = createSentField()
      const sent = field.track('Capítulo 1')
      field.watch('Capítulo 11', vi.fn()).onKeyDown(event)
      expect(sent.after('Capítulo 10'), `${event.key} ${event.currentTarget.selectionStart}`).toBe(replaced ? 'Capítulo 10' : '0')
    }
  })

  it('recortar sem seleção não marca; soltar texto marca', () => {
    const field = createSentField()
    const sent = field.track('Docs')
    field.watch('Docs', vi.fn()).onCut(selection(2))
    expect(sent.after('Docs x')).toBe('x')
    field.watch('Docs', vi.fn()).onCut(selection(0, 2))
    expect(sent.after('Docs x')).toBe('Docs x')
    const dropped = createSentField()
    const sentDropped = dropped.track('Docs')
    dropped.watch('Docs', vi.fn()).onDrop()
    expect(sentDropped.after('Docs x')).toBe('Docs x')
  })

  it('espaço no fim do enviado não conta como texto gravado', () => {
    const field = createSentField()
    const sent = field.track(' Primeiro ')
    field.watch(' Primeiro ', vi.fn()).onKeyDown(keyDown('Backspace', 10))
    expect(sent.after(' PrimeiroSegundo')).toBe('Segundo')
  })

  it('Enter envia quando há onEnter; as marcas morrem no fim da gravação', () => {
    const field = createSentField()
    const onEnter = vi.fn()
    const enter = keyDown('Enter', 0)
    field.watch('x', vi.fn(), onEnter).onKeyDown(enter)
    expect(onEnter).toHaveBeenCalledTimes(1)
    expect(enter.preventDefault).toHaveBeenCalled()
    field.watch('x', vi.fn()).onKeyDown(keyDown('Enter', 0))
    expect(onEnter).toHaveBeenCalledTimes(1)

    const first = field.track('Primeiro')
    field.watch('Primeiro', vi.fn()).onPaste(selection(0, 8))
    first.end()
    expect(first.after('Primeiro novo')).toBe('Primeiro novo')
    // A gravação seguinte começa sem a marca da anterior, e edição fora de gravação não marca nada.
    field.watch('', vi.fn()).onPaste(selection(0))
    const second = field.track('Segundo')
    field.watch('Segundo', vi.fn()).onBeforeInput(selection(7))
    expect(second.after('SegundoTerceiro')).toBe('Terceiro')
    second.end()
  })
})

describe('createSaveGate', () => {
  it('gravou: limpa o campo', async () => {
    const gate = createSaveGate()
    const clear = vi.fn()
    await expect(gate('k', () => Promise.resolve(true), clear)).resolves.toBe(true)
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('recusado (false): o texto fica no campo', async () => {
    const gate = createSaveGate()
    const clear = vi.fn()
    await expect(gate('k', () => Promise.resolve(false), clear)).resolves.toBe(false)
    expect(clear).not.toHaveBeenCalled()
  })

  it('exceção conta como recusa, sem promessa rejeitada solta', async () => {
    const gate = createSaveGate()
    const clear = vi.fn()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(gate('k', () => Promise.reject(new Error('rede')), clear)).resolves.toBe(false)
    expect(clear).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it('quem não devolve nada (onUpdate antigo) conta como gravado', async () => {
    const gate = createSaveGate()
    const clear = vi.fn()
    await expect(gate('k', () => undefined, clear)).resolves.toBe(true)
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('a mesma chave não sai de novo enquanto grava (Enter seguido de blur)', async () => {
    const gate = createSaveGate()
    let finish: (ok: boolean) => void = () => {}
    const save = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
    const first = gate('point:Ler', save, () => {})
    await expect(gate('point:Ler', save, () => {})).resolves.toBe(false)
    expect(save).toHaveBeenCalledTimes(1)
    finish(true)
    await expect(first).resolves.toBe(true)
    // Terminou: a mesma chave pode sair de novo.
    await expect(gate('point:Ler', () => true, () => {})).resolves.toBe(true)
  })
})

describe('helpers de tela', () => {
  it('data local sem passar por new Date()', () => {
    expect(formatDateISO('2026-10-07', 'pt-BR')).toBe('07/10/2026')
    expect(formatDateISO('2026-10-07', 'en')).toBe('10/07/2026')
    expect(formatDateISO('x', 'pt-BR')).toBe('x')
  })

  it('iniciais e cor do avatar', () => {
    expect(initialsOf('  ')).toBe('?')
    expect(initialsOf('rust')).toBe('RU')
    expect(initialsOf('Go lang')).toBe('GL')
    expect(avatarBg('Rust')).toBe(avatarBg('Rust'))
    expect(avatarBg('Rust')).toMatch(/^var\(--sticky-[a-z]+-bg\)$/)
  })
})
