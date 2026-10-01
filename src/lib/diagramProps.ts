// REL-004: as props do bloco de diagrama (BlockNote) guardam JSON em texto.
// Um `elements` ilegível não pode virar diagrama vazio: o Excalidraw chama
// onChange ao montar, e o bloco gravaria `[]` por cima do dado salvo.

export type DiagramProps =
  | { ok: true; elements: unknown[]; appState: Record<string, unknown> }
  | { ok: false }

export function parseDiagramProps(elements: string, appState: string): DiagramProps {
  let parsedElements: unknown
  try {
    parsedElements = JSON.parse(elements || '[]')
  } catch {
    return { ok: false }
  }
  if (!Array.isArray(parsedElements)) return { ok: false }

  // appState só guarda a vista (fundo, zoom, rolagem): se estiver ilegível, a
  // vista padrão serve, e o próximo salvamento a reescreve.
  let parsedAppState: Record<string, unknown> = {}
  try {
    const value: unknown = JSON.parse(appState || '{}')
    if (value && typeof value === 'object' && !Array.isArray(value)) parsedAppState = value as Record<string, unknown>
  } catch { /* vista padrão */ }

  return { ok: true, elements: parsedElements, appState: parsedAppState }
}

/**
 * UX-013: ao desmontar o bloco com um save agendado (debounce de 800 ms),
 * grava na hora se o bloco ainda existir no editor; se foi removido, descarta
 * (antes, o timer disparava `updateBlock` sobre um bloco inexistente).
 */
export function flushPendingDiagramSave<T>({ pending, blockExists, save }: {
  pending: T | null
  blockExists: () => boolean
  save: (value: T) => void
}): 'saved' | 'discarded' | 'nothing' {
  if (pending === null) return 'nothing'
  if (!blockExists()) return 'discarded'
  save(pending)
  return 'saved'
}
