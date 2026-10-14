import type { StudySave } from '../../lib/data/study'
import type { StudyCard, StudyQuizAnswer, StudyResource } from '../../types'

// Lógica pura das gravações de Estudos (API-029), fora do hook para ficar
// testável sem React:
//   • os espelhos locais das RPCs do API-024, para a tela mudar na hora;
//   • o livro de cada linha: a última versão que o servidor devolveu, com as
//     gravações próprias ainda em voo por cima (StudyLedger);
//   • o registro de escritas, que diz ao refetch o que ele não pode pisar
//     (StudyWriteTracker, mergeRefetch);
//   • a regra de conflito por campo e o refazer com fim definido.

// ── Espelhos locais das RPCs ─────────────────────────────────────────────────
// Fazem o que a RPC fará no servidor, só no item: a tela muda na hora, e a
// linha que volta substitui o espelho. Item que já não está no card fica como
// está (a RPC dará P0002, e o hook relê o card).

export function addCheckpointLocal(card: StudyCard, point: { id: string; text: string }): StudyCard {
  if (card.checkpoints.some(p => p.id === point.id)) return card
  return { ...card, checkpoints: [...card.checkpoints, { id: point.id, text: point.text, completed: false }] }
}

/** Nota '' tira a chave, como o study_checkpoint_edit. */
export function editCheckpointLocal(card: StudyCard, id: string, change: { text?: string; note?: string }): StudyCard {
  return {
    ...card,
    checkpoints: card.checkpoints.map(p => {
      if (p.id !== id) return p
      const next = { ...p, ...(change.text !== undefined ? { text: change.text } : {}) }
      if (change.note === undefined) return next
      if (change.note) return { ...next, note: change.note }
      delete next.note
      return next
    }),
  }
}

export function toggleCheckpointLocal(card: StudyCard, id: string, completed: boolean): StudyCard {
  return { ...card, checkpoints: card.checkpoints.map(p => (p.id === id ? { ...p, completed } : p)) }
}

export function removeCheckpointLocal(card: StudyCard, id: string): StudyCard {
  return { ...card, checkpoints: card.checkpoints.filter(p => p.id !== id) }
}

export function addResourceLocal(card: StudyCard, resource: StudyResource): StudyCard {
  if (card.resources.some(r => r.id === resource.id)) return card
  return { ...card, resources: [...card.resources, resource] }
}

export function removeResourceLocal(card: StudyCard, id: string): StudyCard {
  return { ...card, resources: card.resources.filter(r => r.id !== id) }
}

/** Só a primeira resposta conta (a trava do study_quiz_answer). */
export function answerQuizLocal(card: StudyCard, questionId: string, answer: StudyQuizAnswer | number): StudyCard {
  return {
    ...card,
    quiz: card.quiz.map(q => {
      if (q.id !== questionId || q.userAnswer !== null) return q
      if (q.kind === 'choice') return typeof answer === 'number' ? { ...q, userAnswer: answer } : q
      return typeof answer === 'string' ? { ...q, userAnswer: answer } : q
    }),
  }
}

/** Zera todas as respostas, ou só as erradas (as certas ficam), como o study_quiz_reset. */
export function resetQuizLocal(card: StudyCard, onlyWrong: boolean): StudyCard {
  return {
    ...card,
    quiz: card.quiz.map(q => (q.userAnswer === null || (onlyWrong && q.userAnswer === q.answer) ? q : { ...q, userAnswer: null })),
  }
}

// ── Ordem e versão ───────────────────────────────────────────────────────────

/**
 * A ordem do roteiro, a mesma do study_reschedule: sort_order, created_at e
 * id (o sort_order antigo pode repetir). As datas são texto do servidor no
 * mesmo formato, e o `<` comum as ordena; o localeCompare não (põe '.' antes
 * de '+').
 */
export function compareCardOrder(a: StudyCard, b: StudyCard): number {
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1
  if (a.id !== b.id) return a.id < b.id ? -1 : 1
  return 0
}

/**
 * A versão `candidate` é mais nova que `known`? As duas são o updated_at do
 * servidor (to_jsonb e PostgREST dão o mesmo texto, com +00:00): o zero final
 * da fração some, e '+' < '.' < dígito em ASCII, então o `>` de texto acerta
 * ('…03+00:00' < '…03.5+00:00' < '…03.51+00:00'). Nunca Date (perde os µs)
 * nem localeCompare.
 */
export function isNewerVersion(candidate: string, known: string | undefined): boolean {
  return known === undefined || candidate > known
}

/**
 * Conflito de verdade: algum campo do patch mudou no servidor desde o início
 * da edição (`base`) e não ficou igual ao que esta aba quer gravar. Mudança
 * em outro campo ou nas listas não conta: a gravação é refeita com a versão
 * nova.
 */
export function fieldConflict<T extends object>(current: T, base: Partial<T>, patch: Partial<T>): boolean {
  return (Object.keys(patch) as (keyof T)[]).some(key => {
    const now = current[key] ?? null
    return now !== (base[key] ?? null) && now !== (patch[key] ?? null)
  })
}

/** Quantas vezes a gravação escalar é refeita porque a versão mudou por outro motivo. */
export const STUDY_SAVE_ATTEMPTS = 3

/**
 * Grava com versão e refaz enquanto o conflito não for no campo: até
 * STUDY_SAVE_ATTEMPTS vezes, depois erro (sem laço sem fim). Sem `base` (data,
 * status, nível e prazo, gravados no onChange), a última gravação vale e a
 * versão nova sempre refaz. `base` também pode ser a escolha feita com cada
 * linha relida (StudyFieldBases.pick): a base que confere o servidor depende
 * do que ele tem. `onFresh` recebe cada linha relida, que é a versão do
 * próximo envio.
 */
export async function saveWithRetry<T extends { updated_at: string }>(
  save: (version: string) => Promise<StudySave<T>>,
  version: string,
  patch: Partial<T>,
  base: Partial<T> | ((current: T) => Partial<T> | undefined) | undefined,
  onFresh: (current: T) => void,
): Promise<StudySave<T>> {
  let expected = version
  for (let attempt = 1; ; attempt++) {
    const result = await save(expected)
    if (result.status !== 'conflict') return result
    onFresh(result.current)
    const checked = typeof base === 'function' ? base(result.current) : base
    if (checked && fieldConflict(result.current, checked, patch)) return result
    if (attempt >= STUDY_SAVE_ATTEMPTS) {
      return { status: 'error', error: { message: `a versão mudou ${attempt} vezes seguidas`, code: 'STUDY_RETRY_LIMIT' } }
    }
    expected = result.current.updated_at
  }
}

/**
 * Como terminou a gravação de um campo escalar, para o rascunho
 * (useFieldDraft): `failed` (rede, RLS, limite de tentativas) guarda o texto
 * para tentar de novo; `conflict` (o campo mudou em outra aba, ou a linha
 * sumiu) fica com o do servidor, e o aviso traz "Copiar meu texto".
 */
export type StudyFieldOutcome = 'saved' | 'conflict' | 'failed'

/**
 * Uma gravação de campo que falhou: `base` é a base com que ela conferiu o
 * servidor, `value` o que ela tentou gravar e `own` a base própria dela (a
 * do rascunho).
 */
export interface StudyFailedSave {
  base: object
  value: object
  own: object
}

/** Os campos do patch valem o mesmo em `a` e em `b` (ausente conta como null). */
function sameFields(a: object, b: object, patch: object): boolean {
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  return Object.keys(patch).every(key => (left[key] ?? null) === (right[key] ?? null))
}

/**
 * A base herdada de uma gravação que falhou, por chave (linha + campo, a
 * mesma da fila). Quem volta ao campo com a gravação ainda em voo pega como
 * base o valor dela, que a tela mostra; se ela falha, esse valor pode não ter
 * chegado ao servidor, e o servidor ainda com o valor de antes parecia
 * mudança de outra aba (a 2ª edição era descartada sem ir à rede).
 *
 * A herança fica presa ao texto que falhou: só herda a gravação que partiu
 * dele (a base própria é o valor que falhou) ou o mesmo rascunho que voltou
 * e sai de novo (a mesma base própria da que falhou). Partir de outro texto
 * não herda: o servidor de volta ao valor de antes da falha é conflito.
 * Herdar soma a base de antes à própria, não a troca: `pick` é refeito com
 * cada linha relida, e o servidor com o valor que falhou (a resposta se
 * perdeu depois do commit) confere: com a base própria, quando a edição
 * partiu dele; com o próprio valor, quando é o rascunho que voltou, editado
 * ou não (o texto lá é o da pessoa). Todo fim de gravação da chave apaga a
 * herança (gravar, dar conflito, inclusive na pré-checagem, a linha sumir), e
 * falhar de novo põe a dela; o refetch que traz o valor que falhou troca a
 * base herdada por ele (`seen`): a de antes já não está no servidor.
 */
export class StudyFieldBases {
  private readonly failed = new Map<string, StudyFailedSave>()

  /**
   * A base que confere o servidor: a própria; se o servidor não está nela e
   * a edição é da cadeia do texto que falhou, o próprio texto (quando é ele
   * que está lá) ou a herdada (a de antes da falha).
   */
  pick<T extends object>(key: string, current: T, own: Partial<T> | undefined, patch: Partial<T>): Partial<T> | undefined {
    const failed = this.failed.get(key)
    if (!own || !failed || !fieldConflict(current, own, patch)) return own
    const fromFailed = sameFields(own, failed.value, patch) || sameFields(own, failed.own, patch)
    if (!fromFailed) return own
    return sameFields(current, failed.value, patch) ? failed.value : failed.base
  }

  /** Fim da gravação: a que falhou deixa a dela para a seguinte; as outras apagam a herança. */
  settle(key: string, failed?: StudyFailedSave): void {
    if (failed) this.failed.set(key, failed)
    else this.failed.delete(key)
  }

  /**
   * O servidor tem a linha `row`: a herança cujo valor já está nela passa a
   * ter ele como base (o texto chegou lá; o de antes, não mais).
   */
  seen(id: string, row: object): void {
    for (const [key, failed] of this.failed) {
      if (key.startsWith(`${id}:`) && sameFields(row, failed.value, failed.value)) this.failed.set(key, { ...failed, base: failed.value })
    }
  }
}

// ── Livro das linhas ─────────────────────────────────────────────────────────

export interface PendingOp<T> {
  readonly apply: (row: T) => T
}

/**
 * A última linha que o servidor devolveu de cada card (ou tópico) e as
 * gravações desta aba ainda em voo. A tela mostra `view`: a linha do servidor
 * com as pendentes reaplicadas por cima. Gravação que falha só sai da lista
 * (o "desfazer" é recalcular), e a que grava traz a linha nova, que entra só
 * se for mais nova que a conhecida: as respostas chegam fora de ordem, e a
 * versão de cada linha só anda para frente.
 */
export class StudyLedger<T extends { id: string; updated_at: string }> {
  private readonly server = new Map<string, T>()
  private readonly pending = new Map<string, PendingOp<T>[]>()

  base(id: string): T | undefined {
    return this.server.get(id)
  }

  view(id: string): T | undefined {
    const row = this.server.get(id)
    return row && (this.pending.get(id) ?? []).reduce((acc, op) => op.apply(acc), row)
  }

  /** Resposta de RPC ou releitura: entra só se for mais nova. */
  adopt(row: T): boolean {
    if (!isNewerVersion(row.updated_at, this.server.get(row.id)?.updated_at)) return false
    this.server.set(row.id, row)
    return true
  }

  /** Carga e refetch: entra sem conferir a versão (o restore do backup traz versões mais velhas). */
  replace(row: T): void {
    this.server.set(row.id, row)
  }

  forget(id: string): void {
    this.server.delete(id)
    this.pending.delete(id)
  }

  push(id: string, op: PendingOp<T>): void {
    this.pending.set(id, [...(this.pending.get(id) ?? []), op])
  }

  pop(id: string, op: PendingOp<T>): void {
    const rest = (this.pending.get(id) ?? []).filter(item => item !== op)
    if (rest.length > 0) this.pending.set(id, rest)
    else this.pending.delete(id)
  }
}

// ── Registro de escritas e refetch ───────────────────────────────────────────

/**
 * Contador de escrita por id, para o refetch (a crítica do API-029 reproduziu
 * as três corridas de um refetch que sai antes de uma gravação e volta depois
 * dela: o card criado no meio sumia, o excluído voltava e o ponto marcado
 * desmarcava). O refetch guarda `now()` no início; id que gravou, foi criado
 * ou ainda grava depois disso fica com o local, e id excluído por esta aba é
 * "removido" até um refetch que saiu depois da exclusão. Não há guarda por
 * versão: o restore do site-backup traz versões mais velhas, e o refetch tem
 * de aceitá-las.
 */
export class StudyWriteTracker {
  private seq = 0
  private readonly touchedAt = new Map<string, number>()
  private readonly inFlight = new Map<string, number>()
  private readonly removedAt = new Map<string, number>()
  private readonly chains = new Map<string, Promise<unknown>>()

  now(): number {
    return this.seq
  }

  /** O id mudou nesta aba (gravou, foi criado, chegou do servidor). */
  mark(id: string): void {
    this.touchedAt.set(id, ++this.seq)
  }

  begin(id: string): void {
    this.inFlight.set(id, (this.inFlight.get(id) ?? 0) + 1)
    this.mark(id)
  }

  end(id: string): void {
    const left = (this.inFlight.get(id) ?? 1) - 1
    if (left > 0) this.inFlight.set(id, left)
    else this.inFlight.delete(id)
    this.mark(id)
  }

  keepLocal(id: string, since: number): boolean {
    return this.inFlight.has(id) || (this.touchedAt.get(id) ?? 0) > since
  }

  /** Exclusão em voo: removido até ela terminar e um refetch posterior confirmar. */
  removing(id: string): void {
    this.removedAt.set(id, Infinity)
  }

  removed(id: string): void {
    this.removedAt.set(id, ++this.seq)
  }

  /** A exclusão falhou: a linha volta. */
  restored(id: string): void {
    this.removedAt.delete(id)
  }

  isRemoved(id: string): boolean {
    return this.removedAt.has(id)
  }

  /** Depois de um refetch que saiu em `since`: a exclusão terminada antes dele já está no servidor. */
  expireRemoved(since: number): void {
    for (const [id, at] of this.removedAt) if (at <= since) this.removedAt.delete(id)
  }

  /**
   * Fila por chave (card + item, ou card + campo): só a mesma chave espera a
   * anterior; o resto sai na hora. Falha de uma não trava a seguinte.
   */
  serial<R>(key: string, run: () => PromiseLike<R>): Promise<R> {
    const previous = this.chains.get(key) ?? Promise.resolve()
    const next = previous.then(run)
    const settled = next.then(() => undefined, () => undefined)
    this.chains.set(key, settled)
    void settled.then(() => { if (this.chains.get(key) === settled) this.chains.delete(key) })
    return next
  }
}

export interface RefetchGuard {
  /** Gravou, foi criado ou ainda grava depois que o refetch saiu: fica o local. */
  keepLocal: (id: string) => boolean
  /** Excluído por esta aba: não volta. */
  removed: (id: string) => boolean
}

/**
 * Junta o que o refetch trouxe com o que está na tela. Fica o local do id
 * protegido pelo `guard`; o resto vira o do servidor; o que não veio e não é
 * protegido some (`gone`, excluído em outra aba); o que veio e não estava
 * entra. Os protegidos que o servidor ainda não tem (criados no meio) ficam
 * no começo, na ordem local; o resto segue a ordem do servidor.
 */
export function mergeRefetch<T extends { id: string }>(
  local: readonly T[],
  server: readonly T[],
  guard: RefetchGuard,
): { rows: T[]; gone: T[] } {
  const localById = new Map(local.map(row => [row.id, row]))
  const serverIds = new Set(server.map(row => row.id))
  const kept = local.filter(row => !serverIds.has(row.id) && guard.keepLocal(row.id))
  const fromServer = server
    .filter(row => !guard.removed(row.id))
    .map(row => (guard.keepLocal(row.id) ? localById.get(row.id) ?? row : row))
  return {
    rows: [...kept, ...fromServer],
    gone: local.filter(row => !serverIds.has(row.id) && !guard.keepLocal(row.id)),
  }
}
