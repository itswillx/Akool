-- Provedor de IA reserva (fallback): usado quando a chamada ao provedor
-- principal falha (quota, indisponibilidade). Fica em profile_secrets, nao em
-- profiles, pelo mesmo motivo da migracao 20260708100000: profiles e' legivel
-- por qualquer autenticado e a chave vazaria via /rest/v1/profiles.
--
-- ATENCAO — migracao reconstruida a partir do schema remoto em 2026-07-29.
-- Ela ja estava APLICADA no projeto remoto (ledger: versao 20260710022712,
-- nome "profile_secrets_fallback_ai") mas nunca teve arquivo no repositorio.
-- Reaplica-la e' um no-op seguro. Ver ./README.md.
--
-- NOTA DE ESTADO (2026-07-29): estas duas colunas NAO sao referenciadas em
-- lugar nenhum do repositorio — nem em src/, nem em supabase/functions/. Quem
-- as le e' a versao PUBLICADA da edge function ai-chat (v9), que esta a frente
-- da copia local em supabase/functions/ai-chat/index.ts. A RPC
-- set_ai_credentials tambem nao grava nelas (conferido via pg_get_functiondef:
-- e' identica a da migracao 20260708100000). Ou seja: hoje nao ha caminho pela
-- UI para preencher o fallback. Ao ressincronizar as edge functions, decidir
-- entre (a) estender set_ai_credentials + UI, ou (b) remover as colunas.

ALTER TABLE public.profile_secrets
  ADD COLUMN IF NOT EXISTS ai_fallback_provider text,
  ADD COLUMN IF NOT EXISTS ai_fallback_api_key text;

-- profile_secrets segue sem policies e sem grants para anon/authenticated
-- (deny-all; acesso so via service role / SECURITY DEFINER). As colunas novas
-- herdam esse fechamento — nao ha grant adicional a fazer.
