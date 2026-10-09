import { useState, type ChangeEvent, type KeyboardEvent, type SyntheticEvent } from 'react'
import type { StudyTopicStatus } from '../../types'
import { localeOf, type Lang, type TranslationKey } from '../../i18n/translations'
import { cutText, isSafeStudyUrl, STUDY_RESOURCE_TITLE_MAX, STUDY_URL_MAX } from '../../lib/studyLimits'

// Non-component UI helpers of the study module (kept out of StudyBits.tsx so
// component files only export components — react-refresh friendly).

export const STATUS_LABEL_KEY: Record<StudyTopicStatus, TranslationKey> = {
  planned: 'study_status_planned',
  studying: 'study_status_studying',
  paused: 'study_status_paused',
  completed: 'study_status_completed',
}

export const STATUS_COLOR: Record<StudyTopicStatus, string> = {
  planned: '#94a3b8',
  studying: '#6366f1',
  paused: '#f59e0b',
  completed: '#22c55e',
}

export const STATUS_ORDER: StudyTopicStatus[] = ['planned', 'studying', 'paused', 'completed']

const AVATAR_COLORS = ['yellow', 'green', 'pink', 'blue', 'purple'] as const

// Deterministic pastel background for a topic avatar, reusing the existing
// sticky-note theme variables so light/dark mode both work.
export function avatarBg(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return `var(--sticky-${AVATAR_COLORS[h % AVATAR_COLORS.length]}-bg)`
}

export function initialsOf(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

// 'YYYY-MM-DD' → localized short date without going through new Date()
// (UTC parsing would shift the day in UTC-3).
export function formatDateISO(dateISO: string, lang: string): string {
  const [y, m, d] = dateISO.split('-')
  if (!y || !m || !d) return dateISO
  return lang === 'en' ? `${m}/${d}/${y}` : `${d}/${m}/${y}`
}

export function formatTimestamp(ts: string, lang: Lang): string {
  return new Date(ts).toLocaleString(localeOf(lang), {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export function useHover(): [boolean, { onMouseEnter: () => void; onMouseLeave: () => void }] {
  const [hov, setHov] = useState(false)
  return [hov, { onMouseEnter: () => setHov(true), onMouseLeave: () => setHov(false) }]
}

/**
 * URL digitada no card → a URL que o servidor aceita, ou null (o botão fica
 * desabilitado). Domínio sem esquema ganha https://. API-021: espaço, caractere
 * de controle, "https://" vazio e mais de 2048 caracteres param aqui, e não
 * numa recusa do servidor depois do clique.
 */
export function normalizeUrl(raw: string): string | null {
  const url = raw.trim()
  if (!url) return null
  const candidate = /^https?:\/\//i.test(url) ? url : /^[\w-]+(\.[\w-]+)+/.test(url) ? `https://${url}` : null
  return candidate && isSafeStudyUrl(candidate) ? candidate : null
}

/**
 * A URL digitada passa do teto do servidor, contando o https:// que o
 * normalizeUrl põe no domínio sem esquema. O campo não tem `maxLength`: o
 * navegador cortaria a URL colada em silêncio e o link gravado não abriria.
 */
export function isUrlTooLong(raw: string): boolean {
  const url = raw.trim()
  if (!url) return false
  return (/^https?:\/\//i.test(url) ? url : `https://${url}`).length > STUDY_URL_MAX
}

/**
 * O que fica no campo depois que `saved` gravou: o texto gravado sai do
 * começo, e o que a pessoa digitou durante a gravação continua (o próximo
 * ponto não gruda no anterior). Se o campo já não começa pelo texto gravado
 * (apagou, colou outra coisa), fica como está. Só vale para o campo que ficou
 * intacto durante a gravação: quem decide é o `createSentField`.
 */
export function withoutSavedLead(current: string, saved: string): string {
  const lead = current.trimStart()
  return lead.startsWith(saved) ? lead.slice(saved.length).trimStart() : current
}

function commonPrefixLength(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

/** Um envio do campo: `after` é a limpeza (updater do estado do campo) e `end` solta a marca. */
export interface SentText {
  after: (current: string) => string
  end: () => void
}

/**
 * Campo de adicionar do card (ponto, título e URL do recurso), R4 do API-021:
 * guarda o texto bruto de cada envio ainda gravando e marca o envio como
 * "substituído" quando uma edição começa dentro dele. A limpeza só tira o texto
 * gravado do começo do campo se ele ficou intacto; substituído, o campo fica
 * como a pessoa deixou. Só pelo valor não dá: digitar "0" no fim de
 * "Capítulo 1" e selecionar tudo e colar "Capítulo 10" dão o mesmo antes e
 * depois, e o corte deixaria "0" (ou "library.html", que vira outro domínio).
 * Por isso os eventos leem a seleção de antes da edição (beforeinput, colar,
 * recortar, soltar, composição, Backspace/Delete), e a troca de valor fecha o
 * resto (apagar palavra, desfazer, teclado do celular): se o começo comum do
 * antes e do depois é menor que o texto enviado, a edição passou por ele.
 */
export function createSentField() {
  const pending = new Set<{ end: number; replaced: boolean }>()
  // Edição que começa na posição `at` atinge todo envio que vai além dela.
  const touch = (at: number) => { for (const sent of pending) if (at < sent.end) sent.replaced = true }
  const fromSelection = (e: SyntheticEvent<HTMLInputElement>) => touch(e.currentTarget.selectionStart ?? 0)
  return {
    /** Envio de `raw` (o valor do campo, sem trim). As marcas vivem até `end`, no fim da gravação. */
    track(raw: string): SentText {
      const sent = { end: raw.trimEnd().length, replaced: false }
      pending.add(sent)
      return {
        after: current => (sent.replaced ? current : withoutSavedLead(current, raw.trim())),
        end: () => { pending.delete(sent) },
      }
    },
    /** Props do input controlado; com `onEnter`, Enter envia. */
    watch(value: string, onValue: (next: string) => void, onEnter?: () => void) {
      return {
        onChange: (e: ChangeEvent<HTMLInputElement>) => { touch(commonPrefixLength(value, e.target.value)); onValue(e.target.value) },
        onBeforeInput: fromSelection,
        onPaste: fromSelection,
        onCompositionStart: fromSelection,
        onCut: (e: SyntheticEvent<HTMLInputElement>) => { if (e.currentTarget.selectionStart !== e.currentTarget.selectionEnd) fromSelection(e) },
        // A posição em que o texto solto entra não é a seleção: conta como edição no começo.
        onDrop: () => touch(0),
        onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(); return }
          if (e.key !== 'Backspace' && e.key !== 'Delete') return
          const { selectionStart: start, selectionEnd } = e.currentTarget
          if (start === null) return
          if (start !== selectionEnd) { touch(start); return }
          // Caret: Delete apaga à frente; Backspace, o caractere anterior. Com
          // modificador apaga palavra ou linha, e a troca de valor decide.
          if (e.altKey || e.ctrlKey || e.metaKey) return
          if (e.key === 'Delete') touch(start)
          else if (start > 0) touch(start - 1)
        },
      }
    },
  }
}

/** Formulário de novo recurso do card (null quando fechado). */
export interface ResourceDraft {
  title: string
  url: string
}

/**
 * O formulário depois que `sent` gravou: cada campo passa pela própria
 * limpeza (o que foi enviado sai, se ficou intacto), o que a pessoa digitou
 * durante a gravação (o próximo recurso) fica, e ele só fecha quando os dois
 * campos ficam vazios (ou já tinha sido fechado).
 */
export function resourceDraftAfterSave(draft: ResourceDraft | null, sent: { title: SentText; url: SentText }): ResourceDraft | null {
  if (!draft) return null
  const next = { title: sent.title.after(draft.title), url: sent.url.after(draft.url) }
  return next.title || next.url ? next : null
}

/** O recurso que o card grava: título digitado ou derivado da URL, dentro do teto do servidor. */
export function resourceFromInput(rawTitle: string, rawUrl: string): { title: string; url: string } | null {
  const url = normalizeUrl(rawUrl)
  if (!url) return null
  return { title: cutText(rawTitle.trim() || url.replace(/^https?:\/\//i, ''), STUDY_RESOURCE_TITLE_MAX), url }
}

/**
 * Grava e só então limpa o campo (API-021): se o servidor recusa, o item volta
 * e o texto digitado continua no campo para corrigir. `false` de `save` é
 * recusa, e exceção também; qualquer outro resultado (inclusive nenhum) conta
 * como gravado. Enquanto uma chave grava, ela não sai de novo: Enter seguido
 * de blur mandaria o mesmo ponto duas vezes, já que o campo ainda não limpou.
 */
export function createSaveGate() {
  const pending = new Set<string>()
  return async (key: string, save: () => unknown, clear: () => void): Promise<boolean> => {
    if (pending.has(key)) return false
    pending.add(key)
    let ok: boolean
    try {
      ok = (await save()) !== false
    } catch (error) {
      console.error('[study] save', error)
      ok = false
    } finally {
      pending.delete(key)
    }
    if (ok) clear()
    return ok
  }
}
