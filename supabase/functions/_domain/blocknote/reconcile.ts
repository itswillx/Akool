// API-023: reconciliação da regravação em Markdown (decisão 1 do plano). Cada
// bloco raiz da nota atual tem a sua projeção: os blocos que o Markdown dele
// vira ao ser lido de volta (em geral um; o bloco que não é lista e tem filhos
// vira ele mais os filhos achatados). Um diff linear sobre as chaves dessas
// projeções e as dos blocos raiz do Markdown novo decide o destino de cada
// bloco antigo:
// - projeção inteira igual e seguida → o bloco volta intacto (id, cores,
//   alinhamento, recolhível, filhos, larguras);
// - só a cabeça igual → o bloco volta sem os filhos (que vêm do Markdown, como
//   no marcador);
// - sem projeção (parágrafo vazio) → volta se os vizinhos voltaram intactos e
//   continuam lado a lado; o que não volta sozinho (bloco ilegível, sem
//   keepIfHidden) sai;
// - o resto sai, e os blocos do Markdown novo entram no lugar.
//
// O diff é o "patience": prefixo e sufixo comuns, âncoras com chave única nos
// dois lados (maior subsequência crescente, O(n log n)) e extensão em volta de
// cada âncora. Não acha sempre o diff mínimo, mas é linear (fora o log) e só
// deixa de preservar, nunca troca conteúdo.

/** Para cada índice de `a`, o índice casado em `b`, ou -1. Os pares são crescentes nos dois lados. */
export function diffKeys(a: readonly string[], b: readonly string[]): Int32Array {
  const match = new Int32Array(a.length).fill(-1)
  let lo = 0
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) {
    match[lo] = lo
    lo++
  }
  let hiA = a.length
  let hiB = b.length
  while (hiA > lo && hiB > lo && a[hiA - 1] === b[hiB - 1]) {
    match[hiA - 1] = hiB - 1
    hiA--
    hiB--
  }
  if (lo >= hiA || lo >= hiB) return match
  // Âncoras: chaves que aparecem uma vez só no meio de cada lado.
  const count = new Map<string, { a: number; b: number; ia: number; ib: number }>()
  for (let i = lo; i < hiA; i++) {
    const c = count.get(a[i])
    if (c) c.a++
    else count.set(a[i], { a: 1, b: 0, ia: i, ib: -1 })
  }
  for (let j = lo; j < hiB; j++) {
    const c = count.get(b[j])
    if (!c) continue
    c.b++
    c.ib = j
  }
  const pairs: [number, number][] = []
  for (let i = lo; i < hiA; i++) {
    const c = count.get(a[i]) as { a: number; b: number; ia: number; ib: number }
    if (c.a === 1 && c.b === 1) pairs.push([i, c.ib])
  }
  // Maior subsequência crescente em b (paciência com busca binária).
  const tails: number[] = []
  const prev = new Int32Array(pairs.length).fill(-1)
  for (let k = 0; k < pairs.length; k++) {
    let l = 0
    let h = tails.length
    while (l < h) {
      const mid = (l + h) >> 1
      if (pairs[tails[mid]][1] < pairs[k][1]) l = mid + 1
      else h = mid
    }
    if (l > 0) prev[k] = tails[l - 1]
    tails[l] = k
  }
  const chosen: number[] = []
  for (let k = tails.length > 0 ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) chosen.push(k)
  chosen.reverse()
  // Cada âncora, estendida para frente e para trás enquanto as chaves batem.
  let floorA = lo
  let floorB = lo
  for (let n = 0; n < chosen.length; n++) {
    const [ia, ib] = pairs[chosen[n]]
    match[ia] = ib
    let x = ia - 1
    let y = ib - 1
    while (x >= floorA && y >= floorB && match[x] === -1 && a[x] === b[y]) match[x--] = y--
    const capA = n + 1 < chosen.length ? pairs[chosen[n + 1]][0] : hiA
    const capB = n + 1 < chosen.length ? pairs[chosen[n + 1]][1] : hiB
    x = ia + 1
    y = ib + 1
    while (x < capA && y < capB && a[x] === b[y]) match[x++] = y++
    floorA = x
    floorB = y
  }
  return match
}

export interface OldGroup {
  /** Chaves da projeção do bloco antigo (vazio: o bloco não aparece no Markdown). */
  keys: readonly string[]
  /**
   * Sem projeção, o bloco pode voltar sozinho (passa no fatal; ex.: o
   * parágrafo vazio)? Sem a flag, ele sai: o ilegível, que a IA não vê, não
   * volta para travar a regravação.
   */
  keepIfHidden?: boolean
}

export type Slot =
  | { kind: 'old'; index: number; mode: 'intact' | 'head'; first: number }
  | { kind: 'new'; index: number }

export interface Reconciliation {
  slots: Slot[]
  /** Destino de cada bloco antigo: 'intact', 'head' ou 'gone'. */
  fate: ('intact' | 'head' | 'gone')[]
}

/**
 * Plano da nota final: a sequência de blocos antigos (inteiros ou só a
 * cabeça) e novos (índice no Markdown novo), na ordem do Markdown novo.
 */
export function reconcile(groups: readonly OldGroup[], newKeys: readonly string[]): Reconciliation {
  const oldKeys: string[] = []
  const firstToken: number[] = []
  for (const g of groups) {
    firstToken.push(oldKeys.length)
    for (const k of g.keys) oldKeys.push(k)
  }
  const match = diffKeys(oldKeys, newKeys)
  const fate: ('intact' | 'head' | 'gone')[] = groups.map(() => 'gone')
  const owner = new Int32Array(newKeys.length).fill(-1)
  groups.forEach((g, i) => {
    const t0 = firstToken[i]
    const m = g.keys.length
    if (m === 0) return
    const start = match[t0]
    if (start < 0) return
    let intact = true
    for (let k = 1; k < m && intact; k++) intact = match[t0 + k] === start + k
    fate[i] = intact ? 'intact' : 'head'
    owner[start] = i
  })
  // Sem projeção: volta se os vizinhos com projeção voltaram intactos e seguidos.
  const span = (i: number) => {
    const start = match[firstToken[i]]
    return { start, end: start + groups[i].keys.length - 1 }
  }
  // O próximo grupo com projeção, de cada um (uma passada de trás para frente).
  const nextFull = new Int32Array(groups.length)
  for (let i = groups.length - 1, next = groups.length; i >= 0; i--) {
    nextFull[i] = next
    if (groups[i].keys.length > 0) next = i
  }
  let prevFull = -1
  for (let i = 0; i < groups.length; i++) {
    if (groups[i].keys.length > 0) {
      prevFull = i
      continue
    }
    if (!groups[i].keepIfHidden) continue
    const next = nextFull[i]
    const prevOk = prevFull < 0 || fate[prevFull] === 'intact'
    const nextOk = next >= groups.length || fate[next] === 'intact'
    if (!prevOk || !nextOk) continue
    const left = prevFull < 0 ? -1 : span(prevFull).end
    const right = next >= groups.length ? newKeys.length : span(next).start
    if (left + 1 === right) fate[i] = 'intact'
  }
  const slots: Slot[] = []
  const placed = new Set<number>()
  // Blocos sem projeção que vão no começo, antes do primeiro bloco novo.
  const placeEmpty = (after: number) => {
    for (let i = after + 1; i < groups.length && groups[i].keys.length === 0; i++) {
      if (fate[i] === 'intact' && !placed.has(i)) {
        placed.add(i)
        slots.push({ kind: 'old', index: i, mode: 'intact', first: -1 })
      }
    }
  }
  placeEmpty(-1)
  for (let j = 0; j < newKeys.length; j++) {
    const i = owner[j]
    if (i < 0) {
      slots.push({ kind: 'new', index: j })
      continue
    }
    slots.push({ kind: 'old', index: i, mode: fate[i] === 'intact' ? 'intact' : 'head', first: j })
    if (fate[i] === 'intact') {
      j += groups[i].keys.length - 1
      placeEmpty(i)
    }
  }
  return { slots, fate }
}
