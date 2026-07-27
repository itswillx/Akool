-- Avatares escolhiveis pelo usuario: emoji + cor de fundo e, opcionalmente,
-- foto (path no bucket privado `avatars`; a foto vence o emoji quando ambos
-- existem; sem nada, a UI cai na inicial + cor deterministica de sempre).
--
-- avatar_url guarda o PATH do objeto ("uid/xxxx.jpg"), nunca uma URL — a
-- leitura passa por createSignedUrl no cliente (lib/storageUrl.ts).
--
-- Gravacao: a policy existente profiles_update_own (id = auth.uid()) ja cobre
-- as colunas novas; o trigger enforce_profile_privilege_bounds so congela
-- role/is_active/invite_slots_remaining e nao interfere.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS avatar_emoji text,
  ADD COLUMN IF NOT EXISTS avatar_color text,
  ADD COLUMN IF NOT EXISTS avatar_url text;

-- ---------------------------------------------------------------------------
-- Bucket privado de avatares. Leitura: qualquer autenticado (avatares aparecem
-- para membros de workspace e shares — mesmo baseline de note-images pos-SEC);
-- escrita/remocao: apenas o dono, com o uid como primeiro segmento do path.
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS avatars_authenticated_read ON storage.objects;
CREATE POLICY avatars_authenticated_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS avatars_owner_insert ON storage.objects;
CREATE POLICY avatars_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars'
              AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS avatars_owner_update ON storage.objects;
CREATE POLICY avatars_owner_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars'
         AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS avatars_owner_delete ON storage.objects;
CREATE POLICY avatars_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars'
         AND (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- search_users_for_share passa a devolver os campos de avatar (a busca de
-- usuarios para compartilhar mostra o avatar no resultado). Mudanca de
-- RETURNS TABLE exige DROP + CREATE; os grants nao sobrevivem ao drop e os
-- default privileges do schema revogam EXECUTE, entao o grant e' reaplicado.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.search_users_for_share(text);

CREATE FUNCTION public.search_users_for_share(p_term text)
RETURNS TABLE(id uuid, display_name text, email text, avatar_emoji text, avatar_color text, avatar_url text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_term is null or length(trim(p_term)) < 3 then
    return;
  end if;
  return query
    select p.id, p.display_name, p.email, p.avatar_emoji, p.avatar_color, p.avatar_url
    from profiles p
    where p.id <> auth.uid()
      and (p.email ilike '%' || trim(p_term) || '%'
           or p.display_name ilike '%' || trim(p_term) || '%')
    order by p.display_name nulls last
    limit 6;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.search_users_for_share(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.search_users_for_share(text) FROM anon, public;
