import type { Announcements, ScreenReaderInstructions, UniqueIdentifier } from '@dnd-kit/core'
import { KeyboardCode, type KeyboardCodes } from '@dnd-kit/core'
import type { TranslationKey } from '../i18n/translations'

// UX-002: arrastar pelo teclado nos kanbans. Espaço pega e solta, setas movem,
// Esc cancela. Enter fica livre para abrir o card.
export const KANBAN_KEYBOARD_CODES: KeyboardCodes = {
  start: [KeyboardCode.Space],
  cancel: [KeyboardCode.Esc],
  end: [KeyboardCode.Space],
}

export interface DndDescribe {
  /** Nome do que está sendo arrastado (título do card, nome da coluna). */
  title: (id: UniqueIdentifier) => string
  /** Nome do lugar sob o item (normalmente a coluna). */
  target: (id: UniqueIdentifier) => string
}

/** Textos para leitor de tela do dnd-kit, no idioma do app. */
export function dndAccessibility(
  t: (key: TranslationKey) => string,
  describe: DndDescribe,
): { announcements: Announcements; screenReaderInstructions: ScreenReaderInstructions } {
  const fill = (key: TranslationKey, active: UniqueIdentifier, over?: UniqueIdentifier) =>
    t(key)
      .replace('{title}', describe.title(active))
      .replace('{target}', over === undefined ? '' : describe.target(over))
  return {
    screenReaderInstructions: { draggable: t('dnd_instructions') },
    announcements: {
      onDragStart: ({ active }) => fill('dnd_pickup', active.id),
      onDragOver: ({ active, over }) => (over ? fill('dnd_over', active.id, over.id) : undefined),
      onDragEnd: ({ active, over }) => (over ? fill('dnd_drop', active.id, over.id) : fill('dnd_drop_nowhere', active.id)),
      onDragCancel: ({ active }) => fill('dnd_cancel', active.id),
    },
  }
}

/**
 * Enter abre o card, sem brigar com o KeyboardSensor (que usa Espaço): repassa
 * a tecla ao listener do dnd-kit e só abre se ele não a consumiu, se o evento
 * veio do próprio card e se não há um arrasto em andamento.
 */
export function cardKeyDown(
  /** `listeners.onKeyDown` do useSortable (tipado pelo dnd-kit como Function). */
  dndKeyDown: unknown,
  onOpen: (() => void) | undefined,
  dragging: boolean,
) {
  return (e: React.KeyboardEvent<HTMLElement>) => {
    if (typeof dndKeyDown === 'function') dndKeyDown(e)
    if (e.defaultPrevented || dragging || !onOpen) return
    if (e.key === 'Enter' && e.target === e.currentTarget) {
      e.preventDefault()
      onOpen()
    }
  }
}
