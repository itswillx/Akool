-- REL-001 (item 6): alerta quando passam mais de 48 h sem backup concluído.
-- Roda no banco (pg_cron, como o backup automático do REL-008), uma hora depois
-- do backup das 06:00 UTC. Sem site_backups `completed` nas últimas 48 h, cada
-- admin ativo recebe uma notificação `backup_stale` (o Dashboard mostra título
-- e corpo de qualquer notificação), no máximo uma por dia por admin.
create or replace function private.notify_stale_backup()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last timestamptz;
  v_sent integer := 0;
  r record;
begin
  select max(created_at) into v_last from public.site_backups where status = 'completed';
  if v_last is not null and v_last > now() - interval '48 hours' then
    return 0;
  end if;
  for r in
    select p.id from public.profiles p
    where p.role = 'admin' and coalesce(p.is_active, true)
      and not exists (
        select 1 from public.notifications n
        where n.user_id = p.id and n.type = 'backup_stale' and n.created_at > now() - interval '24 hours'
      )
  loop
    perform public._notify(
      r.id,
      'backup_stale',
      'Backup atrasado',
      case when v_last is null then 'Nenhum backup concluído até agora.'
           else 'Nenhum backup concluído desde ' || to_char(v_last at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || '.' end,
      jsonb_build_object('last_completed_at', v_last)
    );
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$$;

revoke execute on function private.notify_stale_backup() from public, anon, authenticated;

-- cron.schedule com o mesmo nome atualiza o job: a migration pode rodar de novo.
select cron.schedule('site-backup-stale-alert', '0 7 * * *', 'select private.notify_stale_backup()');
