// API-023: cortes de espaço e tab (códigos 32 e 9) por laço de índice, para o
// parser de Markdown ficar linear. Uma regex ancorada só no fim (/[ \t]+$/)
// é quadrática numa corrida longa de espaços no meio do texto: o V8 tenta casar
// em cada posição da corrida e vai até o fim dela antes de falhar. Nada de
// String.prototype.trim/trimEnd: eles também tiram NBSP, \n e os outros espaços
// Unicode, e isso mudaria o que o CommonMark considera texto.

function isSpaceTab(code: number): boolean {
  return code === 32 || code === 9
}

/** Índice logo depois do último caractere que não é espaço nem tab (0 se só há espaço e tab). */
function spaceTabEnd(s: string): number {
  let e = s.length
  while (e > 0 && isSpaceTab(s.charCodeAt(e - 1))) e--
  return e
}

/** `s` sem os espaços e tabs do fim (o mesmo que `s.replace(/[ \t]+$/, '')`). */
export function trimEndSpaceTab(s: string): string {
  const e = spaceTabEnd(s)
  return e === s.length ? s : s.slice(0, e)
}

/** `s` sem os espaços e tabs das duas bordas (o mesmo que `s.replace(/^[ \t]+|[ \t]+$/g, '')`). */
export function trimSpaceTab(s: string): string {
  const e = spaceTabEnd(s)
  let b = 0
  while (b < e && isSpaceTab(s.charCodeAt(b))) b++
  return b === 0 && e === s.length ? s : s.slice(b, e)
}

/**
 * Conteúdo do título ATX sem a sequência de fechamento opcional (`# a ##`):
 * o mesmo que `.replace(/^[ \t]*#+[ \t]*$/, '').replace(/[ \t]+#+[ \t]*$/, '')`.
 * Só `#` (com espaços) vira título vazio; `#` colado no texto (`# a#`) ou
 * escapado (`# a \#`) fica.
 */
export function stripClosingHashes(s: string): string {
  const e = spaceTabEnd(s)
  let h = e
  while (h > 0 && s.charCodeAt(h - 1) === 35) h--
  if (h === e) return s
  const before = trimEndSpaceTab(s.slice(0, h))
  if (before === '') return ''
  return before.length === h ? s : before
}
