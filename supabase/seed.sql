-- DEV-006: dados de exemplo para o Supabase LOCAL (`npx supabase db reset`).
--
-- Só roda no banco local: o CLI aplica este arquivo depois das migrations no
-- reset local. O `npm run staging:reset` NÃO o lê (há teste), e a produção
-- nunca recebe seed. As senhas abaixo são fictícias e valem só na sua máquina.
--
--   admin@akool.test   / local-admin-123   (admin)
--   pessoa@akool.test  / local-user-123    (usuário comum)
--   convite livre: LOCAL-CONVITE (cadastro pela tela, vale 30 dias)
--
-- O cadastro exige convite (trigger on_auth_user_signup_invite_check), então
-- cada usuário do seed entra com um convite criado antes dele.

-- ── Convites ─────────────────────────────────────────────────────────────────
-- invite_codes.created_by não tem FK: o convite do admin nasce antes do admin.
insert into public.invite_codes (code, created_by, expires_at) values
  ('SEED-ADMIN',    '00000000-0000-4000-a000-000000000001', now() + interval '1 day'),
  ('SEED-PESSOA',   '00000000-0000-4000-a000-000000000001', now() + interval '1 day'),
  ('LOCAL-CONVITE', '00000000-0000-4000-a000-000000000001', now() + interval '30 days')
on conflict (code) do nothing;

-- ── Usuários (auth) ──────────────────────────────────────────────────────────
-- Colunas de token vazias ('' e não null): o GoTrue recusa login com null nelas.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
) values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-a000-000000000001', 'authenticated', 'authenticated',
   'admin@akool.test', extensions.crypt('local-admin-123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"invite_code":"SEED-ADMIN","display_name":"Admin local"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-a000-000000000002', 'authenticated', 'authenticated',
   'pessoa@akool.test', extensions.crypt('local-user-123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"invite_code":"SEED-PESSOA","display_name":"Pessoa local"}',
   now(), now(), '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at) values
  (gen_random_uuid(), '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001', 'email',
   '{"sub":"00000000-0000-4000-a000-000000000001","email":"admin@akool.test","email_verified":true}', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000002', 'email',
   '{"sub":"00000000-0000-4000-a000-000000000002","email":"pessoa@akool.test","email_verified":true}', now(), now(), now())
on conflict do nothing;

-- O perfil nasce pelo trigger handle_new_user() como 'standard'; o papel de
-- admin só muda fora do app (no app, só pela edge admin-ops).
update public.profiles set role = 'admin' where id = '00000000-0000-4000-a000-000000000001';

-- ── Páginas ──────────────────────────────────────────────────────────────────
insert into public.pages (id, user_id, title, icon, type, sort_order) values
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000002', 'Bem-vindo ao Akool local', '👋', 'note', 1),
  ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002', 'Tarefas da semana', '✅', 'todo', 2)
on conflict (id) do nothing;

insert into public.note_contents (page_id, content) values
  ('00000000-0000-4000-b000-000000000001',
   '[{"type":"paragraph","content":[{"type":"text","text":"Banco local com dados de exemplo (supabase/seed.sql).","styles":{}}]}]')
on conflict do nothing;

insert into public.todos (page_id, user_id, text, priority, sort_order) values
  ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002', 'Conferir o fluxo local', 'high', 1),
  ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002', 'Rodar os testes E2E', 'medium', 2);

-- ── Projetos ─────────────────────────────────────────────────────────────────
insert into public.project_boards (id, user_id, name, icon, color, description, sort_order) values
  ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-a000-000000000002', 'Projeto de exemplo', '🚀', '#6366f1', 'Quadro criado pelo seed local.', 1)
on conflict (id) do nothing;

insert into public.project_columns (id, board_id, name, color, sort_order) values
  ('00000000-0000-4000-c100-000000000001', '00000000-0000-4000-c000-000000000001', 'A Fazer',   '#94a3b8', 0),
  ('00000000-0000-4000-c100-000000000002', '00000000-0000-4000-c000-000000000001', 'Fazendo',   '#3b82f6', 1),
  ('00000000-0000-4000-c100-000000000003', '00000000-0000-4000-c000-000000000001', 'Concluído', '#22c55e', 2)
on conflict (id) do nothing;

insert into public.project_cards (board_id, column_id, title, description, priority, labels, sort_order) values
  ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-c100-000000000001', 'Primeiro card', 'Arraste para outra coluna.', 'medium', '["exemplo"]', 0),
  ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-c100-000000000002', 'Card em andamento', '', 'high', '[]', 0),
  ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-c100-000000000003', 'Card concluído', '', 'low', '[]', 0);

-- ── Financeiro (valores em centavos) ─────────────────────────────────────────
insert into public.finance_accounts (user_id, name, type, initial_balance, color, icon) values
  ('00000000-0000-4000-a000-000000000002', 'Conta corrente', 'checking', 150000, '#10b981', '🏦'),
  ('00000000-0000-4000-a000-000000000002', 'Cartão', 'credit', 0, '#f59e0b', '💳');

insert into public.finance_categories (user_id, name, type, color, icon, is_default) values
  ('00000000-0000-4000-a000-000000000002', 'Salário', 'income', '#22c55e', '💰', true),
  ('00000000-0000-4000-a000-000000000002', 'Mercado', 'expense', '#ef4444', '🛒', true),
  ('00000000-0000-4000-a000-000000000002', 'Transporte', 'expense', '#3b82f6', '🚌', true);
