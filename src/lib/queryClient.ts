import { QueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

// PERF-015: cache de dados (react-query), começando pelo Dashboard. O cliente é
// um singleton de módulo: o cache sobrevive a sair e voltar do Dashboard. O
// módulo só é carregado com o chunk do Dashboard, então não pesa no boot
// (orçamento do PERF-012).

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      // Um retry só: com a internet fora, não multiplica as chamadas.
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
})

export const dashboardKeys = {
  all: ['dashboard'] as const,
  finance: (userId: string | undefined) => ['dashboard', 'finance', userId] as const,
  todos: (userId: string | undefined) => ['dashboard', 'todos', userId] as const,
  projects: (userId: string | undefined) => ['dashboard', 'projects', userId] as const,
}

// Invalidação pelo realtime. A assinatura fica no módulo, e não no componente,
// para valer também com o Dashboard fechado: marcar uma tarefa numa página
// invalida o cache antes de você voltar. Cai no logout (SEC-017 remove os
// canais; aqui o estado também é zerado).
let realtimeUserId: string | null = null
let realtimeChannel: ReturnType<typeof supabase.channel> | null = null

export function startDashboardInvalidation(userId: string): void {
  if (realtimeUserId === userId && realtimeChannel) return
  stopDashboardInvalidation()
  realtimeUserId = userId
  realtimeChannel = supabase
    .channel(`dashboard_cache:${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'todos', filter: `user_id=eq.${userId}` },
      () => { void queryClient.invalidateQueries({ queryKey: dashboardKeys.todos(userId) }) })
    // O RLS já limita os cards aos quadros que a pessoa vê.
    .on('postgres_changes', { event: '*', schema: 'public', table: 'project_cards' },
      () => { void queryClient.invalidateQueries({ queryKey: dashboardKeys.projects(userId) }) })
    .subscribe()
}

export function stopDashboardInvalidation(): void {
  if (realtimeChannel) void supabase.removeChannel(realtimeChannel)
  realtimeChannel = null
  realtimeUserId = null
}

// SEC-017: no logout, nada do usuário anterior fica no cache em memória.
supabase.auth.onAuthStateChange(event => {
  if (event === 'SIGNED_OUT') {
    stopDashboardInvalidation()
    queryClient.clear()
  }
})
