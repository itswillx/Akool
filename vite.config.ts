import { cpSync, createReadStream, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { defineConfig } from 'vitest/config'
import { loadEnv, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'

// REL-011: source maps só existem quando dá para subi-los ao Sentry (token,
// org e projeto no build do Coolify). Mesmo assim saem do dist/ depois do
// upload: o Caddy serve tudo o que está lá, e o mapa entregaria o código-fonte.
function removeSourceMaps(): PluginOption {
  return {
    name: 'akool:remove-source-maps',
    apply: 'build',
    enforce: 'post',
    closeBundle() {
      if (!existsSync('dist')) return
      for (const file of readdirSync('dist', { recursive: true, encoding: 'utf8' })) {
        if (file.endsWith('.map')) rmSync(join('dist', file))
      }
    },
  }
}

// SEC-009: as fontes do Excalidraw saem do próprio app, e não do CDN esm.sh
// (o padrão sem window.EXCALIDRAW_ASSET_PATH). A versão entra no caminho para
// o Caddy poder mandar cache longo; o main.tsx aponta o Excalidraw para cá.
const EXCALIDRAW_DIR = resolve('node_modules', '@excalidraw', 'excalidraw')
const EXCALIDRAW_FONTS = join(EXCALIDRAW_DIR, 'dist', 'prod', 'fonts')
const EXCALIDRAW_VERSION = JSON.parse(readFileSync(join(EXCALIDRAW_DIR, 'package.json'), 'utf8')).version as string
const EXCALIDRAW_ASSET_PATH = `/excalidraw-assets/${EXCALIDRAW_VERSION}/`

function excalidrawFonts(): PluginOption {
  let outDir = 'dist'
  return {
    name: 'akool:excalidraw-fonts',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      server.middlewares.use(`${EXCALIDRAW_ASSET_PATH}fonts/`, (req, res, next) => {
        const file = join(EXCALIDRAW_FONTS, decodeURIComponent((req.url ?? '').split('?')[0]))
        if (!file.startsWith(EXCALIDRAW_FONTS + sep) || !existsSync(file) || !statSync(file).isFile()) return next()
        res.setHeader('Content-Type', file.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream')
        createReadStream(file).pipe(res)
      })
    },
    closeBundle() {
      if (existsSync(outDir)) cpSync(EXCALIDRAW_FONTS, join(outDir, EXCALIDRAW_ASSET_PATH, 'fonts'), { recursive: true })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const uploadSourceMaps = mode !== 'test' && !!(env.SENTRY_AUTH_TOKEN && env.SENTRY_ORG && env.SENTRY_PROJECT)
  // Coolify expõe o commit em SOURCE_COMMIT; SENTRY_RELEASE é o plano B.
  const release = env.SOURCE_COMMIT || env.SENTRY_RELEASE || ''

  return {
    plugins: [
      react(),
      excalidrawFonts(),
      ...(uploadSourceMaps
        ? [
          sentryVitePlugin({
            org: env.SENTRY_ORG,
            project: env.SENTRY_PROJECT,
            authToken: env.SENTRY_AUTH_TOKEN,
            // Sentry self-hosted (e o teste local do upload) apontam por aqui.
            ...(env.SENTRY_URL ? { url: env.SENTRY_URL } : {}),
            telemetry: false,
            ...(release ? { release: { name: release } } : {}),
            sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
          }),
          removeSourceMaps(),
        ]
        : []),
    ],
    define: {
      // Testes herméticos: nunca ligam o Sentry, mesmo com DSN no .env.local.
      __SENTRY_DSN__: JSON.stringify(mode === 'test' ? '' : env.VITE_SENTRY_DSN ?? ''),
      __APP_RELEASE__: JSON.stringify(release),
      __EXCALIDRAW_ASSET_PATH__: JSON.stringify(EXCALIDRAW_ASSET_PATH),
    },
    server: {
      host: true, // escuta em 0.0.0.0 — acessível pelo celular na mesma rede
      port: 5173,
    },
    test: {
      environment: 'node',
      // QA-003: e2e/ é do Playwright (npm run test:e2e), não do vitest.
      exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
      // DEV-001: testes herméticos. Valores fictícios que vencem o .env.local,
      // para a suíte rodar no CI sem segredos e nunca apontar para o projeto
      // real; os testes mockam o client do Supabase. Não afeta dev nem build.
      env: {
        VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
        VITE_SUPABASE_ANON_KEY: 'test-anon-key',
      },
      // QA-001: `npm run test:coverage`. O resumo por arquivo (json-summary)
      // alimenta a trava por pasta (scripts/coverage-ratchet.mjs); o HTML fica
      // em coverage/ para navegar.
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}', 'supabase/functions/**/*.ts'],
        exclude: ['**/*.test.{ts,tsx}', '**/*.bench.{ts,tsx}', 'src/test/**', 'src/types/**', '**/*.d.ts', 'e2e/**'],
        reporter: ['text-summary', 'json-summary', 'html'],
        reportsDirectory: 'coverage',
      },
    },
    optimizeDeps: {
      include: ['@excalidraw/excalidraw'],
    },
    build: {
      sourcemap: uploadSourceMaps ? 'hidden' : false,
      commonjsOptions: {
        include: [/excalidraw/, /node_modules/],
      },
      chunkSizeWarningLimit: 800,
      rollupOptions: {
        output: {
          // Grupo manual só para vendors que o boot já carrega, com teste pela
          // raiz exata do pacote: ficam em chunks próprios, que continuam no
          // cache entre deploys. PERF-009: nada de grupo para biblioteca
          // carregada sob demanda (editor, Excalidraw, PDF, xyflow). O rolldown
          // leva para o grupo as dependências do que ele captura
          // (includeDependenciesRecursively), então o antigo grupo "editor"
          // engolia o react-dom e o fflate do jsPDF, e 1,5 MB de editor ia
          // para o boot de todo mundo. Sem grupo, a divisão automática deixa
          // essas bibliotecas nos chunks assíncronos de quem as importa.
          manualChunks(id) {
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react'
            if (/[\\/]node_modules[\\/]@supabase[\\/]/.test(id)) return 'supabase'
          },
        },
      },
    },
    assetsInclude: ['**/*.woff2', '**/*.woff'],
  }
})
