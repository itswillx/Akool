// ARCH-007: eventos entre módulos, tipados. Antes, o emissor usava uma
// constante e o listener uma string solta; renomear um evento não quebrava a
// compilação. Adicionar um evento é acrescentar uma entrada em `AppEvents`;
// uma string fora do mapa não compila.

/** Nome do evento → tipo do `detail` (`undefined` = sem payload). */
export interface AppEvents {
  /**
   * A Loja escreve em finance_transactions por conta própria (receita/despesa
   * ligada a uma venda/compra) e avisa o FinancePanel, que recarrega a aba
   * Transações sem F5.
   */
  finance_transactions_changed: undefined
}

type EventName = keyof AppEvents

type EmitArgs<K extends EventName> = AppEvents[K] extends undefined ? [detail?: undefined] : [detail: AppEvents[K]]

export function emitAppEvent<K extends EventName>(name: K, ...[detail]: EmitArgs<K>): void {
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

/** Escuta o evento; devolve a função que para de escutar (para o cleanup do efeito). */
export function onAppEvent<K extends EventName>(name: K, handler: (detail: AppEvents[K]) => void): () => void {
  const listener = (event: Event) => { handler((event as CustomEvent<AppEvents[K]>).detail) }
  window.addEventListener(name, listener)
  return () => window.removeEventListener(name, listener)
}
