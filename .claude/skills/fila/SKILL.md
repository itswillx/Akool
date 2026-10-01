---
name: fila
description: Trabalha a fila de desenvolvimento do Akool (Projetos → Fila) no fluxo por fases. Pega lotes de 3 cards pela API de cards, avalia cada um, apresenta os planos juntos para o usuário aprovar, desenvolve um por vez e manda para Validação; o que depende do usuário vai para "Aguardando você". Use quando o usuário disser /fila, "toca a fila", "próximo lote" ou pedir para montar uma fila por card, tema ou urgência (ex.: "começa por Segurança P0/P1").
---

# Fila de desenvolvimento

A fila vive no Supabase (`public.project_card_queue`) e é acessada pela edge function `cards-api` através da CLI:

```bash
npm run cards -- <comando>
```

Antes de começar, confira no `.env.local`:
- `AKOOL_API_TOKEN`, gerado pelo usuário em Configurações → API.
- `AKOOL_BOARD_ID`, ou passe `--board=<uuid>` em cada comando. Use `npm run cards -- boards` para listar os quadros.

Se o token faltar ou a API responder 401, pare e peça ao usuário para gerar ou renovar o token. Nunca peça a senha dele.

## O fluxo (quadro com colunas por fase)

```
A fazer → Avaliação → Plano → Desenvolvimento → Validação → Concluído
                                  ↘ Aguardando você ↗
```

| Situação | Coluna | Como chega lá |
|---|---|---|
| Na fila, por prioridade | A fazer | `enqueue`, reprovação, retorno automático, `release` |
| IA avaliando | Avaliação | `next --count=3` |
| Plano aguardando aprovação / aprovado | Plano | `note --phase=plano` / `--phase=aprovado` |
| IA desenvolvendo | Desenvolvimento | `note --phase=desenvolvimento` |
| Pronto para o usuário conferir | Validação | `complete` |
| Depende do usuário | Aguardando você | `block … --user-items/--user-item` |
| Validado pelo usuário | Concluído | ele aprova (botão ou arrastando), ou `validate` quando ele pedir no chat |

O quadro move sozinho: a fila move os cards de coluna. Quem valida é **sempre o usuário**; a IA só roda `validate` quando ele pedir no chat ("aprova SEC-006", "reprova SEC-007 porque…"). Um quadro sem essas colunas funciona do jeito antigo (Fazendo/Concluído); `npm run cards -- setup-flow` converte (só o dono, com a confirmação dele).

## Montar a fila (quando o usuário apontar o que atacar)

```bash
npm run cards -- enqueue --card=SEC-001,SEC-002             # cards específicos
npm run cards -- enqueue --label=segurança --priority=P0,P1  # tema E urgência
npm run cards -- enqueue --priority=P0                       # só urgência
npm run cards -- queue                                       # conferir a ordem
```

Os filtros se combinam com E. `--card` soma cards explícitos. Os temas são labels (segurança, performance, confiabilidade…). Mostre a fila resultante ao usuário antes de começar.

A fila é **priorizada**:
- Cada card novo entra logo depois do último item com prioridade igual ou maior. Um urgente passa na frente dos médios, e o que já estava na fila mantém a ordem relativa, inclusive ajustes manuais.
- Dentro do lote, a ordem é prioridade → esforço (`esforço:s` antes de `m` e `l`) → coluna → posição no quadro.
- O enqueue **por filtro** pula cards aguardando o usuário. Eles voltam sozinhos quando o usuário marca os itens dele, ou por `--card=<ID>`.

## Ciclo por lote: Avaliação → Plano → Desenvolvimento → Validação

Todo card passa pelas fases nesta ordem. **Não pule fases e não desenvolva sem plano aprovado.** A regra vale também para pedidos fora da fila; nesse caso não há registro no card, só plan mode e aprovação.

### 1. Avaliação do lote (só leitura)

1. `npm run cards -- next --count=3`. Completa o lote até 3 cards em andamento (fase `avaliacao`, coluna Avaliação) e mostra o Markdown de todos. Cards já em andamento são retomados na fase em que pararam. O usuário pode pedir outro tamanho ("lote de 5").
2. Para cada card: leia o card e os arquivos citados e reproduza o problema sem alterar nada (teste que falha, query só de leitura, chamada que mostre o erro).
3. Levante, por card:
   - o que está confirmado;
   - o que o card diz e não bate mais com o código;
   - riscos;
   - o que depende do usuário (senha, painel do Supabase, GitHub, decisão de produto).
4. Registre cada um: `npm run cards -- note <ID> --phase=avaliacao --note-file=<avaliacao.md>`.

### 2. Plano conjunto (uma aprovação para o lote)

0. **Antes** de entrar em plan mode, rode `npm run cards -- note <ID> --phase=plano` sem texto para cada card do lote. Em plan mode não dá para gravar no card, e assim os cards aparecem na coluna Plano.
1. Entre em plan mode e escreva **um plano com uma seção por card**:
   - arquivos;
   - abordagem;
   - testes;
   - portões de deploy em produção;
   - pendências do usuário.
2. Peça aprovação com `ExitPlanMode` (uma vez para o lote). Se o usuário pedir mudanças, ajuste e peça de novo. **Sem aprovação, não avance.**
3. Depois da aprovação, registre cada plano aprovado: `npm run cards -- note <ID> --phase=aprovado --note-file=<plano-ID.md>`.
4. Card que o usuário não aprovou ou quis adiar: `npm run cards -- release <ID> --note="<motivo>"`. Ele volta para a fila na posição da prioridade.

### 3. Desenvolvimento (um card por vez)

1. `npm run cards -- note <ID> --phase=desenvolvimento`. O card vai para a coluna Desenvolvimento; os outros esperam em Plano (aprovado).
2. Implemente seguindo o padrão do código ao redor. Ao terminar cada subtarefa, marque: `npm run cards -- check <ID> <n>`.
3. Valide antes de mandar para Validação:
   - `npm test`
   - `npm run lint:ci`
   - `npx tsc -b`
   - `npm run build`
   - Se o card mexe na UI, verifique na preview `akool-dev`.
4. **Produção** (migration ou edge function):
   - Faça o ensaio atômico, um `DO` terminando em `RAISE`, para que tudo seja desfeito.
   - Mostre o resultado e peça confirmação **antes** de aplicar, item por item (pode ser uma pergunta com várias opções, uma por item).
   - Depois de aplicar, repita o teste em produção.
5. Escreva a nota em um arquivo temporário do scratchpad, com:
   - **Resumo:** o que mudou e por quê, em 2–4 linhas.
   - **Arquivos:** lista dos arquivos alterados.
   - **Testes:** comandos rodados e resultado (ex.: `npm test`: 532 passaram).
   - **Como conferir:** o que o usuário deve olhar para validar.
6. Feche a parte da IA:
   - `npm run cards -- complete <ID> --note-file=<nota.md>` se tudo foi feito. O card vai para **Validação** com as subtarefas marcadas e a nota na descrição. Ele só vai para Concluído quando o usuário aprovar.
   - Se sobrou algo que só o usuário faz: `block` com os itens dele (veja abaixo).
7. Siga para o próximo card do lote. No fim do lote, resuma em poucas linhas: o que foi para Validação (e como conferir), o que ficou aguardando o usuário, e comece o próximo lote.

Para reordenar a fila:
- um card: `npm run cards -- move <ID> <posição>` (1 = próximo);
- a fila inteira por prioridade e esforço: `npm run cards -- reprioritize`, que desfaz ajustes manuais.

## Aguardando você (em vez de concluir)

```bash
npm run cards -- block <ID> --note-file=<pendencias.md> --user-items=1,2 --user-item="Rotacionar o segredo no painel"
```

- `--user-items` marca subtarefas **existentes** (posição ou id) como do usuário; `--user-item` (repetível) cria subtarefas novas do usuário. Os itens aparecem com o selo "Você" no card.
- O card vai para "Aguardando você". Quando o usuário marca **todos** os itens dele (no app ou pedindo no chat), o card **volta sozinho** para a fila, na posição da prioridade.
- Em card já aguardando, o mesmo comando atualiza as pendências.

Use quando:
- O card exigir algo que só o usuário faz: trocar senha, rotacionar chave, configurar painel, criar repositório, decisão de produto ou pagamento.
- Os testes não passarem e a causa estiver fora do escopo do card.
- O card estiver ambíguo a ponto de mudar o que deve ser feito.

**Nunca mande para Validação um card com teste falhando** ou com subtarefa que não foi feita de verdade. Nesses casos, use `block` e explique no motivo.

## Validação (do usuário)

- Aprovar: botão "Aprovar e concluir" no card ou na fila, ou arrastar o card para Concluído. Pelo chat: `npm run cards -- validate <ID>`.
- Reprovar: botão "Reprovar" com o motivo, ou `npm run cards -- validate <ID> --reject --note="<motivo>"`. O card volta ao **topo** da fila; na avaliação seguinte, leia o motivo na descrição.

## Parar

Pare quando `next` responder "Fila vazia", quando o usuário pedir, ou antes de qualquer ação irreversível ou externa. Nesses casos, pergunte antes de continuar. No fim, mostre `npm run cards -- queue` e resuma o que foi para Validação e o que ficou aguardando o usuário.
