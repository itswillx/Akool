-- DEV-002: num banco montado só pelo repositório (o staging), profiles ainda
-- terminava com SELECT para anon e SELECT/UPDATE de tabela para authenticated,
-- herdados de migrations antigas. Em produção esses privilégios de tabela já
-- tinham saído quando entraram os grants por coluna (SEC-013 e seguintes):
-- sem esta revogação, a restrição por coluna não vale num banco novo, e o
-- anon leria perfis. Em produção é idempotente (já está assim); os grants por
-- coluna de authenticated não mudam.
revoke select, update on table public.profiles from authenticated;
revoke all on table public.profiles from anon;
