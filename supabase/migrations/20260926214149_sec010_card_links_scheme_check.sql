-- SEC-010: links de card só com http(s).
--
-- A UI normaliza os links (normalizeLinkUrl), mas qualquer editor do quadro
-- grava project_cards.links direto pela REST. No app, o React 19 neutraliza
-- javascript: em href, mas data: e outros esquemas passavam, e quem lê os dados
-- fora do app (CLI, cards-api, exportações) não tem essa proteção. A CHECK
-- fecha no banco: array de objetos, cada um com `url` http(s) sem espaço nem
-- caractere de controle.

create or replace function private.card_links_are_safe(p_links jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_links) = 'array'
     and not exists (
       select 1
         from jsonb_array_elements(p_links) as l(item)
        where jsonb_typeof(l.item) <> 'object'
           or jsonb_typeof(l.item -> 'url') is distinct from 'string'
           or (l.item ->> 'url') !~* '^https?://[^[:space:][:cntrl:]]+$'
     );
$$;

-- A CHECK roda com o papel de quem grava: authenticated (REST) e service_role
-- precisam de EXECUTE. As funções SECURITY DEFINER gravam como o dono.
revoke execute on function private.card_links_are_safe(jsonb) from public;
grant execute on function private.card_links_are_safe(jsonb) to authenticated, service_role;

alter table public.project_cards
  add constraint project_cards_links_safe check (private.card_links_are_safe(links));
