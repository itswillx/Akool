# Backlogs em Markdown: formato e importação

Os arquivos `backlog-*.md` desta pasta entram no Kanban de Projetos pela tela (Projetos → Importar, `ImportCardsModal`) ou pela linha de comando (`npm run import:cards -- <arquivo.md>`). As duas usam o mesmo parser e o mesmo plano de importação. Este README é a especificação do formato e não é lido como backlog.

## Formato (BacklogCard v1)

O parser é `supabase/functions/_domain/backlogMarkdownParser.ts`, reexportado por `src/lib/backlogMarkdownParser.ts` (API-027).

- `## Tópico: X`.
- `### CARD ABC-123 — Título`.
- Tabela Campo|Valor (ou lista `- **Campo:** valor`) com ID, Prioridade, Esforço, Labels (separadas por vírgula), Arquivos (em crases) e Depende de.
- `**Problema:**` e `**Contexto:**`, depois da tabela.
- `**Subtarefas Kanban:**`.

`backlog-card-sample.md` é o exemplo mínimo: use-o para testar antes de importar um arquivo grande.

## Leitura (API-033)

- CRLF e CR viram LF antes de tudo.
- Tudo é linear, sem regex com retrocesso, porque a tela reparseia a cada tecla.
- Problema e Contexto vão do rótulo até o próximo marcador: `**Subtarefas`, `**Problema:**`, `**Contexto:**`, linha que começa com `---`, `### CARD`, `# ` ou `## `. Um `### Critérios` fica dentro.
- Dentro de cerca de código (```` ``` ```` ou `~~~`, inclusive a aberta na linha do rótulo), os marcadores não contam. A cerca que não fecha vai até o fim do card, e nela só os rótulos do card (`**Subtarefas`, `**Problema:**`, `**Contexto:**`) encerram a seção.
- O texto pode começar na linha do rótulo ou na de baixo. O rótulo fica numa linha própria na descrição só quando o texto começa na linha de baixo com um bloco (lista, lista numerada, citação, título, cerca, tabela), para o bloco renderizar, ou quando a linha do rótulo abre uma cerca (`**Contexto:** ```bash`). Na linha do rótulo, `> 2 s`, `2. fase`, `- nada a declarar` ou `# 1 da lista` é parágrafo: continua depois do rótulo, separado por um espaço, como no parser de antes do API-033. Com o rótulo em linha própria, isso viraria citação (lendo "2 s") ou lista numerada a partir de 1.
- Os metadados são lidos fora das faixas de Problema e Contexto, da lista de subtarefas e das cercas que fecham. Uma tabela ou um `- Prioridade: P0` no Contexto não passa por cima dos do card. Por isso a tabela de metadados vem antes do Problema: o que vem depois dele, até o próximo marcador, é Problema.
- Em `**Subtarefas Kanban:**`, cada item é um `- [ ]` de uma linha, sem bullets aninhados, porque uma linha que não começa com `-` encerra a lista.
- Por convenção, o que só o usuário faz entra como subtarefa com o prefixo `Você:`.

## Depende de (API-033)

- Formato: `| **Depende de** | SEC-001, SEC-002 |` ou `- **Depende de:** SEC-001, SEC-002`.
- Os IDs saem de `/\b[A-Z]{2,5}-\d{3}\b/gi`, em maiúsculas, separados por vírgula, ponto e vírgula, espaço ou "e". `—`, `-`, `nenhum`, `nenhuma` e vazio são sem dependência.
- O que sobra num trecho e não é ID vira `invalid_dependency` (o ID do mesmo trecho entra), e o próprio card vira `self_dependency`.
- Só esse nome de campo vale, e só com IDs. O `- **Dependências:**` do Markdown do card, que tem títulos, não é lido. O "Depende de: …" no texto do Contexto (o formato antigo) também não.
- Resolução (`planCardRows`, `_domain/importPlan.ts`): primeiro o card novo do mesmo arquivo. Depois, o do quadro pelo "ID —" ou "ID -", o mais antigo. Senão, o aviso `dependency_not_found`, sem a aresta. A ordem sai do `oldestFirst`: `created_at` e, no empate, `id`, comparando o texto com < e >, como o `order by created_at, id` do Postgres. O `Date.parse` perderia os microssegundos, e todos os cards de uma importação têm o mesmo `created_at`; o `localeCompare` segue o idioma, não os bytes.
- Ciclo entre os cards novos (com o caminho) e mais de 100 dependências bloqueiam a importação inteira, como os limites de subtarefas. O ciclo que passa por um card pulado não conta.
- O card que já está no quadro é pulado e não muda. O aviso `dependency_not_applied` cita as dependências que faltam nele; a importação não atualiza o `depends_on` de card existente.
- A gravação é por níveis (`insertBatches`), porque o gatilho do API-013 recusa a dependência que ainda não existe, inclusive a que vem depois no mesmo INSERT. Se um lote falha, os anteriores ficam com as dependências completas, e a nova tentativa com "pular duplicados" grava o resto.

## Importar

- A prévia da tela (`ImportCardsModal`) roda o mesmo `planCardRows` contra os cards do quadro em memória. Ela mostra ciclo, limites e dependências não encontradas antes de gravar, e um problema que bloqueia desliga o botão. Depois de importar, os avisos são os da gravação, e com aviso o modal não fecha sozinho. A prévia põe os cards em memória, que vêm na ordem do quadro (`sort_order`), no mesmo `oldestFirst` da gravação. Assim, com dois cards do mesmo ID externo, as duas escolhem o mesmo card para pular, para resolver a dependência e para o aviso `dependency_not_applied`.
- Pela linha de comando, rode antes `npm run import:cards -- docs/imports/<arquivo>.md --dry-run` e confira, card a card, o número de subtarefas, a presença do Contexto e a ausência de avisos. O dry-run lista as dependências, as que ficam fora do arquivo (procuradas no quadro só na importação) e os problemas que bloqueiam; com algum, sai com 1. As variáveis (`IMPORT_USER_EMAIL` e `IMPORT_USER_PASSWORD`, ou `SUPABASE_SERVICE_ROLE_KEY` com `--user-id`) estão no `.env.example`, e `npm run import:cards` sem argumentos mostra as opções.
- Os avisos do parser saem de dois jeitos: `warnings`, com o texto da CLI, e `issues`, com o código. A tela traduz as `issues` com `backlogIssueText` e os avisos do plano com `importWarningText` (`_domain/importPlan.ts`). Os problemas do plano que impedem a importação saem com `importIssueText(issue, t)`, nas chaves `projects_import_error_*` (`{id}`, `{detail}` e o limite em `{max}`). A tela passa o seu `t`, inclusive para os `errors` do `importParsedCards` (opção `t`); a CLI passa o `tPtBR` (`_domain/i18n.pt-BR.ts`).

## Golden do parser

O golden `supabase/functions/_domain/fixtures/backlogs.golden.json` guarda o resultado do parser em cada backlog desta pasta (menos este README). Por card, ele tem ID, prioridade, esforço, tópico, rótulos, número de arquivos, subtarefas feitas/total e o sha256 do card sem o `dependsOn`, que pega título, descrição e o texto das subtarefas.

- O `dependsOn` entra no fim da linha só quando existe, e assim os backlogs de antes do campo saem iguais.
- Quem muda um backlog desta pasta (ou o parser, de propósito) regrava com `npx vitest run supabase/functions/_domain/backlogMarkdownParser.test.ts -u` e confere o diff do golden no PR.
- O `-u` vai depois do arquivo: no vitest 4 ele aceita um valor, e `-u <arquivo>` engole o arquivo e roda a suíte inteira.
