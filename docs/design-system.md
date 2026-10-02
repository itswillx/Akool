# Design system do Akool

Os tokens que o app usa, com o papel de cada um, e as regras para não sair deles. A fonte é `src/index.css` (`:root` claro, `html.dark` escuro); os aliases para código ficam em `src/shared/ui/uiTokens.ts`. O lint (`akool/no-hex-color`, UX-015) recusa cor hex nova fora das paletas de dados.

## Cores

| Token | Claro | Escuro | Para quê |
|---|---|---|---|
| `--color-bg` | `#ffffff` | `#191919` | fundo da área de trabalho |
| `--color-bg-secondary` | `#f7f6f3` | `#1f1f1f` | barra lateral, cabeçalhos, folhas |
| `--color-bg-tertiary` | `#faf9f7` | `#252525` | blocos de destaque suave |
| `--color-surface` | `#ffffff` | `#252525` | cartões, modais, popovers |
| `--color-border` / `-hover` / `-active` | `#e9e9e7` / `#ebebea` / `#e3e2e0` | `#2d2d2d` / `#383838` / `#454545` | bordas e os seus estados |
| `--color-text` | `#37352f` | `#e8e8e6` | texto principal |
| `--color-text-muted` | `#71706b` | `#8f8f8b` | texto secundário (4,5:1 no fundo) |
| `--color-text-subtle` | `#6b6b6b` | `#a0a09d` | rótulos de campo |
| `--color-icon` | `#8a8985` | `#7a7a77` | ícone que carrega sentido (3:1) |
| `--color-hover` / `--color-active` | `#ebebea` / `#e3e2e0` | `#2d2d2d` / `#383838` | fundo de item em hover / selecionado |
| `--color-btn-primary` / `-hover` / `-text` | grafite `#37352f` | `#e8e8e6` | **botão primário** (a ação principal de cada tela) |
| `--color-btn-disabled` / `-text` | `#e9e9e7` / `#9b9a97` | `#2d2d2d` / `#7a7a77` | botão desabilitado |
| `--color-primary` | azul `#3b82f6` | `#60a5fa` | links, foco, divisor arrastando |
| `--color-accent` / `--color-accent-soft` | índigo `#6366f1` / 13 % | `#818cf8` / 18 % | **destaque**: chips e filtros ativos, ícones de atalho, bolinha de notificação, barras de progresso, cabeçalhos de estados vazios |
| `--color-done` / `--color-success` | verde `#10b981` | `#10b981` / `#34d399` | concluído, receita |
| `--color-error` | `#ef4444` | `#f87171` | erro, despesa, exclusão |
| `--color-warning` | `#f59e0b` | `#fbbf24` | atenção, atrasado |
| `--color-logo-bg` / `-text` | `#37352f` / `#ffffff` | `#e8e8e6` / `#191919` | o "A" do logotipo |
| `--sticky-*-bg` / `-border` | amarelo, verde, rosa, azul, roxo | versões escuras | notas rápidas |

Três cores de "ação" diferentes, de propósito:

- **`btn-primary` (grafite):** o botão que conclui a tela (Salvar, Criar, Entrar). Um por tela.
- **`primary` (azul):** o que é link ou foco; não é fundo de botão.
- **`accent` (índigo):** o que está selecionado ou merece o olhar (chip ativo, contador, ícone de módulo). Nunca em texto corrido.

## Paletas de dados (ficam hex)

Cores que a pessoa escolhe e que vão para o banco não são tokens: cor de quadro (`BOARD_COLORS`), de categoria (`CATEGORY_COLORS`), de conta e meta (`ACCOUNT_COLORS`, `GOAL_COLORS`), de avatar (`AVATAR_COLORS`), as prioridades (`src/lib/priorities.ts`) e os status da fila (`QueueModal`). O PDF (`financePdf.ts`) também usa hex: o jsPDF e o canvas não leem CSS. Esses arquivos estão liberados no `eslint.config.js`.

## Espaçamento

Escala em px, em `padding`/`gap`/`margin`: **4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32**. Regras práticas: 4–6 entre ícone e texto; 8–10 dentro de botões e campos; 12–16 entre blocos de um cartão; 20–24 de margem de modal e seção; 32 só em estados vazios.

## Raios

| px | Onde |
|---|---|
| 6 | campos, botões pequenos, badges |
| 8 | botões, itens de nav, chips |
| 10 | botões do tour |
| 12 | modais no desktop, cartões |
| 14–16 | cartões de destaque, caixa de confirmação |
| 20 | folhas no celular (cantos de cima), tour |
| 999 / 50% | pílulas e bolinhas |

## Tipografia

Fonte do sistema (`-apple-system, BlinkMacSystemFont, "Segoe UI", …`); a Space Grotesk só no nome "Akool" das telas de entrada (servida de `/fonts`, UX-014).

| Tamanho | Uso |
|---|---|
| 10–11 | badges, contadores, rótulos em caixa alta |
| 12–12.5 | metadados, texto auxiliar |
| 13–13.5 | corpo denso (listas, navs, tabelas) |
| 14 | corpo, campos de formulário |
| 15–17 | títulos de cartão e de folha |
| 19–21 | títulos de seção e do tour |
| 26–28 | título de página (Dashboard, Ajuda) |

Pesos: 500 (texto de nav), 600 (ênfase, botões), 700 (títulos). Caixa alta só com `letterSpacing` 0.4–0.7 e 10–11 px.

## Sombras e camadas

- Modais e popovers: `0 8px 32px rgba(0,0,0,0.3)`; folhas no celular: `0 -8px 32px rgba(0,0,0,0.3)`; gaveta: `-14px 0 44px rgba(0,0,0,0.22)`.
- Fundo escurecido (`Backdrop`): `rgba(0,0,0,0.5)` para modais e folhas, `0.4` para confirmações.
- `zIndex`: 55 sidebar no celular · 200 tour · 900 grafo em tela cheia · 1000 modais e gavetas · 1100 modais sobre modais (importação, lightbox).

## Regras

1. Cor só por token; hex só nas paletas de dados listadas acima.
2. Tema escuro: todo token tem valor em `html.dark`; nada de `#fff` fixo em texto.
3. Contraste: texto 4,5:1, ícone com sentido 3:1 (os valores acima já cumprem; `scripts/theme-contrast.test.ts` confere).
4. Foco visível pela regra global (UX-004); não remover `outline` sem substituto.
5. Antes de inventar um tamanho ou raio, use o da escala.
