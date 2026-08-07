import { useSyncExternalStore } from 'react'
import { getDocsSelection, subscribeDocsSelection } from '../lib/docsNavigation'

/** Seleção da visão Documentos, reativa a mudanças vindas de qualquer lugar
 *  (o store em lib/docsNavigation fica livre de React). */
export function useDocsSelection() {
  return useSyncExternalStore(subscribeDocsSelection, getDocsSelection)
}
