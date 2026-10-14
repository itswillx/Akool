# Projetos (`src/modules/finance/myprojects`)

A aba de **Metas**, mais um **Resumo** que mostra as metas por fase.

Nasceu com quatro domínios: **Obras** e **Investimentos** saíram em 2026-08-07, e
a **Loja** saiu do frontend em 2026-10-14 (tabelas mantidas; ver "Fora do
frontend" em `docs/arquitetura.md`).

> O app tem outra seção chamada "Projetos" no menu global (`ProjectsPanel`, o
> kanban de tarefas). São coisas diferentes em níveis de navegação diferentes, e
> a fronteira do `../README.md` continua valendo: nada daqui importa nada de lá.

## Por que o `TabId` é `'myprojects'` e não `'projects'`

Só o **rótulo** diz "Projetos"; o id interno não pode.

`'projects'` era o id da aba de Obras. Se o `TabId` novo também fosse
`'projects'`, o mesmo texto significaria "abra a seção Projetos" e "abra Obras",
e quem tem `'projects'` gravado no `localStorage` desde antes cairia no lugar
errado. `section.test.ts` trava esse comportamento.

Mesma razão pela qual a chave `finance_myprojects_section` fica como está —
renomeá-la só derrubaria a preferência de quem já usa.

## Arquivos

```
section.ts          ProjectsSection, validador, mapa de abas legadas, parseFinanceLocation
MyProjectsTab.tsx   sub-nav segmentada (Resumo · Metas)
SummaryView.tsx     o cartão de entrada + o kanban por fase
SummaryBoard.tsx    o kanban por fase (read-only)
unifiedCards.ts     achata a meta num card (sem JSX)
```

Metas não tem arquivo aqui: o `GoalsTab` e seus três modais continuam no
`FinancePanel` e chegam prontos pela prop `goalsSlot`. São treze props, e o
modal de compartilhamento depende do `UserPicker` privado do painel — encanar
tudo isso por um componente que não trata de metas custaria mais do que rende.

## Navegação

`TabId` perdeu `'projects'`, `'store'`, `'investments'` e `'goals'`, e ganhou
`'myprojects'`. A sub-aba (`ProjectsSection`) é estado do **`FinancePanel`**,
não deste componente: um atalho do Resumo precisa poder mandar "vá para Metas"
com a aba já montada, e se o estado morasse aqui dentro (lido do localStorage no
mount) essa navegação viraria um no-op silencioso.

`resolveTabRequest` no `FinancePanel` é o **único** ponto que entende os ids
antigos. Ele atende três formas:

| Entrada | Resultado |
|---|---|
| `'myprojects'` | a aba, mantendo a sub-aba atual |
| `'myprojects:goals'` | a aba, forçando Metas (deep-link) |
| `'goals'` (legado) | idem — cobre um `localStorage` gravado por versão anterior |

`'projects'`, `'investments'` e `'store'` caem no **Resumo**: as sub-abas de
Obras, Investimentos e Loja não existem mais, e apontar para um id que `isProjectsSection`
recusa faria a navegação virar um no-op silencioso.

## Dados

Nada aqui busca dados: as metas vêm por prop do `FinancePanel` (o
`useFinanceData`, de onde o Resumo geral também depende). Até 14/10/2026 este
componente hospedava o hook da Loja.

## O kanban do Resumo

Colunas derivadas por [`src/lib/financePhase.ts`](../../../lib/financePhase.ts):
`planned · doing · done · cancelled` (a última nasce oculta). **Nenhuma coluna
nova no banco** — a fase sempre sai do status que cada domínio já mantém.

**Read-only de propósito.** Concluir uma meta tem regras próprias na aba Metas;
clicar no card leva até lá, onde o movimento é seguro.

O total de cada coluna é o **valor já guardado**, não um saldo. Pelo mesmo motivo
o card de meta soma o **acumulado**, não o alvo — o alvo é intenção e vai no
subtítulo.
