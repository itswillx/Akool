-- public.todos was never added to the supabase_realtime publication, so the
-- postgres_changes subscription in TodoList.tsx silently never fires and
-- collaborative todo lists don't sync live between users.
ALTER PUBLICATION supabase_realtime ADD TABLE public.todos;
