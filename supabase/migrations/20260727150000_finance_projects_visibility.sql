-- Obras: visibilidade dos FILHOS (etapas, itens, cotacoes, gastos) passa a
-- derivar da OBRA, nao do workspace_id da propria linha.
--
-- Motivo: no desenho original cada linha filha carregava seu proprio
-- workspace_id e a RLS checava is_workspace_member(workspace_id) nela mesma.
-- Isso quebra ao compartilhar uma obra retroativamente: os filhos criados
-- antes ficam com workspace_id nulo e continuam invisiveis para a familia
-- (obra "vazia" para o membro). E o dono nem consegue cascatear a correcao:
-- o trigger finance_guard_workspace impede terceiros de realocar linhas.
-- Derivando da obra, compartilhar/des-compartilhar e' um UPDATE em UMA linha
-- (finance_projects.workspace_id) e todos os filhos seguem junto.
--
-- finance_projects e finance_suppliers continuam com as policies originais
-- (workspace na propria linha — correto para elas). O workspace_id das filhas
-- permanece preenchido pelo app por consistencia, mas deixa de mandar na
-- visibilidade.

CREATE OR REPLACE FUNCTION public.finance_project_visible(p_project_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.finance_projects p
    WHERE p.id = p_project_id
      AND (p.user_id = auth.uid()
           OR (p.workspace_id IS NOT NULL AND public.is_workspace_member(p.workspace_id)))
  );
$$;

-- Obrigatorio: os default privileges do schema revogam EXECUTE de funcoes
-- novas (20260708110000_sec_rpc_grants.sql). Sem o grant, toda policy que usa
-- a funcao falha e as obras somem para todo mundo.
GRANT EXECUTE ON FUNCTION public.finance_project_visible(uuid) TO authenticated;
-- O revoke de default privileges nao cobriu o role que aplica migrations
-- (advisor flagrou anon com EXECUTE) — revogar explicitamente.
REVOKE EXECUTE ON FUNCTION public.finance_project_visible(uuid) FROM anon, public;

-- Filhas com project_id direto.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'finance_project_stages','finance_project_items','finance_project_expenses'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %1$s_select ON public.%1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_insert ON public.%1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_update ON public.%1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_delete ON public.%1$s', t);

    EXECUTE format(
      'CREATE POLICY %1$s_select ON public.%1$s FOR SELECT TO authenticated
         USING (user_id = auth.uid() OR public.finance_project_visible(project_id))', t);

    -- Membro so insere em obra que enxerga (antes so checava user_id; o
    -- trigger de workspace nao valida a obra em si).
    EXECUTE format(
      'CREATE POLICY %1$s_insert ON public.%1$s FOR INSERT TO authenticated
         WITH CHECK (user_id = auth.uid() AND public.finance_project_visible(project_id))', t);

    -- Colaboracao total dentro da obra compartilhada, como no resto do modulo
    -- financeiro (qualquer membro edita/exclui).
    EXECUTE format(
      'CREATE POLICY %1$s_update ON public.%1$s FOR UPDATE TO authenticated
         USING (user_id = auth.uid() OR public.finance_project_visible(project_id))
         WITH CHECK (user_id = auth.uid() OR public.finance_project_visible(project_id))', t);

    EXECUTE format(
      'CREATE POLICY %1$s_delete ON public.%1$s FOR DELETE TO authenticated
         USING (user_id = auth.uid() OR public.finance_project_visible(project_id))', t);
  END LOOP;
END $$;

-- Cotacoes nao tem project_id: derivam via o item a que pertencem.
DROP POLICY IF EXISTS finance_project_quotes_select ON public.finance_project_quotes;
DROP POLICY IF EXISTS finance_project_quotes_insert ON public.finance_project_quotes;
DROP POLICY IF EXISTS finance_project_quotes_update ON public.finance_project_quotes;
DROP POLICY IF EXISTS finance_project_quotes_delete ON public.finance_project_quotes;

CREATE POLICY finance_project_quotes_select ON public.finance_project_quotes
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.finance_project_items i
    WHERE i.id = item_id AND public.finance_project_visible(i.project_id)
  ));

CREATE POLICY finance_project_quotes_insert ON public.finance_project_quotes
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.finance_project_items i
    WHERE i.id = item_id AND public.finance_project_visible(i.project_id)
  ));

CREATE POLICY finance_project_quotes_update ON public.finance_project_quotes
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.finance_project_items i
    WHERE i.id = item_id AND public.finance_project_visible(i.project_id)
  ))
  WITH CHECK (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.finance_project_items i
    WHERE i.id = item_id AND public.finance_project_visible(i.project_id)
  ));

CREATE POLICY finance_project_quotes_delete ON public.finance_project_quotes
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.finance_project_items i
    WHERE i.id = item_id AND public.finance_project_visible(i.project_id)
  ));
