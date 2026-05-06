REVOKE ALL ON FUNCTION public.accept_org_invite(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_org_invite(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.accept_org_invite(uuid, uuid, text) FROM authenticated;
GRANT ALL ON FUNCTION public.accept_org_invite(uuid, uuid, text) TO service_role;
