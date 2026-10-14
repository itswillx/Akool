import { describe, expect, it } from 'vitest'
import harness from '../../../supabase/checks/api024-study-rpcs.sql?raw'
import { resourceFromInput } from './studyUi'

// API-024: o study_resource_add normaliza a URL e o título como a tela (URL e
// título aparados, https:// no domínio sem esquema, título vazio vira a URL
// sem o esquema). Os vetores do harness (supabase/checks/api024-study-rpcs.sql,
// `url_vec`: [url digitada, título digitado, url gravada, título gravado], null
// = recusa) rodam contra a RPC no staging e aqui contra o resourceFromInput:
// mudar um lado sem o outro quebra.

type UrlVector = [url: string, title: string, savedUrl: string | null, savedTitle: string | null]

function urlVectors(): UrlVector[] {
  const marker = "url_vec jsonb := '"
  const start = harness.indexOf(marker)
  expect(start).toBeGreaterThan(-1)
  return JSON.parse(harness.slice(start + marker.length, harness.indexOf("';", start))) as UrlVector[]
}

describe('resourceFromInput × study_resource_add (vetores do harness do API-024)', () => {
  const vectors = urlVectors()

  it('tem aceites e recusas, com espaços do trim do JS nas bordas', () => {
    expect(vectors.filter(([, , saved]) => saved !== null).length).toBeGreaterThanOrEqual(5)
    expect(vectors.filter(([, , saved]) => saved === null).length).toBeGreaterThanOrEqual(5)
    expect(vectors.some(([url]) => url !== url.trim() && url.trim() !== url.replace(/^ +| +$/g, ''))).toBe(true)
  })

  it.each(vectors)('%j', (url, title, savedUrl, savedTitle) => {
    expect(resourceFromInput(title, url)).toEqual(savedUrl === null ? null : { url: savedUrl, title: savedTitle })
  })
})
