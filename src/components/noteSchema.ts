import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core'
import { DiagramBlock } from './DiagramBlock'
import { ProjectCardBlock } from './blocks/ProjectCardBlock'

// API-020: o schema das notas, fora do NoteEditor para o teste de
// compatibilidade (noteSchema.test.ts) comparar com o spec do validador
// (supabase/functions/_domain/blocknote/spec.ts) e carregar as fixtures no
// editor de verdade. Mudar um bloco aqui exige mudar o spec e republicar a api.
export const noteSchema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, diagram: DiagramBlock(), projectCard: ProjectCardBlock() },
})

// O schema expõe o tipo do bloco parcial (fantasma); evita instanciar os genéricos à mão.
export type NoteBlock = typeof noteSchema.PartialBlock
