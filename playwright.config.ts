import { defineConfig, devices } from '@playwright/test'
import { assertNotProduction, stagingEnv } from './e2e/env'

// QA-003: E2E contra o staging (DEV-002). O servidor é o build de staging
// servido pelo `vite preview`; a trava abaixo impede rodar contra a produção.
//   npm run test:e2e                     todos (os logados precisam de E2E_USER/E2E_PASSWORD)
//   npm run test:e2e -- --project=public só os que não fazem login
const env = stagingEnv()
assertNotProduction(env.VITE_SUPABASE_URL)

const PORT = 4173

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'pt-BR',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'npm run build:staging && npm run preview:staging',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
  projects: [
    { name: 'public', testMatch: /public\/.*\.spec\.ts/ },
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'app', testMatch: /app\/.*\.spec\.ts/, dependencies: ['setup'], use: { storageState: 'e2e/.auth/user.json' } },
  ],
})
