-- SEC-014: avatar_url e avatar_color não podem virar pixel de rastreio.
--   * avatar_url só é um path do bucket avatars DO PRÓPRIO perfil
--     (<id>/<uuid>.<ext>), como o UserSettingsModal grava; URL externa não entra.
--   * avatar_color só #rrggbb: o valor vai para o CSS `background`, que
--     aceitaria `url(...)`.
-- Dados conferidos antes (0 linhas fora do formato). Reverter:
--   alter table public.profiles drop constraint profiles_avatar_url_own_path,
--                               drop constraint profiles_avatar_color_hex;
alter table public.profiles
  add constraint profiles_avatar_url_own_path
    check (avatar_url is null or avatar_url ~ ('^' || id::text || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$')),
  add constraint profiles_avatar_color_hex
    check (avatar_color is null or avatar_color ~ '^#[0-9a-fA-F]{6}$');
