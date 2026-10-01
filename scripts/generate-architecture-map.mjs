/**
 * Gera docs/architecture-map.excalidraw — mapa da arquitetura do Akool.
 *
 * ARCH-009: a ordem dos providers vem do src/App.tsx (scripts/provider-order.mjs),
 * não de uma lista à mão; o resto do mapa é o spec declarativo abaixo.
 *
 * Como importar no app:
 *   1. npm run generate:architecture-map   (ou: node scripts/generate-architecture-map.mjs)
 *   2. Abra uma pagina do tipo "drawing" no Excalinotion
 *   3. No canvas Excalidraw: menu (hamburguer) > Open > selecione docs/architecture-map.excalidraw
 *   4. A cena e salva automaticamente em drawing_contents (debounce ~2s)
 *
 * Manutencao: edite o spec declarativo (buildElements) abaixo e re-execute este script.
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STYLE, createMapContext, buildScene, writeScene } from './excalidraw-map-helpers.mjs'
import { providerChain, providerId, readAppProviderOrder } from './provider-order.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_PATH = join(__dirname, '..', 'docs', 'architecture-map.excalidraw')
const PROVIDERS = readAppProviderOrder(join(__dirname, '..', 'src', 'App.tsx'))
const PROVIDER_IDS = new Set(providerChain(PROVIDERS).map(providerId))

function buildElements() {
  const { box, container, edge } = createMapContext()
  const chain = providerChain(PROVIDERS)
  const elements = []
  const push = (...groups) => groups.flat().forEach((el) => elements.push(el))

  const X0 = 40
  const Y0 = 40

  push(
    container('frame', {
      x: X0,
      y: Y0,
      w: 1880,
      h: 1220,
      title: 'Arquitetura Excalinotion',
      titleSize: 28,
      strokeColor: STYLE.frameStroke,
    }),
  )

  const topY = Y0 + 70
  const bx = X0 + 50
  const by = topY

  push(
    container('bootstrap', { x: bx, y: by, w: 260, h: 290, title: 'Bootstrap' }),
    box('mainTsx', { x: bx + 40, y: by + 55, w: 110, h: 40, label: 'main.tsx', fontSize: 14 }),
    box('authLoading', { x: bx + 170, y: by + 55, w: 70, h: 40, label: 'loading', fontSize: 13 }),
    box('app', { x: bx + 40, y: by + 110, w: 110, h: 40, label: 'App', fontSize: 14 }),
    box('authGate', { x: bx + 170, y: by + 110, w: 80, h: 40, label: 'AuthPage', fontSize: 13 }),
    // Providers do App(): envolvem tudo, inclusive a tela de login.
    ...PROVIDERS.outer.map((name, i) => box(providerId(name), { x: bx + 30, y: by + 150 + i * 44, w: 200, h: 36, label: name, fontSize: 12 })),
  )

  const px = bx + 300
  const py = topY
  push(
    container('providers', { x: px, y: py, w: 500, h: 260, title: 'Providers do AppInner (pos-login)' }),
    // Montados só depois dos portões do AppInner (loading, recuperação, login, MFA).
    ...PROVIDERS.inner.map((name, i) => box(providerId(name), {
      x: px + 20 + (i % 2) * 240, y: py + 55 + Math.floor(i / 2) * 45, w: 215, h: 38, label: name, fontSize: 12,
    })),
  )

  const fx = px + 530
  const fy = topY
  push(
    container('financeModule', { x: fx, y: fy, w: 270, h: 260, title: 'Modulo Finance' }),
    box('financeBarrel', { x: fx + 20, y: fy + 55, w: 120, h: 38, label: 'index.ts', fontSize: 13 }),
    box('financeTabs', { x: fx + 20, y: fy + 100, w: 230, h: 38, label: 'overview | transactions | budgets', fontSize: 10 }),
    box('financeWorkspaces', { x: fx + 20, y: fy + 145, w: 230, h: 38, label: 'individual + family workspace', fontSize: 11 }),
    box('financeRpc', { x: fx + 20, y: fy + 190, w: 230, h: 38, label: 'RPCs: create_workspace, invite', fontSize: 10 }),
  )

  const sx = fx + 310
  const sy = topY
  push(
    container('supabase', { x: sx, y: sy, w: 560, h: 1060, title: 'Supabase', titleSize: 24 }),
    box('sbAuth', { x: sx + 20, y: sy + 55, w: 200, h: 40, label: 'Auth + profiles', fontSize: 13 }),
    box('sbRealtime', { x: sx + 20, y: sy + 105, w: 140, h: 40, label: 'Realtime', fontSize: 13 }),
    box('sbStorage', { x: sx + 20, y: sy + 155, w: 260, h: 40, label: 'Storage: note-images, transaction-photos', fontSize: 10 }),
    box('sbEdge', { x: sx + 20, y: sy + 205, w: 220, h: 40, label: 'Edge Function: site-backup', fontSize: 11 }),
    box('sbRpc', { x: sx + 20, y: sy + 255, w: 280, h: 40, label: 'RPCs: create_workspace, invite_member', fontSize: 10 }),
    container('sbPages', { x: sx + 20, y: sy + 320, w: 520, h: 85, title: 'Postgres: pages', titleSize: 15 }),
    box('tblPages', { x: sx + 36, y: sy + 358, w: 260, h: 34, label: 'pages | page_shares | page_presence', fontSize: 10 }),
    container('sbContent', { x: sx + 20, y: sy + 420, w: 520, h: 85, title: 'Postgres: conteudo', titleSize: 15 }),
    box('tblContent', { x: sx + 36, y: sy + 458, w: 290, h: 34, label: 'note_contents | drawing_contents | todos', fontSize: 10 }),
    container('sbProjects', { x: sx + 20, y: sy + 520, w: 520, h: 85, title: 'Postgres: projects', titleSize: 15 }),
    box('tblProjects', { x: sx + 36, y: sy + 558, w: 340, h: 34, label: 'project_boards | columns | cards | shares', fontSize: 10 }),
    container('sbFinance', { x: sx + 20, y: sy + 620, w: 520, h: 110, title: 'Postgres: finance', titleSize: 15 }),
    box('tblFinance', { x: sx + 36, y: sy + 658, w: 470, h: 32, label: 'finance_accounts | categories | transactions | budgets', fontSize: 9 }),
    box('tblFinance2', { x: sx + 36, y: sy + 694, w: 470, h: 32, label: 'finance_goals | recurring | workspaces | invites', fontSize: 9 }),
    box('tblMisc', { x: sx + 20, y: sy + 750, w: 340, h: 40, label: 'notifications | invite_codes', fontSize: 12 }),
  )

  const ux = bx
  const uy = topY + 300
  push(
    container('uiShell', { x: ux, y: uy, w: 1080, h: 100, title: 'UI Shell' }),
    box('sidebar', { x: ux + 20, y: uy + 48, w: 110, h: 40, label: 'Sidebar', fontSize: 14 }),
    box('modeSwitch', { x: ux + 160, y: uy + 48, w: 200, h: 40, label: 'WorkspaceModeSwitch', fontSize: 12 }),
    box('mainContent', { x: ux + 390, y: uy + 48, w: 150, h: 40, label: 'MainContent', fontSize: 14 }),
  )

  const rx = bx
  const ry = uy + 130
  push(
    container('router', { x: rx, y: ry, w: 1080, h: 330, title: 'MainContent router' }),
    box('financePanel', { x: rx + 20, y: ry + 55, w: 125, h: 38, label: 'FinancePanel', fontSize: 13 }),
    box('usersPanel', { x: rx + 20, y: ry + 100, w: 185, h: 38, label: 'UserManagementPanel', fontSize: 11 }),
    box('projectsPanel', { x: rx + 20, y: ry + 145, w: 125, h: 38, label: 'ProjectsPanel', fontSize: 13 }),
    box('helpPanel', { x: rx + 20, y: ry + 190, w: 95, h: 38, label: 'HelpPanel', fontSize: 13 }),
    box('backupPanel', { x: rx + 20, y: ry + 235, w: 115, h: 38, label: 'BackupPanel', fontSize: 13 }),
    box('dashboard', { x: rx + 230, y: ry + 55, w: 115, h: 38, label: 'Dashboard', fontSize: 14 }),
    box('pageView', { x: rx + 230, y: ry + 110, w: 115, h: 38, label: 'Page view', fontSize: 14 }),
    box('pageHeader', { x: rx + 390, y: ry + 55, w: 115, h: 38, label: 'PageHeader', fontSize: 13 }),
    box('noteEditor', { x: rx + 390, y: ry + 100, w: 115, h: 38, label: 'NoteEditor', fontSize: 13 }),
    box('todoList', { x: rx + 390, y: ry + 145, w: 95, h: 38, label: 'TodoList', fontSize: 13 }),
    box('drawingCanvas', { x: rx + 390, y: ry + 190, w: 135, h: 38, label: 'DrawingCanvas', fontSize: 12 }),
    box('splitView', { x: rx + 390, y: ry + 235, w: 95, h: 38, label: 'SplitView', fontSize: 13 }),
    box('routeByType', { x: rx + 540, y: ry + 145, w: 270, h: 38, label: 'page.type: note | todo | drawing | both', fontSize: 11 }),
  )

  const hx = bx
  const hy = ry + 360
  push(
    container('hooks', { x: hx, y: hy, w: 1080, h: 120, title: 'Hooks' }),
    box('useCollab', { x: hx + 20, y: hy + 48, w: 195, h: 40, label: 'useCollaborativeContent', fontSize: 11 }),
    box('usePresence', { x: hx + 235, y: hy + 48, w: 155, h: 40, label: 'usePagePresence', fontSize: 12 }),
    box('useBackup', { x: hx + 410, y: hy + 48, w: 125, h: 40, label: 'useSiteBackup', fontSize: 12 }),
    box('usePdf', { x: hx + 555, y: hy + 48, w: 115, h: 40, label: 'usePdfExport', fontSize: 12 }),
    box('useMobile', { x: hx + 690, y: hy + 48, w: 115, h: 40, label: 'useIsMobile', fontSize: 12 }),
  )

  push(
    edge('mainTsx', 'app'),
    edge('app', providerId(chain[0])),
    edge('app', 'authGate'),
    edge('app', 'authLoading'),
    // A cadeia de providers, de fora para dentro, na ordem do App.tsx.
    ...chain.slice(1).map((name, i) => edge(providerId(chain[i]), providerId(name))),
    edge(providerId(chain[chain.length - 1]), 'modeSwitch'),
    edge(providerId(chain[chain.length - 1]), 'sidebar'),
    edge('sidebar', 'mainContent'),
    edge('modeSwitch', 'mainContent'),
    edge('mainContent', 'financePanel'),
    edge('mainContent', 'dashboard'),
    edge('mainContent', 'pageView'),
    edge('pageView', 'pageHeader'),
    edge('pageHeader', 'noteEditor'),
    edge('pageHeader', 'todoList'),
    edge('pageHeader', 'drawingCanvas'),
    edge('pageHeader', 'splitView'),
    edge('pageHeader', 'routeByType'),
    edge('financePanel', 'financeBarrel'),
    edge('financeBarrel', 'financeTabs'),
    edge('noteEditor', 'useCollab'),
    edge('todoList', 'useCollab'),
    edge('drawingCanvas', 'useCollab'),
    edge('pageView', 'usePresence'),
    edge('backupPanel', 'useBackup'),
    ...(PROVIDER_IDS.has('authProvider') ? [edge('authProvider', 'sbAuth', { dashed: true })] : []),
    edge('authGate', 'sbAuth', { dashed: true }),
    ...(PROVIDER_IDS.has('pagesProvider') ? [edge('pagesProvider', 'tblPages', { dashed: true })] : []),
    edge('useCollab', 'sbRealtime', { dashed: true }),
    edge('useCollab', 'tblContent', { dashed: true }),
    edge('usePresence', 'tblPages', { dashed: true }),
    edge('useBackup', 'sbEdge', { dashed: true }),
    edge('usePdf', 'tblContent', { dashed: true }),
    edge('projectsPanel', 'tblProjects', { dashed: true }),
    edge('financeBarrel', 'tblFinance', { dashed: true }),
    edge('financeRpc', 'sbRpc', { dashed: true }),
    edge('noteEditor', 'sbStorage', { dashed: true }),
    ...(PROVIDER_IDS.has('notificationsProvider') ? [edge('notificationsProvider', 'tblMisc', { dashed: true })] : []),
    edge('usersPanel', 'tblMisc', { dashed: true }),
  )

  return elements
}

writeScene(OUT_PATH, buildScene(buildElements()))
