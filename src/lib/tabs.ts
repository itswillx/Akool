// Ids que ligam aba ↔ painel no componente Tabs (UX-008). Ficam fora do
// componente para o fast refresh continuar funcionando nele.

export const tabId = (idBase: string, id: string) => `${idBase}-tab-${id}`
export const tabPanelId = (idBase: string, id: string) => `${idBase}-panel-${id}`

/** Props do painel da aba selecionada. */
export function tabPanelProps(idBase: string, selected: string) {
  return {
    id: tabPanelId(idBase, selected),
    role: 'tabpanel' as const,
    'aria-labelledby': tabId(idBase, selected),
    tabIndex: 0 as const,
  }
}
