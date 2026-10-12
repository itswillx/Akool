import { describe, expect, it } from 'vitest'
import migration from '../../supabase/migrations/20261008130000_api021_study_rules.sql?raw'
import migration024 from '../../supabase/migrations/20261011120000_api024_study_rpcs.sql?raw'
import {
  cutText,
  isSafeStudyUrl,
  STUDY_BLOCKS_MAX,
  STUDY_CHECKPOINT_NOTE_MAX,
  STUDY_CHECKPOINT_TEXT_MAX,
  STUDY_CHECKPOINTS_MAX,
  STUDY_EXPLANATION_MAX,
  STUDY_ID_MAX,
  STUDY_IMPORT_CARDS_MAX,
  STUDY_IMPORT_MAX_BYTES,
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

// API-024: as RPCs de Estudos (20261011120000_api024_study_rpcs.sql) com os
// mesmos números e o mesmo aparar do app.

const STUDY_RPCS = [
  'study_checkpoint_add', 'study_checkpoint_edit', 'study_checkpoint_toggle', 'study_checkpoint_remove',
  'study_resource_add', 'study_resource_remove', 'study_quiz_answer', 'study_quiz_reset',
  'study_cards_append', 'study_reschedule', 'study_import_topic',
]

/** Corpo de uma RPC da migration do API-024. */
function rpcBody(name: string): string {
  const start = migration024.indexOf(`create function public.${name}(`)
  expect(start, name).toBeGreaterThan(-1)
  return migration024.slice(start, migration024.indexOf('$$;', migration024.indexOf('as $$', start)))
}

/** Os caracteres (BMP) que o String.prototype.trim tira. */
function jsTrimSet(): number[] {
  const set: number[] = []
  for (let code = 0; code <= 0xffff; code++) {
    if (code >= 0xd800 && code <= 0xdfff) continue
    if (`${String.fromCharCode(code)}x`.trim() === 'x') set.push(code)
  }
  return set
}

describe('API-024: as RPCs de Estudos com os números do app', () => {
  it('as 11 RPCs estão na migration', () => {
    for (const name of STUDY_RPCS) rpcBody(name)
    expect(migration024.match(/^create function public\.study_/gm)).toHaveLength(STUDY_RPCS.length)
  })

  it('anexar e importar: até STUDY_IMPORT_CARDS_MAX cards e STUDY_IMPORT_MAX_BYTES por chamada', () => {
    const append = rpcBody('study_cards_append')
    expect(append).toContain(`jsonb_array_length(p_cards) not between 1 and ${STUDY_IMPORT_CARDS_MAX} then`)
    expect(append).toContain(`octet_length(p_cards::text) > ${STUDY_IMPORT_MAX_BYTES} then`)
    const importTopic = rpcBody('study_import_topic')
    expect(importTopic).toContain(`jsonb_array_length(v_cards) > ${STUDY_IMPORT_CARDS_MAX} then`)
    expect(importTopic).toContain(`octet_length(p_payload::text) > ${STUDY_IMPORT_MAX_BYTES} then`)
  })

  it('o título derivado da URL é cortado no teto do título do recurso', () => {
    expect(rpcBody('study_resource_add')).toContain(
      `v_title := left(regexp_replace(v_url, '^https?://', '', 'i'), ${STUDY_RESOURCE_TITLE_MAX});`,
    )
  })

  it('a regex de URL e o teto do id ficam só no gatilho do API-021 (nada copiado para derivar)', () => {
    for (const name of STUDY_RPCS) {
      const body = rpcBody(name)
      expect(body, name).not.toContain('[:cntrl:]')
      expect(body, name).not.toMatch(/length\(v_id\)|->> 'id'\) not between/)
    }
  })

  it('c_ws, o aparar das RPCs, tira os mesmos caracteres que o trim da tela', () => {
    const literals = [...migration024.matchAll(/c_ws\s+constant text := U&'([^']*)';/g)].map(match => match[1])
    expect(literals).toHaveLength(5)
    expect(new Set(literals).size).toBe(1)
    // Só escapes \XXXX no literal: nenhum caractere invisível cru no arquivo.
    expect(literals[0].replace(/\\[0-9a-f]{4}/g, '')).toBe('')
    const sqlSet = [...literals[0].matchAll(/\\([0-9a-f]{4})/g)].map(match => parseInt(match[1], 16))
    expect(sqlSet).toEqual(jsTrimSet())
  })

  it('todo btrim das RPCs usa c_ws (o btrim sem lista só tira o espaço)', () => {
    const calls = [...migration024.matchAll(/btrim\(((?:[^()]|\([^()]*\))*)\)/g)].map(match => match[1])
    expect(calls.length).toBeGreaterThan(0)
    for (const args of calls) expect(args).toMatch(/, c_ws$/)
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
      'https://a.b/\tx', 'https://a.b/\u0001', 'https://a.b/\u200bx', 'https://a.b/\u00a0', ' https://a.b']) {
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
