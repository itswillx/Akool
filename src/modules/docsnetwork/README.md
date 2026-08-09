# Rede (Documentos)

Grafo interativo de como as coisas do usuário se conectam: páginas, quadros e
cards do Kanban, notas rápidas e colaboradores. Seção de Documentos, ao lado de
Projetos / Notas rápidas / Estudos.

## Por que ele existe assim

**Não há links página↔página no app** — sem wiki-links, sem backlinks, sem
tabela de links. Um grafo só de páginas redesenharia a árvore da sidebar e nada
mais. Por isso o grafo puxa as conexões que já são relacionais no banco:

| Aresta | De onde vem |
|---|---|
| `parent-page` | `pages.parent_id` |
| `board-card` | `project_cards.board_id` |
| `card-parent` | `project_cards.parent_card_id` |
| `card-depends` | `project_cards.depends_on[]` |
| `card-page` | `project_cards.linked_page_id` |
| `note-link` | `quick_notes.linked_items[]` |
| `assignee` | `project_cards.assignee_user_id` |
| `page-share` | `page_shares` |
| `board-share` | `project_shares` |

**Tamanho do nó = grau** (vizinhos distintos), não valor: o grafo responde
"o que é o centro de gravidade daqui" e "o que está solto".

## Decisões que não são óbvias

- **O usuário logado nunca é nó.** Ele é dono de quase tudo; um nó "eu" ligado
  ao grafo inteiro destruiria o layout de força e o ranking de grau. O loader
  garante isso removendo o próprio id do mapa de perfis.
- **O filtro de tipos entra DENTRO do `buildDocsGraph`**, antes de contar grau.
  Esconder colaboradores tem que encolher as páginas às quais estavam ligados —
  aplicar o filtro depois deixaria o raio prometendo ligações invisíveis.
- **Arestas paralelas colapsam** por par não-ordenado. Dois itens podem estar
  ligados de mais de um jeito (card que é subtarefa E dependência); sem colapso
  o "grau" viraria contagem de relações, não de vizinhos.
- **Teto de 300 nós** (`capGraph`): o layout de força é O(n²) e um kanban grande
  passa fácil de centenas de cards. O corte é sinalizado na UI — grafo menor em
  silêncio se lê como "é só isso que existe".
- **Não mexemos no `ProjectsPanel`** para pegar os dados do Kanban. Os loaders
  de lá escrevem em cinco `useState` do painel, consultam refs para decidir se o
  refresh é silencioso e governam a restauração do modal de card. `lib/
  docsGraphData.ts` espelha as queries, como `lib/projectImport.ts` já fazia.

## Fora do escopo da v1

- Links escritos **dentro** do conteúdo BlockNote (o bloco `projectCard`
  embedado numa página). Exigiria baixar e varrer o JSON de `note_contents` de
  todas as páginas.
- `sharedPages` (páginas em que o usuário é viewer/editor) — o rail lateral de
  Documentos também não as lista, então o grafo segue o mesmo escopo.
- Dados de Estudos.

## Onde mora o quê

- `src/lib/docsGraph.ts` — modelo puro (nós, arestas, grau, rankings). Testado.
- `src/lib/docsGraphData.ts` — as queries Supabase. Sem lógica.
- `src/lib/graph.ts` — helpers neutros de grafo, compartilhados com a Rede do
  financeiro (busca, faixa de valores, vizinhos, corte).
- `src/components/graph/GraphCanvas.tsx` — o SVG (pan/zoom/hover/seleção),
  também compartilhado. `DocsGraphView` é o adaptador deste domínio.
- Nada aqui importa de `modules/finance` ou `modules/projects` — o que é comum
  subiu para `src/lib` e `src/components`.
