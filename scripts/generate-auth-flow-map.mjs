/**
 * Gera docs/auth-flow-map.excalidraw — mapa do fluxo de autenticacao Excalinotion.
 *
 * Como importar no app:
 *   1. npm run generate:auth-flow-map   (ou: node scripts/generate-auth-flow-map.mjs)
 *   2. Abra uma pagina do tipo "drawing" no Excalinotion
 *   3. No canvas Excalidraw: menu (hamburguer) > Open > selecione docs/auth-flow-map.excalidraw
 *   4. A cena e salva automaticamente em drawing_contents (debounce ~2s)
 *
 * Manutencao: edite buildAuthElements() abaixo e re-execute este script.
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STYLE, createMapContext, buildScene, writeScene } from './excalidraw-map-helpers.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_PATH = join(__dirname, '..', 'docs', 'auth-flow-map.excalidraw')

function buildAuthElements() {
  const { box, container, edge } = createMapContext()
  const elements = []
  const push = (...groups) => groups.flat().forEach((el) => elements.push(el))

  const X0 = 40
  const Y0 = 40

  push(
    container('frame', {
      x: X0,
      y: Y0,
      w: 1880,
      h: 1180,
      title: 'Fluxo de Autenticacao Excalinotion',
      titleSize: 26,
      strokeColor: STYLE.frameStroke,
    }),
  )

  const topY = Y0 + 70
  const lx = X0 + 50
  const cx = lx + 340
  const sx = cx + 620

  // --- Left: Bootstrap + App gate + Daily login ---
  push(
    container('bootstrap', { x: lx, y: topY, w: 280, h: 200, title: 'Bootstrap' }),
    box('authProvider', { x: lx + 20, y: topY + 55, w: 150, h: 38, label: 'AuthProvider', fontSize: 13 }),
    box('appInner', { x: lx + 20, y: topY + 105, w: 120, h: 38, label: 'AppInner', fontSize: 13 }),
    box('appGate', { x: lx + 160, y: topY + 105, w: 100, h: 38, label: 'App gate', fontSize: 13 }),

    container('appGateFlow', { x: lx, y: topY + 220, w: 280, h: 200, title: 'App gate (App.tsx)' }),
    box('gateLoading', { x: lx + 20, y: topY + 265, w: 110, h: 38, label: 'loading → spinner', fontSize: 11 }),
    box('gateAuthPage', { x: lx + 20, y: topY + 315, w: 200, h: 38, label: '!user → AuthPage', fontSize: 11 }),
    box('gateApp', { x: lx + 20, y: topY + 365, w: 220, h: 38, label: 'user → App autenticado', fontSize: 11 }),

    container('dailyLogin', { x: lx, y: topY + 440, w: 280, h: 200, title: 'Daily login check' }),
    box('dailyCond', { x: lx + 20, y: topY + 485, w: 240, h: 50, label: 'last_login_date !== today\n&& !justSignedIn && mount > 5s', fontSize: 10 }),
    box('dailyAction', { x: lx + 20, y: topY + 550, w: 240, h: 38, label: 'signOut + dailyLoginRequired', fontSize: 10 }),
    box('dailyBanner', { x: lx + 20, y: topY + 595, w: 240, h: 38, label: 'AuthPage banner amarelo', fontSize: 11 }),
  )

  // --- Left bottom: AuthProvider init ---
  push(
    container('authInit', { x: lx, y: topY + 660, w: 280, h: 220, title: 'AuthProvider init' }),
    box('getSession', { x: lx + 20, y: topY + 705, w: 200, h: 38, label: 'auth.getSession()', fontSize: 12 }),
    box('onAuthChange', { x: lx + 20, y: topY + 750, w: 220, h: 38, label: 'onAuthStateChange', fontSize: 12 }),
    box('loadProfile', { x: lx + 20, y: topY + 795, w: 150, h: 38, label: 'loadProfile()', fontSize: 12 }),
    box('authState', { x: lx + 20, y: topY + 840, w: 240, h: 38, label: 'user | session | profile | loading', fontSize: 10 }),
  )

  // --- Center top: AuthPage sign in / sign up ---
  push(
    container('signInUI', { x: cx, y: topY, w: 280, h: 200, title: 'AuthPage — Sign in' }),
    box('signInForm', { x: cx + 20, y: topY + 55, w: 200, h: 38, label: 'email + senha', fontSize: 13 }),
    box('signInCall', { x: cx + 20, y: topY + 100, w: 160, h: 38, label: 'signIn()', fontSize: 13 }),
    box('signInError', { x: cx + 20, y: topY + 145, w: 200, h: 38, label: 'erro na UI / sucesso via listener', fontSize: 10 }),

    container('signInFlow', { x: cx, y: topY + 220, w: 280, h: 260, title: 'signIn() — AuthContext' }),
    box('signInPwd', { x: cx + 20, y: topY + 265, w: 220, h: 38, label: 'signInWithPassword', fontSize: 11 }),
    box('checkActive', { x: cx + 20, y: topY + 310, w: 220, h: 38, label: 'profiles.is_active?', fontSize: 12 }),
    box('inactiveSignOut', { x: cx + 20, y: topY + 355, w: 240, h: 38, label: 'inativo → signOut + erro', fontSize: 11 }),
    box('updateLoginDate', { x: cx + 20, y: topY + 400, w: 240, h: 38, label: 'update last_login_date', fontSize: 11 }),
    box('reloadProfile', { x: cx + 20, y: topY + 445, w: 160, h: 38, label: 'loadProfile()', fontSize: 12 }),

    container('signUpUI', { x: cx + 300, y: topY, w: 280, h: 200, title: 'AuthPage — Sign up' }),
    box('signUpForm', { x: cx + 320, y: topY + 55, w: 240, h: 38, label: 'email + senha + convite', fontSize: 11 }),
    box('validateInvite', { x: cx + 320, y: topY + 100, w: 220, h: 38, label: 'validate_invite_code RPC', fontSize: 11 }),
    box('signUpCall', { x: cx + 320, y: topY + 145, w: 160, h: 38, label: 'signUp()', fontSize: 13 }),

    container('signUpFlow', { x: cx + 300, y: topY + 220, w: 280, h: 200, title: 'signUp() — AuthContext' }),
    box('signUpAuth', { x: cx + 320, y: topY + 265, w: 240, h: 38, label: 'auth.signUp + invite_code', fontSize: 11 }),
    box('signUpConfirm', { x: cx + 320, y: topY + 310, w: 240, h: 38, label: 'sucesso → confirme email', fontSize: 11 }),
    box('signUpHook', { x: cx + 320, y: topY + 355, w: 240, h: 38, label: 'signup hook → profiles', fontSize: 11 }),
  )

  // --- Center bottom: authenticated session + account ops ---
  push(
    container('authenticated', { x: cx, y: topY + 500, w: 580, h: 130, title: 'App autenticado' }),
    box('providers', { x: cx + 20, y: topY + 545, w: 280, h: 38, label: 'PagesProvider + demais providers', fontSize: 11 }),
    box('useAuthConsumers', { x: cx + 20, y: topY + 590, w: 320, h: 38, label: 'useAuth() → Sidebar, UserSettingsModal', fontSize: 10 }),

    container('logout', { x: cx, y: topY + 650, w: 180, h: 120, title: 'Logout' }),
    box('signOutFn', { x: cx + 20, y: topY + 695, w: 140, h: 38, label: 'signOut()', fontSize: 13 }),
    box('signOutTriggers', { x: cx + 20, y: topY + 740, w: 150, h: 38, label: 'Sidebar | daily check', fontSize: 11 }),

    container('changePwd', { x: cx + 200, y: topY + 650, w: 280, h: 120, title: 'changePassword()' }),
    box('reAuth', { x: cx + 220, y: topY + 695, w: 220, h: 38, label: 'signInWithPassword (senha atual)', fontSize: 10 }),
    box('updatePwd', { x: cx + 220, y: topY + 740, w: 200, h: 38, label: 'updateUser({ password })', fontSize: 11 }),

    container('updateProf', { x: cx + 500, y: topY + 650, w: 280, h: 120, title: 'updateProfile()' }),
    box('profUpdate', { x: cx + 520, y: topY + 695, w: 240, h: 38, label: 'profiles.update(name, lang, theme)', fontSize: 10 }),
    box('langStorage', { x: cx + 520, y: topY + 740, w: 240, h: 38, label: 'localStorage excalinotion_auth_lang', fontSize: 10 }),
  )

  // --- Center bottom: invite codes ---
  push(
    container('invites', { x: cx, y: topY + 790, w: 580, h: 130, title: 'Invite codes' }),
    box('genInvite', { x: cx + 20, y: topY + 835, w: 260, h: 38, label: 'UserSettings / Admin → generate_invite_code', fontSize: 9 }),
    box('revokeInvite', { x: cx + 20, y: topY + 880, w: 260, h: 38, label: 'UserManagement → admin_revoke_invite_code', fontSize: 9 }),
    box('tblInvites', { x: cx + 300, y: topY + 835, w: 260, h: 38, label: 'invite_codes (tabela)', fontSize: 11 }),
  )

  // --- Right: Supabase ---
  push(
    container('supabase', { x: sx, y: topY, w: 560, h: 920, title: 'Supabase', titleSize: 24 }),
    container('sbAuthBlock', { x: sx + 20, y: topY + 55, w: 520, h: 200, title: 'Auth', titleSize: 16 }),
    box('sbGetSession', { x: sx + 36, y: topY + 95, w: 160, h: 34, label: 'getSession', fontSize: 12 }),
    box('sbSignInPwd', { x: sx + 36, y: topY + 135, w: 180, h: 34, label: 'signInWithPassword', fontSize: 11 }),
    box('sbSignUp', { x: sx + 36, y: topY + 175, w: 120, h: 34, label: 'signUp', fontSize: 12 }),
    box('sbSignOut', { x: sx + 240, y: topY + 95, w: 120, h: 34, label: 'signOut', fontSize: 12 }),
    box('sbUpdateUser', { x: sx + 240, y: topY + 135, w: 160, h: 34, label: 'updateUser', fontSize: 12 }),
    box('sbOnAuthChange', { x: sx + 240, y: topY + 175, w: 200, h: 34, label: 'onAuthStateChange', fontSize: 11 }),

    container('sbPostgres', { x: sx + 20, y: topY + 275, w: 520, h: 130, title: 'Postgres', titleSize: 16 }),
    box('tblProfiles', { x: sx + 36, y: topY + 315, w: 120, h: 34, label: 'profiles', fontSize: 12 }),
    box('profFields', { x: sx + 36, y: topY + 355, w: 460, h: 34, label: 'role | is_active | language | theme | last_login_date', fontSize: 9 }),
    box('tblInviteCodes', { x: sx + 300, y: topY + 315, w: 140, h: 34, label: 'invite_codes', fontSize: 11 }),

    container('sbRpcs', { x: sx + 20, y: topY + 425, w: 520, h: 130, title: 'RPCs', titleSize: 16 }),
    box('rpcValidate', { x: sx + 36, y: topY + 465, w: 200, h: 34, label: 'validate_invite_code', fontSize: 11 }),
    box('rpcGenerate', { x: sx + 36, y: topY + 505, w: 200, h: 34, label: 'generate_invite_code', fontSize: 11 }),
    box('rpcRevoke', { x: sx + 280, y: topY + 465, w: 220, h: 34, label: 'admin_revoke_invite_code', fontSize: 10 }),

    container('sbHooks', { x: sx + 20, y: topY + 575, w: 520, h: 100, title: 'Signup hook (server)', titleSize: 15 }),
    box('signupHook', { x: sx + 36, y: topY + 615, w: 460, h: 38, label: 'trigger: cria profiles + consome convite', fontSize: 11 }),
  )

  // --- Solid arrows (internal flow) ---
  push(
    edge('authProvider', 'appInner'),
    edge('appInner', 'appGate'),
    edge('appGate', 'gateLoading'),
    edge('appGate', 'gateAuthPage'),
    edge('appGate', 'gateApp'),
    edge('gateApp', 'providers'),
    edge('dailyCond', 'dailyAction'),
    edge('dailyAction', 'dailyBanner'),
    edge('dailyAction', 'signOutFn'),
    edge('getSession', 'loadProfile'),
    edge('onAuthChange', 'loadProfile'),
    edge('loadProfile', 'authState'),
    edge('signInForm', 'signInCall'),
    edge('signInCall', 'signInPwd'),
    edge('signInPwd', 'checkActive'),
    edge('checkActive', 'inactiveSignOut'),
    edge('checkActive', 'updateLoginDate'),
    edge('updateLoginDate', 'reloadProfile'),
    edge('gateAuthPage', 'signInForm'),
    edge('signUpForm', 'validateInvite'),
    edge('validateInvite', 'signUpCall'),
    edge('signUpCall', 'signUpAuth'),
    edge('signUpAuth', 'signUpConfirm'),
    edge('signUpAuth', 'signUpHook'),
    edge('signOutFn', 'signOutTriggers'),
    edge('reAuth', 'updatePwd'),
    edge('profUpdate', 'langStorage'),
    edge('genInvite', 'tblInvites'),
    edge('validateInvite', 'rpcValidate'),
  )

  // --- Dashed arrows (Supabase) ---
  push(
    edge('getSession', 'sbGetSession', { dashed: true }),
    edge('onAuthChange', 'sbOnAuthChange', { dashed: true }),
    edge('loadProfile', 'tblProfiles', { dashed: true }),
    edge('signInPwd', 'sbSignInPwd', { dashed: true }),
    edge('checkActive', 'tblProfiles', { dashed: true }),
    edge('updateLoginDate', 'tblProfiles', { dashed: true }),
    edge('inactiveSignOut', 'sbSignOut', { dashed: true }),
    edge('signUpAuth', 'sbSignUp', { dashed: true }),
    edge('signUpHook', 'signupHook', { dashed: true }),
    edge('signOutFn', 'sbSignOut', { dashed: true }),
    edge('reAuth', 'sbSignInPwd', { dashed: true }),
    edge('updatePwd', 'sbUpdateUser', { dashed: true }),
    edge('profUpdate', 'tblProfiles', { dashed: true }),
    edge('dailyCond', 'tblProfiles', { dashed: true }),
    edge('genInvite', 'rpcGenerate', { dashed: true }),
    edge('revokeInvite', 'rpcRevoke', { dashed: true }),
    edge('validateInvite', 'tblInviteCodes', { dashed: true }),
    edge('changePwd', 'reAuth'),
  )

  return elements
}

writeScene(OUT_PATH, buildScene(buildAuthElements()))
