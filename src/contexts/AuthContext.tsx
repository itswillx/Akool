import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

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
}

interface AuthContextType {
  user: User | null
  session: Session | null
  profile: UserProfile | null
  isAdmin: boolean
  loading: boolean
  justSignedIn: boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signUp: (email: string, password: string, inviteCode: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ error: string | null }>
  updateProfile: (data: Partial<Pick<UserProfile, 'display_name' | 'language' | 'theme'>>) => Promise<{ error: string | null }>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [justSignedIn, setJustSignedIn] = useState(false)

  const loadProfile = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('id, email, display_name, role, is_active, language, theme, invite_slots_remaining, last_login_date')
      .eq('id', userId)
      .single()
    if (data) {
      const profile: UserProfile = data as UserProfile
      setProfile(profile)
      if (profile.language) {
        localStorage.setItem('excalinotion_auth_lang', profile.language)
      }
    }
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        loadProfile(session.user.id).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        loadProfile(session.user.id)
      } else {
        setProfile(null)
      }
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
    const { error: reAuthErr } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword })
    if (reAuthErr) return { error: 'Senha atual incorreta.' }
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) return { error: error.message }
    return { error: null }
  }, [user])

  const updateProfile = useCallback(async (data: Partial<Pick<UserProfile, 'display_name' | 'language' | 'theme'>>): Promise<{ error: string | null }> => {
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
    user, session, profile, isAdmin, loading, justSignedIn,
    signIn, signUp, signOut, changePassword, updateProfile, refreshProfile,
  }), [user, session, profile, isAdmin, loading, justSignedIn, signIn, signUp, signOut, changePassword, updateProfile, refreshProfile])

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
