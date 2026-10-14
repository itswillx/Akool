import { supabase } from '../supabase'
import type { WriteError } from '../optimistic'
import { localDateISO } from '../studyProgress'
import type { Json } from '../../types/database'
import type {
  StudyCard, StudyCheckpoint, StudyLog, StudyQuizAnswer, StudyQuizQuestion, StudyResource, StudyTopic,
} from '../../types'

// API-029 (ARCH-003): consultas de Estudos num lugar só. A tela deixa de
// regravar checkpoints, resources e quiz inteiros: cada item vai pela sua RPC
// do API-024 (supabase/migrations/20261011120000_api024_study_rpcs.sql), que
// trava o card e mexe só naquele item. Importar e reagendar são uma chamada
// cada, tudo ou nada. Datas (started_at, completed_at), versão (updated_at) e
// posição (sort_order) são do servidor: o app nunca as envia, só usa a versão
// como filtro dos campos escalares.

/** Campos escalares do card que a tela edita (as listas vão pelas RPCs). */
export type StudyCardFieldPatch = Partial<Pick<StudyCard, 'title' | 'description' | 'rationale' | 'due_date'>>
export type StudyTopicFieldPatch = Partial<Pick<StudyTopic, 'title' | 'area' | 'level' | 'objective' | 'status' | 'target_date'>>

/** Um card para study_cards_append e study_import_topic (sem posição nem versão). */
export interface StudyCardInput {
  title: string
  description?: string
  rationale?: string
  checkpoints?: StudyCheckpoint[]
  resources?: StudyResource[]
  quiz?: StudyQuizQuestion[]
}

export interface StudyImportTopic {
  title: string
  area: string
  level: string
  objective: string
  target_date: string | null
}

export interface StudyTopicForm {
  title: string
  area: string
  level: string
  objective: string
  target_date: string | null
}

export type StudyResult<T> = { data: T | null; error: WriteError | null }

// ── Normalização ─────────────────────────────────────────────────────────────

type CardRow = Omit<StudyCard, 'rationale' | 'checkpoints' | 'resources' | 'quiz'> & {
  rationale: string | null
  checkpoints: unknown
  resources: unknown
  quiz: unknown
}

// API-021: o servidor confere a forma, mas uma linha antiga ou gravada por
// outro caminho não pode derrubar a carga nem a Visão geral: coluna que não é
// lista vira [], item que não é objeto e escolha sem alternativas saem.
function objectsOf<T>(value: unknown): T[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is T => typeof item === 'object' && item !== null && !Array.isArray(item))
}

/** Linha de study_cards (SELECT ou RPC) na forma da tela. */
export function normalizeStudyCard(row: CardRow): StudyCard {
  return {
    ...row,
    rationale: row.rationale ?? '',
    checkpoints: objectsOf<StudyCheckpoint>(row.checkpoints),
    resources: objectsOf<StudyResource>(row.resources),
    // Por tipo de pergunta, para o TS manter o userAnswer de cada um.
    quiz: objectsOf<StudyQuizQuestion>(row.quiz).flatMap<StudyQuizQuestion>(q =>
      q.kind === 'choice'
        ? (Array.isArray(q.options) ? [{ ...q, userAnswer: q.userAnswer ?? null }] : [])
        : [{ ...q, userAnswer: q.userAnswer ?? null }],
    ),
  }
}

/** Os campos de `patch` já estão assim em `row`? (escalares: texto, data ou null) */
export function fieldsMatch<T extends object>(row: T, patch: Partial<T>): boolean {
  return (Object.keys(patch) as (keyof T)[]).every(key => (row[key] ?? null) === (patch[key] ?? null))
}

function failure(thrown: unknown): WriteError {
  return { message: thrown instanceof Error ? thrown.message : String(thrown) }
}

// ── Leitura ──────────────────────────────────────────────────────────────────

export interface StudySnapshot {
  topics: StudyTopic[]
  cards: StudyCard[]
  logs: StudyLog[]
  error: WriteError | null
}

/**
 * Tudo de Estudos da pessoa. Os cards vêm na ordem do roteiro: sort_order,
 * created_at e id, a mesma do study_reschedule (o sort_order antigo pode
 * repetir). Rede caída também volta como `error` (a carga não lança).
 */
export async function listStudy(userId: string): Promise<StudySnapshot> {
  try {
    const [topicsRes, cardsRes, logsRes] = await Promise.all([
      supabase.from('study_topics').select('*').eq('user_id', userId).order('updated_at', { ascending: false }),
      supabase.from('study_cards').select('*').eq('user_id', userId)
        .order('sort_order', { ascending: true }).order('created_at', { ascending: true }).order('id', { ascending: true }),
      supabase.from('study_logs').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    ])
    const error = topicsRes.error ?? cardsRes.error ?? logsRes.error
    if (error) return { topics: [], cards: [], logs: [], error }
    return {
      topics: topicsRes.data ?? [],
      cards: (cardsRes.data ?? []).map(normalizeStudyCard),
      logs: logsRes.data ?? [],
      error: null,
    }
  } catch (thrown) {
    return { topics: [], cards: [], logs: [], error: failure(thrown) }
  }
}

export async function getStudyCard(id: string): Promise<StudyResult<StudyCard>> {
  const { data, error } = await supabase.from('study_cards').select('*').eq('id', id).maybeSingle()
  return { data: data && !error ? normalizeStudyCard(data) : null, error }
}

export async function getStudyTopic(id: string): Promise<StudyResult<StudyTopic>> {
  const { data, error } = await supabase.from('study_topics').select('*').eq('id', id).maybeSingle()
  return { data: error ? null : data, error }
}

// ── Gravação com versão ──────────────────────────────────────────────────────

export type StudySave<T> =
  | { status: 'saved'; row: T }
  | { status: 'conflict'; current: T }
  | { status: 'gone' }
  | { status: 'denied' }
  | { status: 'error'; error: WriteError }

/**
 * Depois de zero linhas no UPDATE com versão, como o saveCardVersioned de
 * Projetos (src/lib/data/projects.ts): já tem o patch (reenvio) → `saved`; na
 * mesma versão e sem o patch → `denied` (o RLS recusou); outra versão →
 * `conflict`. Quem decide se o conflito é de verdade (o campo mudou desde o
 * início da edição) ou se refaz com a versão nova é o hook.
 */
function settle<T extends { updated_at: string }>(current: T, patch: Partial<T>, expected: string): StudySave<T> {
  if (fieldsMatch(current, patch)) return { status: 'saved', row: current }
  if (current.updated_at === expected) return { status: 'denied' }
  return { status: 'conflict', current }
}

/**
 * Grava os campos escalares só se o card ainda estiver na versão `expected`
 * (a string do servidor, comparada por igualdade). Pede a linha inteira de
 * volta: com ela o hook adota a versão nova sem perder o que outra gravação
 * desta aba (um ponto marcado) já pôs no card.
 */
export async function saveCardFields(id: string, patch: StudyCardFieldPatch, expected: string): Promise<StudySave<StudyCard>> {
  const { data, error } = await supabase.from('study_cards').update(patch).eq('id', id).eq('updated_at', expected).select('*')
  if (error) return { status: 'error', error }
  if (data.length > 0) return { status: 'saved', row: normalizeStudyCard(data[0]) }
  const reread = await getStudyCard(id)
  if (reread.error) return { status: 'error', error: reread.error }
  if (!reread.data) return { status: 'gone' }
  return settle<StudyCard>(reread.data, patch, expected)
}

/** O mesmo do saveCardFields, no tópico. As datas voltam na linha (gatilho study_topics_rules). */
export async function saveTopicFields(id: string, patch: StudyTopicFieldPatch, expected: string): Promise<StudySave<StudyTopic>> {
  const { data, error } = await supabase.from('study_topics').update(patch).eq('id', id).eq('updated_at', expected).select('*')
  if (error) return { status: 'error', error }
  if (data.length > 0) return { status: 'saved', row: data[0] }
  const reread = await getStudyTopic(id)
  if (reread.error) return { status: 'error', error: reread.error }
  if (!reread.data) return { status: 'gone' }
  return settle<StudyTopic>(reread.data, patch, expected)
}

// ── Tópico, card e diário ────────────────────────────────────────────────────

/** Sem datas nem versão: o gatilho preenche. */
export function insertTopic(userId: string, form: StudyTopicForm) {
  return supabase.from('study_topics').insert({ user_id: userId, ...form }).select('*').single()
}

// Sem .select() nos deletes: 0 linhas é ambíguo (RLS barrou ou alguém já
// apagou), e tratar como falha faria a linha "voltar" num caso legítimo.
export function deleteTopic(id: string) {
  return supabase.from('study_topics').delete().eq('id', id)
}

export function deleteCard(id: string) {
  return supabase.from('study_cards').delete().eq('id', id)
}

export function insertLog(userId: string, topicId: string, content: string) {
  return supabase.from('study_logs').insert({ user_id: userId, topic_id: topicId, content }).select('*').single()
}

export function deleteLog(id: string) {
  return supabase.from('study_logs').delete().eq('id', id)
}

// ── Por item (RPCs do API-024) ───────────────────────────────────────────────

async function oneCard(query: PromiseLike<{ data: CardRow | null; error: WriteError | null }>): Promise<StudyResult<StudyCard>> {
  const { data, error } = await query
  return { data: data && !error ? normalizeStudyCard(data) : null, error }
}

async function cardList(query: PromiseLike<{ data: CardRow[] | null; error: WriteError | null }>): Promise<StudyResult<StudyCard[]>> {
  const { data, error } = await query
  return { data: data && !error ? data.map(normalizeStudyCard) : null, error }
}

/** Ponto novo no fim. O `id` vem de quem chama, estável por rascunho: o reenvio depois de uma falha não duplica. */
export function addCheckpoint(cardId: string, point: { id: string; text: string }) {
  return oneCard(supabase.rpc('study_checkpoint_add', { p_card: cardId, p_text: point.text, p_id: point.id }))
}

/** Texto e/ou nota; o que não veio fica como está. Nota '' tira a chave. */
export function editCheckpoint(cardId: string, checkpointId: string, change: { text?: string; note?: string }) {
  return oneCard(supabase.rpc('study_checkpoint_edit', {
    p_card: cardId,
    p_checkpoint: checkpointId,
    ...(change.text !== undefined ? { p_text: change.text } : {}),
    ...(change.note !== undefined ? { p_note: change.note } : {}),
  }))
}

/** `completed` sempre explícito: repetir é idempotente (nulo inverteria). */
export function toggleCheckpoint(cardId: string, checkpointId: string, completed: boolean) {
  return oneCard(supabase.rpc('study_checkpoint_toggle', { p_card: cardId, p_checkpoint: checkpointId, p_completed: completed }))
}

export function removeCheckpoint(cardId: string, checkpointId: string) {
  return oneCard(supabase.rpc('study_checkpoint_remove', { p_card: cardId, p_checkpoint: checkpointId }))
}

export function addResource(cardId: string, resource: { id: string; title: string; url: string }) {
  return oneCard(supabase.rpc('study_resource_add', { p_card: cardId, p_url: resource.url, p_title: resource.title, p_id: resource.id }))
}

export function removeResource(cardId: string, resourceId: string) {
  return oneCard(supabase.rpc('study_resource_remove', { p_card: cardId, p_resource: resourceId }))
}

/** Escolha: o índice da alternativa; Certo/Errado: 'certo' ou 'errado'. */
export function answerQuiz(cardId: string, questionId: string, answer: StudyQuizAnswer | number) {
  return oneCard(supabase.rpc('study_quiz_answer', { p_card: cardId, p_question: questionId, p_answer: answer }))
}

export function resetQuiz(cardId: string, onlyWrong: boolean) {
  return oneCard(supabase.rpc('study_quiz_reset', { p_card: cardId, p_only_wrong: onlyWrong }))
}

// ── Lote ─────────────────────────────────────────────────────────────────────

// Os tipos do app não têm índice de string, e o Json gerado exige um: a forma
// é a que as RPCs conferem (o gatilho do API-021 recusa o resto).
const asJson = (value: unknown) => value as Json

/** Cards no fim do tópico (1 a 100, até 4 MiB), tudo ou nada; o servidor dá a posição. */
export function appendStudyCards(topicId: string, cards: StudyCardInput[]) {
  return cardList(supabase.rpc('study_cards_append', { p_topic: topicId, p_cards: asJson(cards) }))
}

/**
 * O servidor recusou o dia do aparelho: 22023 "Data de hoje (…) a mais de 1
 * dia do hoje de São Paulo". O aparelho não tem como saber que o próprio
 * relógio está errado (o dia de São Paulo que ele calcula sai do mesmo
 * relógio), então quem descobre é o servidor.
 */
function isTodayRefused(error: WriteError | null): boolean {
  return error?.code === '22023' && error.hint === 'akool' && error.message.startsWith('Data de hoje')
}

/**
 * Chama com o dia do aparelho (`today`) e, se o servidor o recusa, refaz uma
 * vez sem ele: vale o hoje de São Paulo do servidor, e o relógio errado não
 * derruba a importação nem o reagendar.
 */
async function withDeviceToday<R extends { error: WriteError | null }>(
  today: string | undefined,
  call: (today?: string) => PromiseLike<R>,
): Promise<R> {
  const first = await call(today)
  return today && isTodayRefused(first.error) ? call() : first
}

export interface StudyImportResult {
  topic: StudyTopic
  cards: StudyCard[]
}

/**
 * Tópico, cards e (com meta) prazos numa transação: card com erro não deixa
 * tópico vazio. O `p_today` só serve para distribuir os prazos até a meta:
 * sem meta, nem vai (o servidor confere o dia antes de olhar a meta).
 */
export async function importStudyTopic(
  payload: { topic: StudyImportTopic; cards: StudyCardInput[] },
  now: Date = new Date(),
): Promise<StudyResult<StudyImportResult>> {
  const { data, error } = await withDeviceToday(payload.topic.target_date ? localDateISO(now) : undefined, today =>
    supabase.rpc('study_import_topic', { p_payload: asJson(payload), ...(today ? { p_today: today } : {}) }))
  if (error || !data) return { data: null, error }
  const body = data as unknown as { topic: StudyTopic; cards: CardRow[] }
  return { data: { topic: body.topic, cards: body.cards.map(normalizeStudyCard) }, error: null }
}

/** Prazos até a meta, distribuídos no servidor a partir do dia do aparelho; devolve todos os cards do tópico. */
export function rescheduleStudyTopic(topicId: string, now: Date = new Date()) {
  return cardList(withDeviceToday(localDateISO(now), today =>
    supabase.rpc('study_reschedule', { p_topic: topicId, ...(today ? { p_today: today } : {}) })))
}

// ── Erros ────────────────────────────────────────────────────────────────────

/**
 * - `missing`: P0002, item ou card que não existe (ou é de outra pessoa); nas
 *   RPCs do tópico (anexar, reagendar), o tópico;
 * - `answered`: P0001, pergunta já respondida (e tópico sem meta, no reagendar);
 * - `invalid`: 22023 e 23514 (entrada e forma), e 23505 com hint akool (id de
 *   item repetido com outro conteúdo);
 * - `outdated`: a RPC não existe no servidor (PGRST202 do PostgREST, 42883 do
 *   Postgres): o front saiu antes da migration;
 * - `other`: o resto (rede, permissão, sessão), que o mapSupabaseError trata.
 */
export type StudyErrorKind = 'missing' | 'answered' | 'invalid' | 'outdated' | 'other'

export function studyErrorKind(error: WriteError | null | undefined): StudyErrorKind {
  switch (error?.code) {
    case 'P0002': return 'missing'
    case 'P0001': return 'answered'
    case '22023':
    case '23514': return 'invalid'
    case '23505': return error.hint === 'akool' ? 'invalid' : 'other'
    case 'PGRST202':
    case '42883': return 'outdated'
    default: return 'other'
  }
}

const CARD_PREFIX = /^cards\/(\d+): ([\s\S]*)$/

/**
 * O card que derrubou a importação ("cards/N: motivo", N a partir de 0): o
 * número (a partir de 1) e o título, para a mensagem traduzida. O motivo vem
 * do servidor em pt-BR e vai só para o console.
 */
export function importErrorCard(
  error: WriteError | null | undefined,
  cards: readonly { title: string }[],
): { n: number; title: string; reason: string } | null {
  const match = error?.message?.match(CARD_PREFIX)
  if (!match) return null
  const index = Number(match[1])
  return { n: index + 1, title: cards[index]?.title ?? '', reason: match[2] }
}
