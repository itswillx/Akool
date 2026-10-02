import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import akool from './scripts/eslint-plugin-akool.mjs'

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
    files: ['src/i18n/translations.*.ts', 'src/i18n/helpContent.ts', 'src/types/index.ts'],
    rules: { 'max-lines': 'off' },
  },
  {
    // UX-015: paletas de dados (escolha do usuário, gravada no banco), cores dos
    // passos do tour/Ajuda, o PDF (jsPDF/canvas não lê CSS) e os tokens em si.
    files: [
      'src/lib/priorities.ts', 'src/lib/avatar.ts', 'src/lib/importProjectCards.ts', 'src/lib/financePdf.ts',
      'src/modules/projects/projectsShared.ts', 'src/modules/projects/QueueModal.tsx', 'src/modules/study/studyUi.ts',
      'src/modules/finance/modals/AccountModal.tsx', 'src/modules/finance/modals/GoalModals.tsx', 'src/modules/finance/modals/CategoryModal.tsx',
      'src/modules/projects/modals/BoardModals.tsx', 'src/i18n/tourContent.ts', 'src/i18n/helpContent.ts', 'src/shared/ui/uiTokens.ts',
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
