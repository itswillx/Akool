# Loja (finance/store)

Submódulo de finanças para revenda de itens (placas de vídeo, processadores,
itens avulsos): estoque, pipeline de venda, clientes e lucro. Renderizado como
a aba `store` do FinancePanel, dentro do `FinanceMobileContext.Provider`.

## Arquivos

```
index.ts                 barrel público (FinancePanel faz lazy import daqui)
FinanceStoreTab.tsx      orquestrador: sub-nav segmentada + modais
useFinanceStore.ts       camada de dados otimista + integração com transações
storeUi.ts               mapas de cor/label sem JSX (padrão projectsUi.ts)
StoreOverview.tsx        capital parado, resultado do mês, pipeline
InventoryView.tsx        produtos com estoque derivado; repor via PurchaseModal
SalesView.tsx            pipeline com transições de status + confirmações
CustomersView.tsx        clientes com histórico derivado das vendas
ProductModal.tsx         form de produto; criação embute a compra inicial
PurchaseModal.tsx        reposição/edição de compra
SaleModal.tsx            form de venda (N itens, frete, taxas, lucro ao vivo)
CustomerModal.tsx        form de cliente
```

Lógica pura em `src/lib/financeStoreCalc.ts` (com testes ao lado).
Migration: `supabase/migrations/20260728120000_finance_store_module.sql`.

## Decisões

* **Estoque é derivado, nunca armazenado**: disponível = comprado − vendido −
  reservado (`productStock`). Vendas `negotiating` reservam; `cancelled`
  devolve as unidades sozinha. Não existe coluna `quantity_on_hand`.
* **Modelo misto** numa tabela só: `products.kind 'unique'|'stock'`. Item único
  nasce com uma purchase de qty 1 embutida no ProductModal; reposição de stock
  é uma purchase nova.
* **Snapshot na venda**: `sale_items` congela `product_name`, `unit_price` e
  `unit_cost_at_sale` — editar/apagar o produto depois não reescreve o lucro
  histórico.
* **Integração com o fluxo de caixa pelo lado da Loja**:
  `sales.transaction_id` / `purchases.transaction_id` → `finance_transactions`
  com `ON DELETE SET NULL`. Sempre **uma** transação por venda (agregado
  líquido = itens + frete cobrado − taxas). Marcar `sold` pode criar a receita;
  `cancelled` a remove; qualquer edição de dinheiro numa venda transacionada
  re-sincroniza o amount (`syncSaleTx`). Transação apagada à mão na aba
  Transações apenas deslinka.
* Todo write em `finance_transactions` dispara o CustomEvent
  `finance_transactions_changed`; o FinancePanel escuta e dá `reload()` — a
  transação aparece na aba Transações sem F5.
* **Fornecedores são os mesmos `finance_suppliers` de Obras** (uma agenda só);
  clientes são tabela própria (`finance_store_customers`).
* Workspace: toda linha usa o `workspaceId` da prop no momento da criação (a
  Loja é um domínio único, diferente de Obras onde filhos herdam do projeto).
* Anexos no bucket privado `store-files` via `AttachmentField` (prop `bucket`);
  leitura só por signed URL; remover a linha remove os objetos antes.
* Dinheiro em centavos (`toCents`/`formatBRL`), datas `'YYYY-MM-DD'` fatiadas
  como texto.
