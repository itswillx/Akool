// Config do bloco de diagrama do BlockNote. Fica num arquivo sem componente
// para o DiagramBlockView exportar só o componente (react-refresh).
export const diagramBlockConfig = {
  type: 'diagram' as const,
  propSchema: {
    elements: {
      default: '[]',
    },
    appState: {
      default: '{}',
    },
    collapsed: {
      default: 'false',
    },
  },
  content: 'none' as const,
}
