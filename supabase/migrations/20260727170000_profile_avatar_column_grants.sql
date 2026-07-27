-- profiles usa grants POR COLUNA para SELECT/UPDATE (nao ha grant de tabela
-- para authenticated — e' assim que ai_has_key e afins ficam controlados).
-- Consequencia: as colunas de avatar criadas em 20260727160000 nasceram sem
-- SELECT/UPDATE, o que fazia o loadProfile (que agora seleciona as tres)
-- falhar com 42501 para todo usuario. Conceder explicitamente.

GRANT SELECT (avatar_emoji, avatar_color, avatar_url) ON public.profiles TO authenticated;
GRANT UPDATE (avatar_emoji, avatar_color, avatar_url) ON public.profiles TO authenticated;
