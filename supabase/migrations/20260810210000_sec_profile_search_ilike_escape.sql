-- SEC-002: search_users_for_share interpolava p_term cru no ilike
-- ('%' || trim(p_term) || '%'). % e _ sao curingas de ILIKE no Postgres, entao
-- um POST direto com p_term = '___' ou '%%%' passa da guarda de 3 caracteres
-- e casa com qualquer email/nome, enumerando todos os profiles via
-- SECURITY DEFINER (ignora a policy restritiva profiles_authenticated_select).
-- A sanitizacao client-side (sanitizeIlikeTerm) e bypassavel com POST direto
-- na REST API, entao o fix precisa estar dentro da propria funcao.
--
-- Fix: escapar \, % e _ do termo antes de concatenar no padrao ilike, usando
-- ESCAPE '\'. Ordem importa: escapar as barras ja existentes no termo ANTES
-- de introduzir novas barras de escape para % e _, senao as barras novas
-- seriam escapadas de novo.

CREATE OR REPLACE FUNCTION public.search_users_for_share(p_term text)
RETURNS TABLE(id uuid, display_name text, email text, avatar_emoji text, avatar_color text, avatar_url text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_term text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_term is null or length(trim(p_term)) < 3 then
    return;
  end if;
  v_term := replace(replace(replace(trim(p_term), '\', '\\'), '%', '\%'), '_', '\_');
  return query
    select p.id, p.display_name, p.email, p.avatar_emoji, p.avatar_color, p.avatar_url
    from profiles p
    where p.id <> auth.uid()
      and (p.email ilike '%' || v_term || '%' escape '\'
           or p.display_name ilike '%' || v_term || '%' escape '\')
    order by p.display_name nulls last
    limit 6;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.search_users_for_share(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.search_users_for_share(text) FROM anon, public;
