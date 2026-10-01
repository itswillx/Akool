# Backlog Akool: um shell de modal só (saiu do QA-004)

> 1 card no formato BacklogCard v1. Importar em Projetos → Importar, no quadro da auditoria 2026-09.
> Separado do QA-004 em 01/10/2026: o lote 23 criou o `Backdrop` e o usou nos 4 shells de modal, no `ConfirmDeleteModal` e no `Drawer` (10 dos 21 overlays à mão). Ficaram os 11 overlays especializados e os 4 shells quase iguais.

## Tópico: Qualidade de código

### CARD QA-007 — Unificar os shells de modal e os overlays restantes no Backdrop

| Campo          | Valor                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------- |
| **ID**         | QA-007                                                                                        |
| **Prioridade** | P3                                                                                            |
| **Esforço**    | M                                                                                             |
| **Labels**     | qualidade, refactor, duplicação, modais                                                       |
| **Arquivos**   | `src/components/Backdrop.tsx`, `src/modules/projects/ModalShell.tsx`, `src/modules/projects/ui.tsx`, `src/modules/finance/ui/Modal.tsx`, `src/modules/study/StudyBits.tsx` |

**Problema:** Existem 4 shells de modal quase iguais (`projects/ModalShell`, `projects/ui.Modal`, `finance/ui/Modal`, `study/StudyBits.ModalShell`), cada um com a folha de celular e o diálogo centrado, diferindo só em largura, `zIndex`, regra de fechar pelo fundo e alça de arrastar. Fora deles, 11 overlays ainda montam `position: fixed; inset: 0` à mão: lightbox de anexos (`CardSections`, `finance/ui/AttachmentField`), recorte do avatar, tour de boas-vindas, grafo em tela cheia (`GraphCanvas`), popover e modal de compartilhar (`SharePageModal`, `PageHeader`), configurações (`UserSettingsModal`), importação de cards (`ImportProjectCardsModal`) e a gaveta da sidebar (`App.tsx`). Regras de Esc, foco preso e `aria-*` (UX-003) ficam repetidas em cada um.

**Subtarefas Kanban:**

- [ ] Um `ModalShell` em `src/components/` (título, X, folha no celular, centrado no desktop, `width`, `zIndex`, `dismissOnBackdrop`, alça opcional) sobre o `Backdrop` e o `useDialog`
- [ ] Os 4 shells dos módulos viram reexports ou somem; os usos passam a importar de `src/components`
- [ ] Os 11 overlays especializados usam o `Backdrop` (mantendo cor, `zIndex` e alinhamento de cada um)
- [ ] Trava: nenhum `position: 'fixed', inset: 0` fora de `Backdrop.tsx` em `src/` (teste de higiene)
