import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { User, Session, AuthChangeEvent } from '@supabase/supabase-js'
import { supabase, createEphemeralAuthClient, recoveryLinkDetected } from '../lib/supabase'

export interface UserProfile {
  id: string
  email: string
  display_name: string | null
  role: 'admin' | 'standard'
  is_active: boolean
  language: 'pt-BR' | 'en'
  theme: 'light' | 'dark'
  invite_slots_remaining: number
  last_login_date: string | null
  avatar_emoji: string | null
  avatar_color: string | null
  /** Storage PATH in the private `avatars` bucket, resolved via signed URL. */
  avatar_url: string | null
  finance_dashboard_view: 'simple' | 'detailed'
}

interface AuthContextType {
  user: User | null
  session: Session | null
  profile: UserProfile | null
  isAdmin: boolean
  loading: boolean
  justSignedIn: boolean
  // True after landing from a password-recovery email link (PASSWORD_RECOVERY
  // event): the app shows the "set new password" screen until completed.
  recoveryMode: boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signUp: (email: string, password: string, inviteCode: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  // Error strings may be the machine codes 'wrong_password' | 'same_password'
  // | 'session_missing' (callers map them to translated messages) or a raw
  // Supabase error message as fallback.
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ error: string | null }>
  sendPasswordReset: (email: string) => Promise<{ error: string | null }>
  completePasswordReset: (newPassword: string) => Promise<{ error: string | null }>
  cancelPasswordReset: () => Promise<void>
  updateProfile: (data: Partial<Pick<UserProfile, 'display_name' | 'language' | 'theme' | 'avatar_emoji' | 'avatar_color' | 'avatar_url' | 'finance_dashboard_view'>>) => Promise<{ error: string | null }>
  refreshProfile: () => Promise<void>
}

// Survives a mid-flow page reload of the recovery tab: the recovery hash is
// consumed on first load, so the flag is what keeps the reset screen up.
const RECOVERY_FLAG = 'akool_recovery_pending'

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// True when `nextUser` is a redundant re-emission for the account already
// reflected in `currentUserId` — i.e. the identity churn described above,
// which the `user` state should NOT adopt. USER_UPDATED is always false here
// since that event means the account's own data (email/metadata) changed.
export function isSameAccountEvent(
  currentUserId: string | null,
  nextUser: User | null,
  event: AuthChangeEvent,
): boolean {
  return !!nextUser && currentUserId === nextUser.id && event !== 'USER_UPDATED'
}

export function mergeAuthUser(prev: User | null, nextUser: User | null, sameAccount: boolean): User | null {
  return sameAccount && prev ? prev : nextUser
}

// Contrato: a referência de `user` só muda em troca de conta (login/logout) ou em
// `USER_UPDATED` (e-mail/metadata mudou de verdade) — nunca em SIGNED_IN/TOKEN_REFRESHED
// redundantes para a mesma conta. Consumidores NUNCA devem depender de `[user]` (o
// objeto) em efeitos/memos/callbacks — sempre de `user?.id` (e `user?.email` também,
// se precisar; ver o padrão em FinancePanel.tsx:228-234). Ver `isSameAccountEvent`
// abaixo, e o callback de `onAuthStateChange` para o porquê.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [justSignedIn, setJustSignedIn] = useState(false)
  const [recoveryMode, setRecoveryMode] = useState(
    () => recoveryLinkDetected || sessionStorage.getItem(RECOVERY_FLAG) === '1'
  )

  const loadProfile = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('id, email, display_name, role, is_active, language, theme, invite_slots_remaining, last_login_date, avatar_emoji, avatar_color, avatar_url, finance_dashboard_view')
      .eq('id', userId)
      .single()
    if (data) {
      const profile: UserProfile = data as UserProfile
      // Catches a ban that happened after this session was already open —
      // signIn's own is_active check only covers the login moment itself.
      if (!profile.is_active) {
        await supabase.auth.signOut()
        setProfile(null)
        return
      }
      setProfile(profile)
      if (profile.language) {
        localStorage.setItem('excalinotion_auth_lang', profile.language)
      }
    }
  }, [])

  // Account currently reflected in `user`/`profile`. Read inside the auth
  // callback, which closes over the initial render and cannot see the state.
  const currentUserIdRef = useRef<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      currentUserIdRef.current = session?.user?.id ?? null
      if (session?.user) {
        loadProfile(session.user.id).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryMode(true)
        sessionStorage.setItem(RECOVERY_FLAG, '1')
      }
      if (event === 'SIGNED_OUT') sessionStorage.removeItem(RECOVERY_FLAG)

      // Always: consumers read a fresh `session.access_token` at call time.
      setSession(session)

      const nextUser = session?.user ?? null
      // With autoRefreshToken (the default), supabase-js listens to
      // `visibilitychange` and re-emits SIGNED_IN every time the tab regains
      // focus, handing us a freshly deserialized `session.user` — a new object
      // for the very same account. Handing that identity to React invalidates
      // every `[user]` dependency in the app: useFinanceData would re-run,
      // flip its `loading` back to true and unmount all finance tabs, wiping
      // their local state. So keep the previous instance when nothing changed.
      // USER_UPDATED is the one event that must adopt the new object (email or
      // metadata really did change).
      const sameAccount = isSameAccountEvent(currentUserIdRef.current, nextUser, event)
      setUser(prev => mergeAuthUser(prev, nextUser, sameAccount))

      if (nextUser) {
        // Refetching on every focus would churn `profile` for no reason. The
        // flows that genuinely need fresh data (signIn, changePassword,
        // completePasswordReset) call loadProfile themselves.
        if (!sameAccount) loadProfile(nextUser.id)
      } else {
        setProfile(null)
      }
      currentUserIdRef.current = nextUser?.id ?? null
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    setJustSignedIn(true)
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error }
    if (data.user) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('is_active')
        .eq('id', data.user.id)
        .single()
      if (prof && !prof.is_active) {
        await supabase.auth.signOut()
        return { error: new Error('Sua conta está desativada. Contate o administrador.') }
      }
    }
    if (data.user) {
      // Client-writable by design: it's the daily-login UX nag in App.tsx,
      // not a permission boundary. The privilege-escalation trigger on
      // profiles already locks down role/is_active/invite_slots_remaining.
      const today = new Date().toISOString().split('T')[0]
      await supabase.from('profiles').update({ last_login_date: today }).eq('id', data.user.id)
      await loadProfile(data.user.id)
    }
    return { error: null }
  }, [loadProfile])

  const signUp = useCallback(async (email: string, password: string, inviteCode: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { invite_code: inviteCode.trim().toUpperCase() },
      },
    })
    return { error }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setProfile(null)
  }, [])

  const changePassword = useCallback(async (currentPassword: string, newPassword: string): Promise<{ error: string | null }> => {
    if (!user?.email) return { error: 'Usuário não autenticado.' }
    // Verify the current password on a throwaway client: signing in on the
    // main client would fire SIGNED_IN → loadProfile → new profile object,
    // which lets the daily-login guard in App.tsx sign the user out mid-change.
    const verifier = createEphemeralAuthClient()
    const { error: reAuthErr } = await verifier.auth.signInWithPassword({ email: user.email, password: currentPassword })
    if (reAuthErr) return { error: 'wrong_password' }
    // The user just proved their password — count it as today's login BEFORE
    // updateUser, whose USER_UPDATED → loadProfile would otherwise hand the
    // daily-login guard a stale last_login_date. Client-writable by design,
    // see the note on the same update in signIn above.
    const today = new Date().toISOString().split('T')[0]
    await supabase.from('profiles').update({ last_login_date: today }).eq('id', user.id)
    // current_password is required by the project's "Require current password
    // when changing password" auth setting; sessions older than that check
    // otherwise get 400 "Current password required when setting new password."
    const { error } = await supabase.auth.updateUser({ password: newPassword, current_password: currentPassword })
    // scope 'local' only: the default 'global' would revoke every session,
    // including the main client's.
    verifier.auth.signOut({ scope: 'local' }).catch(() => {})
    if (error) {
      if (error.code === 'same_password' || /different/i.test(error.message)) return { error: 'same_password' }
      if (error.code === 'weak_password') return { error: 'weak_password' }
      if (/current password/i.test(error.message)) return { error: 'wrong_password' }
      return { error: error.message }
    }
    await loadProfile(user.id)
    return { error: null }
  }, [user, loadProfile])

  const sendPasswordReset = useCallback(async (email: string): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    })
    return { error: error ? error.message : null }
  }, [])

  const completePasswordReset = useCallback(async (newPassword: string): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) {
      if (error.code === 'same_password' || /different/i.test(error.message)) return { error: 'same_password' }
      if (error.code === 'weak_password') return { error: 'weak_password' }
      if (/session/i.test(error.message)) return { error: 'session_missing' }
      return { error: error.message }
    }
    // Count the recovery as today's login so the daily-login guard doesn't
    // immediately sign the user back out after choosing the new password.
    // Client-writable by design, see the note on the same update in signIn above.
    setJustSignedIn(true)
    if (user) {
      const today = new Date().toISOString().split('T')[0]
      await supabase.from('profiles').update({ last_login_date: today }).eq('id', user.id)
      await loadProfile(user.id)
    }
    sessionStorage.removeItem(RECOVERY_FLAG)
    setRecoveryMode(false)
    return { error: null }
  }, [user, loadProfile])

  // Bail out of an unfinished recovery: the email link created a real,
  // persisted session — leaving it behind would keep the user logged in
  // without ever having set the new password.
  const cancelPasswordReset = useCallback(async () => {
    sessionStorage.removeItem(RECOVERY_FLAG)
    setRecoveryMode(false)
    await signOut()
  }, [signOut])

  const updateProfile = useCallback(async (data: Partial<Pick<UserProfile, 'display_name' | 'language' | 'theme' | 'avatar_emoji' | 'avatar_color' | 'avatar_url' | 'finance_dashboard_view'>>): Promise<{ error: string | null }> => {
    if (!user) return { error: 'Usuário não autenticado.' }
    const { error } = await supabase.from('profiles').update(data).eq('id', user.id)
    if (error) return { error: error.message }
    setProfile(prev => prev ? { ...prev, ...data } : prev)
    if (data.language) localStorage.setItem('excalinotion_auth_lang', data.language)
    return { error: null }
  }, [user])

  const refreshProfile = useCallback(async () => {
    if (user) await loadProfile(user.id)
  }, [user, loadProfile])

  const isAdmin = profile?.role === 'admin'

  const value = useMemo<AuthContextType>(() => ({
    user, session, profile, isAdmin, loading, justSignedIn, recoveryMode,
    signIn, signUp, signOut, changePassword, sendPasswordReset, completePasswordReset, cancelPasswordReset, updateProfile, refreshProfile,
  }), [user, session, profile, isAdmin, loading, justSignedIn, recoveryMode, signIn, signUp, signOut, changePassword, sendPasswordReset, completePasswordReset, cancelPasswordReset, updateProfile, refreshProfile])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
