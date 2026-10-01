-- SEC-015: a IA sem uso sai do app (decisão de 01/10/2026). As edges ai-chat,
-- analyze-transaction-photo, categorize-transactions e study-lookup não têm
-- consumidor no frontend, em cron nem em função do banco; o código sai do repo e
-- as functions são apagadas no painel. A chave de IA guardada sem cifra sai
-- junto. As tabelas profile_secrets e study_lookup_cache ficam (o site-backup
-- as classifica); a remoção delas fica para o DEV-010.

delete from public.profile_secrets;
revoke all on public.profile_secrets from anon, authenticated;
