// ARCH-009: a ordem real dos providers vem do próprio src/App.tsx, lida das
// tags JSX de abertura (`<XProvider>`), e não de uma lista escrita à mão. O
// gerador do mapa de arquitetura e o teste que compara com docs/arquitetura.md
// usam isto; quem mudar a ordem no código tem de mudar o doc, ou o CI acusa.
import { readFileSync } from 'node:fs'

const OPEN_TAG = /<([A-Z][A-Za-z]*Provider)[\s>]/g

function openingTags(source) {
  const seen = new Set()
  const out = []
  for (const m of source.matchAll(OPEN_TAG)) {
    if (seen.has(m[1])) continue
    seen.add(m[1])
    out.push(m[1])
  }
  return out
}

/**
 * `outer`: os providers do `App()` (envolvem o app inteiro, inclusive o login);
 * `inner`: os do `AppInner`, montados só depois dos portões (loading,
 * recuperação de senha, login, MFA). No arquivo, o AppInner vem antes do App.
 */
export function readProviderOrder(source) {
  const appStart = source.search(/export default function App\s*\(/)
  if (appStart < 0) throw new Error('App.tsx: `export default function App(` não encontrado')
  return { outer: openingTags(source.slice(appStart)), inner: openingTags(source.slice(0, appStart)) }
}

export function readAppProviderOrder(appPath) {
  return readProviderOrder(readFileSync(appPath, 'utf8'))
}

/** A cadeia inteira, de fora para dentro. */
export function providerChain(order) {
  return [...order.outer, ...order.inner]
}

/** Id de caixa no mapa: `AuthProvider` → `authProvider`. */
export function providerId(name) {
  return name[0].toLowerCase() + name.slice(1)
}
