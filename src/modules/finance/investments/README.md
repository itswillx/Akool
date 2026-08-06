# Investimentos

Para onde vai o dinheiro que sai da conta corrente e **não** é despesa.

## O problema que este módulo resolve

Antes dele, um aporte detectado no extrato era apenas **desmarcado** no preview
do import ([`statementImport.ts`](../../../lib/statementImport.ts)), para não
inflar receita/despesa do mês. O efeito colateral é que o dinheiro sumia:

- o saldo da conta calculado pelo app (`initial_balance + receitas − despesas`)
  ficava **maior** que o do banco;
- o "Patrimônio" ignorava tudo que estava aplicado.

Agora o movimento vai para `finance_investment_movements` — fora de
`finance_transactions`, então continua sem inflar os totais do mês — e
`accountBalance` o subtrai explicitamente pelo 3º parâmetro.

## Decisões

- **Posição derivada, nunca armazenada.** `aplicado = opening_balance + Σ
  movimentos com sinal` ([`financeInvestmentCalc.ts`](../../../lib/financeInvestmentCalc.ts)),
  mesma disciplina do estoque da Loja. Apagar ou reimportar um movimento
  restaura o número sozinho.
- **Duas tabelas de sinal separadas**: como o movimento muda a *posição* e como
  muda a *conta corrente*. Um aporte mexe nas duas em direções opostas; um
  rendimento creditado na conta mexe só na conta; um capitalizado dentro do
  produto mexe só na posição. Juntar as duas foi o que fez o app reportar um
  saldo que não batia com o banco.
- **`aplicado` é custo/principal, não valor de mercado.** Um extrato de conta
  corrente só mostra dinheiro que *atravessou a conta*, então a capitalização
  interna do CDB é invisível para o import. Toda linha importada nasce com
  `settles_in_account = true`. O card de topo diz isso literalmente — ler o
  número como valor de carteira é exatamente o erro que o módulo existe para
  corrigir.
- **`opening_balance` é constante editável**, como
  `finance_accounts.initial_balance`, não cache. Resolve o cold start de quem já
  tinha saldo aplicado antes do primeiro extrato — o import não tem como
  adivinhar isso.
- **Idempotência real na reimportação** via unique parcial em
  `(investment_id, import_key)`. É algo que `finance_transactions` não tem: lá a
  deduplicação é heurística por falta de coluna FITID.
- **Não busca dados.** Posições e movimentos já vêm do `useFinanceData` do
  `FinancePanel`, porque todo saldo de conta depende deles. Buscar de novo aqui
  dobraria as queries e deixaria as duas cópias divergirem após uma escrita.

## Como as posições nascem

Sozinhas, na importação de extrato.
[`investmentClassifier.ts`](../../../lib/investmentClassifier.ts) reconhece o
produto, a instituição e a direção do movimento na descrição, e devolve um
`matchKey` estável (`'c6|cdb'`) derivado **só de tokens** — nunca de valor, data
ou contraparte numérica — para que o mesmo produto case mês após mês.

Aporte × resgate é decidido pelo **sinal** da linha, não pela palavra: o sinal é
fato do razão, a palavra é texto. Quando os dois discordam, o sinal vence e a
linha cai para `confidence: 'low'`, chegando desmarcada no preview para o
usuário confirmar. É essa regra que mantém a aritmética do saldo consistente.
