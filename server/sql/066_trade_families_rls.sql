-- ============================================================
-- Protect trade_families behind RLS
-- ============================================================
-- trade_families is a shared reference table exposed from public.
-- Keep it readable to authenticated users and writable only via
-- migrations / privileged roles.

ALTER TABLE public.trade_families ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read trade_families" ON public.trade_families;

CREATE POLICY "Read trade_families" ON public.trade_families
  FOR SELECT TO authenticated
  USING (true);
