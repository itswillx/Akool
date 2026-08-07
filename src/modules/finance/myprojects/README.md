# Projetos (`src/modules/finance/myprojects`)

A aba que unificou **Loja** e **Metas**, mais um **Resumo** que cruza as duas.
Antes eram abas irmãs na sidebar, sem nenhuma visão consolidada.

Nasceu com quatro domínios: **Obras** e **Investimentos** saíram em 2026-08-07
(ver [`../README.md`](../README.md) para o que virou o quê).

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
MyProjectsTab.tsx   sub-nav segmentada; hospeda o hook de dados da Loja
SummaryView.tsx     dois cartões de entrada + o kanban por fase
SummaryBoard.tsx    o kanban unificado (read-only)
unifiedCards.ts     achata venda/meta num card só (sem JSX)
```

Metas não tem arquivo aqui: o `GoalsTab` e seus três modais continuam no
`FinancePanel` e chegam prontos pela prop `goalsSlot`. São treze props, e o
modal de compartilhamento depende do `UserPicker` privado do painel — encanar
tudo isso por um componente que não trata de metas custaria mais do que rende.

## Navegação

`TabId` perdeu `'projects'`, `'store'`, `'investments'` e `'goals'`, e ganhou
`'myprojects'`. A sub-aba (`ProjectsSection`) é estado do **`FinancePanel`**,
não deste componente: um atalho do Resumo precisa poder mandar "vá para a Loja"
com a aba já montada, e se o estado morasse aqui dentro (lido do localStorage no
mount) essa navegação viraria um no-op silencioso.

`resolveTabRequest` no `FinancePanel` é o **único** ponto que entende os ids
antigos. Ele atende três formas:

| Entrada | Resultado |
|---|---|
| `'myprojects'` | a aba, mantendo a sub-aba atual |
| `'myprojects:store'` | a aba, forçando a Loja (deep-link) |
| `'store'` (legado) | idem — cobre um `localStorage` gravado por versão anterior |

`'projects'` e `'investments'` caem no **Resumo**: as sub-abas de Obras e
Investimentos não existem mais, e apontar para um id que `isProjectsSection`
recusa faria a navegação virar um no-op silencioso.

## Dados

`MyProjectsTab` chama `useFinanceStore` **uma vez** e passa o store por prop
para a sub-aba. Antes cada aba chamava o seu; com o Resumo lendo os mesmos
dados, duas cópias divergiriam na primeira escrita. Metas continua **sem** fetch
próprio (vem por prop do `FinancePanel`, de onde o Resumo geral também depende).

## O kanban do Resumo

Colunas derivadas por [`src/lib/financePhase.ts`](../../../lib/financePhase.ts):
`planned · doing · done · cancelled` (a última nasce oculta). **Nenhuma coluna
nova no banco** — a fase sempre sai do status que cada domínio já mantém.

**Read-only de propósito.** "Em andamento → Concluído" significa duas coisas
diferentes: `sales.status='delivered'` **com efeito em `finance_transactions`** e
`finance_goals.status='completed'`. Reimplementar o `StatusConfirmModal` num
board agregado duplicaria a lógica mais perigosa do módulo. Clicar no card leva
à sub-aba de origem, onde o movimento é seguro.

O total de cada coluna é rotulado **"valor envolvido"**, não "saldo": somar
venda + meta num R$ só é uma ordem de grandeza. Sem o rótulo, vira um número que
ninguém sabe interpretar. Pelo mesmo motivo o card de meta soma o **acumulado**,
não o alvo — o alvo é intenção e vai no subtítulo.
