-- PR-09: member invoice random reviewer + timed payout-detail access.
-- This is repo-managed only; do not hand-run against remote DB.

CREATE TABLE IF NOT EXISTS public.org_settings (
    org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    finance_review_window_hours integer NOT NULL DEFAULT 168,
    finance_reviewer_pool uuid[],
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT org_settings_finance_review_window_hours_check
        CHECK (finance_review_window_hours BETWEEN 1 AND 720)
);

CREATE OR REPLACE TRIGGER org_settings_set_updated_at
    BEFORE UPDATE ON public.org_settings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.org_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read org settings as active member" ON public.org_settings;
CREATE POLICY "Read org settings as active member"
    ON public.org_settings FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.org_memberships AS membership
            WHERE membership.org_id = org_settings.org_id
              AND membership.user_id = auth.uid()
              AND membership.status = 'active'
        )
    );

CREATE TABLE IF NOT EXISTS public.invoice_review_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id uuid NOT NULL REFERENCES public.member_invoices(id) ON DELETE CASCADE,
    reviewer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    completed_at timestamptz,
    reassigned_from uuid REFERENCES public.invoice_review_assignments(id) ON DELETE SET NULL,
    CONSTRAINT invoice_review_assignments_window_check
        CHECK (expires_at > assigned_at),
    CONSTRAINT invoice_review_assignments_completed_check
        CHECK (completed_at IS NULL OR completed_at >= assigned_at),
    CONSTRAINT invoice_review_assignments_invoice_unique
        UNIQUE (invoice_id, reviewer_user_id, expires_at)
);

CREATE INDEX IF NOT EXISTS invoice_review_assignments_reviewer_active_idx
    ON public.invoice_review_assignments (reviewer_user_id, expires_at, completed_at);

CREATE INDEX IF NOT EXISTS invoice_review_assignments_invoice_idx
    ON public.invoice_review_assignments (invoice_id);

CREATE INDEX IF NOT EXISTS invoice_review_assignments_org_idx
    ON public.invoice_review_assignments (org_id, expires_at);

ALTER TABLE public.invoice_review_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Reviewer reads own invoice review assignments" ON public.invoice_review_assignments;
CREATE POLICY "Reviewer reads own invoice review assignments"
    ON public.invoice_review_assignments FOR SELECT TO authenticated
    USING (reviewer_user_id = auth.uid());

REVOKE ALL ON TABLE public.org_settings FROM anon, authenticated;
GRANT SELECT ON TABLE public.org_settings TO authenticated;
GRANT ALL ON TABLE public.org_settings TO service_role;

REVOKE ALL ON TABLE public.invoice_review_assignments FROM anon, authenticated;
GRANT SELECT ON TABLE public.invoice_review_assignments TO authenticated;
GRANT ALL ON TABLE public.invoice_review_assignments TO service_role;

-- Older member-invoice migrations added server code before registering these
-- Proposal types in the DB check constraint. Keep the full known set here so
-- PR-09 mark-paid Proposals can be created through the normal Proposal path.
ALTER TABLE public.proposals DROP CONSTRAINT IF EXISTS proposals_type_check;
ALTER TABLE public.proposals
    ADD CONSTRAINT proposals_type_check
    CHECK (
        type = ANY (
            ARRAY[
                'expense.create',
                'expense.update',
                'expense.void',
                'income.create',
                'income.update',
                'income.reverse',
                'invoice.create',
                'invoice.send',
                'invoice.mark_paid',
                'invoice.member_issue',
                'invoice.member_mark_paid',
                'invoice.member_void',
                'payment.record',
                'payment.allocate',
                'reward.calculate',
                'reward.adjust',
                'reward.pool.adjust',
                'path.level.update',
                'level.objection',
                'skill.achieve',
                'skill.revoke',
                'evaluation.submit',
                'evaluation.finalize',
                'assignment.create',
                'assignment.update',
                'assignment.cancel',
                'leave.request',
                'communication.review',
                'communication.task',
                'task.revision.request',
                'site.create',
                'site.complete',
                'site.close.finalize',
                'site.close.reopen',
                'policy.update',
                'luqo.catalog.add',
                'luqo.star.achieve',
                'luqo.score.update',
                'luqo.reward.calculate'
            ]::text[]
        )
    );

COMMENT ON TABLE public.invoice_review_assignments IS
    'Time-bound assignment granting one reviewer access to member invoice payout details.';
COMMENT ON COLUMN public.invoice_review_assignments.completed_at IS
    'Set when the assigned reviewer completes invoice.member_mark_paid through Proposal flow.';
COMMENT ON TABLE public.org_settings IS
    'Organization-level feature settings. PR-09 uses finance_review_window_hours and optional finance_reviewer_pool.';
