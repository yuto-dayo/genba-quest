INSERT INTO public.policies (
  org_id,
  name,
  description,
  proposal_type,
  conditions,
  required_approvers,
  required_count,
  auto_approve,
  ai_can_approve,
  priority,
  is_active,
  approval_mode
)
SELECT
  org.id,
  'member_classification_update_admin_approval',
  '契約区分（外注/給与判定）の更新は admin 1名承認。AI承認不可。',
  'member.classification.update',
  '[]'::jsonb,
  '[{"type":"role","role":"admin","value":"admin","count":1}]'::jsonb,
  1,
  false,
  false,
  80,
  true,
  'random_one'
FROM public.organizations AS org
WHERE NOT EXISTS (
  SELECT 1
  FROM public.policies AS existing
  WHERE existing.org_id = org.id
    AND existing.proposal_type = 'member.classification.update'
    AND existing.name = 'member_classification_update_admin_approval'
);

