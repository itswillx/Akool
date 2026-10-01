import { createReactBlockSpec } from '@blocknote/react'
import { diagramBlockConfig } from './diagramBlockConfig'
import DiagramBlockView from './DiagramBlockView'

// O spec precisa estar no schema do BlockNote de forma síncrona (NoteEditor
// monta o schema em escopo de módulo); o componente e o canvas lazy ficam em
// DiagramBlockView.tsx.
export const DiagramBlock = createReactBlockSpec(diagramBlockConfig, { render: DiagramBlockView })
