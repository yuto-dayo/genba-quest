-- 040: Shared communication hub based on conversations + logs

CREATE TABLE IF NOT EXISTS public.communication_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'waiting_internal'
    CHECK (status IN ('active', 'waiting_internal', 'waiting_client', 'resolved')),
  source_channel text NOT NULL DEFAULT 'gmail'
    CHECK (source_channel IN ('gmail', 'phone', 'line', 'in_person', 'sms', 'manual')),
  last_channel text NOT NULL DEFAULT 'gmail'
    CHECK (last_channel IN ('gmail', 'phone', 'line', 'in_person', 'sms', 'manual', 'system')),
  external_thread_key text,
  assignee_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  site_name_snapshot text,
  client_name_snapshot text,
  client_email_snapshot text,
  ai_summary text,
  ai_priority text
    CHECK (ai_priority IS NULL OR ai_priority IN ('urgent', 'high', 'medium', 'low')),
  next_action text,
  next_action_due_date date,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  last_message_preview text,
  created_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS communication_conversations_org_channel_thread_idx
  ON public.communication_conversations (org_id, source_channel, external_thread_key)
  WHERE external_thread_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS communication_conversations_org_status_activity_idx
  ON public.communication_conversations (org_id, status, last_activity_at DESC);

CREATE INDEX IF NOT EXISTS communication_conversations_org_assignee_activity_idx
  ON public.communication_conversations (org_id, assignee_user_id, last_activity_at DESC);

CREATE TABLE IF NOT EXISTS public.communication_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES public.communication_conversations(id) ON DELETE CASCADE,
  channel text NOT NULL
    CHECK (channel IN ('gmail', 'phone', 'line', 'in_person', 'sms', 'manual', 'system')),
  direction text NOT NULL DEFAULT 'internal'
    CHECK (direction IN ('inbound', 'outbound', 'internal')),
  log_kind text NOT NULL DEFAULT 'message'
    CHECK (log_kind IN ('message', 'note', 'status_change', 'assignment_change', 'summary_update', 'proposal_link')),
  subject text,
  body text NOT NULL,
  summary text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by_type text NOT NULL DEFAULT 'human'
    CHECK (created_by_type IN ('human', 'ai', 'system', 'integration')),
  created_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by_name_snapshot text,
  external_source text,
  external_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS communication_logs_external_source_id_idx
  ON public.communication_logs (external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS communication_logs_conversation_occurred_idx
  ON public.communication_logs (conversation_id, occurred_at ASC, created_at ASC);

CREATE INDEX IF NOT EXISTS communication_logs_org_channel_idx
  ON public.communication_logs (org_id, channel, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.communication_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES public.communication_conversations(id) ON DELETE CASCADE,
  link_type text NOT NULL CHECK (link_type IN ('proposal')),
  proposal_id uuid REFERENCES public.proposals(id) ON DELETE CASCADE,
  log_id uuid REFERENCES public.communication_logs(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communication_links_proposal_required CHECK (
    (link_type = 'proposal' AND proposal_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS communication_links_conversation_proposal_idx
  ON public.communication_links (conversation_id, link_type, proposal_id);

CREATE INDEX IF NOT EXISTS communication_links_org_conversation_idx
  ON public.communication_links (org_id, conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.communication_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES public.communication_conversations(id) ON DELETE CASCADE,
  participant_kind text NOT NULL CHECK (participant_kind IN ('client', 'internal', 'integration')),
  display_name text NOT NULL,
  email text,
  phone text,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS communication_participants_conversation_profile_idx
  ON public.communication_participants (conversation_id, profile_id)
  WHERE profile_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS communication_participants_conversation_email_idx
  ON public.communication_participants (conversation_id, email)
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS communication_participants_org_conversation_idx
  ON public.communication_participants (org_id, conversation_id, created_at ASC);

ALTER TABLE public.communication_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read Communication Conversations" ON public.communication_conversations;
DROP POLICY IF EXISTS "Insert Communication Conversations" ON public.communication_conversations;
DROP POLICY IF EXISTS "Update Communication Conversations" ON public.communication_conversations;
DROP POLICY IF EXISTS "Read Communication Logs" ON public.communication_logs;
DROP POLICY IF EXISTS "Insert Communication Logs" ON public.communication_logs;
DROP POLICY IF EXISTS "Update Communication Logs" ON public.communication_logs;
DROP POLICY IF EXISTS "Read Communication Links" ON public.communication_links;
DROP POLICY IF EXISTS "Insert Communication Links" ON public.communication_links;
DROP POLICY IF EXISTS "Read Communication Participants" ON public.communication_participants;
DROP POLICY IF EXISTS "Insert Communication Participants" ON public.communication_participants;
DROP POLICY IF EXISTS "Update Communication Participants" ON public.communication_participants;

CREATE POLICY "Read Communication Conversations" ON public.communication_conversations
  FOR SELECT TO authenticated
  USING (
    org_id = COALESCE(
      NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
      NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  );

CREATE POLICY "Insert Communication Conversations" ON public.communication_conversations
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = COALESCE(
      NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
      NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  );

CREATE POLICY "Update Communication Conversations" ON public.communication_conversations
  FOR UPDATE TO authenticated
  USING (
    org_id = COALESCE(
      NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
      NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  )
  WITH CHECK (
    org_id = COALESCE(
      NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
      NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  );

CREATE POLICY "Read Communication Logs" ON public.communication_logs
  FOR SELECT TO authenticated
  USING (
    org_id = COALESCE(
      NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
      NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  );

CREATE POLICY "Insert Communication Logs" ON public.communication_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = COALESCE(
      NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
      NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  );

CREATE POLICY "Update Communication Logs" ON public.communication_logs
  FOR UPDATE TO authenticated
  USING (
    org_id = COALESCE(
      NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
      NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  )
  WITH CHECK (
    org_id = COALESCE(
      NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
      NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  );

CREATE POLICY "Read Communication Links" ON public.communication_links
  FOR SELECT TO authenticated
  USING (
    org_id = COALESCE(
      NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
      NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  );

CREATE POLICY "Insert Communication Links" ON public.communication_links
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = COALESCE(
      NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
      NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  );

CREATE POLICY "Read Communication Participants" ON public.communication_participants
  FOR SELECT TO authenticated
  USING (
    org_id = COALESCE(
      NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
      NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  );

CREATE POLICY "Insert Communication Participants" ON public.communication_participants
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = COALESCE(
      NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
      NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  );

CREATE POLICY "Update Communication Participants" ON public.communication_participants
  FOR UPDATE TO authenticated
  USING (
    org_id = COALESCE(
      NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
      NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  )
  WITH CHECK (
    org_id = COALESCE(
      NULLIF(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid,
      NULLIF(auth.jwt() -> 'user_metadata' ->> 'org_id', '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  );

WITH review_proposals AS (
  SELECT
    p.id,
    p.org_id,
    p.site_id,
    p.status,
    p.created_at,
    p.updated_at,
    COALESCE(NULLIF(p.payload->>'source_message_subject', ''), '(件名なし)') AS subject,
    COALESCE(
      NULLIF(p.payload->>'source_thread_id', ''),
      NULLIF(p.payload->>'source_message_id', '')
    ) AS thread_key,
    NULLIF(p.payload->>'source_message_id', '') AS message_id,
    COALESCE(
      NULLIF(p.payload->>'source_message_from', ''),
      '送信者不明'
    ) AS sender,
    COALESCE(
      NULLIF(p.payload->>'source_message_body_preview', ''),
      NULLIF(p.payload->>'email_body_preview', ''),
      NULLIF(p.payload->>'summary', ''),
      p.description
    ) AS preview,
    NULLIF(p.payload->>'summary', '') AS summary,
    NULLIF(p.payload->>'priority', '') AS priority,
    NULLIF(p.payload->>'due_date', '') AS due_date
  FROM public.proposals p
  WHERE p.type = 'communication.review'
),
conversation_seed AS (
  SELECT
    rp.*,
    s.name AS site_name,
    NULLIF(regexp_replace(rp.sender, '\s*<[^>]+>\s*$', ''), '') AS sender_name,
    NULLIF(substring(rp.sender FROM '<([^>]+)>'), '') AS sender_email
  FROM review_proposals rp
  LEFT JOIN public.sites s ON s.id = rp.site_id
  WHERE rp.thread_key IS NOT NULL
)
INSERT INTO public.communication_conversations (
  org_id,
  title,
  status,
  source_channel,
  last_channel,
  external_thread_key,
  site_id,
  site_name_snapshot,
  client_name_snapshot,
  client_email_snapshot,
  ai_summary,
  ai_priority,
  next_action,
  next_action_due_date,
  last_activity_at,
  last_message_preview,
  created_at,
  updated_at
)
SELECT
  seed.org_id,
  seed.subject,
  CASE
    WHEN seed.status = 'executed' THEN 'resolved'
    ELSE 'waiting_internal'
  END,
  'gmail',
  'gmail',
  seed.thread_key,
  seed.site_id,
  seed.site_name,
  COALESCE(seed.sender_name, seed.sender),
  seed.sender_email,
  seed.summary,
  seed.priority,
  seed.summary,
  CASE
    WHEN seed.due_date ~ '^\d{4}-\d{2}-\d{2}$' THEN seed.due_date::date
    ELSE NULL
  END,
  seed.created_at,
  seed.preview,
  seed.created_at,
  seed.updated_at
FROM conversation_seed seed
WHERE NOT EXISTS (
  SELECT 1
  FROM public.communication_conversations existing
  WHERE existing.org_id = seed.org_id
    AND existing.source_channel = 'gmail'
    AND existing.external_thread_key = seed.thread_key
);

WITH review_proposals AS (
  SELECT
    p.id,
    p.org_id,
    p.created_at,
    COALESCE(
      NULLIF(p.payload->>'source_thread_id', ''),
      NULLIF(p.payload->>'source_message_id', '')
    ) AS thread_key,
    NULLIF(p.payload->>'source_message_id', '') AS message_id,
    COALESCE(NULLIF(p.payload->>'source_message_subject', ''), '(件名なし)') AS subject,
    COALESCE(
      NULLIF(p.payload->>'source_message_body_full', ''),
      NULLIF(p.payload->>'source_message_body_preview', ''),
      NULLIF(p.payload->>'email_body_full', ''),
      NULLIF(p.payload->>'email_body_preview', ''),
      NULLIF(p.payload->>'summary', ''),
      p.description
    ) AS body,
    NULLIF(p.payload->>'summary', '') AS summary,
    COALESCE(
      NULLIF(p.payload->>'source_message_date', ''),
      p.created_at::text
    ) AS source_message_date,
    COALESCE(
      NULLIF(p.payload->>'source_message_from', ''),
      '送信者不明'
    ) AS sender
  FROM public.proposals p
  WHERE p.type = 'communication.review'
),
log_seed AS (
  SELECT
    rp.org_id,
    c.id AS conversation_id,
    rp.message_id,
    rp.subject,
    rp.body,
    rp.summary,
    rp.source_message_date,
    rp.sender
  FROM review_proposals rp
  JOIN public.communication_conversations c
    ON c.org_id = rp.org_id
   AND c.source_channel = 'gmail'
   AND c.external_thread_key = rp.thread_key
  WHERE rp.thread_key IS NOT NULL
    AND rp.message_id IS NOT NULL
)
INSERT INTO public.communication_logs (
  org_id,
  conversation_id,
  channel,
  direction,
  log_kind,
  subject,
  body,
  summary,
  occurred_at,
  created_by_type,
  created_by_name_snapshot,
  external_source,
  external_id,
  metadata
)
SELECT
  seed.org_id,
  seed.conversation_id,
  'gmail',
  'inbound',
  'message',
  seed.subject,
  seed.body,
  seed.summary,
  CASE
    WHEN seed.source_message_date ~ '^\d{4}-\d{2}-\d{2}' THEN seed.source_message_date::timestamptz
    ELSE now()
  END,
  'integration',
  'Gmail Watcher',
  'gmail',
  seed.message_id,
  jsonb_build_object(
    'source_message_id', seed.message_id,
    'source_message_from', seed.sender
  )
FROM log_seed seed
WHERE NOT EXISTS (
  SELECT 1
  FROM public.communication_logs existing
  WHERE existing.external_source = 'gmail'
    AND existing.external_id = seed.message_id
);

WITH proposal_seed AS (
  SELECT
    p.id AS proposal_id,
    p.org_id,
    COALESCE(
      NULLIF(p.payload->>'source_thread_id', ''),
      NULLIF(p.payload->>'source_message_id', '')
    ) AS thread_key,
    p.created_at
  FROM public.proposals p
  WHERE p.type IN ('communication.review', 'communication.task', 'task.revision.request')
)
INSERT INTO public.communication_links (
  org_id,
  conversation_id,
  link_type,
  proposal_id,
  created_at
)
SELECT
  seed.org_id,
  c.id,
  'proposal',
  seed.proposal_id,
  seed.created_at
FROM proposal_seed seed
JOIN public.communication_conversations c
  ON c.org_id = seed.org_id
 AND c.source_channel = 'gmail'
 AND c.external_thread_key = seed.thread_key
WHERE seed.thread_key IS NOT NULL
ON CONFLICT (conversation_id, link_type, proposal_id) DO NOTHING;

WITH participant_seed AS (
  SELECT
    p.org_id,
    c.id AS conversation_id,
    COALESCE(
      NULLIF(p.payload->>'source_message_from', ''),
      '送信者不明'
    ) AS sender,
    p.created_at
  FROM public.proposals p
  JOIN public.communication_conversations c
    ON c.org_id = p.org_id
   AND c.source_channel = 'gmail'
   AND c.external_thread_key = COALESCE(
     NULLIF(p.payload->>'source_thread_id', ''),
     NULLIF(p.payload->>'source_message_id', '')
   )
  WHERE p.type = 'communication.review'
),
normalized_participants AS (
  SELECT DISTINCT ON (conversation_id, COALESCE(NULLIF(substring(sender FROM '<([^>]+)>'), ''), sender))
    org_id,
    conversation_id,
    COALESCE(NULLIF(regexp_replace(sender, '\s*<[^>]+>\s*$', ''), ''), sender) AS display_name,
    NULLIF(substring(sender FROM '<([^>]+)>'), '') AS email,
    created_at
  FROM participant_seed
)
INSERT INTO public.communication_participants (
  org_id,
  conversation_id,
  participant_kind,
  display_name,
  email,
  is_primary,
  created_at,
  updated_at
)
SELECT
  seed.org_id,
  seed.conversation_id,
  'client',
  seed.display_name,
  seed.email,
  true,
  seed.created_at,
  seed.created_at
FROM normalized_participants seed
WHERE NOT EXISTS (
  SELECT 1
  FROM public.communication_participants existing
  WHERE existing.conversation_id = seed.conversation_id
    AND (
      (seed.email IS NOT NULL AND existing.email = seed.email)
      OR (seed.email IS NULL AND existing.display_name = seed.display_name)
    )
);
