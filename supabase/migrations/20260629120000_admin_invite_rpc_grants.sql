-- Restore EXECUTE for logged-in users only. anon/PUBLIC remain blocked.
-- Functions validate profiles.role = 'admin' internally.
GRANT EXECUTE ON FUNCTION public.admin_add_invite_slots(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_invite_code(uuid) TO authenticated;
