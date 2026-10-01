import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import { tabId, tabPanelId } from '../lib/tabs'

// UX-008: abas no padrão WAI-ARIA (tablist/tab/tabpanel). O app não tinha
// nenhuma: as abas eram botões soltos, e o leitor de tela não dizia qual estava
// selecionada nem quantas havia. Uma parada de Tab; ←/→ trocam de aba (e já a
// abrem), Home/End vão à primeira/última. O botão de cada aba é desenhado por
// quem usa (render prop), então o visual de cada tela continua igual.

export interface TabProps {
  id: string
  role: 'tab'
  'aria-selected': boolean
  'aria-controls': string
  tabIndex: 0 | -1
  onClick: () => void
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void
}

export function Tabs<T extends string>({ idBase, items, selected, onSelect, label, style, className, renderTab }: {
  /** Prefixo dos ids (aba ↔ painel). Único na página. */
  idBase: string
  items: readonly T[]
  selected: T
  onSelect: (id: T) => void
  /** Nome do grupo de abas para o leitor de tela. */
  label: string
  style?: CSSProperties
  className?: string
  renderTab: (id: T, props: TabProps, isSelected: boolean) => ReactNode
}) {
  // O foco vai para a aba pelo id: a aba já existe no DOM, só não está focada.
  const moveTo = (id: T) => {
    onSelect(id)
    document.getElementById(tabId(idBase, id))?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLElement>, index: number) => {
    const last = items.length - 1
    const target =
      e.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : e.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : null
    if (target === null) return
    e.preventDefault()
    moveTo(items[target])
  }

  return (
    <div role="tablist" aria-label={label} style={style} className={className}>
      {items.map((id, index) => {
        const isSelected = id === selected
        return renderTab(id, {
          id: tabId(idBase, id),
          role: 'tab',
          'aria-selected': isSelected,
          'aria-controls': tabPanelId(idBase, id),
          tabIndex: isSelected ? 0 : -1,
          onClick: () => onSelect(id),
          onKeyDown: e => onKeyDown(e, index),
        }, isSelected)
      })}
    </div>
  )
}
