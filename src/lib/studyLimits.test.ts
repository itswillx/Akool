import { describe, expect, it } from 'vitest'
import migration from '../../supabase/migrations/20261008130000_api021_study_rules.sql?raw'
import {
  cutText,
  isSafeStudyUrl,
  STUDY_BLOCKS_MAX,
  STUDY_CHECKPOINT_NOTE_MAX,
  STUDY_CHECKPOINT_TEXT_MAX,
  STUDY_CHECKPOINTS_MAX,
  STUDY_EXPLANATION_MAX,
  STUDY_ID_MAX,
  STUDY_JSON_MAX_BYTES,
  STUDY_OPTION_MAX,
  STUDY_OPTIONS_MAX,
  STUDY_OPTIONS_MIN,
  STUDY_QUIZ_MAX,
  STUDY_RESOURCE_TITLE_MAX,
  STUDY_RESOURCES_MAX,
  STUDY_STATEMENT_MAX,
  STUDY_URL_MAX,
  studyJsonBytes,
} from './studyLimits'

// API-021: os limites do app são os do gatilho study_cards_rules, conferidos
// contra o texto da própria migration (mudar um lado sem o outro quebra aqui).

/** Corpo de uma função da migration, para procurar o número no lugar certo. */
function sqlBody(name: string): string {
  const start = migration.indexOf(`create function private.${name}(`)
  expect(start, name).toBeGreaterThan(-1)
  return migration.slice(start, migration.indexOf('$$;', migration.indexOf('as $$', start)))
}

describe('studyLimits: os mesmos números do servidor', () => {
  it('pontos de estudo', () => {
    const body = sqlBody('study_checkpoints_problem')
    expect(body).toContain(`jsonb_array_length(p_items) > ${STUDY_CHECKPOINTS_MAX} then`)
    expect(body).toContain(`length(v_item ->> 'text') > ${STUDY_CHECKPOINT_TEXT_MAX} then`)
    expect(body).toContain(`length(v_item ->> 'note') > ${STUDY_CHECKPOINT_NOTE_MAX})`)
    expect(body).toContain(`length(v_item ->> 'id') not between 1 and ${STUDY_ID_MAX}`)
    expect(body).toContain(`octet_length(p_items::text) > ${STUDY_JSON_MAX_BYTES} then`)
  })

  it('recursos', () => {
    const body = sqlBody('study_resources_problem')
    expect(body).toContain(`jsonb_array_length(p_items) > ${STUDY_RESOURCES_MAX} then`)
    expect(body).toContain(`length(v_item ->> 'title') > ${STUDY_RESOURCE_TITLE_MAX} then`)
    expect(body).toContain(`length(v_item ->> 'url') > ${STUDY_URL_MAX}`)
    expect(body).toContain(`length(v_item ->> 'licenseUrl') > ${STUDY_URL_MAX}`)
    expect(body).toContain(`octet_length(p_items::text) > ${STUDY_JSON_MAX_BYTES} then`)
  })

  it('quiz', () => {
    const body = sqlBody('study_quiz_problem')
    expect(body).toContain(`jsonb_array_length(p_items) > ${STUDY_QUIZ_MAX} then`)
    expect(body).toContain(`length(v_item ->> 'statement') > ${STUDY_STATEMENT_MAX} then`)
    expect(body).toContain(`length(v_item ->> 'explanation') > ${STUDY_EXPLANATION_MAX} then`)
    expect(body).toContain(`v_n not between ${STUDY_OPTIONS_MIN} and ${STUDY_OPTIONS_MAX} then`)
    expect(body).toContain(`length(o #>> '{}') > ${STUDY_OPTION_MAX})`)
  })

  it('blocos', () => {
    expect(sqlBody('study_blocks_problem')).toContain(`jsonb_array_length(p_items) > ${STUDY_BLOCKS_MAX} then`)
  })

  it('URL: a regex do servidor é a do SEC-010', () => {
    expect(sqlBody('study_resources_problem')).toContain(`!~* '^https?://[^[:space:][:cntrl:]]+$'`)
  })
})

describe('isSafeStudyUrl', () => {
  it('aceita http(s) em qualquer caixa', () => {
    expect(isSafeStudyUrl('https://example.com/a?b=1#c')).toBe(true)
    expect(isSafeStudyUrl('http://example.com')).toBe(true)
    expect(isSafeStudyUrl('HTTPS://OK.EXAMPLE')).toBe(true)
  })

  it('recusa outro esquema, "https://" vazio, espaço e caractere de controle ou invisível', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'ftp://a.b', 'https://', 'https://a b.com',
      'https://a.b/\tx', 'https://a.b/\u0001', 'https://a.b/​x', 'https://a.b/ ', ' https://a.b']) {
      expect(isSafeStudyUrl(url), url).toBe(false)
    }
  })

  it('até 2048 caracteres', () => {
    const base = 'https://a.b/'
    expect(isSafeStudyUrl(base + 'x'.repeat(STUDY_URL_MAX - base.length))).toBe(true)
    expect(isSafeStudyUrl(base + 'x'.repeat(STUDY_URL_MAX - base.length + 1))).toBe(false)
  })
})

describe('cutText', () => {
  it('não mexe no que cabe e corta o que passa', () => {
    expect(cutText('abc', 3)).toBe('abc')
    expect(cutText('abcdef', 3)).toBe('abc')
  })

  it('não deixa meia letra no fim (o banco recusa surrogate solto)', () => {
    const cut = cutText('ab😀c', 3)
    expect(cut).toBe('ab')
    expect(cutText('ab😀c', 4)).toBe('ab😀')
  })
})

describe('studyJsonBytes', () => {
  // Valores medidos no staging com octet_length('<o mesmo JSON>'::jsonb::text).
  it('mede como o octet_length do jsonb em texto', () => {
    expect(studyJsonBytes([{ id: 'a', text: 'é\n\t"x"\\ \u0001 /   😀', completed: false, note: undefined }])).toBe(76)
    expect(studyJsonBytes([{ kind: 'choice', id: 'q', statement: 's', options: ['a', 'b'], answer: 1, userAnswer: null, explanation: 'Desde 1960.' }])).toBe(135)
    expect(studyJsonBytes([])).toBe(2)
    expect(studyJsonBytes([{ id: 'r', title: '', url: 'https://a.b', license: null }])).toBe(65)
  })

  it('undefined numa lista vira null, como no JSON', () => {
    expect(studyJsonBytes([undefined, 1])).toBe('[null, 1]'.length)
  })
})
