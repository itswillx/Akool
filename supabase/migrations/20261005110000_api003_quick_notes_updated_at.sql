-- API-003: quick_notes ganha o gatilho de updated_at (hora do servidor), como
-- pages, note_contents e drawing_contents já têm.
--
-- O app deixa de mandar o updated_at do relógio do aparelho e passa a gravar
-- condicionado à versão que conhece (src/lib/data/quickNotes.ts): zero linhas
-- com a nota existindo é conflito, não sobrescrita. Sem este gatilho a versão
-- nunca mudaria e a condição não pegaria nada, então ele vai para produção
-- antes do app novo.
--
-- Só BEFORE UPDATE: o INSERT do restore (rel004) mantém o updated_at do backup.
-- update_updated_at() não tem EXECUTE para authenticated (SEC-012), e não
-- precisa: o gatilho dispara sem conferir EXECUTE.

drop trigger if exists quick_notes_updated_at on public.quick_notes;

create trigger quick_notes_updated_at
  before update on public.quick_notes
  for each row execute function public.update_updated_at();
