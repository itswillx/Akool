import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import akool from './scripts/eslint-plugin-akool.mjs'

// API-027: o fuso no fim do texto que vai ao `new Date` em _domain e _api. O Z
// ou o offset vêm logo depois dos minutos ou dos segundos ('…T01:30Z',
// '…00.123+00:00', '…00-0300'); sem isso, o '-2025' de '03-10-2025' (hora local
// no V8) contaria como offset. Sem a flag i: o 'z' minúsculo é Invalid Date no
// Safari. A cauda de template ou de concatenação pode ser só o Z ou um offset
// com dois-pontos, porque a hora pode estar na parte variável (`${dia}T${hora}Z`).
const TZ_END = String.raw`:\d\d(\.\d+)?(Z|[+-]\d\d:?\d\d)$`
const TZ_TAIL = String.raw`${TZ_END}|^(Z|[+-]\d\d:\d\d)$`
// Só a data ('2025', '2025-03', '2025-03-10') é meia-noite UTC pela especificação.
const DATE_ONLY = String.raw`^\d{4}(-\d\d(-\d\d)?)?$`
const LOCAL_TEXT = 'Texto sem Z nem offset depois da hora é hora local: use toUTC (isoDate.ts) ou ponha o Z.'

export default defineConfig([
  // src/types/database.ts é gerado (npm run gen:types); coverage/ é o relatório do test:coverage.
  globalIgnores(['dist', 'coverage', 'src/types/database.ts']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // QA-002: regras que usam os tipos (recommendedTypeChecked), só em src/.
    // Problema antigo fica na catraca (scripts/lint-baseline.json) e só desce.
    files: ['src/**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // PERF-008: promessa solta (sem await, .then/.catch ou void). Com
      // checkThenables pega também as queries do supabase-js, que são
      // preguiçosas: sem .then() nem chegam a ser enviadas.
      '@typescript-eslint/no-floating-promises': ['error', { checkThenables: true }],
      // onClick={async () => …} é o padrão do React; o que interessa é promessa
      // onde se espera boolean/void fora do JSX (if, forEach, callbacks).
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
    },
  },
  {
    // QA-002 / UX-002: acessibilidade no JSX. Os achados antigos estão na
    // catraca; o UX-008 cobre o que a varredura axe pega em tela.
    files: ['src/**/*.tsx'],
    extends: [jsxA11y.flatConfigs.recommended],
    rules: {
      // O divisor de painéis é um "window splitter" (WAI-ARIA): separator com
      // aria-valuenow, focável para mover com o teclado.
      'jsx-a11y/no-noninteractive-tabindex': ['error', { tags: [], roles: ['tabpanel', 'separator'], allowExpressionValues: true }],
    },
  },
  {
    // REL-004: escrita do supabase com o resultado descartado (a falha some e
    // a tela mostra sucesso). Ver scripts/eslint-no-discarded-supabase-write.mjs.
    files: ['src/**/*.{ts,tsx}'],
    plugins: { akool },
    rules: {
      'akool/no-discarded-supabase-write': 'error',
      // UX-008: botão só com ícone precisa de aria-label.
      'akool/button-has-name': 'error',
      // UX-011: texto de interface passa pelas traduções (src/i18n).
      'akool/no-literal-jsx-text': 'error',
      // UX-015: cor é token, não hex solto (paletas de dados liberadas abaixo).
      'akool/no-hex-color': 'error',
      // ARCH-006: módulos não se importam entre si; src/shared só importa lib/i18n.
      'akool/no-cross-module-import': 'error',
      // ARCH-006: arquivo acima de 600 linhas (sem brancos e comentários) é
      // aviso; os atuais estão na catraca e nenhum novo passa. Dados (traduções,
      // Ajuda, tipos) e testes ficam fora.
      'max-lines': ['warn', { max: 600, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // API-005: _api e _domain rodam no Deno e no navegador. O tsconfig.functions.json
    // tem types: ["node"] só por causa dos testes, então o tsc deixaria passar
    // globais do Node; a fronteira de imports não vê globais.
    files: ['supabase/functions/_api/**/*.ts', 'supabase/functions/_domain/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      // API-027: o @types/node também declara localStorage e sessionStorage, e o
      // tsc deixaria passar; navegador e DOM não existem no Deno.
      'no-restricted-globals': [
        'error', 'process', 'Buffer', 'require', 'module', 'exports', '__dirname', '__filename', 'global', 'setImmediate',
        'localStorage', 'sessionStorage', 'navigator', 'window', 'document',
      ],
      // API-027: sem relógio nem fuso do ambiente. No Deno o fuso é UTC, e o dia
      // vira às 21h em Brasília: "hoje" e "agora" vêm de quem chama, e as datas
      // usam os getters UTC (isoDate.ts). Texto sem Z nem offset e data montada
      // por partes são hora local: a meia-noite do início do horário de verão
      // tem 23 h, e a semana do createdPerWeek errava. Só dá para ver o texto
      // literal, o template e a concatenação com cauda literal (`cd + 'T00:00:00'`);
      // `new Date(variavel)` e `cd + variavel` passam. A data sem hora é UTC, mas
      // também é barrada: por convenção, o dia passa por toUTC. O `toString()` fica
      // de fora: sem os tipos, a regra barraria o `n.toString(16)` dos números.
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: '_domain e _api recebem o "agora" de quem chama.' },
        { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: '_domain e _api recebem o "agora" de quem chama.' },
        { selector: "CallExpression[callee.name='Date']", message: '`Date()` sem new é o "agora": _domain e _api o recebem de quem chama.' },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length>1]",
          message: 'Data montada por partes é hora local: use Date.UTC ou toUTC (isoDate.ts).',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='parse']",
          message: 'Date.parse lê o texto sem fuso em hora local: use toUTC (isoDate.ts) ou new Date com Z.',
        },
        {
          selector: `NewExpression[callee.name='Date'] > Literal.arguments[value=type(string)][value!=/${TZ_END}/][value!=/${DATE_ONLY}/]`,
          message: LOCAL_TEXT,
        },
        {
          selector: `NewExpression[callee.name='Date'] > Literal.arguments[value=/${DATE_ONLY}/]`,
          message: 'Data sem hora é meia-noite UTC, não hora local, mas por convenção o dia passa por toUTC (isoDate.ts).',
        },
        {
          selector: `NewExpression[callee.name='Date'] > TemplateLiteral.arguments:not(:has(> TemplateElement[tail=true][value.raw=/${TZ_TAIL}/]))`,
          message: LOCAL_TEXT,
        },
        {
          selector: `NewExpression[callee.name='Date'] > BinaryExpression.arguments[operator='+'][right.type='Literal'][right.value=type(string)][right.value!=/${TZ_TAIL}/]`,
          message: LOCAL_TEXT,
        },
        {
          selector: 'CallExpression[callee.property.name=/^(get|set)(FullYear|Year|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds|TimezoneOffset)$/]',
          message: 'Hora local depende do fuso do ambiente: use os getters UTC.',
        },
        { selector: 'CallExpression[callee.property.name=/^to(Date|Time)String$/]', message: 'Hora local depende do fuso do ambiente: use toISOString ou isoFromUTC.' },
        { selector: 'CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/]', message: 'Sem locale nem fuso do ambiente.' },
        {
          // O no-restricted-globals não vê globalThis.localStorage nem (globalThis as X).Date.
          selector: 'MemberExpression'
            + ':matches([property.name=/^(localStorage|sessionStorage|window|document|navigator|Date)$/], [property.value=/^(localStorage|sessionStorage|window|document|navigator|Date)$/])'
            + ':matches([object.name=/^(globalThis|self)$/], [object.expression.name=/^(globalThis|self)$/], [object.expression.expression.name=/^(globalThis|self)$/])',
          message: 'Navegador, DOM e relógio não passam por globalThis em _domain e _api.',
        },
        { selector: "AssignmentPattern[right.type='CallExpression'][right.callee.name=/^today/]", message: '`today` é obrigatório em _domain e _api.' },
      ],
    },
  },
  {
    files: ['src/i18n/translations.*.ts', 'src/i18n/helpContent.ts', 'src/types/index.ts'],
    rules: { 'max-lines': 'off' },
  },
  {
    // UX-015: paletas de dados (escolha do usuário, gravada no banco), cores dos
    // passos do tour/Ajuda, o PDF (jsPDF/canvas não lê CSS) e os tokens em si.
    files: [
      'src/lib/priorities.ts', 'src/lib/avatar.ts', 'src/lib/financePdf.ts',
      'src/modules/projects/projectsShared.ts', 'src/modules/projects/QueueModal.tsx', 'src/modules/study/studyUi.ts',
      'src/modules/finance/modals/AccountModal.tsx', 'src/modules/finance/modals/GoalModals.tsx', 'src/modules/finance/modals/CategoryModal.tsx',
      'src/modules/projects/modals/BoardModals.tsx', 'src/i18n/tourContent.ts', 'src/i18n/landingContent.ts', 'src/i18n/appPreviewContent.ts', 'src/i18n/helpContent.ts', 'src/shared/ui/uiTokens.ts',
    ],
    rules: { 'akool/no-hex-color': 'off' },
  },
  {
    // QA-003: Playwright não é React; o `use` das fixtures não é hook.
    files: ['e2e/**/*.ts', 'playwright.config.ts'],
    rules: { 'react-hooks/rules-of-hooks': 'off' },
  },
  {
    // Testes montam JSX com texto fixo de propósito.
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**'],
    rules: {
      'akool/no-literal-jsx-text': 'off',
      'akool/no-hex-color': 'off',
      'max-lines': 'off',
      // Mocks async sem await imitam a API real; e expect(obj.metodo) com
      // vi.fn() não tem `this` para perder.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
])
