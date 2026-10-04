import { flushSync } from 'react-dom'

// Transições das telas de entrada pela View Transitions API (mesmo documento).
// O React 19.2 estável não tem <ViewTransition>: o update roda dentro do
// startViewTransition com flushSync, e os efeitos do commit síncrono (foco no
// título, rolagem ao topo) entram no quadro novo. Sem a API ou com movimento
// reduzido, o update roda na hora, como antes. O tipo vai no <html>
// (data-auth-vt) para o CSS (authMotion.css) escolher a animação:
//   page: landing ↔ login (crossfade da página; o conteúdo novo entra ao montar)
//   card: dentro do cartão (Entrar ↔ Criar conta, recuperar, painel de sucesso)
// Chame só de handlers (clique, envio), nunca de render ou efeito.

export type AuthTransition = 'page' | 'card'

let seq = 0

export function runAuthTransition(kind: AuthTransition, update: () => void, doc: Document = document): void {
  if (typeof doc.startViewTransition !== 'function' || doc.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    update()
    return
  }
  const id = ++seq
  const root = doc.documentElement
  root.dataset.authVt = kind
  const transition = doc.startViewTransition(() => { flushSync(update) })
  // Uma transição nova no meio de outra encerra a anterior: só a última limpa o atributo.
  const clear = () => { if (id === seq) delete root.dataset.authVt }
  // Transição pulada (clique duplo, aba escondida) rejeita `ready`; o update roda mesmo assim.
  transition.ready.catch(() => {})
  transition.finished.then(clear, clear)
}
