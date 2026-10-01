-- REL-008: backup automático agendado no servidor.
--
-- O backup "automático" só rodava quando um admin abria o painel de backup
-- (o navegador chamava create_backup). Sem visita, não havia backup; o último
-- foi em 30/07/2026. O agendamento antigo (20250622120000_site_backups.sql) só
-- valia se o pg_cron já existisse, e dependia de app.settings.*, que o
-- Supabase não oferece mais.
--
-- Agora: o pg_cron chama todo dia a Edge Function site-backup com a ação
-- run_auto_backup. Quem decide se venceu é a função (interval_days em
-- site_backup_settings, hoje 7 dias), então a chamada diária é segura, e um dia
-- que falhar é coberto no seguinte.
--
-- A URL e o segredo ficam no Vault, fora do repositório:
--   - site_backup_url: https://<projeto>.supabase.co/functions/v1/site-backup
--   - backup_cron_secret: o mesmo valor do BACKUP_CRON_SECRET das Edge
--     Functions (a site-backup só aceita o segredo em run_auto_backup, SEC-003).
-- Sem os dois, a chamada falha com uma mensagem clara, e nada mais é afetado.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Chamada da Edge Function. Fica numa função para o job e a verificação
-- manual usarem o mesmo caminho. SECURITY DEFINER para ler o Vault; em
-- `private`, sem EXECUTE para a API.
create or replace function private.request_site_backup()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'site_backup_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'backup_cron_secret';
  if v_url is null or v_secret is null then
    raise exception 'REL-008: faltam site_backup_url e/ou backup_cron_secret no Vault';
  end if;

  -- O pg_net envia depois do commit; o backup inteiro leva segundos, então o
  -- timeout é largo para a resposta ficar registrada em net._http_response.
  return net.http_post(
    url := v_url,
    body := '{"action":"run_auto_backup"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    timeout_milliseconds := 120000
  );
end;
$$;

revoke execute on function private.request_site_backup() from public, anon, authenticated;

-- O job antigo, se algum dia chegou a ser criado.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'weekly-site-backup') then
    perform cron.unschedule('weekly-site-backup');
  end if;
end
$$;

-- cron.schedule com o mesmo nome atualiza o job: a migration pode rodar de novo.
-- 06:00 UTC = 03:00 em Brasília.
select cron.schedule('site-backup-auto', '0 6 * * *', 'select private.request_site_backup()');

-- O histórico do pg_cron cresce para sempre sem poda.
select cron.schedule(
  'cron-history-prune',
  '30 5 * * 0',
  $$delete from cron.job_run_details where end_time < now() - interval '14 days'$$
);
