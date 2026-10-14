# Loja (finance/store)

Submódulo de finanças para revenda de itens (placas de vídeo, processadores,
itens avulsos): estoque, pipeline de venda, clientes e lucro. Renderizado como
a aba `store` do FinancePanel, dentro do `FinanceMobileContext.Provider`.

## Arquivos

```
index.ts                 barrel público
FinanceStoreTab.tsx      orquestrador: sub-nav segmentada + modais
useFinanceStore.ts       estado da Loja; vendas pelas RPCs (API-028), o resto otimista
storeUi.ts               mapas de cor/label sem JSX (padrão projectsUi.ts)
saleTransitions.ts       reexporta as transições do _domain + as chaves dos botões
StoreOverview.tsx        capital parado, resultado do mês, pipeline
InventoryView.tsx        produtos com estoque derivado; repor via PurchaseModal
PurchasesBoard.tsx       funil de compra em kanban (quoting→purchased→received)
SalesView.tsx            pipeline: toggle quadro/lista, transições + confirmações
SalesBoard.tsx           kanban do pipeline de venda
StatusConfirmModal.tsx   confirmação das transições que mexem em transações
CustomersView.tsx        clientes com histórico derivado das vendas
ProductModal.tsx         form de produto; criação embute a compra inicial
PurchaseModal.tsx        reposição/edição de compra, com seletor de fase
SaleModal.tsx            form de venda (N itens, frete, taxas, lucro ao vivo)
CustomerModal.tsx        form de cliente
```

A Loja é a sub-aba `store` de **Projetos**; o `store` vem por prop (o
Resumo de lá lê os mesmos dados e duas cópias divergiriam na primeira escrita).

Lógica pura em `supabase/functions/_domain/financeStoreCalc.ts` e
`_domain/saleTransitions.ts` (com testes ao lado), reexportada por
`src/lib/financeStoreCalc.ts` e por `saleTransitions.ts` daqui. As RPCs das
vendas ficam em `src/lib/data/financeStore.ts`.
Migrations: `supabase/migrations/20260728120000_finance_store_module.sql` e
`20261012120000_api028_store_sales_server.sql` (vendas no servidor).
Harness: `supabase/checks/api028-store-sales.sql`.

## Decisões

* **Estoque é derivado, nunca armazenado**: disponível = comprado − vendido −
  reservado (`productStock`). Vendas `negotiating` reservam; `cancelled`
  devolve as unidades sozinha. Não existe coluna `quantity_on_hand`.
* **Funil de compra** (`purchases.status`, migration `20260805120000`):
  `quoting → purchased → received`. Só `quoting` fica **fora** do estoque e do
  custo médio — é intenção, o dinheiro não saiu. `purchased` já conta (é meu,
  ainda que a caminho). Linhas sem `status` contam, por compatibilidade.
  Voltar de `purchased` para `quoting` **apaga a despesa vinculada**, espelhando
  o `reopen` da venda.
* **Modelo misto** numa tabela só: `products.kind 'unique'|'stock'`. Item único
  nasce com uma purchase de qty 1 embutida no ProductModal; reposição de stock
  é uma purchase nova.
* **Snapshot na venda**: `sale_items` congela `product_name`, `unit_price` e
  `unit_cost_at_sale` — editar/apagar o produto depois não reescreve o lucro
  histórico.
* **Integração com o fluxo de caixa pelo lado da Loja**:
  `sales.transaction_id` / `purchases.transaction_id` → `finance_transactions`
  com `ON DELETE SET NULL`. Sempre **uma** transação por venda (agregado
  líquido = itens + frete cobrado − taxas). Transação apagada à mão na aba
  Transações apenas deslinka.
* **Vendas no servidor (API-028)**: venda, itens e receita vinculada mudam
  por 8 RPCs SECURITY INVOKER (`store_sale_create`, `_set_status`, `_update`,
  `_items_add`, `_items_update`, `_items_remove`, `_generate_income` e
  `_delete`), cada uma numa transação; o hook não tem otimismo nas vendas e
  adota o que volta. Marcar `sold` pode criar a receita; reabrir e cancelar a
  apagam; toda mudança de dinheiro, data ou conta re-sincroniza a receita na
  mesma chamada (também enviada → vendida com outra data). A receita de outra
  pessoa (invisível para quem chama, como a de quem saiu do workspace) só
  barra o que mexe nela: editar a nota passa; mudar o líquido, a data ou a
  conta, cancelar e excluir dão 42501, e o texto diz que quem a lançou a
  altera ou apaga em Transações. A receita nasce no workspace da venda quando
  quem vende é membro. Líquido <= 0 com receita é recusado: o
  `StatusConfirmModal` desliga "Criar receita" e o `SaleModal` não deixa tirar
  o último item que zeraria o líquido (adicione o novo antes).
* **O item segue a venda** (API-028): nas policies de
  `finance_store_sale_items`, o SELECT vale para o dono do item ou para quem
  vê a venda; o UPDATE e o DELETE valem só para quem vê a venda. O item não
  sai do workspace da venda. Assim:
  - a dona removida do workspace (ou que saiu) vê, tira e soma na receita o
    item que um membro pôs na venda dela;
  - o líquido não muda conforme quem chama;
  - quando a venda sai do workspace, o item de outra pessoa que ficou nela
    some para os membros que já não veem a venda: eles não o leem, não mudam
    o preço e não o apagam. O autor dele ainda o lê.
* **Regras no banco (API-028)**: os gatilhos `private.store_sale_rules` e
  `private.store_sale_item_rules` (DEFINER, predicado explícito) valem para
  qualquer cliente, inclusive a escrita direta: status só nos 10 pares de
  `_domain/saleTransitions.ts`, venda nova em negociação, `sold_on`
  obrigatório na venda consumida e até amanhã em São Paulo, `delivered_on` só
  na entregue (até amanhã e não antes do `sold_on`, também quando é o
  `sold_on` da entregue que muda), estoque global
  (todas as linhas do produto, também as que a pessoa não vê), item único com
  1 unidade, produto arquivado fora de venda nova, cliente/conta/receita do
  escopo do dono da venda. Dinheiro >= 0 por CHECK nas 4 tabelas. As recusas
  viram texto traduzido por `storeErrorKey` (`src/lib/data/financeStore.ts`):
  a aba mostra no aviso do topo, o `SaleModal` no próprio modal e a lista
  (o caminho do celular) na linha da venda; o kanban reverte o card. O teto
  dos inputs de data da venda é `saleDateMax` (`saleDates.ts`): o menor entre
  o amanhã do aparelho e o de São Paulo.
* **Compras e produtos recusados** (até o API-037, que os leva para o
  servidor): o CHECK de dinheiro >= 0 recusa o negativo digitado (o `min="0"`
  não barra). `PurchaseModal` e `ProductModal` desligam o Salvar com valor
  negativo e só fecham quando a gravação deu certo; a compra recusada apaga a
  despesa que acabou de lançar, a edição recusada volta a tela, e o motivo
  sai traduzido. O produto novo cuja compra inicial foi recusada fica criado
  sem estoque: salvar de novo regrava só a compra.
* **Marcar como comprado no kanban**: o `ExpenseConfirmModal` grava pelo
  `markPurchased`, que lança a despesa a partir da compra que abriu o modal e
  grava o status e o vínculo num update só (sem depender do estado depois do
  update). Recusada a compra, a despesa recém-lançada é apagada; o modal só
  fecha quando deu certo, e o card volta quando a pessoa desiste. As outras
  mudanças de fase devolvem ao kanban o ok real.
* **A despesa da compra tem valor > 0** (CHECK `amount > 0` de
  `finance_transactions`; o custo zero da compra continua valendo). Com o
  total zero, "Gerar despesa" desliga e desmarca nos três modais, com a dica;
  `createPurchase` e `markPurchased` não lançam despesa de total zero, e a
  compra com despesa não vai a zero (`updatePurchase` recusa antes de gravar:
  apague antes a despesa em Transações). A trava é só da edição que leva o
  total a zero: a compra antiga já com total zero e despesa ainda muda de
  fase, notas e data, e a despesa recebe só a data. A recusa da despesa conta como
  falha, com o motivo traduzido: a compra nova não grava sem ela; na edição,
  a compra fica gravada, e salvar de novo regrava a despesa.
* **`updated_at` é do servidor** nas 5 tabelas (gatilho em UPDATE; o restore
  guarda o do backup): o app não manda mais o relógio do aparelho.
* Todo write em `finance_transactions` dispara o CustomEvent
  `finance_transactions_changed`; o FinancePanel escuta e dá `reload()` — a
  transação aparece na aba Transações sem F5.
* **`finance_suppliers` veio de Obras e a Loja é a última dona.** Obras foi
  removida em 2026-08-07; a tabela sobreviveu por causa daqui (ver
  `../README.md`). Clientes são tabela própria (`finance_store_customers`).
* Workspace: toda linha usa o `workspaceId` da prop no momento da criação — a
  Loja é um domínio único, sem hierarquia de onde herdar. A exceção são os
  itens de venda: o gatilho dá a eles o workspace da venda (API-028).
* Anexos no bucket privado `store-files` via `AttachmentField` (prop `bucket`,
  hoje em `../ui/`); leitura só por signed URL. Produto e compra removem os
  objetos antes da linha; a venda, depois (`store_sale_delete` devolve os
  caminhos): um anexo órfão no bucket é menos grave que uma venda sem anexos.
* Dinheiro em centavos (`toCents`/`formatBRL`), datas `'YYYY-MM-DD'` fatiadas
  como texto.
