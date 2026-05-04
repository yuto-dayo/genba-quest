


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "private"."has_org_role"("p_org_id" "uuid", "p_roles" "text"[]) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.org_memberships m
    WHERE m.org_id = p_org_id
      AND m.user_id = auth.uid()
      AND m.status = 'active'
      AND m.role = ANY (p_roles)
  );
$$;


ALTER FUNCTION "private"."has_org_role"("p_org_id" "uuid", "p_roles" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_active_member"("p_org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.org_memberships m
    WHERE m.org_id = p_org_id
      AND m.user_id = auth.uid()
      AND m.status = 'active'
  );
$$;


ALTER FUNCTION "private"."is_active_member"("p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accounting_audit_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.accounting_audit_log (
    table_name,
    record_id,
    action,
    old_values,
    new_values,
    changed_by
  )
  VALUES (
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    CASE WHEN TG_OP != 'INSERT' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP != 'DELETE' THEN to_jsonb(NEW) END,
    COALESCE(
      CASE WHEN TG_OP != 'DELETE' THEN NEW.created_by END,
      CASE WHEN TG_OP = 'DELETE' THEN OLD.created_by END,
      auth.uid()
    )
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."accounting_audit_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accounting_auto_assign_reviewer"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_reviewer uuid;
  v_amount numeric;
BEGIN
  IF NEW.kind = 'expense' AND NEW.risk_level = 'HIGH' THEN
    IF NEW.reviewer_id IS NULL THEN
      v_amount := COALESCE(NEW.amount_total, 0);

      -- 金額に応じた承認権限を持つユーザーを選択（申請者除外）
      SELECT id
        INTO v_reviewer
      FROM public.profiles
      WHERE id <> NEW.created_by
        AND COALESCE(approval_limit, 50000) >= v_amount
      ORDER BY COALESCE(approval_limit, 50000) ASC, random()
      LIMIT 1;

      -- 承認権限を持つユーザーがいない場合は admin/manager を選択
      IF v_reviewer IS NULL THEN
        SELECT id
          INTO v_reviewer
        FROM public.profiles
        WHERE id <> NEW.created_by
          AND role IN ('admin', 'manager')
        ORDER BY random()
        LIMIT 1;
      END IF;

      -- それでもいない場合は従来通りランダム選択
      IF v_reviewer IS NULL THEN
        SELECT id
          INTO v_reviewer
        FROM public.profiles
        WHERE id <> NEW.created_by
        ORDER BY random()
        LIMIT 1;
      END IF;

      IF v_reviewer IS NULL THEN
        RAISE EXCEPTION 'no eligible reviewer (only applicant exists?)';
      END IF;

      NEW.reviewer_id := v_reviewer;
    END IF;

    NEW.review_status := 'pending';
    NEW.status := 'pending_review';
    NEW.review_assigned_at := COALESCE(NEW.review_assigned_at, now());
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."accounting_auto_assign_reviewer"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_personal_schedule_request_from_proposal"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_schedule_id uuid;
  v_user_candidate text;
  v_user_id uuid;
  v_start_candidate text;
  v_end_candidate text;
  v_start_date date;
  v_end_date date;
  v_type_candidate text;
  v_schedule_type text;
  v_title text;
  v_reason text;
  v_address text;
  v_color_candidate text;
  v_color text;
  v_start_time_candidate text;
  v_end_time_candidate text;
  v_start_time time;
  v_end_time time;
  v_blocks_assignment boolean;
  v_visibility_candidate text;
  v_visibility text;
BEGIN
  IF NEW.type <> 'leave.request' OR NEW.status <> 'executed' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'executed' THEN
    RETURN NEW;
  END IF;

  v_user_candidate := COALESCE(
    NULLIF(NEW.payload->>'user_id', ''),
    NULLIF(NEW.payload->>'userId', ''),
    NULLIF(NEW.payload->>'target_user_id', ''),
    NULLIF(NEW.payload->>'targetUserId', ''),
    CASE
      WHEN COALESCE(NEW.created_by->>'type', '') = 'human'
        THEN NULLIF(NEW.created_by->>'id', '')
      ELSE NULL
    END
  );

  IF v_user_candidate IS NOT NULL
    AND v_user_candidate ~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
  THEN
    v_user_id := v_user_candidate::uuid;
  ELSE
    RETURN NEW;
  END IF;

  v_start_candidate := COALESCE(
    NULLIF(NEW.payload->>'start_date', ''),
    NULLIF(NEW.payload->>'startDate', ''),
    NULLIF(NEW.payload->>'date', '')
  );
  v_end_candidate := COALESCE(
    NULLIF(NEW.payload->>'end_date', ''),
    NULLIF(NEW.payload->>'endDate', ''),
    v_start_candidate
  );

  IF v_start_candidate IS NULL
    OR v_end_candidate IS NULL
    OR v_start_candidate !~ '^\d{4}-\d{2}-\d{2}$'
    OR v_end_candidate !~ '^\d{4}-\d{2}-\d{2}$'
  THEN
    RETURN NEW;
  END IF;

  v_start_date := v_start_candidate::date;
  v_end_date := v_end_candidate::date;
  IF v_start_date > v_end_date THEN
    RETURN NEW;
  END IF;

  v_type_candidate := LOWER(COALESCE(
    NULLIF(NEW.payload->>'schedule_type', ''),
    NULLIF(NEW.payload->>'scheduleType', ''),
    NULLIF(NEW.payload->>'type', ''),
    NULLIF(NEW.payload->>'leave_type', ''),
    NULLIF(NEW.payload->>'leaveType', ''),
    'vacation'
  ));

  v_schedule_type := CASE
    WHEN v_type_candidate IN ('event', 'task', 'vacation', 'sick_leave', 'business_trip', 'training')
      THEN v_type_candidate
    WHEN v_type_candidate IN ('todo', 'to-do') THEN 'task'
    WHEN v_type_candidate IN ('leave', 'holiday') THEN 'vacation'
    WHEN v_type_candidate IN ('sick', 'sickleave') THEN 'sick_leave'
    WHEN v_type_candidate IN ('trip', 'business-trip', 'businesstrip') THEN 'business_trip'
    ELSE NULL
  END;

  IF v_schedule_type IS NULL THEN
    RETURN NEW;
  END IF;

  v_start_time_candidate := COALESCE(
    NULLIF(NEW.payload->>'start_time', ''),
    NULLIF(NEW.payload->>'startTime', '')
  );
  v_end_time_candidate := COALESCE(
    NULLIF(NEW.payload->>'end_time', ''),
    NULLIF(NEW.payload->>'endTime', '')
  );

  IF (v_start_time_candidate IS NULL) <> (v_end_time_candidate IS NULL) THEN
    RAISE EXCEPTION 'PERSONAL_SCHEDULE_TIME_RANGE_INVALID';
  END IF;

  IF v_start_time_candidate IS NOT NULL THEN
    IF v_start_time_candidate !~ '^\d{2}:\d{2}(:\d{2})?$'
      OR v_end_time_candidate !~ '^\d{2}:\d{2}(:\d{2})?$'
    THEN
      RAISE EXCEPTION 'PERSONAL_SCHEDULE_TIME_RANGE_INVALID';
    END IF;

    v_start_time := v_start_time_candidate::time;
    v_end_time := v_end_time_candidate::time;
    IF v_start_date = v_end_date AND v_start_time >= v_end_time THEN
      RAISE EXCEPTION 'PERSONAL_SCHEDULE_TIME_RANGE_INVALID';
    END IF;
  END IF;

  v_title := COALESCE(
    NULLIF(btrim(NEW.payload->>'title'), ''),
    NULLIF(btrim(NEW.payload->>'name'), ''),
    CASE v_schedule_type
      WHEN 'vacation' THEN '休み'
      WHEN 'sick_leave' THEN '病欠'
      WHEN 'business_trip' THEN '出張'
      WHEN 'training' THEN '研修'
      WHEN 'task' THEN 'タスク'
      ELSE '予定'
    END
  );
  v_reason := COALESCE(
    NULLIF(NEW.payload->>'reason', ''),
    NULLIF(NEW.payload->>'note', ''),
    NULLIF(NEW.payload->>'description', ''),
    NULLIF(NEW.description, '')
  );
  v_address := COALESCE(
    NULLIF(btrim(NEW.payload->>'address'), ''),
    NULLIF(btrim(NEW.payload->>'location'), ''),
    NULLIF(btrim(NEW.payload->>'place'), '')
  );
  v_color_candidate := COALESCE(
    NULLIF(btrim(NEW.payload->>'color'), ''),
    NULLIF(btrim(NEW.payload->>'schedule_color'), ''),
    NULLIF(btrim(NEW.payload->>'scheduleColor'), '')
  );
  v_color := CASE
    WHEN v_color_candidate ~ '^#[0-9A-Fa-f]{6}$' THEN UPPER(v_color_candidate)
    ELSE NULL
  END;
  v_blocks_assignment := v_schedule_type IN ('vacation', 'sick_leave');
  v_visibility_candidate := LOWER(COALESCE(
    NULLIF(NEW.payload->>'visibility', ''),
    NULLIF(NEW.payload->>'visibility_scope', ''),
    NULLIF(NEW.payload->>'visibilityScope', ''),
    NULLIF(NEW.payload->>'display_scope', ''),
    NULLIF(NEW.payload->>'displayScope', ''),
    'personal'
  ));
  v_visibility := CASE
    WHEN v_blocks_assignment THEN 'organization'
    WHEN v_visibility_candidate IN ('organization', 'org', 'team', 'public') THEN 'organization'
    WHEN v_visibility_candidate IN ('personal', 'private', 'self') THEN 'personal'
    ELSE 'personal'
  END;

  SELECT id INTO v_schedule_id
  FROM public.personal_schedules
  WHERE user_id = v_user_id
    AND start_date = v_start_date
    AND end_date = v_end_date
    AND type = v_schedule_type
    AND title = v_title
    AND (
      (start_time IS NULL AND v_start_time IS NULL)
      OR start_time = v_start_time
    )
    AND (
      (end_time IS NULL AND v_end_time IS NULL)
      OR end_time = v_end_time
    )
  LIMIT 1;

  IF v_schedule_id IS NULL THEN
    INSERT INTO public.personal_schedules (
      user_id,
      start_date,
      end_date,
      type,
      title,
      start_time,
      end_time,
      address,
      color,
      blocks_assignment,
      visibility,
      reason,
      approved,
      updated_at
    )
    VALUES (
      v_user_id,
      v_start_date,
      v_end_date,
      v_schedule_type,
      v_title,
      v_start_time,
      v_end_time,
      v_address,
      v_color,
      v_blocks_assignment,
      v_visibility,
      v_reason,
      true,
      now()
    );
  ELSE
    UPDATE public.personal_schedules
    SET approved = true,
        title = v_title,
        start_time = v_start_time,
        end_time = v_end_time,
        address = COALESCE(v_address, address),
        color = COALESCE(v_color, color),
        blocks_assignment = v_blocks_assignment,
        visibility = v_visibility,
        reason = COALESCE(v_reason, reason),
        updated_at = now()
    WHERE id = v_schedule_id;
  END IF;

  RETURN NEW;
END;
$_$;


ALTER FUNCTION "public"."apply_personal_schedule_request_from_proposal"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."approve_proposal_atomic"("p_org_id" "uuid", "p_proposal_id" "uuid", "p_approver" "jsonb", "p_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_proposal proposals%ROWTYPE;
  v_approver_type text;
  v_creator_type text;
  v_approval_count integer;
  v_new_approval jsonb;
  v_updated_approvals jsonb;
  v_is_fully_approved boolean;
  v_auto_executed boolean := false;
  v_execute_result jsonb;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_proposal
  FROM proposals
  WHERE id = p_proposal_id
    AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROPOSAL_NOT_FOUND';
  END IF;

  IF v_proposal.status != 'pending' THEN
    RAISE EXCEPTION 'PROPOSAL_NOT_IN_PENDING_STATE';
  END IF;

  v_approver_type := p_approver->>'type';
  v_creator_type := v_proposal.created_by->>'type';

  IF v_creator_type = 'ai' AND v_approver_type = 'ai' THEN
    RAISE EXCEPTION 'AI_SELF_APPROVAL_PROHIBITED';
  END IF;

  IF v_approver_type = 'integration' THEN
    RAISE EXCEPTION 'INTEGRATION_APPROVAL_PROHIBITED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_proposal.approvals, '[]'::jsonb)) AS elem
    WHERE elem->'actor'->>'id' = p_approver->>'id'
      AND elem->>'decision' = 'approve'
  ) THEN
    RAISE EXCEPTION 'ALREADY_APPROVED_BY_THIS_ACTOR';
  END IF;

  SELECT count(*)::integer INTO v_approval_count
  FROM jsonb_array_elements(COALESCE(v_proposal.approvals, '[]'::jsonb)) AS elem
  WHERE elem->>'decision' = 'approve';

  IF v_proposal.required_approvals > 0 AND v_approval_count >= v_proposal.required_approvals THEN
    RAISE EXCEPTION 'APPROVAL_COUNT_ALREADY_MET';
  END IF;

  v_new_approval := jsonb_build_object(
    'actor', p_approver,
    'decision', 'approve',
    'reason', p_reason,
    'at', v_now::text
  );
  v_updated_approvals := COALESCE(v_proposal.approvals, '[]'::jsonb) || v_new_approval;

  v_approval_count := v_approval_count + 1;
  v_is_fully_approved := (v_approval_count >= v_proposal.required_approvals);

  IF v_is_fully_approved THEN
    UPDATE proposals
    SET status = 'approved',
        approvals = v_updated_approvals,
        updated_at = v_now
    WHERE id = p_proposal_id
      AND org_id = p_org_id
    RETURNING * INTO v_proposal;

    BEGIN
      v_execute_result := public.execute_proposal_atomic(
        p_org_id,
        p_proposal_id,
        jsonb_build_object('type', 'system', 'id', 'system', 'name', 'System Auto-Execute')
      );

      SELECT * INTO v_proposal
      FROM proposals
      WHERE id = p_proposal_id
        AND org_id = p_org_id;

      v_auto_executed := true;
    EXCEPTION
      WHEN OTHERS THEN
        v_auto_executed := false;
    END;
  ELSE
    UPDATE proposals
    SET approvals = v_updated_approvals,
        updated_at = v_now
    WHERE id = p_proposal_id
      AND org_id = p_org_id
    RETURNING * INTO v_proposal;
  END IF;

  RETURN jsonb_build_object(
    'proposal', to_jsonb(v_proposal),
    'is_fully_approved', v_is_fully_approved,
    'auto_executed', v_auto_executed
  );
END;
$$;


ALTER FUNCTION "public"."approve_proposal_atomic"("p_org_id" "uuid", "p_proposal_id" "uuid", "p_approver" "jsonb", "p_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."approve_proposal_atomic"("p_org_id" "uuid", "p_proposal_id" "uuid", "p_approver" "jsonb", "p_reason" "text") IS '承認+実行を原子的に実行: pending承認待ち + AI自己承認禁止 + 承認追加 + (条件充足時)Event作成+仕訳+ステータス更新';



CREATE OR REPLACE FUNCTION "public"."assert_reward_write_allowed"("p_org_id" "uuid", "p_route_key" "text", "p_proposal_type" "text", "p_payload" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_legacy_mode text := 'blocked';
  v_legacy_config jsonb := jsonb_build_object(
    'http_status', 410,
    'message', 'Legacy reward write path is frozen. Use PATH v2 canonical routes.'
  );
  v_canonical_mode text := 'path_v22_only';
  v_canonical_config jsonb := jsonb_build_object(
    'required_calculation_system', 'path_v22'
  );
  v_calculation_system text := COALESCE(NULLIF(p_payload->>'calculation_system', ''), '');
  v_month_close_id text := COALESCE(NULLIF(p_payload->>'month_close_id', ''), '');
BEGIN
  SELECT control_mode, config_json
  INTO v_legacy_mode, v_legacy_config
  FROM public.reward_write_controls
  WHERE org_id = p_org_id
    AND control_key = 'legacy_reward_write';

  IF NOT FOUND THEN
    v_legacy_mode := 'blocked';
    v_legacy_config := jsonb_build_object(
      'http_status', 410,
      'message', 'Legacy reward write path is frozen. Use PATH v2 canonical routes.'
    );
  END IF;

  SELECT control_mode, config_json
  INTO v_canonical_mode, v_canonical_config
  FROM public.reward_write_controls
  WHERE org_id = p_org_id
    AND control_key = 'canonical_reward_system';

  IF NOT FOUND THEN
    v_canonical_mode := 'path_v22_only';
    v_canonical_config := jsonb_build_object(
      'required_calculation_system', 'path_v22'
    );
  END IF;

  IF p_route_key IN (
    'pathRewards.proposals',
    'pathRewards.execute',
    'legacy_reward_write'
  ) AND v_legacy_mode = 'blocked' THEN
    RAISE EXCEPTION 'LEGACY_REWARD_WRITE_FROZEN';
  END IF;

  IF p_proposal_type IN ('reward.calculate', 'reward.adjust')
     AND v_canonical_mode = 'path_v22_only'
     AND v_calculation_system <> COALESCE(v_canonical_config->>'required_calculation_system', 'path_v22')
  THEN
    RAISE EXCEPTION 'REWARD_WRITE_REQUIRES_PATH_V22';
  END IF;

  RETURN jsonb_build_object(
    'org_id', p_org_id,
    'route_key', p_route_key,
    'proposal_type', p_proposal_type,
    'legacy_reward_write_mode', v_legacy_mode,
    'canonical_reward_system_mode', v_canonical_mode,
    'calculation_system', NULLIF(v_calculation_system, ''),
    'month_close_id', NULLIF(v_month_close_id, ''),
    'allowed', true
  );
END;
$$;


ALTER FUNCTION "public"."assert_reward_write_allowed"("p_org_id" "uuid", "p_route_key" "text", "p_proposal_type" "text", "p_payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."assert_reward_write_allowed"("p_org_id" "uuid", "p_route_key" "text", "p_proposal_type" "text", "p_payload" "jsonb") IS 'Shared guard for reward write routes. Rejects legacy write paths and requires path_v22 for canonical reward proposals.';



CREATE OR REPLACE FUNCTION "public"."bootstrap_first_org"("p_user_id" "uuid", "p_name" "text", "p_slug" "text" DEFAULT NULL::"text") RETURNS TABLE("org_id" "uuid", "org_name" "text", "org_slug" "text", "org_status" "text", "membership_org_id" "uuid", "membership_user_id" "uuid", "membership_role" "text", "membership_status" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(59001);

  IF EXISTS (
    SELECT 1
    FROM public.organizations
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'SYSTEM_BOOTSTRAP_ALREADY_COMPLETED';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.bootstrap_org(p_user_id, p_name, p_slug);
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM LIKE '%ORG_BOOTSTRAP_NAME_REQUIRED%' THEN
      RAISE EXCEPTION 'SYSTEM_BOOTSTRAP_NAME_REQUIRED';
    END IF;

    IF SQLERRM LIKE '%ORG_BOOTSTRAP_SLUG_CONFLICT%' THEN
      RAISE EXCEPTION 'SYSTEM_BOOTSTRAP_SLUG_CONFLICT';
    END IF;

    RAISE;
END;
$$;


ALTER FUNCTION "public"."bootstrap_first_org"("p_user_id" "uuid", "p_name" "text", "p_slug" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."bootstrap_first_org"("p_user_id" "uuid", "p_name" "text", "p_slug" "text") IS 'Bootstrap the very first organization in the system exactly once.';



CREATE OR REPLACE FUNCTION "public"."bootstrap_org"("p_user_id" "uuid", "p_name" "text", "p_slug" "text" DEFAULT NULL::"text") RETURNS TABLE("org_id" "uuid", "org_name" "text", "org_slug" "text", "org_status" "text", "membership_org_id" "uuid", "membership_user_id" "uuid", "membership_role" "text", "membership_status" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := nullif(lower(btrim(coalesce(p_slug, ''))), '');
  v_org organizations%ROWTYPE;
  v_constraint_name text;
BEGIN
  IF v_name = '' THEN
    RAISE EXCEPTION 'ORG_BOOTSTRAP_NAME_REQUIRED';
  END IF;

  INSERT INTO public.organizations (name, slug, status)
  VALUES (v_name, v_slug, 'active')
  RETURNING * INTO v_org;

  INSERT INTO public.org_memberships (
    org_id,
    user_id,
    role,
    status,
    joined_at
  )
  VALUES (
    v_org.id,
    p_user_id,
    'admin',
    'active',
    now()
  );

  RETURN QUERY
  SELECT
    v_org.id,
    v_org.name,
    v_org.slug,
    v_org.status,
    v_org.id,
    p_user_id,
    'admin',
    'active';
EXCEPTION
  WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
    IF v_constraint_name IN ('organizations_slug_key', 'organizations_slug_lower_idx') THEN
      RAISE EXCEPTION 'ORG_BOOTSTRAP_SLUG_CONFLICT';
    END IF;
    RAISE;
END;
$$;


ALTER FUNCTION "public"."bootstrap_org"("p_user_id" "uuid", "p_name" "text", "p_slug" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."bootstrap_org"("p_user_id" "uuid", "p_name" "text", "p_slug" "text") IS 'Bootstrap a first organization and creator membership in one transaction.';



CREATE OR REPLACE FUNCTION "public"."canonical_reward_execution_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $_$
DECLARE
  v_calculation_system text;
  v_month_close_id uuid;
  v_revenue_basis_id uuid;
  v_month_close_status text;
  v_dummy uuid;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(OLD.status, '') = 'executed' OR NEW.status <> 'executed' THEN
    RETURN NEW;
  END IF;

  IF NEW.type NOT IN ('reward.calculate', 'reward.adjust') THEN
    RETURN NEW;
  END IF;

  v_calculation_system := COALESCE(
    NULLIF(NEW.calculation_system, ''),
    NULLIF(NEW.payload->>'calculation_system', ''),
    ''
  );

  IF NEW.type = 'reward.calculate' AND v_calculation_system = 'path_v31' THEN
    RETURN NEW;
  END IF;

  IF NEW.type = 'reward.calculate' AND v_calculation_system <> 'path_v22' THEN
    RAISE EXCEPTION 'REWARD_CALCULATE_PATH_V22_REQUIRED';
  END IF;

  IF NEW.type = 'reward.adjust' AND v_calculation_system <> 'path_v22' THEN
    RAISE EXCEPTION 'REWARD_ADJUST_PATH_V22_REQUIRED';
  END IF;

  v_month_close_id := NEW.month_close_id;
  IF v_month_close_id IS NULL
     AND COALESCE(NEW.payload->>'month_close_id', '') ~* '^[0-9a-fA-F-]{36}$'
  THEN
    v_month_close_id := (NEW.payload->>'month_close_id')::uuid;
  END IF;

  IF v_month_close_id IS NULL THEN
    IF NEW.type = 'reward.calculate' THEN
      RAISE EXCEPTION 'REWARD_CALCULATE_MONTH_CLOSE_REQUIRED';
    ELSE
      RAISE EXCEPTION 'REWARD_ADJUST_MONTH_CLOSE_REQUIRED';
    END IF;
  END IF;

  SELECT status
  INTO v_month_close_status
  FROM public.month_closes
  WHERE id = v_month_close_id
    AND org_id = NEW.org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MONTH_CLOSE_NOT_FOUND';
  END IF;

  IF v_month_close_status <> 'fixed' THEN
    IF NEW.type = 'reward.calculate' THEN
      RAISE EXCEPTION 'REWARD_CALCULATE_REQUIRES_FIXED_MONTH_CLOSE';
    ELSE
      RAISE EXCEPTION 'REWARD_ADJUST_REQUIRES_FIXED_MONTH_CLOSE';
    END IF;
  END IF;

  IF NEW.type = 'reward.adjust' THEN
    v_revenue_basis_id := NEW.revenue_basis_id;
    IF v_revenue_basis_id IS NULL
       AND COALESCE(NEW.payload->>'revenue_basis_id', '') ~* '^[0-9a-fA-F-]{36}$'
    THEN
      v_revenue_basis_id := (NEW.payload->>'revenue_basis_id')::uuid;
    END IF;

    IF v_revenue_basis_id IS NULL THEN
      RAISE EXCEPTION 'REWARD_ADJUST_REVENUE_BASIS_REQUIRED';
    END IF;

    SELECT id
    INTO v_dummy
    FROM public.revenue_basis
    WHERE id = v_revenue_basis_id
      AND org_id = NEW.org_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'REVENUE_BASIS_NOT_FOUND';
    END IF;
  END IF;

  RETURN NEW;
END;
$_$;


ALTER FUNCTION "public"."canonical_reward_execution_guard"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."canonical_reward_execution_guard"() IS 'Hard fail reward.calculate / reward.adjust execution unless canonical anchors and fixed month close requirements are satisfied.';



CREATE OR REPLACE FUNCTION "public"."capture_path_evaluation_finalize"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_member_id uuid;
  v_month text;
  v_states jsonb;
  v_current_level text;
  v_comment text;
  v_finalized_at timestamptz;
  v_work_days integer;
  v_a integer;
  v_r integer;
  v_q integer;
  v_key text;
  v_value text;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.type <> 'evaluation.finalize'
    OR NEW.status <> 'executed'
    OR COALESCE(OLD.status, '') = 'executed'
  THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.payload->>'member_id', '') !~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
    RETURN NEW;
  END IF;

  v_member_id := (NEW.payload->>'member_id')::uuid;
  v_month := COALESCE(NULLIF(NEW.payload->>'month', ''), TO_CHAR(COALESCE(NEW.executed_at, now()), 'YYYY-MM'));
  v_states := COALESCE(NEW.payload->'confirmed_big_skill_states', '{}'::jsonb);
  v_current_level := NULLIF(NEW.payload->>'current_level', '');
  v_comment := COALESCE(NEW.payload->>'comment', '');
  v_finalized_at := COALESCE(NEW.executed_at, now());
  v_work_days := GREATEST(COALESCE((NEW.payload->>'work_days')::integer, 0), 0);
  v_a := LEAST(GREATEST(COALESCE((NEW.payload->>'A')::integer, 1), 0), 2);
  v_r := LEAST(GREATEST(COALESCE((NEW.payload->>'R')::integer, 1), 0), 2);
  v_q := LEAST(GREATEST(COALESCE((NEW.payload->>'Q')::integer, 1), 0), 2);

  INSERT INTO public.member_skill_profiles (
    org_id,
    member_id,
    current_level,
    current_level_since,
    cross_work_status,
    putty_foundation_status,
    planning_preparation_status,
    quality_stability_status,
    site_trust_status,
    education_support_status,
    updated_at
  ) VALUES (
    NEW.org_id,
    v_member_id,
    CASE WHEN v_current_level IN ('L1', 'L2', 'L3', 'L4') THEN v_current_level ELSE NULL END,
    CASE WHEN v_current_level IN ('L1', 'L2', 'L3', 'L4') THEN v_finalized_at ELSE NULL END,
    COALESCE(v_states->>'cross_work', 'unverified'),
    COALESCE(v_states->>'putty_foundation', 'unverified'),
    COALESCE(v_states->>'planning_preparation', 'unverified'),
    COALESCE(v_states->>'quality_stability', 'unverified'),
    COALESCE(v_states->>'site_trust', 'unverified'),
    COALESCE(v_states->>'education_support', 'unverified'),
    v_finalized_at
  )
  ON CONFLICT (org_id, member_id) DO UPDATE
    SET cross_work_status = COALESCE(v_states->>'cross_work', public.member_skill_profiles.cross_work_status),
        putty_foundation_status = COALESCE(v_states->>'putty_foundation', public.member_skill_profiles.putty_foundation_status),
        planning_preparation_status = COALESCE(v_states->>'planning_preparation', public.member_skill_profiles.planning_preparation_status),
        quality_stability_status = COALESCE(v_states->>'quality_stability', public.member_skill_profiles.quality_stability_status),
        site_trust_status = COALESCE(v_states->>'site_trust', public.member_skill_profiles.site_trust_status),
        education_support_status = COALESCE(v_states->>'education_support', public.member_skill_profiles.education_support_status),
        current_level = CASE
          WHEN v_current_level IN ('L1', 'L2', 'L3', 'L4') THEN v_current_level
          ELSE public.member_skill_profiles.current_level
        END,
        current_level_since = CASE
          WHEN v_current_level IN ('L1', 'L2', 'L3', 'L4') THEN v_finalized_at
          ELSE public.member_skill_profiles.current_level_since
        END,
        updated_at = v_finalized_at;

  FOR v_key, v_value IN
    SELECT key, value
    FROM jsonb_each_text(v_states)
  LOOP
    IF v_key IN (
      'cross_work',
      'putty_foundation',
      'planning_preparation',
      'quality_stability',
      'site_trust',
      'education_support'
    ) THEN
      INSERT INTO public.monthly_evaluation_confirmations (
        org_id,
        month,
        member_id,
        target_type,
        target_key,
        confirmation_status,
        comment,
        confirmed_by,
        confirmed_at,
        updated_at
      ) VALUES (
        NEW.org_id,
        v_month,
        v_member_id,
        'big_skill',
        v_key,
        v_value,
        v_comment,
        NEW.executed_by,
        v_finalized_at,
        v_finalized_at
      )
      ON CONFLICT (org_id, month, member_id, target_type, target_key) DO UPDATE
        SET confirmation_status = EXCLUDED.confirmation_status,
            comment = EXCLUDED.comment,
            confirmed_by = EXCLUDED.confirmed_by,
            confirmed_at = EXCLUDED.confirmed_at,
            updated_at = EXCLUDED.updated_at;
    END IF;
  END LOOP;

  INSERT INTO public.monthly_evaluation_finalizations (
    org_id,
    month,
    member_id,
    proposal_id,
    confirmed_big_skill_states,
    work_days,
    A,
    R,
    Q,
    current_level,
    comment,
    finalized_by,
    finalized_at,
    updated_at
  ) VALUES (
    NEW.org_id,
    v_month,
    v_member_id,
    NEW.id,
    v_states,
    v_work_days,
    v_a,
    v_r,
    v_q,
    CASE WHEN v_current_level IN ('L1', 'L2', 'L3', 'L4') THEN v_current_level ELSE NULL END,
    v_comment,
    NEW.executed_by,
    v_finalized_at,
    v_finalized_at
  )
  ON CONFLICT (org_id, month, member_id) DO UPDATE
    SET proposal_id = EXCLUDED.proposal_id,
        confirmed_big_skill_states = EXCLUDED.confirmed_big_skill_states,
        work_days = EXCLUDED.work_days,
        A = EXCLUDED.A,
        R = EXCLUDED.R,
        Q = EXCLUDED.Q,
        current_level = EXCLUDED.current_level,
        comment = EXCLUDED.comment,
        finalized_by = EXCLUDED.finalized_by,
        finalized_at = EXCLUDED.finalized_at,
        updated_at = EXCLUDED.updated_at;

  RETURN NEW;
END;
$_$;


ALTER FUNCTION "public"."capture_path_evaluation_finalize"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."capture_path_reward_snapshot"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_calculation_system text;
  v_calculation_version text;
  v_month text;
  v_member jsonb;
  v_profit_inputs jsonb;
  v_constant_snapshot jsonb;
  v_policy_snapshot jsonb;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.type <> 'reward.calculate'
    OR NEW.status <> 'executed'
    OR COALESCE(OLD.status, '') = 'executed'
  THEN
    RETURN NEW;
  END IF;

  v_calculation_system := COALESCE(NEW.payload->>'calculation_system', '');
  IF v_calculation_system <> 'path_v2' THEN
    RETURN NEW;
  END IF;

  v_calculation_version := COALESCE(NULLIF(NEW.payload->>'calculation_version', ''), 'path_v2');
  v_month := COALESCE(
    NULLIF(NEW.payload->>'month', ''),
    TO_CHAR(COALESCE(NEW.executed_at, now()), 'YYYY-MM')
  );
  v_profit_inputs := COALESCE(NEW.payload->'profit_inputs', '{}'::jsonb);
  v_constant_snapshot := COALESCE(NEW.payload->'constant_snapshot', '{}'::jsonb);
  v_policy_snapshot := jsonb_build_object(
    'policy_ref', NEW.policy_ref,
    'required_approvals', NEW.required_approvals,
    'approvals', COALESCE(NEW.approvals, '[]'::jsonb)
  );

  DELETE FROM public.reward_calculation_snapshots
  WHERE org_id = NEW.org_id
    AND proposal_id = NEW.id;

  FOR v_member IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(NEW.payload->'members', '[]'::jsonb))
  LOOP
    IF COALESCE(v_member->>'member_id', '') !~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      CONTINUE;
    END IF;

    INSERT INTO public.reward_calculation_snapshots (
      org_id,
      month,
      proposal_id,
      member_id,
      calculation_system,
      calculation_version,
      input_snapshot,
      result_snapshot,
      policy_snapshot,
      executed_by,
      finalized_at
    ) VALUES (
      NEW.org_id,
      v_month,
      NEW.id,
      (v_member->>'member_id')::uuid,
      v_calculation_system,
      v_calculation_version,
      jsonb_build_object(
        'month', v_month,
        'member_id', v_member->>'member_id',
        'name', v_member->>'name',
        'work_days', COALESCE((v_member->>'work_days')::integer, 0),
        'level', v_member->>'level',
        'A', COALESCE((v_member->>'A')::integer, 0),
        'R', COALESCE((v_member->>'R')::integer, 0),
        'Q', COALESCE((v_member->>'Q')::integer, 0),
        'profit_inputs_snapshot', v_profit_inputs,
        'constant_snapshot', v_constant_snapshot
      ),
      jsonb_build_object(
        'profit_amount', COALESCE((NEW.payload->>'profit_amount')::numeric, 0),
        'base_pool_amount', COALESCE((NEW.payload->>'base_pool_amount')::numeric, 0),
        'variable_pool_amount', COALESCE((NEW.payload->>'variable_pool_amount')::numeric, 0),
        'level_coefficient', COALESCE((v_member->>'level_coefficient')::numeric, 0),
        'base_weight', COALESCE((v_member->>'base_weight')::numeric, 0),
        'monthly_point_total', COALESCE((v_member->>'monthly_point_total')::integer, 0),
        'monthly_coefficient', COALESCE((v_member->>'monthly_coefficient')::numeric, 0),
        'base_reward', COALESCE((v_member->>'base_reward')::numeric, 0),
        'variable_reward', COALESCE((v_member->>'variable_reward')::numeric, 0),
        'total_reward', COALESCE((v_member->>'total_reward')::numeric, 0)
      ),
      v_policy_snapshot,
      NEW.executed_by,
      COALESCE(NEW.executed_at, now())
    )
    ON CONFLICT (org_id, proposal_id, member_id) DO UPDATE
      SET month = EXCLUDED.month,
          calculation_system = EXCLUDED.calculation_system,
          calculation_version = EXCLUDED.calculation_version,
          input_snapshot = EXCLUDED.input_snapshot,
          result_snapshot = EXCLUDED.result_snapshot,
          policy_snapshot = EXCLUDED.policy_snapshot,
          executed_by = EXCLUDED.executed_by,
          finalized_at = EXCLUDED.finalized_at;
  END LOOP;

  RETURN NEW;
END;
$_$;


ALTER FUNCTION "public"."capture_path_reward_snapshot"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_journal_balance"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  total_debit numeric(15, 2);
  total_credit numeric(15, 2);
BEGIN
  -- 同一トランザクションの借方・貸方合計を取得
  SELECT
    COALESCE(SUM(debit_amount), 0),
    COALESCE(SUM(credit_amount), 0)
  INTO total_debit, total_credit
  FROM ledger_entries
  WHERE transaction_id = NEW.transaction_id;

  -- バランスチェック（借方 = 貸方）
  IF total_debit != total_credit THEN
    RAISE EXCEPTION 'JOURNAL_IMBALANCED: debit=%, credit=%', total_debit, total_credit;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."check_journal_balance"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_site_rpc"("p_org_id" "uuid", "p_site_id" "uuid", "p_actor_user_id" "uuid", "p_effective_completed_at" timestamp with time zone DEFAULT "now"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_site public.sites%ROWTYPE;
  v_effective_completed_at timestamptz := COALESCE(p_effective_completed_at, now());
  v_existing_event_id uuid;
  v_existing_revenue_basis_id uuid;
  v_existing_income_proposal_id uuid;
  v_next_sequence_no integer;
  v_event_id uuid;
  v_revenue_basis_id uuid;
  v_income_proposal_id uuid;
  v_income_idempotency_key text;
  v_amount numeric(15, 2);
  v_description text;
  v_system_actor jsonb := jsonb_build_object(
    'type', 'system',
    'id', 'system:site_completion_rpc',
    'name', 'System Site Completion RPC'
  );
BEGIN
  SELECT *
  INTO v_site
  FROM public.sites
  WHERE id = p_site_id
    AND org_id = p_org_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SITE_NOT_FOUND';
  END IF;

  v_amount := ROUND(COALESCE(v_site.revenue, 0)::numeric, 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'SITE_REVENUE_REQUIRED_FOR_AUTO_INCOME';
  END IF;

  SELECT sce.id, rb.id
  INTO v_existing_event_id, v_existing_revenue_basis_id
  FROM public.site_completion_events AS sce
  JOIN public.revenue_basis AS rb
    ON rb.origin_completion_event_id = sce.id
   AND rb.org_id = p_org_id
   AND rb.status = 'active'
  WHERE sce.org_id = p_org_id
    AND sce.site_id = p_site_id
    AND sce.event_type = 'recorded'
    AND NOT EXISTS (
      SELECT 1
      FROM public.site_completion_events AS reversed
      WHERE reversed.reversed_event_id = sce.id
    )
  ORDER BY sce.sequence_no DESC
  LIMIT 1;

  IF v_existing_event_id IS NOT NULL THEN
    v_existing_income_proposal_id := public.find_proposal_id_by_idempotency_key(
      p_org_id,
      format('income:auto:site_completion_event:%s', v_existing_event_id)
    );

    IF v_site.status = 'completed' THEN
      RETURN jsonb_build_object(
        'site_id', p_site_id,
        'site_completion_event_id', v_existing_event_id,
        'revenue_basis_id', v_existing_revenue_basis_id,
        'income_proposal_id', v_existing_income_proposal_id,
        'idempotent', true
      );
    END IF;

    RAISE EXCEPTION 'SITE_COMPLETION_ALREADY_ACTIVE';
  END IF;

  SELECT COALESCE(MAX(sequence_no), 0) + 1
  INTO v_next_sequence_no
  FROM public.site_completion_events
  WHERE site_id = p_site_id;

  UPDATE public.sites
  SET status = 'completed',
      completed_at = v_effective_completed_at
  WHERE id = p_site_id;

  INSERT INTO public.site_completion_events (
    org_id,
    site_id,
    sequence_no,
    event_type,
    effective_completed_at,
    actor_user_id,
    idempotency_key
  )
  VALUES (
    p_org_id,
    p_site_id,
    v_next_sequence_no,
    'recorded',
    v_effective_completed_at,
    p_actor_user_id,
    format('site:completion:recorded:%s:%s', p_site_id, v_next_sequence_no)
  )
  RETURNING id INTO v_event_id;

  INSERT INTO public.revenue_basis (
    org_id,
    site_id,
    origin_completion_event_id,
    status,
    recognition_date,
    currency,
    metadata_json
  )
  VALUES (
    p_org_id,
    p_site_id,
    v_event_id,
    'active',
    v_effective_completed_at::date,
    'JPY',
    jsonb_build_object(
      'site_completion_event_id', v_event_id,
      'site_status', 'completed',
      'source', 'complete_site_rpc'
    )
  )
  RETURNING id INTO v_revenue_basis_id;

  v_income_idempotency_key := format('income:auto:site_completion_event:%s', v_event_id);
  v_income_proposal_id := public.find_proposal_id_by_idempotency_key(p_org_id, v_income_idempotency_key);

  IF v_income_proposal_id IS NULL THEN
    v_description := COALESCE(v_site.name, 'site') || ' 売上計上';

    INSERT INTO public.proposals (
      org_id,
      type,
      status,
      site_id,
      revenue_basis_id,
      created_by,
      payload,
      description,
      policy_ref,
      approvals,
      required_approvals,
      idempotency_key
    )
    VALUES (
      p_org_id,
      'income.create',
      'approved',
      p_site_id,
      v_revenue_basis_id,
      v_system_actor,
      jsonb_build_object(
        'amount', v_amount,
        'currency', 'JPY',
        'recorded_date', v_effective_completed_at::date,
        'recognition_date', v_effective_completed_at::date,
        'description', v_description,
        'site_id', p_site_id,
        'revenue_basis_id', v_revenue_basis_id,
        'site_completion_event_id', v_event_id,
        'source', 'complete_site_rpc'
      ),
      v_description,
      'system.auto_income_from_site_completion',
      '[]'::jsonb,
      0,
      v_income_idempotency_key
    )
    RETURNING id INTO v_income_proposal_id;
  END IF;

  RETURN jsonb_build_object(
    'site_id', p_site_id,
    'site_completion_event_id', v_event_id,
    'revenue_basis_id', v_revenue_basis_id,
    'income_proposal_id', v_income_proposal_id,
    'idempotent', false
  );
END;
$$;


ALTER FUNCTION "public"."complete_site_rpc"("p_org_id" "uuid", "p_site_id" "uuid", "p_actor_user_id" "uuid", "p_effective_completed_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."complete_site_rpc"("p_org_id" "uuid", "p_site_id" "uuid", "p_actor_user_id" "uuid", "p_effective_completed_at" timestamp with time zone) IS 'Atomically records site completion fact, creates revenue_basis, and auto-generates an approved income.create proposal.';



CREATE OR REPLACE FUNCTION "public"."execute_proposal_atomic"("p_org_id" "uuid", "p_proposal_id" "uuid", "p_executor" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $_$
DECLARE
  v_proposal proposals%ROWTYPE;
  v_event_id uuid;
  v_transaction_id uuid;
  v_event_type text;
  v_amount numeric(15, 2);
  v_description text;
  v_transaction_date date;
  v_currency text;
  v_category text;
  v_expense_account text;
  v_assignment_site_id uuid;
  v_assignment_worker_ids uuid[];
  v_leave_schedule_id uuid;
  v_leave_user_id uuid;
  v_leave_start_date date;
  v_leave_end_date date;
  v_leave_type text;
  v_leave_reason text;
  -- LUQO用変数
  v_luqo_member_id uuid;
  v_luqo_period text;
  v_luqo_lu integer;
  v_luqo_q integer;
  v_luqo_o integer;
  v_luqo_score integer;
  v_luqo_star_id uuid;
  v_luqo_cat_id uuid;
  v_now timestamptz := now();
BEGIN
  -- 1. Proposalを取得（FOR UPDATEでロック）
  SELECT * INTO v_proposal
  FROM proposals
  WHERE id = p_proposal_id
    AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROPOSAL_NOT_FOUND';
  END IF;

  -- 冪等性: 既にexecutedならそのまま返す
  IF v_proposal.status = 'executed' THEN
    RETURN to_jsonb(v_proposal);
  END IF;

  IF v_proposal.status != 'approved' THEN
    RAISE EXCEPTION 'PROPOSAL_NOT_APPROVED';
  END IF;

  -- 承認数チェック
  IF v_proposal.required_approvals > 0 THEN
    DECLARE
      v_approval_count integer;
    BEGIN
      SELECT count(*)::integer INTO v_approval_count
      FROM jsonb_array_elements(COALESCE(v_proposal.approvals, '[]'::jsonb)) AS elem
      WHERE elem->>'decision' = 'approve';

      IF v_approval_count < v_proposal.required_approvals THEN
        RAISE EXCEPTION 'INSUFFICIENT_APPROVALS';
      END IF;
    END;
  END IF;

  -- 2. イベントタイプをマッピング
  v_event_type := CASE v_proposal.type
    WHEN 'expense.create' THEN 'expense_recorded'
    WHEN 'expense.update' THEN 'expense_recorded'
    WHEN 'expense.void' THEN 'expense_voided'
    WHEN 'income.create' THEN 'income_recorded'
    WHEN 'income.update' THEN 'income_recorded'
    WHEN 'invoice.create' THEN 'invoice_issued'
    WHEN 'invoice.send' THEN 'invoice_sent'
    WHEN 'invoice.mark_paid' THEN 'payment_received'
    WHEN 'reward.calculate' THEN 'reward_calculated'
    WHEN 'reward.adjust' THEN 'reward_adjusted'
    WHEN 'skill.achieve' THEN 'skill_achieved'
    WHEN 'skill.revoke' THEN 'skill_revoked'
    WHEN 'evaluation.finalize' THEN 'evaluation_finalized'
    WHEN 'assignment.create' THEN 'assignment.scheduled'
    WHEN 'assignment.update' THEN 'assignment.rescheduled'
    WHEN 'assignment.cancel' THEN 'assignment.cancelled'
    WHEN 'leave.request' THEN 'leave.recorded'
    WHEN 'communication.review' THEN 'communication.review_recorded'
    WHEN 'communication.task' THEN 'communication.task_recorded'
    WHEN 'task.revision.request' THEN 'task.revision_requested'
    WHEN 'site.create' THEN 'site.created'
    ELSE 'internal_transfer'
  END;

  -- 3. 既存LedgerEvent確認（冪等性）
  SELECT id INTO v_event_id
  FROM ledger_events
  WHERE proposal_id = p_proposal_id
    AND org_id = p_org_id
  ORDER BY created_at DESC
  LIMIT 1;

  -- 4. LedgerEvent作成（なければ）
  IF v_event_id IS NULL THEN
    INSERT INTO ledger_events (org_id, event_type, proposal_id, payload, actor)
    VALUES (p_org_id, v_event_type, p_proposal_id, v_proposal.payload, p_executor)
    RETURNING id INTO v_event_id;
  END IF;

  -- 5. 金額を抽出
  v_amount := COALESCE(
    (v_proposal.payload->>'amount')::numeric,
    (v_proposal.payload->>'amount_total')::numeric,
    (v_proposal.payload->>'total_amount')::numeric,
    (v_proposal.payload->>'total')::numeric,
    0
  );

  -- 6. 仕訳生成（金額が正の場合のみ）
  IF v_amount > 0 THEN
    SELECT id INTO v_transaction_id
    FROM ledger_transactions
    WHERE event_id = v_event_id
      AND org_id = p_org_id
    LIMIT 1;

    IF v_transaction_id IS NULL THEN
      v_description := COALESCE(
        v_proposal.payload->>'description',
        v_proposal.payload->>'memo',
        v_proposal.description
      );
      v_transaction_date := COALESCE(
        (v_proposal.payload->>'recorded_date')::date,
        (v_proposal.payload->>'date')::date,
        (v_proposal.payload->>'transaction_date')::date,
        v_now::date
      );
      v_currency := UPPER(COALESCE(v_proposal.payload->>'currency', 'JPY'));

      INSERT INTO ledger_transactions (org_id, event_id, transaction_date, description, currency)
      VALUES (p_org_id, v_event_id, v_transaction_date, v_description, v_currency)
      RETURNING id INTO v_transaction_id;

      v_category := LOWER(COALESCE(v_proposal.payload->>'category', ''));
      v_expense_account := CASE v_category
        WHEN 'material' THEN '5100'
        WHEN 'materials' THEN '5100'
        WHEN 'tool' THEN '5200'
        WHEN 'tools' THEN '5200'
        WHEN 'travel' THEN '5300'
        WHEN 'transportation' THEN '5300'
        WHEN 'food' THEN '5400'
        ELSE '5900'
      END;

      CASE v_event_type
        WHEN 'expense_recorded' THEN
          INSERT INTO ledger_entries (transaction_id, account_code, debit_amount, credit_amount, memo, line_number)
          VALUES
            (v_transaction_id, v_expense_account, v_amount, 0, v_description, 1),
            (v_transaction_id, '1100', 0, v_amount, v_description, 2);

        WHEN 'expense_voided' THEN
          INSERT INTO ledger_entries (transaction_id, account_code, debit_amount, credit_amount, memo, line_number)
          VALUES
            (v_transaction_id, '1100', v_amount, 0, v_description, 1),
            (v_transaction_id, v_expense_account, 0, v_amount, v_description, 2);

        WHEN 'income_recorded', 'invoice_issued' THEN
          INSERT INTO ledger_entries (transaction_id, account_code, debit_amount, credit_amount, memo, line_number)
          VALUES
            (v_transaction_id, '1200', v_amount, 0, v_description, 1),
            (v_transaction_id, '4100', 0, v_amount, v_description, 2);

        WHEN 'payment_received' THEN
          INSERT INTO ledger_entries (transaction_id, account_code, debit_amount, credit_amount, memo, line_number)
          VALUES
            (v_transaction_id, '1100', v_amount, 0, v_description, 1),
            (v_transaction_id, '1200', 0, v_amount, v_description, 2);

        WHEN 'reward_calculated', 'reward_adjusted' THEN
          INSERT INTO ledger_entries (transaction_id, account_code, debit_amount, credit_amount, memo, line_number)
          VALUES
            (v_transaction_id, '5500', v_amount, 0, v_description, 1),
            (v_transaction_id, '2130', 0, v_amount, v_description, 2);

        ELSE
          DECLARE
            v_debit_account text := COALESCE(
              v_proposal.payload->>'debit_account_code',
              v_proposal.payload->>'debit_account'
            );
            v_credit_account text := COALESCE(
              v_proposal.payload->>'credit_account_code',
              v_proposal.payload->>'credit_account'
            );
          BEGIN
            IF v_debit_account IS NOT NULL AND v_credit_account IS NOT NULL THEN
              INSERT INTO ledger_entries (transaction_id, account_code, debit_amount, credit_amount, memo, line_number)
              VALUES
                (v_transaction_id, v_debit_account, v_amount, 0, v_description, 1),
                (v_transaction_id, v_credit_account, 0, v_amount, v_description, 2);
            END IF;
          END;
      END CASE;
    END IF;
  END IF;

  -- 6.5 assignment.create のドメイン副作用
  IF v_proposal.type = 'assignment.create' THEN
    DECLARE
      v_site_candidate text;
    BEGIN
      v_site_candidate := COALESCE(
        NULLIF(v_proposal.payload->>'site_id', ''),
        NULLIF(v_proposal.payload->>'siteId', ''),
        NULLIF(v_proposal.payload->>'target_site_id', '')
      );

      IF v_site_candidate IS NOT NULL
        AND v_site_candidate ~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      THEN
        v_assignment_site_id := v_site_candidate::uuid;
      ELSE
        v_assignment_site_id := NULL;
      END IF;

      SELECT ARRAY_AGG(DISTINCT worker_uuid) INTO v_assignment_worker_ids
      FROM (
        SELECT worker_id::uuid AS worker_uuid
        FROM (
          SELECT NULLIF(v_proposal.payload->>'worker_id', '') AS worker_id
          UNION ALL SELECT NULLIF(v_proposal.payload->>'workerId', '')
          UNION ALL SELECT NULLIF(v_proposal.payload->>'user_id', '')
          UNION ALL SELECT NULLIF(v_proposal.payload->>'userId', '')
          UNION ALL SELECT value FROM jsonb_array_elements_text(COALESCE(v_proposal.payload->'worker_ids', '[]'::jsonb))
          UNION ALL SELECT value FROM jsonb_array_elements_text(COALESCE(v_proposal.payload->'workerIds', '[]'::jsonb))
          UNION ALL SELECT value FROM jsonb_array_elements_text(COALESCE(v_proposal.payload->'user_ids', '[]'::jsonb))
          UNION ALL SELECT value FROM jsonb_array_elements_text(COALESCE(v_proposal.payload->'userIds', '[]'::jsonb))
          UNION ALL SELECT NULLIF(elem->>'worker_id', '') FROM jsonb_array_elements(COALESCE(v_proposal.payload->'assignments', '[]'::jsonb)) AS elem
          UNION ALL SELECT NULLIF(elem->>'workerId', '') FROM jsonb_array_elements(COALESCE(v_proposal.payload->'assignments', '[]'::jsonb)) AS elem
          UNION ALL SELECT NULLIF(elem->>'user_id', '') FROM jsonb_array_elements(COALESCE(v_proposal.payload->'assignments', '[]'::jsonb)) AS elem
          UNION ALL SELECT NULLIF(elem->>'userId', '') FROM jsonb_array_elements(COALESCE(v_proposal.payload->'assignments', '[]'::jsonb)) AS elem
        ) AS raw_ids
        WHERE worker_id IS NOT NULL
          AND worker_id ~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      ) AS valid_ids;

      IF v_assignment_site_id IS NOT NULL
        AND COALESCE(array_length(v_assignment_worker_ids, 1), 0) > 0
      THEN
        UPDATE sites AS s
        SET assigned_users = (
          SELECT ARRAY(
            SELECT DISTINCT assigned_user
            FROM unnest(COALESCE(s.assigned_users, ARRAY[]::uuid[]) || v_assignment_worker_ids) AS assigned_user
          )
        )
        WHERE s.id = v_assignment_site_id;

        UPDATE profiles
        SET current_site_id = v_assignment_site_id
        WHERE id = ANY(v_assignment_worker_ids);
      END IF;
    END;
  END IF;

  -- 6.6 leave.request のドメイン副作用
  IF v_proposal.type = 'leave.request' THEN
    DECLARE
      v_leave_user_candidate text;
      v_leave_start_candidate text;
      v_leave_end_candidate text;
      v_leave_type_candidate text;
    BEGIN
      v_leave_user_candidate := COALESCE(
        NULLIF(v_proposal.payload->>'user_id', ''),
        NULLIF(v_proposal.payload->>'userId', ''),
        NULLIF(v_proposal.payload->>'target_user_id', ''),
        NULLIF(v_proposal.payload->>'targetUserId', ''),
        CASE
          WHEN COALESCE(v_proposal.created_by->>'type', '') = 'human'
            THEN NULLIF(v_proposal.created_by->>'id', '')
          ELSE NULL
        END
      );

      IF v_leave_user_candidate IS NOT NULL
        AND v_leave_user_candidate ~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      THEN
        v_leave_user_id := v_leave_user_candidate::uuid;
      ELSE
        v_leave_user_id := NULL;
      END IF;

      v_leave_start_candidate := COALESCE(
        NULLIF(v_proposal.payload->>'start_date', ''),
        NULLIF(v_proposal.payload->>'startDate', ''),
        NULLIF(v_proposal.payload->>'date', '')
      );

      IF v_leave_start_candidate IS NOT NULL
        AND v_leave_start_candidate ~ '^\d{4}-\d{2}-\d{2}$'
      THEN
        v_leave_start_date := v_leave_start_candidate::date;
      ELSE
        v_leave_start_date := NULL;
      END IF;

      v_leave_end_candidate := COALESCE(
        NULLIF(v_proposal.payload->>'end_date', ''),
        NULLIF(v_proposal.payload->>'endDate', ''),
        v_leave_start_candidate
      );

      IF v_leave_end_candidate IS NOT NULL
        AND v_leave_end_candidate ~ '^\d{4}-\d{2}-\d{2}$'
      THEN
        v_leave_end_date := v_leave_end_candidate::date;
      ELSE
        v_leave_end_date := NULL;
      END IF;

      v_leave_type_candidate := LOWER(COALESCE(
        NULLIF(v_proposal.payload->>'leave_type', ''),
        NULLIF(v_proposal.payload->>'leaveType', ''),
        NULLIF(v_proposal.payload->>'schedule_type', ''),
        NULLIF(v_proposal.payload->>'scheduleType', ''),
        NULLIF(v_proposal.payload->>'type', ''),
        'vacation'
      ));

      v_leave_type := CASE
        WHEN v_leave_type_candidate IN ('vacation', 'sick_leave', 'business_trip', 'training')
          THEN v_leave_type_candidate
        WHEN v_leave_type_candidate IN ('leave', 'holiday') THEN 'vacation'
        WHEN v_leave_type_candidate IN ('sick', 'sickleave') THEN 'sick_leave'
        WHEN v_leave_type_candidate IN ('trip', 'business-trip', 'businesstrip') THEN 'business_trip'
        ELSE NULL
      END;

      v_leave_reason := COALESCE(
        NULLIF(v_proposal.payload->>'reason', ''),
        NULLIF(v_proposal.payload->>'note', ''),
        NULLIF(v_proposal.payload->>'description', ''),
        NULLIF(v_proposal.description, '')
      );

      IF v_leave_user_id IS NOT NULL
        AND v_leave_start_date IS NOT NULL
        AND v_leave_end_date IS NOT NULL
        AND v_leave_start_date <= v_leave_end_date
        AND v_leave_type IS NOT NULL
      THEN
        SELECT id INTO v_leave_schedule_id
        FROM personal_schedules
        WHERE user_id = v_leave_user_id
          AND start_date = v_leave_start_date
          AND end_date = v_leave_end_date
          AND type = v_leave_type
        LIMIT 1;

        IF v_leave_schedule_id IS NULL THEN
          INSERT INTO personal_schedules (user_id, start_date, end_date, type, reason, approved, updated_at)
          VALUES (v_leave_user_id, v_leave_start_date, v_leave_end_date, v_leave_type, v_leave_reason, true, v_now);
        ELSE
          UPDATE personal_schedules
          SET approved = true,
              reason = COALESCE(v_leave_reason, reason),
              updated_at = v_now
          WHERE id = v_leave_schedule_id;
        END IF;
      END IF;
    END;
  END IF;

  -- ============================================================
  -- 6.7 luqo.catalog.add — スキルカタログに新項目を追加
  -- ============================================================
  IF v_proposal.type = 'luqo.catalog.add' THEN
    DECLARE
      v_cat_id_candidate text;
      v_item_name text;
      v_item_points integer;
      v_item_is_speed boolean;
    BEGIN
      v_cat_id_candidate := NULLIF(v_proposal.payload->>'category_id', '');
      v_item_name := NULLIF(v_proposal.payload->>'name', '');
      v_item_points := COALESCE((v_proposal.payload->>'points')::integer, 0);
      v_item_is_speed := COALESCE((v_proposal.payload->>'is_speed')::boolean, false);

      IF v_cat_id_candidate IS NOT NULL
        AND v_cat_id_candidate ~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
        AND v_item_name IS NOT NULL
        AND v_item_points > 0
      THEN
        INSERT INTO public.luqo_skill_catalog (
          org_id, category_id, name, is_speed,
          speed_threshold, speed_unit, points, description, created_by
        ) VALUES (
          p_org_id,
          v_cat_id_candidate::uuid,
          v_item_name,
          v_item_is_speed,
          (v_proposal.payload->>'speed_threshold')::integer,
          NULLIF(v_proposal.payload->>'speed_unit', ''),
          v_item_points,
          NULLIF(v_proposal.payload->>'description', ''),
          p_executor
        )
        ON CONFLICT (org_id, category_id, name) DO UPDATE
          SET points = EXCLUDED.points,
              is_speed = EXCLUDED.is_speed,
              speed_threshold = EXCLUDED.speed_threshold,
              speed_unit = EXCLUDED.speed_unit,
              description = EXCLUDED.description,
              is_active = true,
              updated_at = now();
      END IF;
    END;
  END IF;

  -- ============================================================
  -- 6.8 luqo.star.achieve — メンバーのスター達成を記録
  -- ============================================================
  IF v_proposal.type = 'luqo.star.achieve' THEN
    DECLARE
      v_member_candidate text;
      v_star_candidate text;
    BEGIN
      v_member_candidate := COALESCE(
        NULLIF(v_proposal.payload->>'member_id', ''),
        CASE WHEN COALESCE(v_proposal.created_by->>'type', '') = 'human'
          THEN NULLIF(v_proposal.created_by->>'id', '') ELSE NULL END
      );
      v_star_candidate := NULLIF(v_proposal.payload->>'star_id', '');

      IF v_member_candidate IS NOT NULL
        AND v_member_candidate ~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
        AND v_star_candidate IS NOT NULL
        AND v_star_candidate ~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      THEN
        v_luqo_member_id := v_member_candidate::uuid;
        v_luqo_star_id := v_star_candidate::uuid;

        INSERT INTO public.luqo_star_achievements (org_id, member_id, star_id, achieved_at, proposal_id)
        VALUES (p_org_id, v_luqo_member_id, v_luqo_star_id, v_now, p_proposal_id)
        ON CONFLICT (org_id, member_id, star_id) DO UPDATE
          SET revoked_at = NULL,
              revoke_proposal_id = NULL,
              achieved_at = v_now,
              proposal_id = p_proposal_id;
      END IF;
    END;
  END IF;

  -- ============================================================
  -- 6.9 luqo.score.update — LUQO行動スコア(LU/Q/O)を更新
  -- ============================================================
  IF v_proposal.type = 'luqo.score.update' THEN
    DECLARE
      v_member_candidate text;
    BEGIN
      v_member_candidate := COALESCE(
        NULLIF(v_proposal.payload->>'member_id', ''),
        CASE WHEN COALESCE(v_proposal.created_by->>'type', '') = 'human'
          THEN NULLIF(v_proposal.created_by->>'id', '') ELSE NULL END
      );
      v_luqo_period := NULLIF(v_proposal.payload->>'period', '');
      v_luqo_lu := (v_proposal.payload->>'lu_score')::integer;
      v_luqo_q := (v_proposal.payload->>'q_score')::integer;
      v_luqo_o := (v_proposal.payload->>'o_score')::integer;

      IF v_member_candidate IS NOT NULL
        AND v_member_candidate ~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
        AND v_luqo_period IS NOT NULL
        AND v_luqo_lu IS NOT NULL
        AND v_luqo_q IS NOT NULL
        AND v_luqo_o IS NOT NULL
      THEN
        v_luqo_member_id := v_member_candidate::uuid;
        -- LU:Q:O = 30:50:20 で加重平均
        v_luqo_score := ROUND(v_luqo_lu * 0.30 + v_luqo_q * 0.50 + v_luqo_o * 0.20)::integer;

        INSERT INTO public.luqo_period_scores (
          org_id, member_id, period,
          lu_score, q_score, o_score, luqo_score,
          submission_rate, updated_at
        ) VALUES (
          p_org_id, v_luqo_member_id, v_luqo_period,
          v_luqo_lu, v_luqo_q, v_luqo_o, v_luqo_score,
          COALESCE((v_proposal.payload->>'submission_rate')::integer, 0),
          v_now
        )
        ON CONFLICT (org_id, member_id, period) DO UPDATE
          SET lu_score = EXCLUDED.lu_score,
              q_score = EXCLUDED.q_score,
              o_score = EXCLUDED.o_score,
              luqo_score = EXCLUDED.luqo_score,
              submission_rate = EXCLUDED.submission_rate,
              updated_at = v_now;
      END IF;
    END;
  END IF;

  -- ============================================================
  -- 6.10 luqo.reward.calculate — 月次報酬計算を確定
  -- ============================================================
  IF v_proposal.type = 'luqo.reward.calculate' THEN
    DECLARE
      v_reward_period text;
      v_reward_profit integer;
      v_reward_company_rate numeric(4, 2);
      v_reward_distributable integer;
      v_reward_breakdown jsonb;
    BEGIN
      v_reward_period := NULLIF(v_proposal.payload->>'period', '');
      v_reward_profit := COALESCE((v_proposal.payload->>'profit')::integer, 0);
      v_reward_company_rate := COALESCE((v_proposal.payload->>'company_rate')::numeric, 0);
      v_reward_distributable := ROUND(v_reward_profit * (1 - v_reward_company_rate / 100))::integer;
      v_reward_breakdown := COALESCE(v_proposal.payload->'breakdown', '[]'::jsonb);

      IF v_reward_period IS NOT NULL AND v_reward_profit > 0 THEN
        INSERT INTO public.luqo_reward_calculations (
          org_id, period, profit, company_rate, distributable,
          breakdown, proposal_id, finalized
        ) VALUES (
          p_org_id, v_reward_period, v_reward_profit,
          v_reward_company_rate, v_reward_distributable,
          v_reward_breakdown, p_proposal_id, true
        )
        ON CONFLICT (org_id, period) DO UPDATE
          SET profit = EXCLUDED.profit,
              company_rate = EXCLUDED.company_rate,
              distributable = EXCLUDED.distributable,
              breakdown = EXCLUDED.breakdown,
              proposal_id = EXCLUDED.proposal_id,
              finalized = true;

        -- 対象期間のスコアをfinalized=trueに
        UPDATE public.luqo_period_scores
        SET finalized = true, updated_at = v_now
        WHERE org_id = p_org_id AND period = v_reward_period;
      END IF;
    END;
  END IF;

  -- 7. Proposalをexecutedに更新
  UPDATE proposals
  SET status = 'executed',
      executed_at = v_now,
      executed_by = p_executor,
      result_event_id = v_event_id,
      updated_at = v_now
  WHERE id = p_proposal_id
    AND org_id = p_org_id
  RETURNING * INTO v_proposal;

  RETURN to_jsonb(v_proposal);
END;
$_$;


ALTER FUNCTION "public"."execute_proposal_atomic"("p_org_id" "uuid", "p_proposal_id" "uuid", "p_executor" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."execute_proposal_atomic"("p_org_id" "uuid", "p_proposal_id" "uuid", "p_executor" "jsonb") IS 'Proposal実行を原子的に実行: Event作成 + 仕訳生成 + explicit event mapping + ドメイン副作用(assignment/leave/luqo) + ステータス更新を1トランザクションで';



CREATE OR REPLACE FUNCTION "public"."find_proposal_id_by_idempotency_key"("p_org_id" "uuid", "p_idempotency_key" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_proposal_id uuid;
BEGIN
  SELECT id
  INTO v_proposal_id
  FROM public.proposals
  WHERE org_id = p_org_id
    AND idempotency_key = p_idempotency_key
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN v_proposal_id;
END;
$$;


ALTER FUNCTION "public"."find_proposal_id_by_idempotency_key"("p_org_id" "uuid", "p_idempotency_key" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."find_proposal_id_by_idempotency_key"("p_org_id" "uuid", "p_idempotency_key" "text") IS 'Returns a proposal id for a stable idempotency key within an org.';



CREATE OR REPLACE FUNCTION "public"."get_jp_fiscal_year"("d" "date") RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT CASE WHEN EXTRACT(MONTH FROM d) >= 4 THEN EXTRACT(YEAR FROM d)::int ELSE (EXTRACT(YEAR FROM d)::int - 1) END;
$$;


ALTER FUNCTION "public"."get_jp_fiscal_year"("d" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_accounting_void_chain"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_parent_voids_transaction_id uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status = 'voided'
     AND COALESCE(OLD.status, '') <> 'voided'
     AND OLD.voids_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'REVERSAL_TRANSACTION_CANNOT_BE_VOIDED';
  END IF;

  IF NEW.voids_transaction_id IS NOT NULL THEN
    SELECT voids_transaction_id
      INTO v_parent_voids_transaction_id
      FROM public.accounting_transactions
     WHERE id = NEW.voids_transaction_id;

    IF v_parent_voids_transaction_id IS NOT NULL THEN
      RAISE EXCEPTION 'REVERSAL_OF_REVERSAL_NOT_ALLOWED';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."guard_accounting_void_chain"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_personal_schedule_row"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.title := COALESCE(
    NULLIF(btrim(NEW.title), ''),
    CASE NEW.type
      WHEN 'vacation' THEN '休み'
      WHEN 'sick_leave' THEN '病欠'
      WHEN 'business_trip' THEN '出張'
      WHEN 'training' THEN '研修'
      WHEN 'task' THEN 'タスク'
      WHEN 'event' THEN '予定'
      ELSE '予定'
    END
  );
  NEW.blocks_assignment := NEW.type IN ('vacation', 'sick_leave');
  NEW.visibility := CASE
    WHEN NEW.blocks_assignment THEN 'organization'
    WHEN NEW.visibility IN ('personal', 'organization') THEN NEW.visibility
    ELSE 'personal'
  END;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."normalize_personal_schedule_row"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."path_role_shares_valid"("p_role_shares" "jsonb") RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
  v_key text;
  v_value jsonb;
BEGIN
  IF p_role_shares IS NULL OR jsonb_typeof(p_role_shares) <> 'object' THEN
    RETURN false;
  END IF;

  FOR v_key, v_value IN SELECT key, value FROM jsonb_each(p_role_shares)
  LOOP
    IF v_key NOT IN ('planning', 'quality', 'admin', 'client') THEN
      RETURN false;
    END IF;
    IF jsonb_typeof(v_value) <> 'number' THEN
      RETURN false;
    END IF;
    IF (v_value #>> '{}')::numeric < 0 THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$$;


ALTER FUNCTION "public"."path_role_shares_valid"("p_role_shares" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_fixed_month_close_line_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_month_close_status text;
  v_month_close_id uuid;
BEGIN
  v_month_close_id := CASE
    WHEN TG_TABLE_NAME = 'month_close_lines' THEN OLD.month_close_id
    ELSE (
      SELECT month_close_id
      FROM public.month_close_lines
      WHERE id = OLD.month_close_line_id
    )
  END;

  SELECT status
  INTO v_month_close_status
  FROM public.month_closes
  WHERE id = v_month_close_id;

  IF v_month_close_status IN ('fixed', 'superseded') THEN
    RAISE EXCEPTION 'FIXED_MONTH_CLOSE_LINES_IMMUTABLE';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."prevent_fixed_month_close_line_mutation"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."prevent_fixed_month_close_line_mutation"() IS 'Prevents update/delete on month_close_lines and month_close_line_sources once the parent month_close is fixed or superseded.';



CREATE OR REPLACE FUNCTION "public"."prevent_fixed_month_close_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF OLD.status IN ('fixed', 'superseded') THEN
    RAISE EXCEPTION 'FIXED_MONTH_CLOSE_IMMUTABLE';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."prevent_fixed_month_close_mutation"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."prevent_fixed_month_close_mutation"() IS 'Prevents update/delete on fixed or superseded month_closes.';



CREATE OR REPLACE FUNCTION "public"."prevent_fixed_reward_run_line_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_reward_run_status text;
  v_reward_run_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'reward_run_lines' THEN
    v_reward_run_id := OLD.reward_run_id;
  ELSIF TG_TABLE_NAME = 'posting_groups' THEN
    v_reward_run_id := OLD.reward_run_id;
  ELSIF TG_TABLE_NAME = 'accounting_journal_entries' THEN
    SELECT reward_run_id
    INTO v_reward_run_id
    FROM public.posting_groups
    WHERE id = OLD.posting_group_id;
  ELSE
    SELECT pg.reward_run_id
    INTO v_reward_run_id
    FROM public.accounting_journal_entries aje
    JOIN public.posting_groups pg
      ON pg.id = aje.posting_group_id
    WHERE aje.id = OLD.entry_id;
  END IF;

  IF v_reward_run_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT status
  INTO v_reward_run_status
  FROM public.reward_runs
  WHERE id = v_reward_run_id;

  IF v_reward_run_status IN ('fixed', 'superseded') THEN
    RAISE EXCEPTION 'FIXED_REWARD_RUN_LINES_IMMUTABLE';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."prevent_fixed_reward_run_line_mutation"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."prevent_fixed_reward_run_line_mutation"() IS 'Prevents update/delete on reward-linked lines, posting_groups, and journals once the parent reward_run is fixed or superseded.';



CREATE OR REPLACE FUNCTION "public"."prevent_fixed_reward_run_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('fixed', 'superseded') THEN
      RAISE EXCEPTION 'FIXED_REWARD_RUN_IMMUTABLE';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'superseded' THEN
    RAISE EXCEPTION 'FIXED_REWARD_RUN_IMMUTABLE';
  END IF;

  IF OLD.status = 'fixed' THEN
    IF NOT (
      NEW.status = OLD.status
      AND NEW.org_id = OLD.org_id
      AND NEW.run_kind = OLD.run_kind
      AND NEW.month_close_id = OLD.month_close_id
      AND NEW.proposal_execution_id = OLD.proposal_execution_id
      AND NEW.reward_rule_version_id = OLD.reward_rule_version_id
      AND NEW.calculation_system = OLD.calculation_system
      AND NEW.adjusts_reward_run_id IS NOT DISTINCT FROM OLD.adjusts_reward_run_id
      AND NEW.fixed_at = OLD.fixed_at
      AND NEW.created_at = OLD.created_at
      AND OLD.payout_posting_group_id IS NULL
      AND NEW.payout_posting_group_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'FIXED_REWARD_RUN_IMMUTABLE';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prevent_fixed_reward_run_mutation"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."prevent_fixed_reward_run_mutation"() IS 'Prevents update/delete on fixed or superseded reward_runs, except a one-time payout_posting_group_id fill after fixation.';



CREATE OR REPLACE FUNCTION "public"."reject_proposal_atomic"("p_org_id" "uuid", "p_proposal_id" "uuid", "p_rejector" "jsonb", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_proposal proposals%ROWTYPE;
  v_new_rejection jsonb;
  v_updated_approvals jsonb;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_proposal
  FROM proposals
  WHERE id = p_proposal_id
    AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROPOSAL_NOT_FOUND';
  END IF;

  IF v_proposal.status != 'pending' THEN
    RAISE EXCEPTION 'PROPOSAL_NOT_IN_PENDING_STATE';
  END IF;

  v_new_rejection := jsonb_build_object(
    'actor', p_rejector,
    'decision', 'reject',
    'reason', p_reason,
    'at', v_now::text
  );
  v_updated_approvals := COALESCE(v_proposal.approvals, '[]'::jsonb) || v_new_rejection;

  UPDATE proposals
  SET status = 'rejected',
      approvals = v_updated_approvals,
      rejection_reason = p_reason,
      updated_at = v_now
  WHERE id = p_proposal_id
    AND org_id = p_org_id
  RETURNING * INTO v_proposal;

  RETURN to_jsonb(v_proposal);
END;
$$;


ALTER FUNCTION "public"."reject_proposal_atomic"("p_org_id" "uuid", "p_proposal_id" "uuid", "p_rejector" "jsonb", "p_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reject_proposal_atomic"("p_org_id" "uuid", "p_proposal_id" "uuid", "p_rejector" "jsonb", "p_reason" "text") IS 'Proposal却下を原子的に実行: pending承認待ちに対する却下履歴追加 + status更新を1トランザクションで実行';



CREATE OR REPLACE FUNCTION "public"."reverse_site_completion_rpc"("p_org_id" "uuid", "p_site_id" "uuid", "p_actor_user_id" "uuid", "p_effective_reversed_at" timestamp with time zone DEFAULT "now"(), "p_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_site public.sites%ROWTYPE;
  v_effective_reversed_at timestamptz := COALESCE(p_effective_reversed_at, now());
  v_active_recorded_event_id uuid;
  v_active_revenue_basis_id uuid;
  v_recorded_effective_completed_at timestamptz;
  v_latest_reversed_event_id uuid;
  v_latest_reversed_revenue_basis_id uuid;
  v_latest_income_reverse_proposal_id uuid;
  v_latest_reward_adjust_proposal_id uuid;
  v_next_sequence_no integer;
  v_reversal_event_id uuid;
  v_income_create_proposal public.proposals%ROWTYPE;
  v_income_reverse_proposal_id uuid;
  v_income_reverse_idempotency_key text;
  v_month_close_id uuid;
  v_reward_adjust_proposal_id uuid;
  v_reward_adjust_idempotency_key text;
  v_system_actor jsonb := jsonb_build_object(
    'type', 'system',
    'id', 'system:site_completion_rpc',
    'name', 'System Site Completion RPC'
  );
  v_income_amount numeric(15, 2);
  v_site_name text;
BEGIN
  SELECT *
  INTO v_site
  FROM public.sites
  WHERE id = p_site_id
    AND org_id = p_org_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SITE_NOT_FOUND';
  END IF;

  v_site_name := COALESCE(v_site.name, 'site');

  SELECT sce.id, rb.id, sce.effective_completed_at
  INTO v_active_recorded_event_id, v_active_revenue_basis_id, v_recorded_effective_completed_at
  FROM public.site_completion_events AS sce
  JOIN public.revenue_basis AS rb
    ON rb.origin_completion_event_id = sce.id
   AND rb.org_id = p_org_id
   AND rb.status = 'active'
  WHERE sce.org_id = p_org_id
    AND sce.site_id = p_site_id
    AND sce.event_type = 'recorded'
    AND NOT EXISTS (
      SELECT 1
      FROM public.site_completion_events AS reversed
      WHERE reversed.reversed_event_id = sce.id
    )
  ORDER BY sce.sequence_no DESC
  LIMIT 1;

  IF v_active_recorded_event_id IS NULL THEN
    IF v_site.status = 'completion_reversed' THEN
      SELECT sce.id
      INTO v_latest_reversed_event_id
      FROM public.site_completion_events AS sce
      WHERE sce.org_id = p_org_id
        AND sce.site_id = p_site_id
        AND sce.event_type = 'reversed'
      ORDER BY sce.sequence_no DESC
      LIMIT 1;

      IF v_latest_reversed_event_id IS NOT NULL THEN
        SELECT rb.id
        INTO v_latest_reversed_revenue_basis_id
        FROM public.revenue_basis AS rb
        WHERE rb.org_id = p_org_id
          AND rb.reversed_by_event_id = v_latest_reversed_event_id
        ORDER BY rb.created_at DESC
        LIMIT 1;

        v_latest_income_reverse_proposal_id := public.find_proposal_id_by_idempotency_key(
          p_org_id,
          format('income:reverse:site_completion_reversal:%s', v_latest_reversed_event_id)
        );

        SELECT p.id
        INTO v_latest_reward_adjust_proposal_id
        FROM public.proposals AS p
        WHERE p.org_id = p_org_id
          AND p.type = 'reward.adjust'
          AND p.idempotency_key LIKE format('reward:adjust:site_completion_reversal:%s:%%', v_latest_reversed_event_id)
        ORDER BY p.created_at DESC
        LIMIT 1;

        RETURN jsonb_build_object(
          'site_id', p_site_id,
          'reversal_event_id', v_latest_reversed_event_id,
          'revenue_basis_id', v_latest_reversed_revenue_basis_id,
          'income_reverse_proposal_id', v_latest_income_reverse_proposal_id,
          'reward_adjust_proposal_id', v_latest_reward_adjust_proposal_id,
          'idempotent', true
        );
      END IF;
    END IF;

    RAISE EXCEPTION 'SITE_COMPLETION_NOT_ACTIVE';
  END IF;

  SELECT COALESCE(MAX(sequence_no), 0) + 1
  INTO v_next_sequence_no
  FROM public.site_completion_events
  WHERE site_id = p_site_id;

  UPDATE public.sites
  SET status = 'completion_reversed',
      completed_at = NULL
  WHERE id = p_site_id;

  INSERT INTO public.site_completion_events (
    org_id,
    site_id,
    sequence_no,
    event_type,
    effective_completed_at,
    reversed_event_id,
    actor_user_id,
    idempotency_key
  )
  VALUES (
    p_org_id,
    p_site_id,
    v_next_sequence_no,
    'reversed',
    v_effective_reversed_at,
    v_active_recorded_event_id,
    p_actor_user_id,
    format('site:completion:reversed:%s:%s', p_site_id, v_active_recorded_event_id)
  )
  RETURNING id INTO v_reversal_event_id;

  UPDATE public.revenue_basis
  SET status = 'reversed',
      reversed_by_event_id = v_reversal_event_id
  WHERE id = v_active_revenue_basis_id;

  SELECT *
  INTO v_income_create_proposal
  FROM public.proposals
  WHERE org_id = p_org_id
    AND revenue_basis_id = v_active_revenue_basis_id
    AND type = 'income.create'
  ORDER BY created_at DESC
  LIMIT 1;

  v_income_amount := ROUND(
    COALESCE(
      NULLIF(v_income_create_proposal.payload->>'amount', '')::numeric,
      NULLIF(v_income_create_proposal.payload->>'amount_total', '')::numeric,
      v_site.revenue,
      0
    )::numeric,
    2
  );

  IF v_income_create_proposal.id IS NOT NULL THEN
    IF v_income_create_proposal.status IN ('draft', 'pending', 'approved') THEN
      UPDATE public.proposals
      SET status = 'canceled'
      WHERE id = v_income_create_proposal.id
        AND status IN ('draft', 'pending', 'approved');
    ELSIF v_income_create_proposal.status = 'executed' THEN
      v_income_reverse_idempotency_key := format(
        'income:reverse:site_completion_reversal:%s',
        v_reversal_event_id
      );
      v_income_reverse_proposal_id := public.find_proposal_id_by_idempotency_key(
        p_org_id,
        v_income_reverse_idempotency_key
      );

      IF v_income_reverse_proposal_id IS NULL THEN
        INSERT INTO public.proposals (
          org_id,
          type,
          status,
          site_id,
          revenue_basis_id,
          created_by,
          payload,
          description,
          policy_ref,
          approvals,
          required_approvals,
          idempotency_key,
          supersedes_proposal_id
        )
        VALUES (
          p_org_id,
          'income.reverse',
          'approved',
          p_site_id,
          v_active_revenue_basis_id,
          v_system_actor,
          jsonb_build_object(
            'amount', v_income_amount,
            'currency', 'JPY',
            'recorded_date', v_effective_reversed_at::date,
            'recognition_date', v_recorded_effective_completed_at::date,
            'description', v_site_name || ' 売上取消',
            'site_id', p_site_id,
            'revenue_basis_id', v_active_revenue_basis_id,
            'site_completion_reversal_event_id', v_reversal_event_id,
            'reverses_proposal_id', v_income_create_proposal.id,
            'reason', p_reason,
            'source', 'reverse_site_completion_rpc'
          ),
          v_site_name || ' 売上取消',
          'system.auto_income_reverse_from_site_completion',
          '[]'::jsonb,
          0,
          v_income_reverse_idempotency_key,
          v_income_create_proposal.id
        )
        RETURNING id INTO v_income_reverse_proposal_id;
      END IF;
    END IF;
  END IF;

  SELECT mcl.month_close_id
  INTO v_month_close_id
  FROM public.month_close_lines AS mcl
  JOIN public.month_closes AS mc
    ON mc.id = mcl.month_close_id
  WHERE mcl.revenue_basis_id = v_active_revenue_basis_id
    AND mc.org_id = p_org_id
    AND mc.status = 'fixed'
  ORDER BY mc.fixed_at DESC NULLS LAST, mc.created_at DESC
  LIMIT 1;

  IF v_month_close_id IS NOT NULL THEN
    v_reward_adjust_idempotency_key := format(
      'reward:adjust:site_completion_reversal:%s:close:%s',
      v_reversal_event_id,
      v_month_close_id
    );
    v_reward_adjust_proposal_id := public.find_proposal_id_by_idempotency_key(
      p_org_id,
      v_reward_adjust_idempotency_key
    );

    IF v_reward_adjust_proposal_id IS NULL THEN
      INSERT INTO public.proposals (
        org_id,
        type,
        status,
        site_id,
        revenue_basis_id,
        month_close_id,
        calculation_system,
        created_by,
        payload,
        description,
        policy_ref,
        approvals,
        required_approvals,
        idempotency_key
      )
      VALUES (
        p_org_id,
        'reward.adjust',
        'approved',
        p_site_id,
        v_active_revenue_basis_id,
        v_month_close_id,
        'path_v22',
        v_system_actor,
        jsonb_build_object(
          'month_close_id', v_month_close_id,
          'revenue_basis_id', v_active_revenue_basis_id,
          'calculation_system', 'path_v22',
          'run_type', 'adjustment',
          'site_id', p_site_id,
          'site_completion_reversal_event_id', v_reversal_event_id,
          'reason_code', 'site_completion_reversed',
          'reason', p_reason,
          'source', 'reverse_site_completion_rpc'
        ),
        v_site_name || ' 報酬調整',
        'system.auto_reward_adjust_from_site_completion',
        '[]'::jsonb,
        0,
        v_reward_adjust_idempotency_key
      )
      RETURNING id INTO v_reward_adjust_proposal_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'site_id', p_site_id,
    'reversal_event_id', v_reversal_event_id,
    'revenue_basis_id', v_active_revenue_basis_id,
    'income_reverse_proposal_id', v_income_reverse_proposal_id,
    'reward_adjust_proposal_id', v_reward_adjust_proposal_id,
    'idempotent', false
  );
END;
$$;


ALTER FUNCTION "public"."reverse_site_completion_rpc"("p_org_id" "uuid", "p_site_id" "uuid", "p_actor_user_id" "uuid", "p_effective_reversed_at" timestamp with time zone, "p_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reverse_site_completion_rpc"("p_org_id" "uuid", "p_site_id" "uuid", "p_actor_user_id" "uuid", "p_effective_reversed_at" timestamp with time zone, "p_reason" "text") IS 'Atomically records site completion reversal, reverses revenue_basis, and auto-generates income.reverse / reward.adjust proposals when needed.';



CREATE OR REPLACE FUNCTION "public"."rpc_next_invoice_no"("p_issue_date" "date" DEFAULT CURRENT_DATE) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_fy integer;
  v_seq integer;
BEGIN
  v_fy := public.get_jp_fiscal_year(p_issue_date);

  -- next_seq is "last issued sequence" (starts at 1).
  INSERT INTO public.invoice_number_sequences (fiscal_year, next_seq)
  VALUES (v_fy, 1)
  ON CONFLICT (fiscal_year)
  DO UPDATE SET next_seq = public.invoice_number_sequences.next_seq + 1
  RETURNING next_seq INTO v_seq;

  RETURN 'GQ-' || v_fy::text || '-' || LPAD(v_seq::text, 6, '0');
END;
$$;


ALTER FUNCTION "public"."rpc_next_invoice_no"("p_issue_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."try_parse_amount_text"("p_value" "text") RETURNS numeric
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
  v_normalized text;
BEGIN
  IF p_value IS NULL THEN
    RETURN NULL;
  END IF;

  v_normalized := regexp_replace(p_value, '[^0-9.\-]', '', 'g');
  IF v_normalized IS NULL OR btrim(v_normalized) = '' OR v_normalized IN ('-', '.', '-.') THEN
    RETURN NULL;
  END IF;

  BEGIN
    RETURN v_normalized::numeric;
  EXCEPTION
    WHEN others THEN
      RETURN NULL;
  END;
END;
$$;


ALTER FUNCTION "public"."try_parse_amount_text"("p_value" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."try_parse_amount_text"("p_value" "text") IS 'Proposal payloadから金額文字列を安全にnumeric変換するヘルパー';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."account_master" (
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "category" "text" NOT NULL,
    "parent_code" "text",
    "is_active" boolean DEFAULT true,
    "display_order" integer,
    "description" "text",
    CONSTRAINT "account_master_category_check" CHECK (("category" = ANY (ARRAY['asset'::"text", 'liability'::"text", 'equity'::"text", 'revenue'::"text", 'expense'::"text"])))
);


ALTER TABLE "public"."account_master" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accounting_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "table_name" "text" NOT NULL,
    "record_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "old_values" "jsonb",
    "new_values" "jsonb",
    "changed_by" "uuid",
    "changed_at" timestamp with time zone DEFAULT "now"(),
    "ip_address" "text",
    "user_agent" "text",
    CONSTRAINT "accounting_audit_log_action_check" CHECK (("action" = ANY (ARRAY['INSERT'::"text", 'UPDATE'::"text", 'DELETE'::"text"])))
);


ALTER TABLE "public"."accounting_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accounting_invoice_sources" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "source_transaction_id" "uuid" NOT NULL,
    "source_transaction_date" "date" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_primary_document" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."accounting_invoice_sources" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accounting_invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "transaction_id" "uuid" NOT NULL,
    "invoice_no" "text" NOT NULL,
    "issue_date" "date" NOT NULL,
    "due_date" "date",
    "billing_name" "text" NOT NULL,
    "billing_address" "text",
    "issuer_registration_no" "text",
    "notes" "text",
    "pdf_storage_path" "text",
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "org_id" "uuid",
    "document_type" "text" DEFAULT 'standard_invoice'::"text" NOT NULL,
    "source_transaction_date" "date" NOT NULL,
    "source_transaction_id" "uuid" NOT NULL,
    "issuer_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "registration_number_snapshot" "text",
    "registered_at_snapshot" "date",
    "tax_summary_snapshot" "jsonb" DEFAULT '{"by_rate": [], "currency": "JPY"}'::"jsonb" NOT NULL,
    "eligibility_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "supplements_invoice_id" "uuid",
    "supplemented_at" timestamp with time zone,
    "pdf_render_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "pdf_generated_at" timestamp with time zone,
    "source_summary_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "accounting_invoices_document_type_check" CHECK (("document_type" = ANY (ARRAY['standard_invoice'::"text", 'qualified_invoice'::"text", 'invoice_supplement'::"text"]))),
    CONSTRAINT "accounting_invoices_pdf_render_status_check" CHECK (("pdf_render_status" = ANY (ARRAY['pending'::"text", 'generated'::"text", 'failed'::"text", 'locked'::"text"]))),
    CONSTRAINT "accounting_invoices_qualified_registration_check" CHECK ((("document_type" <> 'qualified_invoice'::"text") OR ("registration_number_snapshot" ~ '^T[0-9]{13}$'::"text"))),
    CONSTRAINT "accounting_invoices_supplement_link_check" CHECK (((("document_type" = 'invoice_supplement'::"text") AND ("supplements_invoice_id" IS NOT NULL)) OR (("document_type" <> 'invoice_supplement'::"text") AND ("supplements_invoice_id" IS NULL))))
);


ALTER TABLE "public"."accounting_invoices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accounting_journal_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "transaction_id" "uuid",
    "entry_date" "date" NOT NULL,
    "memo" "text",
    "posted_at" timestamp with time zone,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "posting_group_id" "uuid"
);


ALTER TABLE "public"."accounting_journal_entries" OWNER TO "postgres";


COMMENT ON COLUMN "public"."accounting_journal_entries"."posting_group_id" IS 'First-class accounting fact root. transaction_id remains only for compatibility during migration.';



CREATE TABLE IF NOT EXISTS "public"."accounting_journal_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "entry_id" "uuid" NOT NULL,
    "line_no" integer NOT NULL,
    "account_code" "text" NOT NULL,
    "account_name" "text",
    "debit" numeric DEFAULT 0 NOT NULL,
    "credit" numeric DEFAULT 0 NOT NULL,
    "tax_rate" numeric,
    "tax_type" "text",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "site_id" "uuid",
    "revenue_basis_id" "uuid",
    "counterparty_id" "uuid",
    CONSTRAINT "accounting_journal_lines_debit_credit_check" CHECK ((("debit" >= (0)::numeric) AND ("credit" >= (0)::numeric) AND (NOT (("debit" > (0)::numeric) AND ("credit" > (0)::numeric))) AND (NOT (("debit" = (0)::numeric) AND ("credit" = (0)::numeric)))))
);


ALTER TABLE "public"."accounting_journal_lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accounting_transaction_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "transaction_id" "uuid" NOT NULL,
    "item_name" "text" NOT NULL,
    "quantity" numeric DEFAULT 1,
    "unit_price" numeric DEFAULT 0,
    "amount" numeric GENERATED ALWAYS AS ((COALESCE("quantity", (0)::numeric) * COALESCE("unit_price", (0)::numeric))) STORED,
    "unit_name" "text" DEFAULT '式'::"text" NOT NULL
);


ALTER TABLE "public"."accounting_transaction_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accounting_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "kind" "text" NOT NULL,
    "cost_center" "text" NOT NULL,
    "site_id" "uuid",
    "client_id" "uuid",
    "vendor_name" "text",
    "description" "text",
    "recorded_date" "date" NOT NULL,
    "currency" "text" DEFAULT 'JPY'::"text" NOT NULL,
    "amount_subtotal" numeric DEFAULT 0 NOT NULL,
    "tax_amount" numeric DEFAULT 0 NOT NULL,
    "amount_total" numeric DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "risk_level" "text" DEFAULT 'LOW'::"text" NOT NULL,
    "reviewer_id" "uuid",
    "review_status" "text" DEFAULT 'not_required'::"text" NOT NULL,
    "review_comment" "text",
    "review_assigned_at" timestamp with time zone,
    "reviewed_at" timestamp with time zone,
    "source_document_id" "uuid",
    "input_sources" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "voided_by" "uuid",
    "voided_at" timestamp with time zone,
    "void_reason" "text",
    "voids_transaction_id" "uuid",
    "tax_category" "text" DEFAULT '10_STANDARD'::"text",
    "expense_item_code" "text",
    "expense_item_other" "text",
    "category" "text",
    CONSTRAINT "accounting_transactions_category_check" CHECK ((("category" IS NULL) OR ("category" = ANY (ARRAY['material'::"text", 'tool'::"text", 'travel'::"text", 'food'::"text", 'fuel'::"text", 'utility'::"text", 'other'::"text"])))),
    CONSTRAINT "accounting_transactions_cost_center_check" CHECK (("cost_center" = ANY (ARRAY['SITE'::"text", 'HQ'::"text"]))),
    CONSTRAINT "accounting_transactions_hq_site_check" CHECK (((("cost_center" = 'HQ'::"text") AND ("site_id" IS NULL)) OR (("cost_center" = 'SITE'::"text") AND ("site_id" IS NOT NULL)))),
    CONSTRAINT "accounting_transactions_kind_check" CHECK (("kind" = ANY (ARRAY['sale'::"text", 'expense'::"text", 'invoice'::"text", 'ap_schedule'::"text"]))),
    CONSTRAINT "accounting_transactions_review_consistency" CHECK (((("review_status" = 'not_required'::"text") AND ("reviewer_id" IS NULL)) OR (("review_status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])) AND ("reviewer_id" IS NOT NULL)))),
    CONSTRAINT "accounting_transactions_review_status_check" CHECK (("review_status" = ANY (ARRAY['not_required'::"text", 'pending'::"text", 'approved'::"text", 'rejected'::"text"]))),
    CONSTRAINT "accounting_transactions_risk_level_check" CHECK (("risk_level" = ANY (ARRAY['LOW'::"text", 'HIGH'::"text"]))),
    CONSTRAINT "accounting_transactions_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'pending_review'::"text", 'approved'::"text", 'posted'::"text", 'voided'::"text"])))
);


ALTER TABLE "public"."accounting_transactions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."accounting_transactions"."expense_item_code" IS '雑費などの頻出内訳コード';



COMMENT ON COLUMN "public"."accounting_transactions"."expense_item_other" IS 'その他選択時の自由記述';



CREATE TABLE IF NOT EXISTS "public"."ai_proposals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "proposal_type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" NOT NULL,
    "proposal_data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "ai_provider" "text" NOT NULL,
    "ai_model" "text" NOT NULL,
    "ai_confidence" numeric,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "review_comment" "text",
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "ai_proposals_proposal_type_check" CHECK (("proposal_type" = ANY (ARRAY['auto_quest'::"text", 'schedule_optimize'::"text", 'cost_reduction'::"text", 'risk_alert'::"text"]))),
    CONSTRAINT "ai_proposals_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."ai_proposals" OWNER TO "postgres";


COMMENT ON TABLE "public"."ai_proposals" IS 'AI生成提案（自動クエスト生成など）';



COMMENT ON COLUMN "public"."ai_proposals"."proposal_type" IS '提案タイプ';



COMMENT ON COLUMN "public"."ai_proposals"."proposal_data" IS 'AI生成データ（JSON）';



COMMENT ON COLUMN "public"."ai_proposals"."ai_confidence" IS 'AI信頼度（0.0〜1.0）';



CREATE TABLE IF NOT EXISTS "public"."badge_application_votes" (
    "application_id" "uuid" NOT NULL,
    "voter_id" "uuid" NOT NULL,
    "vote" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "badge_application_votes_vote_check" CHECK (("vote" = ANY (ARRAY['approve'::"text", 'reject'::"text"])))
);


ALTER TABLE "public"."badge_application_votes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."badge_applications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "applicant_id" "uuid" NOT NULL,
    "badge_id" "text" NOT NULL,
    "level" "text" NOT NULL,
    "reason" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "badge_applications_level_check" CHECK (("level" = ANY (ARRAY['bronze'::"text", 'silver'::"text", 'gold'::"text"]))),
    CONSTRAINT "badge_applications_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."badge_applications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."badge_states" (
    "user_id" "uuid" NOT NULL,
    "badges" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."badge_states" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."battle_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "action_type" "text" NOT NULL,
    "hours_worked" numeric DEFAULT 0,
    "damage_dealt" numeric DEFAULT 0,
    "comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "battle_log_action_type_check" CHECK (("action_type" = ANY (ARRAY['attack'::"text", 'strategy'::"text", 'heal'::"text"])))
);


ALTER TABLE "public"."battle_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "contact_person" "text",
    "email" "text",
    "phone" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "address" "text",
    "billing_name" "text",
    "billing_address" "text",
    "payment_terms" "text",
    "invoice_notes_default" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "deletion_reason" "text",
    "org_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "department" "text",
    "postal_code" "text",
    "prefecture" "text",
    "city" "text",
    "address_line1" "text",
    "address_line2" "text",
    "billing_postal_code" "text",
    "billing_prefecture" "text",
    "billing_city" "text",
    "billing_address_line1" "text",
    "billing_address_line2" "text",
    "calendar_color" "text",
    "calendar_color_token" "text",
    CONSTRAINT "clients_calendar_color_hex_check" CHECK ((("calendar_color" IS NULL) OR ("calendar_color" ~ '^#[0-9A-Fa-f]{6}$'::"text"))),
    CONSTRAINT "clients_calendar_color_token_check" CHECK ((("calendar_color_token" IS NULL) OR ("calendar_color_token" = ANY (ARRAY['red'::"text", 'pink'::"text", 'purple'::"text", 'indigo'::"text", 'blue'::"text", 'lightBlue'::"text", 'cyan'::"text", 'teal'::"text", 'green'::"text", 'amber'::"text", 'orange'::"text", 'deepOrange'::"text"]))))
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."communication_conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "status" "text" DEFAULT 'waiting_internal'::"text" NOT NULL,
    "source_channel" "text" DEFAULT 'gmail'::"text" NOT NULL,
    "last_channel" "text" DEFAULT 'gmail'::"text" NOT NULL,
    "external_thread_key" "text",
    "assignee_user_id" "uuid",
    "site_id" "uuid",
    "site_name_snapshot" "text",
    "client_name_snapshot" "text",
    "client_email_snapshot" "text",
    "ai_summary" "text",
    "ai_priority" "text",
    "next_action" "text",
    "next_action_due_date" "date",
    "last_activity_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_message_preview" "text",
    "created_by_user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "communication_conversations_ai_priority_check" CHECK ((("ai_priority" IS NULL) OR ("ai_priority" = ANY (ARRAY['urgent'::"text", 'high'::"text", 'medium'::"text", 'low'::"text"])))),
    CONSTRAINT "communication_conversations_last_channel_check" CHECK (("last_channel" = ANY (ARRAY['gmail'::"text", 'phone'::"text", 'line'::"text", 'in_person'::"text", 'sms'::"text", 'manual'::"text", 'system'::"text"]))),
    CONSTRAINT "communication_conversations_source_channel_check" CHECK (("source_channel" = ANY (ARRAY['gmail'::"text", 'phone'::"text", 'line'::"text", 'in_person'::"text", 'sms'::"text", 'manual'::"text"]))),
    CONSTRAINT "communication_conversations_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'waiting_internal'::"text", 'waiting_client'::"text", 'resolved'::"text"])))
);


ALTER TABLE "public"."communication_conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."communication_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "link_type" "text" NOT NULL,
    "proposal_id" "uuid",
    "log_id" "uuid",
    "created_by_user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "communication_links_link_type_check" CHECK (("link_type" = 'proposal'::"text")),
    CONSTRAINT "communication_links_proposal_required" CHECK ((("link_type" = 'proposal'::"text") AND ("proposal_id" IS NOT NULL)))
);


ALTER TABLE "public"."communication_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."communication_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "channel" "text" NOT NULL,
    "direction" "text" DEFAULT 'internal'::"text" NOT NULL,
    "log_kind" "text" DEFAULT 'message'::"text" NOT NULL,
    "subject" "text",
    "body" "text" NOT NULL,
    "summary" "text",
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by_type" "text" DEFAULT 'human'::"text" NOT NULL,
    "created_by_user_id" "uuid",
    "created_by_name_snapshot" "text",
    "external_source" "text",
    "external_id" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "communication_logs_channel_check" CHECK (("channel" = ANY (ARRAY['gmail'::"text", 'phone'::"text", 'line'::"text", 'in_person'::"text", 'sms'::"text", 'manual'::"text", 'system'::"text"]))),
    CONSTRAINT "communication_logs_created_by_type_check" CHECK (("created_by_type" = ANY (ARRAY['human'::"text", 'ai'::"text", 'system'::"text", 'integration'::"text"]))),
    CONSTRAINT "communication_logs_direction_check" CHECK (("direction" = ANY (ARRAY['inbound'::"text", 'outbound'::"text", 'internal'::"text"]))),
    CONSTRAINT "communication_logs_log_kind_check" CHECK (("log_kind" = ANY (ARRAY['message'::"text", 'note'::"text", 'status_change'::"text", 'assignment_change'::"text", 'summary_update'::"text", 'proposal_link'::"text"])))
);


ALTER TABLE "public"."communication_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."communication_participants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "participant_kind" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "email" "text",
    "phone" "text",
    "profile_id" "uuid",
    "is_primary" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "communication_participants_participant_kind_check" CHECK (("participant_kind" = ANY (ARRAY['client'::"text", 'internal'::"text", 'integration'::"text"])))
);


ALTER TABLE "public"."communication_participants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."design_principles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" NOT NULL,
    "category" "text" NOT NULL,
    "alpha" numeric DEFAULT 1 NOT NULL,
    "beta" numeric DEFAULT 1 NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "superseded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "design_principles_alpha_check" CHECK (("alpha" > (0)::numeric)),
    CONSTRAINT "design_principles_beta_check" CHECK (("beta" > (0)::numeric)),
    CONSTRAINT "design_principles_category_check" CHECK (("category" = ANY (ARRAY['core'::"text", 'policy'::"text", 'architecture'::"text", 'process'::"text"]))),
    CONSTRAINT "design_principles_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'under_review'::"text", 'superseded'::"text"])))
);


ALTER TABLE "public"."design_principles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "doc_type" "text" NOT NULL,
    "storage_path" "text",
    "original_filename" "text",
    "mime_type" "text",
    "file_size" bigint,
    "sha256" "text",
    "uploaded_by" "uuid",
    "site_id" "uuid",
    "client_id" "uuid",
    "ocr_provider" "text",
    "ocr_blocks" "jsonb",
    "ocr_fields" "jsonb",
    "field_provenance" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "gmail_message_id" "text",
    "gmail_attachment_id" "text",
    "drive_file_id" "text",
    "drive_file_url" "text",
    "drive_folder_id" "text",
    "ocr_text" "text",
    CONSTRAINT "documents_doc_type_check" CHECK (("doc_type" = ANY (ARRAY['receipt'::"text", 'invoice'::"text", 'purchase_order'::"text", 'delivery_note'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."documents" OWNER TO "postgres";


COMMENT ON COLUMN "public"."documents"."gmail_message_id" IS 'Gmail message id that carried the attachment';



COMMENT ON COLUMN "public"."documents"."gmail_attachment_id" IS 'Gmail attachment id';



COMMENT ON COLUMN "public"."documents"."drive_file_id" IS 'Google Drive file id';



COMMENT ON COLUMN "public"."documents"."drive_file_url" IS 'Google Drive preview URL';



COMMENT ON COLUMN "public"."documents"."drive_folder_id" IS 'Google Drive parent folder id';



COMMENT ON COLUMN "public"."documents"."ocr_text" IS 'Cached extracted text for classification/reprocessing';



CREATE TABLE IF NOT EXISTS "public"."feature_flags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "feature_key" "text" NOT NULL,
    "enabled" boolean DEFAULT false,
    "description" "text",
    "rollout_percentage" integer DEFAULT 0,
    "target_users" "uuid"[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "feature_flags_rollout_percentage_check" CHECK ((("rollout_percentage" >= 0) AND ("rollout_percentage" <= 100)))
);


ALTER TABLE "public"."feature_flags" OWNER TO "postgres";


COMMENT ON TABLE "public"."feature_flags" IS '機能フラグ（段階的リリース）';



CREATE TABLE IF NOT EXISTS "public"."finance_payout_postings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "proposal_id" "uuid" NOT NULL,
    "reward_run_id" "uuid",
    "member_id" "uuid" NOT NULL,
    "posting_kind" "text" NOT NULL,
    "accounting_entry_id" "uuid",
    "amount" numeric(15,2) NOT NULL,
    "currency" "text" DEFAULT 'JPY'::"text" NOT NULL,
    "target_month" "text" NOT NULL,
    "correction_month" "text",
    "posted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "canonical_reward_run_id" "uuid",
    "posting_group_id" "uuid",
    CONSTRAINT "finance_payout_postings_posting_kind_check" CHECK (("posting_kind" = ANY (ARRAY['payout'::"text", 'reversal'::"text", 'adjustment'::"text"])))
);


ALTER TABLE "public"."finance_payout_postings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."focus_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "scope" "text" NOT NULL,
    "horizon" "text" DEFAULT 'today'::"text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "title" "text" NOT NULL,
    "note" "text",
    "site_id" "uuid",
    "site_name_snapshot" "text",
    "created_by" "uuid" NOT NULL,
    "completed_by" "uuid",
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "focus_items_horizon_check" CHECK (("horizon" = ANY (ARRAY['today'::"text", 'week'::"text", 'later'::"text"]))),
    CONSTRAINT "focus_items_scope_check" CHECK (("scope" = ANY (ARRAY['personal'::"text", 'org'::"text"]))),
    CONSTRAINT "focus_items_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'done'::"text"])))
);


ALTER TABLE "public"."focus_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gmail_message_processing" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message_id" "text" NOT NULL,
    "history_id" "text" NOT NULL,
    "status" "text" NOT NULL,
    "retry_count" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "gmail_message_processing_retry_count_check" CHECK (("retry_count" >= 0)),
    CONSTRAINT "gmail_message_processing_status_check" CHECK (("status" = ANY (ARRAY['processing'::"text", 'processed'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."gmail_message_processing" OWNER TO "postgres";


COMMENT ON TABLE "public"."gmail_message_processing" IS 'Gmail Webhook処理履歴（message_id + history_id冪等キー）';



COMMENT ON COLUMN "public"."gmail_message_processing"."status" IS 'processing | processed | error';



CREATE TABLE IF NOT EXISTS "public"."governance_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "proposal_id" "uuid",
    "aggregate_type" "text" NOT NULL,
    "aggregate_id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "dedupe_key" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "policy_context" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "actor" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."governance_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_number_sequences" (
    "fiscal_year" integer NOT NULL,
    "next_seq" integer NOT NULL
);


ALTER TABLE "public"."invoice_number_sequences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_assignment_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "site_id" "uuid" NOT NULL,
    "trade_family" "text" NOT NULL,
    "difficulty_band" "text" NOT NULL,
    "risk_band" "text" NOT NULL,
    "candidate_member_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "recommendation_snapshot" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "recommended_member_id" "uuid",
    "chosen_member_id" "uuid",
    "confidence" "text" DEFAULT 'low'::"text" NOT NULL,
    "predicted_productivity" numeric(8,4) DEFAULT 0 NOT NULL,
    "growth_bonus" numeric(8,4) DEFAULT 0 NOT NULL,
    "fairness_bonus" numeric(8,4) DEFAULT 0 NOT NULL,
    "override_reason_code" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "lead_assignment_logs_confidence_check" CHECK (("confidence" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "lead_assignment_logs_difficulty_band_check" CHECK (("difficulty_band" = ANY (ARRAY['S1'::"text", 'S2'::"text", 'S3'::"text"]))),
    CONSTRAINT "lead_assignment_logs_risk_band_check" CHECK (("risk_band" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"])))
);


ALTER TABLE "public"."lead_assignment_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ledger_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "transaction_id" "uuid" NOT NULL,
    "account_code" "text" NOT NULL,
    "debit_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "credit_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "memo" "text",
    "line_number" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ledger_entries_debit_credit_check" CHECK (((("debit_amount" > (0)::numeric) AND ("credit_amount" = (0)::numeric)) OR (("debit_amount" = (0)::numeric) AND ("credit_amount" > (0)::numeric))))
);


ALTER TABLE "public"."ledger_entries" OWNER TO "postgres";


COMMENT ON TABLE "public"."ledger_entries" IS '仕訳明細行 - 借方・貸方の行';



COMMENT ON COLUMN "public"."ledger_entries"."debit_amount" IS '借方金額（貸方は0）';



COMMENT ON COLUMN "public"."ledger_entries"."credit_amount" IS '貸方金額（借方は0）';



CREATE TABLE IF NOT EXISTS "public"."ledger_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "proposal_id" "uuid",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "actor" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ledger_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['expense_recorded'::"text", 'expense_voided'::"text", 'income_recorded'::"text", 'invoice_issued'::"text", 'invoice_sent'::"text", 'payment_received'::"text", 'reward_calculated'::"text", 'reward_adjusted'::"text", 'skill_achieved'::"text", 'skill_revoked'::"text", 'evaluation_finalized'::"text", 'assignment.scheduled'::"text", 'assignment.rescheduled'::"text", 'assignment.cancelled'::"text", 'leave.recorded'::"text", 'communication.review_recorded'::"text", 'communication.task_recorded'::"text", 'task.revision_requested'::"text", 'site.created'::"text", 'internal_transfer'::"text"])))
);


ALTER TABLE "public"."ledger_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."ledger_events" IS 'イベントソーシング用イベントテーブル - 不変';



COMMENT ON COLUMN "public"."ledger_events"."event_type" IS 'イベント種別';



COMMENT ON COLUMN "public"."ledger_events"."proposal_id" IS '元のProposalへの参照';



CREATE TABLE IF NOT EXISTS "public"."ledger_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "event_id" "uuid" NOT NULL,
    "transaction_date" "date" NOT NULL,
    "description" "text" NOT NULL,
    "currency" "text" DEFAULT 'JPY'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ledger_transactions" OWNER TO "postgres";


COMMENT ON TABLE "public"."ledger_transactions" IS '仕訳ヘッダー - 1イベント:1仕訳';



CREATE TABLE IF NOT EXISTS "public"."luqo_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "display_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."luqo_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."luqo_period_scores" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "period" "text" NOT NULL,
    "lu_score" integer,
    "q_score" integer,
    "o_score" integer,
    "luqo_score" integer,
    "tech_stars" integer DEFAULT 0 NOT NULL,
    "speed_stars" integer DEFAULT 0 NOT NULL,
    "combo" integer,
    "submission_rate" integer,
    "finalized" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "luqo_period_scores_combo_check" CHECK ((("combo" >= 0) AND ("combo" <= 100))),
    CONSTRAINT "luqo_period_scores_lu_score_check" CHECK ((("lu_score" >= 0) AND ("lu_score" <= 100))),
    CONSTRAINT "luqo_period_scores_luqo_score_check" CHECK ((("luqo_score" >= 0) AND ("luqo_score" <= 100))),
    CONSTRAINT "luqo_period_scores_o_score_check" CHECK ((("o_score" >= 0) AND ("o_score" <= 100))),
    CONSTRAINT "luqo_period_scores_q_score_check" CHECK ((("q_score" >= 0) AND ("q_score" <= 100))),
    CONSTRAINT "luqo_period_scores_submission_rate_check" CHECK ((("submission_rate" >= 0) AND ("submission_rate" <= 100)))
);


ALTER TABLE "public"."luqo_period_scores" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."luqo_reward_calculations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "period" "text" NOT NULL,
    "profit" integer NOT NULL,
    "company_rate" numeric(4,2) DEFAULT 0 NOT NULL,
    "distributable" integer NOT NULL,
    "breakdown" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "proposal_id" "uuid",
    "finalized" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."luqo_reward_calculations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."luqo_skill_catalog" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "category_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "is_speed" boolean DEFAULT false NOT NULL,
    "speed_threshold" integer,
    "speed_unit" "text",
    "points" integer NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "jsonb" DEFAULT '{"id": "system", "name": "system", "type": "system"}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "luqo_skill_catalog_points_check" CHECK (("points" > 0))
);


ALTER TABLE "public"."luqo_skill_catalog" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."luqo_star_achievements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "star_id" "uuid" NOT NULL,
    "achieved_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "proposal_id" "uuid",
    "revoked_at" timestamp with time zone,
    "revoke_proposal_id" "uuid"
);


ALTER TABLE "public"."luqo_star_achievements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."member_business_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "business_name" "text",
    "legal_name" "text",
    "invoice_registration_number" "text",
    "invoice_registered_status" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "withholding_category" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "payout_terms" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "payout_method_placeholder" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "member_business_profiles_invoice_registered_status_check" CHECK (("invoice_registered_status" = ANY (ARRAY['unknown'::"text", 'registered'::"text", 'not_registered'::"text"])))
);


ALTER TABLE "public"."member_business_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."member_skill_certifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "skill_key" "text" NOT NULL,
    "category" "text" NOT NULL,
    "status" "text" NOT NULL,
    "verified_by" "jsonb",
    "verified_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "evidence_count" integer DEFAULT 0 NOT NULL,
    "last_site_id" "uuid",
    "note" "text" DEFAULT ''::"text" NOT NULL,
    "review_required_flag" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "member_skill_certifications_evidence_count_check" CHECK (("evidence_count" >= 0)),
    CONSTRAINT "member_skill_certifications_status_check" CHECK (("status" = ANY (ARRAY['candidate'::"text", 'verified'::"text", 'review_required'::"text", 'revoked'::"text"])))
);


ALTER TABLE "public"."member_skill_certifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."member_skill_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "current_level" "text",
    "current_level_since" timestamp with time zone,
    "cross_work_status" "text" DEFAULT 'unverified'::"text" NOT NULL,
    "putty_foundation_status" "text" DEFAULT 'unverified'::"text" NOT NULL,
    "planning_preparation_status" "text" DEFAULT 'unverified'::"text" NOT NULL,
    "quality_stability_status" "text" DEFAULT 'unverified'::"text" NOT NULL,
    "site_trust_status" "text" DEFAULT 'unverified'::"text" NOT NULL,
    "education_support_status" "text" DEFAULT 'unverified'::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "member_skill_profiles_current_level_check" CHECK ((("current_level" IS NULL) OR ("current_level" = ANY (ARRAY['L1'::"text", 'L2'::"text", 'L3'::"text", 'L4'::"text"]))))
);


ALTER TABLE "public"."member_skill_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."monster_archetypes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "name_ja" "text" NOT NULL,
    "base_prompt" "text" NOT NULL,
    "work_types" "text"[] NOT NULL,
    "default_attributes" "text"[],
    "rarity" "text" DEFAULT 'common'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "monster_archetypes_rarity_check" CHECK (("rarity" = ANY (ARRAY['common'::"text", 'rare'::"text", 'epic'::"text", 'legendary'::"text"])))
);


ALTER TABLE "public"."monster_archetypes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."monster_images" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "archetype_id" "uuid",
    "image_url" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "prompt_used" "text",
    "generation_cost" numeric DEFAULT 0.12,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."monster_images" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."month_close_line_sources" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "month_close_line_id" "uuid" NOT NULL,
    "source_type" "text" NOT NULL,
    "source_id" "uuid" NOT NULL,
    "contribution_sales" numeric(15,2) DEFAULT 0 NOT NULL,
    "contribution_cost" numeric(15,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "month_close_line_sources_source_type_check" CHECK (("source_type" = ANY (ARRAY['posting_group'::"text", 'proposal_execution'::"text", 'site_completion_event'::"text", 'revenue_basis'::"text"])))
);


ALTER TABLE "public"."month_close_line_sources" OWNER TO "postgres";


COMMENT ON TABLE "public"."month_close_line_sources" IS 'Normalized fan-in lineage for month_close_lines. Source ids must not be stored only as JSON arrays.';



CREATE TABLE IF NOT EXISTS "public"."month_close_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "month_close_id" "uuid" NOT NULL,
    "revenue_basis_id" "uuid" NOT NULL,
    "site_id" "uuid" NOT NULL,
    "recognized_at" timestamp with time zone NOT NULL,
    "sales_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "cost_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "profit_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "dimensions_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "dimension_hash" "text" NOT NULL,
    "source_income_posting_group_id" "uuid" NOT NULL,
    "source_site_completion_event_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "month_close_lines_profit_balance_check" CHECK (("profit_amount" = ("sales_amount" - "cost_amount")))
);


ALTER TABLE "public"."month_close_lines" OWNER TO "postgres";


COMMENT ON TABLE "public"."month_close_lines" IS 'Canonical reward input lines keyed by month_close_id + revenue_basis_id + dimension_hash.';



CREATE TABLE IF NOT EXISTS "public"."month_closes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "period_ym" "text" NOT NULL,
    "status" "text" NOT NULL,
    "source_cutoff_at" timestamp with time zone NOT NULL,
    "fixed_at" timestamp with time zone,
    "fixed_by" "jsonb",
    "supersedes_month_close_id" "uuid",
    "close_rule_version_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "month_closes_fixed_fields_check" CHECK (((("status" = 'fixed'::"text") AND ("fixed_at" IS NOT NULL)) OR ("status" = ANY (ARRAY['draft'::"text", 'superseded'::"text"])))),
    CONSTRAINT "month_closes_period_ym_check" CHECK (("period_ym" ~ '^\d{4}-\d{2}$'::"text")),
    CONSTRAINT "month_closes_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'fixed'::"text", 'superseded'::"text"])))
);


ALTER TABLE "public"."month_closes" OWNER TO "postgres";


COMMENT ON TABLE "public"."month_closes" IS 'Canonical period root for immutable reward input snapshots. period_ym is display/search only; identity is month_close_id.';



CREATE TABLE IF NOT EXISTS "public"."monthly_distribution_closes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "proposal_id" "uuid",
    "month" "text" NOT NULL,
    "canonical_month_close_id" "uuid",
    "pool_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "floor_rate" numeric(8,4) DEFAULT 0.25 NOT NULL,
    "result_rate" numeric(8,4) DEFAULT 0.75 NOT NULL,
    "nonlinear_exponent" numeric(8,4) DEFAULT 1.12 NOT NULL,
    "path_rule_version_id" "uuid",
    "path_rule_version" "text" NOT NULL,
    "path_rule_fingerprint" "text" NOT NULL,
    "calculation_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "closed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "closed_by" "jsonb",
    "status" "text" DEFAULT 'finalized'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "base_pool_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "role_pool_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "responsibility_pool_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "correction_total_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "rounding_method" "text" DEFAULT 'largest_remainder'::"text" NOT NULL,
    "rounding_unit" integer DEFAULT 1 NOT NULL,
    "rule_version" "text",
    "formula_version" "text" DEFAULT 'path_v31_25_10_65'::"text" NOT NULL,
    "snapshot_hash" "text",
    "confirmation_deadline" timestamp with time zone,
    "approved_at" timestamp with time zone,
    "executed_at" timestamp with time zone,
    "posted_at" timestamp with time zone,
    "superseded_at" timestamp with time zone,
    CONSTRAINT "monthly_distribution_closes_month_check" CHECK (("month" ~ '^\d{4}-\d{2}$'::"text")),
    CONSTRAINT "monthly_distribution_closes_rounding_check" CHECK ((("rounding_method" = 'largest_remainder'::"text") AND ("rounding_unit" = 1))),
    CONSTRAINT "monthly_distribution_closes_status_check" CHECK (("status" = ANY (ARRAY['draft_preview'::"text", 'pending_member_confirmation'::"text", 'confirmation_closed'::"text", 'disputed'::"text", 'admin_review'::"text", 'approved'::"text", 'executed'::"text", 'posted'::"text", 'superseded'::"text", 'draft'::"text", 'finalized'::"text"])))
);


ALTER TABLE "public"."monthly_distribution_closes" OWNER TO "postgres";


COMMENT ON COLUMN "public"."monthly_distribution_closes"."snapshot_hash" IS 'Stable hash of the frozen PATH v3.1 monthly distribution snapshot used by reward.calculate(path_v31).';



CREATE TABLE IF NOT EXISTS "public"."monthly_distribution_corrections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "month" "text" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "amount" numeric(15,2) NOT NULL,
    "reason_code" "text" DEFAULT 'manual_adjustment'::"text" NOT NULL,
    "note" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'approved'::"text" NOT NULL,
    "proposal_id" "uuid",
    "approved_by" "jsonb",
    "approved_at" timestamp with time zone,
    "scenario_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "monthly_distribution_corrections_month_check" CHECK (("month" ~ '^\d{4}-\d{2}$'::"text")),
    CONSTRAINT "monthly_distribution_corrections_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'approved'::"text", 'voided'::"text"])))
);


ALTER TABLE "public"."monthly_distribution_corrections" OWNER TO "postgres";


COMMENT ON TABLE "public"."monthly_distribution_corrections" IS 'PATH v3.1 approved member-level monthly corrections. Applied after 25/10/65 pool allocation.';



CREATE TABLE IF NOT EXISTS "public"."monthly_distribution_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "monthly_distribution_close_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "floor_units" numeric(12,2) DEFAULT 0 NOT NULL,
    "floor_pay" numeric(15,2) DEFAULT 0 NOT NULL,
    "raw_result_weight" numeric(15,4) DEFAULT 0 NOT NULL,
    "boosted_result_weight" numeric(15,4) DEFAULT 0 NOT NULL,
    "speed_class" "text" DEFAULT 'normal'::"text" NOT NULL,
    "speed_coeff" numeric(8,4) DEFAULT 1.0 NOT NULL,
    "result_pay" numeric(15,2) DEFAULT 0 NOT NULL,
    "correction" numeric(15,2) DEFAULT 0 NOT NULL,
    "total_pay" numeric(15,2) DEFAULT 0 NOT NULL,
    "calculation_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "base_units" numeric(12,2) DEFAULT 0 NOT NULL,
    "role_points" numeric(15,4) DEFAULT 0 NOT NULL,
    "participation_units" numeric(12,2) DEFAULT 0 NOT NULL,
    "responsibility_coeff" numeric(8,4) DEFAULT 0 NOT NULL,
    "responsibility_weight" numeric(15,4) DEFAULT 0 NOT NULL,
    "base_raw_amount" numeric(15,4) DEFAULT 0 NOT NULL,
    "base_rounding_delta" numeric(15,2) DEFAULT 0 NOT NULL,
    "base_pay_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "role_raw_amount" numeric(15,4) DEFAULT 0 NOT NULL,
    "role_rounding_delta" numeric(15,2) DEFAULT 0 NOT NULL,
    "role_pay_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "responsibility_raw_amount" numeric(15,4) DEFAULT 0 NOT NULL,
    "responsibility_rounding_delta" numeric(15,2) DEFAULT 0 NOT NULL,
    "responsibility_pay_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "correction_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "total_pay_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    CONSTRAINT "monthly_distribution_lines_speed_class_check" CHECK (("speed_class" = ANY (ARRAY['slow'::"text", 'normal'::"text", 'fast'::"text"])))
);


ALTER TABLE "public"."monthly_distribution_lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."monthly_evaluation_ai_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "month" "text" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "monthly_summary" "text" NOT NULL,
    "candidate_states" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "candidate_skill_tags" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "profile_update_candidates" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "promotion_candidate_flag" boolean DEFAULT false NOT NULL,
    "reasons" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "evidence_summary" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "unknown_points" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "review_required_flag" boolean DEFAULT false NOT NULL,
    "generated_by" "jsonb",
    "generated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."monthly_evaluation_ai_reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."monthly_evaluation_confirmations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "month" "text" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "target_type" "text" NOT NULL,
    "target_key" "text" NOT NULL,
    "confirmation_status" "text" NOT NULL,
    "comment" "text" DEFAULT ''::"text" NOT NULL,
    "confirmed_by" "jsonb",
    "confirmed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "monthly_evaluation_confirmations_target_type_check" CHECK (("target_type" = ANY (ARRAY['big_skill'::"text", 'skill_tag'::"text", 'level'::"text"])))
);


ALTER TABLE "public"."monthly_evaluation_confirmations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."monthly_evaluation_finalizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "month" "text" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "proposal_id" "uuid",
    "confirmed_big_skill_states" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "work_days" integer DEFAULT 0 NOT NULL,
    "a" integer DEFAULT 1 NOT NULL,
    "r" integer DEFAULT 1 NOT NULL,
    "q" integer DEFAULT 1 NOT NULL,
    "current_level" "text",
    "comment" "text" DEFAULT ''::"text" NOT NULL,
    "finalized_by" "jsonb",
    "finalized_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "monthly_evaluation_finalizations_a_check" CHECK ((("a" >= 0) AND ("a" <= 2))),
    CONSTRAINT "monthly_evaluation_finalizations_current_level_check" CHECK ((("current_level" IS NULL) OR ("current_level" = ANY (ARRAY['L1'::"text", 'L2'::"text", 'L3'::"text", 'L4'::"text"])))),
    CONSTRAINT "monthly_evaluation_finalizations_q_check" CHECK ((("q" >= 0) AND ("q" <= 2))),
    CONSTRAINT "monthly_evaluation_finalizations_r_check" CHECK ((("r" >= 0) AND ("r" <= 2))),
    CONSTRAINT "monthly_evaluation_finalizations_work_days_check" CHECK (("work_days" >= 0))
);


ALTER TABLE "public"."monthly_evaluation_finalizations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."monthly_evaluation_forms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "month" "text" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "selected_big_skill_states" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "selected_roles" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "site_ids" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "photo_flag" boolean DEFAULT false NOT NULL,
    "rework_flag" "text" DEFAULT 'none'::"text" NOT NULL,
    "comment" "text" DEFAULT ''::"text" NOT NULL,
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "work_days" integer DEFAULT 0 NOT NULL,
    "a_score" smallint DEFAULT 1 NOT NULL,
    "r_score" smallint DEFAULT 1 NOT NULL,
    "q_score" smallint DEFAULT 1 NOT NULL,
    "current_level" "text",
    CONSTRAINT "monthly_evaluation_forms_a_score_check" CHECK ((("a_score" >= 0) AND ("a_score" <= 2))),
    CONSTRAINT "monthly_evaluation_forms_current_level_check" CHECK (("current_level" = ANY (ARRAY['L1'::"text", 'L2'::"text", 'L3'::"text", 'L4'::"text"]))),
    CONSTRAINT "monthly_evaluation_forms_q_score_check" CHECK ((("q_score" >= 0) AND ("q_score" <= 2))),
    CONSTRAINT "monthly_evaluation_forms_r_score_check" CHECK ((("r_score" >= 0) AND ("r_score" <= 2))),
    CONSTRAINT "monthly_evaluation_forms_rework_flag_check" CHECK (("rework_flag" = ANY (ARRAY['none'::"text", 'minor'::"text", 'major'::"text"]))),
    CONSTRAINT "monthly_evaluation_forms_work_days_check" CHECK (("work_days" >= 0))
);


ALTER TABLE "public"."monthly_evaluation_forms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb",
    "read" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "notifications_type_check" CHECK (("type" = ANY (ARRAY['auto_quest'::"text", 'approval_required'::"text", 'approval_result'::"text", 'schedule_conflict'::"text", 'system_alert'::"text"])))
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


COMMENT ON TABLE "public"."notifications" IS 'ユーザー通知';



CREATE TABLE IF NOT EXISTS "public"."ocr_cache" (
    "hash" "text" NOT NULL,
    "extracted_text" "text" NOT NULL,
    "ocr_result" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "source_message_id" "text",
    "source_attachment_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_hit_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "hit_count" integer DEFAULT 1 NOT NULL,
    CONSTRAINT "ocr_cache_hit_count_check" CHECK (("hit_count" >= 1))
);


ALTER TABLE "public"."ocr_cache" OWNER TO "postgres";


COMMENT ON TABLE "public"."ocr_cache" IS 'PDFハッシュ単位のOCR結果キャッシュ';



COMMENT ON COLUMN "public"."ocr_cache"."hash" IS 'sha256(pdf binary)';



COMMENT ON COLUMN "public"."ocr_cache"."ocr_result" IS 'OcrResult JSON payload';



CREATE TABLE IF NOT EXISTS "public"."org_invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "email_normalized" "text" NOT NULL,
    "role" "text" NOT NULL,
    "status" "text" NOT NULL,
    "token_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "invited_by" "uuid",
    "accepted_by" "uuid",
    "accepted_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "org_invites_email_normalized_check" CHECK (("email_normalized" = "lower"("btrim"("email_normalized")))),
    CONSTRAINT "org_invites_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'member'::"text"]))),
    CONSTRAINT "org_invites_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'revoked'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."org_invites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."org_invoice_settings" (
    "org_id" "uuid" NOT NULL,
    "issuer_name" "text" NOT NULL,
    "issuer_address" "text",
    "issuer_contact" "text",
    "bank_account_text" "text",
    "invoice_issuer_status" "text" NOT NULL,
    "qualified_invoice_registration_number" "text",
    "qualified_invoice_registered_at" "date",
    "invoice_notes_default" "text",
    "created_by" "uuid" NOT NULL,
    "updated_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "org_invoice_settings_invoice_issuer_status_check" CHECK (("invoice_issuer_status" = ANY (ARRAY['unregistered'::"text", 'applied'::"text", 'registered'::"text"]))),
    CONSTRAINT "org_invoice_settings_registered_check" CHECK (((("invoice_issuer_status" = 'registered'::"text") AND ("qualified_invoice_registration_number" ~ '^T[0-9]{13}$'::"text") AND ("qualified_invoice_registered_at" IS NOT NULL)) OR (("invoice_issuer_status" = ANY (ARRAY['unregistered'::"text", 'applied'::"text"])) AND ("qualified_invoice_registration_number" IS NULL) AND ("qualified_invoice_registered_at" IS NULL))))
);


ALTER TABLE "public"."org_invoice_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."org_memberships" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "status" "text" NOT NULL,
    "title" "text",
    "approval_limit" numeric,
    "joined_at" timestamp with time zone,
    "suspended_at" timestamp with time zone,
    "suspended_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "org_memberships_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'member'::"text"]))),
    CONSTRAINT "org_memberships_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'suspended'::"text", 'removed'::"text"])))
);


ALTER TABLE "public"."org_memberships" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text",
    "name" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "organizations_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'suspended'::"text"])))
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."path_ai_review_annotations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "month" "text" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "reviewer_kind" "text" NOT NULL,
    "adapter_key" "text" NOT NULL,
    "annotation" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "supporting_evidence_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "challenged_evidence_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "model_version" "text" DEFAULT 'deterministic-v1'::"text" NOT NULL,
    "prompt_version" "text" DEFAULT 'deterministic-v1'::"text" NOT NULL,
    "schema_version" "text" DEFAULT 'path-review-v1'::"text" NOT NULL,
    "created_by" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "path_ai_review_annotations_reviewer_kind_check" CHECK (("reviewer_kind" = ANY (ARRAY['A'::"text", 'B'::"text"])))
);


ALTER TABLE "public"."path_ai_review_annotations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."path_assignment_restrictions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "trade_family" "text" NOT NULL,
    "restriction_level" "text" NOT NULL,
    "reason_code" "text" NOT NULL,
    "detail" "text" DEFAULT ''::"text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ended_at" timestamp with time zone,
    "source_proposal_id" "uuid",
    "created_by" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "path_assignment_restrictions_restriction_level_check" CHECK (("restriction_level" = ANY (ARRAY['none'::"text", 'observe_only'::"text", 'support_required'::"text", 'blocked'::"text"])))
);


ALTER TABLE "public"."path_assignment_restrictions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."path_credited_units" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "close_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "unit_type" "text" NOT NULL,
    "units" numeric(12,2) DEFAULT 0 NOT NULL,
    "source_id" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."path_credited_units" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."path_evidence_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "month" "text" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "trade_family" "text",
    "evidence_class" "text" NOT NULL,
    "origin_event_id" "text" NOT NULL,
    "source_type" "text" NOT NULL,
    "source_ref" "text",
    "summary" "text" DEFAULT ''::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "path_evidence_records_evidence_class_check" CHECK (("evidence_class" = ANY (ARRAY['human_confirmation'::"text", 'performance_evidence'::"text", 'quality_evidence'::"text", 'record_evidence'::"text", 'repeatability_evidence'::"text", 'ai_annotation'::"text"])))
);


ALTER TABLE "public"."path_evidence_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."path_explanation_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "reward_run_id" "uuid" NOT NULL,
    "proposal_id" "uuid" NOT NULL,
    "month" "text" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "explanation_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "rendered_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."path_explanation_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."path_month_closes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "proposal_id" "uuid" NOT NULL,
    "month" "text" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "policy_bundle_version_id" "uuid",
    "policy_fingerprint" "text" NOT NULL,
    "input_hash" "text" NOT NULL,
    "current_role_level" "text",
    "a" integer NOT NULL,
    "r" integer NOT NULL,
    "q" integer NOT NULL,
    "neutral_flags" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "evidence_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "close_status" "text" DEFAULT 'closed'::"text" NOT NULL,
    "explanation" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "finalized_by" "jsonb",
    "finalized_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "path_month_closes_a_check" CHECK ((("a" >= 0) AND ("a" <= 2))),
    CONSTRAINT "path_month_closes_close_status_check" CHECK (("close_status" = ANY (ARRAY['draft'::"text", 'review_required'::"text", 'closed'::"text"]))),
    CONSTRAINT "path_month_closes_current_role_level_check" CHECK ((("current_role_level" IS NULL) OR ("current_role_level" = ANY (ARRAY['L1'::"text", 'L2'::"text", 'L3'::"text", 'L4'::"text"])))),
    CONSTRAINT "path_month_closes_q_check" CHECK ((("q" >= 0) AND ("q" <= 2))),
    CONSTRAINT "path_month_closes_r_check" CHECK ((("r" >= 0) AND ("r" <= 2)))
);


ALTER TABLE "public"."path_month_closes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."path_monthly_close_inputs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "month" "text" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "role_level" "text",
    "trade_family_observations" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "aqr_input" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "selected_site_ids" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "comment" "text" DEFAULT ''::"text" NOT NULL,
    "submitted_by" "jsonb",
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "path_monthly_close_inputs_role_level_check" CHECK ((("role_level" IS NULL) OR ("role_level" = ANY (ARRAY['L1'::"text", 'L2'::"text", 'L3'::"text", 'L4'::"text"]))))
);


ALTER TABLE "public"."path_monthly_close_inputs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."path_opportunity_audits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "month" "text" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "trade_family" "text" NOT NULL,
    "opportunity_status" "text" NOT NULL,
    "eligible_but_unassigned_days" numeric(12,2) DEFAULT 0 NOT NULL,
    "opportunity_concentration_score" numeric(12,4) DEFAULT 0 NOT NULL,
    "promotion_blocked_by_opportunity" boolean DEFAULT false NOT NULL,
    "protected_challenge_count" integer DEFAULT 0 NOT NULL,
    "summary" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "source_proposal_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "path_opportunity_audits_opportunity_status_check" CHECK (("opportunity_status" = ANY (ARRAY['not_observed'::"text", 'opportunity_not_granted'::"text", 'recheck_required'::"text", 'observed'::"text"])))
);


ALTER TABLE "public"."path_opportunity_audits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."path_reward_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "proposal_id" "uuid" NOT NULL,
    "month" "text" NOT NULL,
    "close_id" "uuid",
    "policy_bundle_version_id" "uuid",
    "policy_fingerprint" "text" NOT NULL,
    "input_hash" "text" NOT NULL,
    "run_type" "text" DEFAULT 'standard'::"text" NOT NULL,
    "correction_of_reward_run_id" "uuid",
    "target_month" "text",
    "closed_profit" numeric(15,2) DEFAULT 0 NOT NULL,
    "path_pool_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "base_pool_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "variable_pool_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "guarantee_total_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'approved'::"text" NOT NULL,
    "reward_payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "approved_by" "jsonb",
    "approved_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "path_reward_runs_run_type_check" CHECK (("run_type" = ANY (ARRAY['standard'::"text", 'reversal'::"text", 'adjustment'::"text"]))),
    CONSTRAINT "path_reward_runs_status_check" CHECK (("status" = ANY (ARRAY['approved'::"text", 'posted'::"text", 'reversed'::"text"])))
);


ALTER TABLE "public"."path_reward_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."path_rule_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "version" "text" NOT NULL,
    "effective_from" "date" NOT NULL,
    "status" "text" NOT NULL,
    "fingerprint" "text" NOT NULL,
    "constants_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "path_rule_versions_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'active'::"text", 'retired'::"text"])))
);


ALTER TABLE "public"."path_rule_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."path_site_item_profit_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "month" "text" NOT NULL,
    "site_id" "uuid" NOT NULL,
    "item_key" "text" NOT NULL,
    "item_name" "text" NOT NULL,
    "trade_family" "text" NOT NULL,
    "revenue" numeric(15,2) DEFAULT 0 NOT NULL,
    "material_cost" numeric(15,2) DEFAULT 0 NOT NULL,
    "subcontract_cost" numeric(15,2) DEFAULT 0 NOT NULL,
    "direct_cost" numeric(15,2) DEFAULT 0 NOT NULL,
    "gross_profit" numeric(15,2) DEFAULT 0 NOT NULL,
    "estimated_std_hours" numeric(12,2) DEFAULT 0 NOT NULL,
    "difficulty_band" "text" DEFAULT 'S1'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "path_site_item_profit_snapshots_difficulty_band_check" CHECK (("difficulty_band" = ANY (ARRAY['S1'::"text", 'S2'::"text", 'S3'::"text"])))
);


ALTER TABLE "public"."path_site_item_profit_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."path_trade_endorsements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "trade_family" "text" NOT NULL,
    "skill_status" "text" NOT NULL,
    "confidence_class" "text" NOT NULL,
    "freshness_status" "text" NOT NULL,
    "evidence_class_counts" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "origin_event_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "source_proposal_id" "uuid",
    "approved_by" "jsonb",
    "approved_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "path_trade_endorsements_confidence_class_check" CHECK (("confidence_class" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "path_trade_endorsements_freshness_status_check" CHECK (("freshness_status" = ANY (ARRAY['current'::"text", 'stale_review_required'::"text"]))),
    CONSTRAINT "path_trade_endorsements_skill_status_check" CHECK (("skill_status" = ANY (ARRAY['unverified'::"text", 'assist_required'::"text", 'conditional'::"text", 'near_independent'::"text", 'stable_independent'::"text"])))
);


ALTER TABLE "public"."path_trade_endorsements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."path_work_package_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "work_package_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "responsibility_share" numeric(8,4) DEFAULT 1 NOT NULL,
    "role_type" "text" NOT NULL,
    "quality_result" "text" NOT NULL,
    "rated_units" numeric(12,2) DEFAULT 0 NOT NULL,
    "points_override" numeric(15,4),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "path_work_package_assignments_quality_result_check" CHECK (("quality_result" = ANY (ARRAY['pass'::"text", 'minor_fix'::"text", 'major_fix'::"text"]))),
    CONSTRAINT "path_work_package_assignments_role_type_check" CHECK (("role_type" = ANY (ARRAY['lead'::"text", 'support'::"text", 'teaching'::"text"])))
);


ALTER TABLE "public"."path_work_package_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."path_work_packages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "month" "text" NOT NULL,
    "package_key" "text" NOT NULL,
    "site_id" "uuid" NOT NULL,
    "site_item_profit_id" "uuid",
    "trade_family" "text" NOT NULL,
    "item_type" "text" NOT NULL,
    "quantity" numeric(12,2) DEFAULT 0 NOT NULL,
    "estimated_std_hours" numeric(12,2) DEFAULT 0 NOT NULL,
    "difficulty_band" "text" DEFAULT 'S1'::"text" NOT NULL,
    "risk_band" "text" DEFAULT 'low'::"text" NOT NULL,
    "protected_challenge_flag" boolean DEFAULT false NOT NULL,
    "quality_gate_type" "text" DEFAULT 'standard'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "path_work_packages_difficulty_band_check" CHECK (("difficulty_band" = ANY (ARRAY['S1'::"text", 'S2'::"text", 'S3'::"text"]))),
    CONSTRAINT "path_work_packages_risk_band_check" CHECK (("risk_band" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"])))
);


ALTER TABLE "public"."path_work_packages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."perk_application_votes" (
    "application_id" "uuid" NOT NULL,
    "voter_id" "uuid" NOT NULL,
    "vote" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."perk_application_votes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."perk_applications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "applicant_id" "uuid" NOT NULL,
    "perk_id" "text" NOT NULL,
    "reason" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."perk_applications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."perk_definitions" (
    "id" "text" NOT NULL,
    "category" "text" NOT NULL,
    "label" "text" NOT NULL,
    "percentage" numeric DEFAULT 0 NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."perk_definitions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."perk_states" (
    "user_id" "uuid" NOT NULL,
    "state" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."perk_states" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."personal_schedules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "type" "text" NOT NULL,
    "reason" "text",
    "approved" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "title" "text" NOT NULL,
    "start_time" time without time zone,
    "end_time" time without time zone,
    "blocks_assignment" boolean DEFAULT false NOT NULL,
    "visibility" "text" DEFAULT 'organization'::"text" NOT NULL,
    "address" "text",
    "color" "text",
    CONSTRAINT "personal_schedules_blocking_visibility_check" CHECK ((("blocks_assignment" = false) OR ("visibility" = 'organization'::"text"))),
    CONSTRAINT "personal_schedules_blocks_assignment_check" CHECK (((("type" = ANY (ARRAY['vacation'::"text", 'sick_leave'::"text"])) AND ("blocks_assignment" = true)) OR (("type" = ANY (ARRAY['event'::"text", 'task'::"text", 'business_trip'::"text", 'training'::"text"])) AND ("blocks_assignment" = false)))),
    CONSTRAINT "personal_schedules_color_check" CHECK ((("color" IS NULL) OR ("color" ~ '^#[0-9A-Fa-f]{6}$'::"text"))),
    CONSTRAINT "personal_schedules_time_range_check" CHECK ((("start_date" <= "end_date") AND ((("start_time" IS NULL) AND ("end_time" IS NULL)) OR (("start_time" IS NOT NULL) AND ("end_time" IS NOT NULL) AND (("start_date" < "end_date") OR ("start_time" < "end_time")))))),
    CONSTRAINT "personal_schedules_type_check" CHECK (("type" = ANY (ARRAY['event'::"text", 'task'::"text", 'vacation'::"text", 'sick_leave'::"text", 'business_trip'::"text", 'training'::"text"]))),
    CONSTRAINT "personal_schedules_visibility_check" CHECK (("visibility" = ANY (ARRAY['personal'::"text", 'organization'::"text"])))
);


ALTER TABLE "public"."personal_schedules" OWNER TO "postgres";


COMMENT ON TABLE "public"."personal_schedules" IS '個人スケジュール（休暇・出張など）';



COMMENT ON COLUMN "public"."personal_schedules"."address" IS '予定の住所・場所メモ';



COMMENT ON COLUMN "public"."personal_schedules"."color" IS '予定の表示色（#RRGGBB）';



CREATE TABLE IF NOT EXISTS "public"."policies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "proposal_type" "text",
    "conditions" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "required_approvers" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "required_count" integer DEFAULT 1 NOT NULL,
    "auto_approve" boolean DEFAULT false NOT NULL,
    "ai_can_approve" boolean DEFAULT false NOT NULL,
    "priority" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."policies" OWNER TO "postgres";


COMMENT ON TABLE "public"."policies" IS '承認ポリシー定義テーブル';



COMMENT ON COLUMN "public"."policies"."conditions" IS '適用条件: [{ field, operator, value }]';



COMMENT ON COLUMN "public"."policies"."required_approvers" IS '承認者要件: [{ type: role|specific|any_member|all_members|ai, value? }]';



COMMENT ON COLUMN "public"."policies"."ai_can_approve" IS 'AIが承認可能か（falseの場合、人間のみ承認可）';



COMMENT ON COLUMN "public"."policies"."priority" IS '優先度（高い方が優先適用）';



CREATE TABLE IF NOT EXISTS "public"."policy_bundle_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "bundle_key" "text" NOT NULL,
    "version" "text" NOT NULL,
    "revision" integer DEFAULT 1 NOT NULL,
    "effective_from" "date" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "fingerprint" "text" NOT NULL,
    "policy_constants" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "authority_matrix" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "risk_rules" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "auto_approval_rules" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "published_proposal_id" "uuid",
    "created_by" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "policy_bundle_versions_revision_check" CHECK (("revision" > 0)),
    CONSTRAINT "policy_bundle_versions_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'active'::"text", 'retired'::"text"])))
);


ALTER TABLE "public"."policy_bundle_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."posting_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "group_type" "text" NOT NULL,
    "proposal_execution_id" "uuid" NOT NULL,
    "revenue_basis_id" "uuid",
    "reward_run_id" "uuid",
    "reverses_posting_group_id" "uuid",
    "accounting_date" "date" NOT NULL,
    "posted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "currency" "text" DEFAULT 'JPY'::"text" NOT NULL,
    "description" "text" NOT NULL,
    CONSTRAINT "posting_groups_anchor_check" CHECK (((("group_type" = ANY (ARRAY['income_post'::"text", 'income_reverse'::"text"])) AND ("revenue_basis_id" IS NOT NULL) AND ("reward_run_id" IS NULL)) OR (("group_type" = ANY (ARRAY['payout_post'::"text", 'payout_reverse'::"text"])) AND ("reward_run_id" IS NOT NULL)))),
    CONSTRAINT "posting_groups_group_type_check" CHECK (("group_type" = ANY (ARRAY['income_post'::"text", 'income_reverse'::"text", 'payout_post'::"text", 'payout_reverse'::"text"])))
);


ALTER TABLE "public"."posting_groups" OWNER TO "postgres";


COMMENT ON TABLE "public"."posting_groups" IS 'Accounting fact root. Journal entries must trace to posting_group -> proposal_execution.';



COMMENT ON COLUMN "public"."posting_groups"."reward_run_id" IS 'Canonical reward run anchor. Foreign key is added in a later migration after reward_runs exists.';



CREATE TABLE IF NOT EXISTS "public"."principle_observations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "principle_id" "uuid" NOT NULL,
    "proposal_id" "uuid",
    "outcome" boolean NOT NULL,
    "reason" "text" NOT NULL,
    "observed_by" "jsonb" NOT NULL,
    "alpha_before" numeric NOT NULL,
    "beta_before" numeric NOT NULL,
    "alpha_after" numeric NOT NULL,
    "beta_after" numeric NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."principle_observations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "updated_at" timestamp with time zone,
    "username" "text",
    "full_name" "text",
    "avatar_url" "text",
    "stamina" integer DEFAULT 100,
    "current_site_id" "uuid",
    "holiday_days" integer DEFAULT 0,
    "holiday_target" integer DEFAULT 120,
    "role" "text" DEFAULT 'member'::"text",
    "approval_limit" numeric DEFAULT 50000,
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['member'::"text", 'leader'::"text", 'manager'::"text", 'admin'::"text"]))),
    CONSTRAINT "username_length" CHECK (("char_length"("username") >= 3))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."proposal_executions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "proposal_id" "uuid" NOT NULL,
    "status" "text" NOT NULL,
    "attempt_no" integer NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "error_code" "text",
    "error_message" "text",
    "result_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "proposal_executions_attempt_no_check" CHECK (("attempt_no" > 0)),
    CONSTRAINT "proposal_executions_status_check" CHECK (("status" = ANY (ARRAY['running'::"text", 'succeeded'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."proposal_executions" OWNER TO "postgres";


COMMENT ON TABLE "public"."proposal_executions" IS 'Execution history for proposals. Proposal state and execution attempts are tracked separately.';



CREATE TABLE IF NOT EXISTS "public"."proposals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "type" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "created_by" "jsonb" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "description" "text" NOT NULL,
    "policy_ref" "text",
    "approvals" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "required_approvals" integer DEFAULT 1 NOT NULL,
    "executed_at" timestamp with time zone,
    "executed_by" "jsonb",
    "result_event_id" "uuid",
    "rejection_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "document_id" "uuid",
    "site_id" "uuid",
    "revenue_basis_id" "uuid",
    "month_close_id" "uuid",
    "adjusts_reward_run_id" "uuid",
    "reward_rule_version_id" "uuid",
    "calculation_system" "text",
    "supersedes_proposal_id" "uuid",
    "idempotency_key" "text",
    CONSTRAINT "proposals_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'pending'::"text", 'approved'::"text", 'rejected'::"text", 'executed'::"text", 'canceled'::"text", 'superseded'::"text"]))),
    CONSTRAINT "proposals_type_check" CHECK (("type" = ANY (ARRAY['expense.create'::"text", 'expense.update'::"text", 'expense.void'::"text", 'income.create'::"text", 'income.update'::"text", 'income.reverse'::"text", 'invoice.create'::"text", 'invoice.send'::"text", 'invoice.mark_paid'::"text", 'reward.calculate'::"text", 'reward.adjust'::"text", 'skill.achieve'::"text", 'skill.revoke'::"text", 'evaluation.submit'::"text", 'evaluation.finalize'::"text", 'assignment.create'::"text", 'assignment.update'::"text", 'assignment.cancel'::"text", 'leave.request'::"text", 'communication.review'::"text", 'communication.task'::"text", 'task.revision.request'::"text", 'site.create'::"text", 'site.complete'::"text", 'site.close.finalize'::"text", 'site.close.reopen'::"text", 'policy.update'::"text", 'luqo.catalog.add'::"text", 'luqo.star.achieve'::"text", 'luqo.score.update'::"text", 'luqo.reward.calculate'::"text"])))
);


ALTER TABLE "public"."proposals" OWNER TO "postgres";


COMMENT ON TABLE "public"."proposals" IS 'DAO統一提案テーブル - 全状態変更はここを経由';



COMMENT ON COLUMN "public"."proposals"."type" IS '提案種別（会計・現場・コミュニケーション含む）';



COMMENT ON COLUMN "public"."proposals"."status" IS 'ライフサイクルステータス: draft→pending→approved→executed / rejected';



COMMENT ON COLUMN "public"."proposals"."created_by" IS '作成者: { type: human|ai|system, id, name }';



COMMENT ON COLUMN "public"."proposals"."approvals" IS '承認履歴: [{ actor, decision, reason, at }]';



COMMENT ON COLUMN "public"."proposals"."document_id" IS 'Source document reference';



COMMENT ON COLUMN "public"."proposals"."site_id" IS 'Proposal-level site scope for filtering';



COMMENT ON COLUMN "public"."proposals"."revenue_basis_id" IS 'Canonical business root anchor used by income.create / income.reverse / reward.adjust.';



COMMENT ON COLUMN "public"."proposals"."month_close_id" IS 'Canonical period root anchor for reward.calculate / reward.adjust.';



COMMENT ON COLUMN "public"."proposals"."idempotency_key" IS 'Stable dedupe key for canonical write commands. Timestamp-based keys are prohibited.';



CREATE TABLE IF NOT EXISTS "public"."revenue_basis" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "site_id" "uuid" NOT NULL,
    "origin_completion_event_id" "uuid" NOT NULL,
    "status" "text" NOT NULL,
    "recognition_date" "date" NOT NULL,
    "currency" "text" DEFAULT 'JPY'::"text" NOT NULL,
    "metadata_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "reversed_by_event_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "revenue_basis_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'reversed'::"text", 'superseded'::"text"])))
);


ALTER TABLE "public"."revenue_basis" OWNER TO "postgres";


COMMENT ON TABLE "public"."revenue_basis" IS 'Business lineage anchor for recognized revenue. v1 keeps one revenue_basis per completion event.';



CREATE TABLE IF NOT EXISTS "public"."reward_calculation_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "month" "text" NOT NULL,
    "proposal_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "calculation_system" "text" NOT NULL,
    "calculation_version" "text" NOT NULL,
    "input_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "result_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "policy_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "executed_by" "jsonb",
    "finalized_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."reward_calculation_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reward_confirmations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "monthly_distribution_close_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "viewed_at" timestamp with time zone,
    "accepted_at" timestamp with time zone,
    "disputed_at" timestamp with time zone,
    "expired_at" timestamp with time zone,
    "message" "text" DEFAULT ''::"text" NOT NULL,
    "resolved_by" "jsonb",
    "resolved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reward_confirmations_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'viewed'::"text", 'accepted'::"text", 'question_requested'::"text", 'disputed'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."reward_confirmations" OWNER TO "postgres";


COMMENT ON TABLE "public"."reward_confirmations" IS 'PATH v3.1 member settlement confirmation evidence. accepted means no current dispute against the shown settlement snapshot.';



CREATE TABLE IF NOT EXISTS "public"."reward_run_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "reward_run_id" "uuid" NOT NULL,
    "month_close_line_id" "uuid",
    "revenue_basis_id" "uuid" NOT NULL,
    "recipient_id" "uuid" NOT NULL,
    "base_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "delta_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "payout_amount" numeric(15,2) DEFAULT 0 NOT NULL,
    "formula_snapshot_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reward_run_lines_amount_balance_check" CHECK (("payout_amount" = ("base_amount" + "delta_amount")))
);


ALTER TABLE "public"."reward_run_lines" OWNER TO "postgres";


COMMENT ON TABLE "public"."reward_run_lines" IS 'Canonical per-recipient reward lines. revenue_basis_id is always required even when month_close_line linkage is absent.';



CREATE TABLE IF NOT EXISTS "public"."reward_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "run_kind" "text" NOT NULL,
    "month_close_id" "uuid" NOT NULL,
    "proposal_execution_id" "uuid" NOT NULL,
    "reward_rule_version_id" "uuid" NOT NULL,
    "calculation_system" "text" NOT NULL,
    "adjusts_reward_run_id" "uuid",
    "status" "text" NOT NULL,
    "fixed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "payout_posting_group_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "monthly_distribution_close_id" "uuid",
    CONSTRAINT "reward_runs_adjustment_anchor_check" CHECK (((("run_kind" = 'calculation'::"text") AND ("adjusts_reward_run_id" IS NULL)) OR ("run_kind" = 'adjustment'::"text"))),
    CONSTRAINT "reward_runs_calculation_system_check" CHECK (("calculation_system" = ANY (ARRAY['path_v22'::"text", 'path_v31'::"text"]))),
    CONSTRAINT "reward_runs_run_kind_check" CHECK (("run_kind" = ANY (ARRAY['calculation'::"text", 'adjustment'::"text"]))),
    CONSTRAINT "reward_runs_status_check" CHECK (("status" = ANY (ARRAY['fixed'::"text", 'superseded'::"text"])))
);


ALTER TABLE "public"."reward_runs" OWNER TO "postgres";


COMMENT ON TABLE "public"."reward_runs" IS 'Canonical immutable reward outputs. reward.calculate and reward.adjust both resolve to reward_runs.';



COMMENT ON COLUMN "public"."reward_runs"."proposal_execution_id" IS 'Governance root anchor. Each successful execution produces at most one canonical reward run.';



COMMENT ON COLUMN "public"."reward_runs"."payout_posting_group_id" IS 'Optional payout posting root. Kept nullable because payout posting can happen after reward run fixation.';



CREATE TABLE IF NOT EXISTS "public"."reward_write_controls" (
    "org_id" "uuid" NOT NULL,
    "control_key" "text" NOT NULL,
    "control_mode" "text" NOT NULL,
    "config_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reward_write_controls_control_key_check" CHECK (("control_key" = ANY (ARRAY['legacy_reward_write'::"text", 'canonical_reward_system'::"text"]))),
    CONSTRAINT "reward_write_controls_control_mode_check" CHECK (("control_mode" = ANY (ARRAY['blocked'::"text", 'allow'::"text", 'path_v22_only'::"text"])))
);


ALTER TABLE "public"."reward_write_controls" OWNER TO "postgres";


COMMENT ON TABLE "public"."reward_write_controls" IS 'Org-scoped freeze controls for reward write paths. Used by route/service guards before canonical hard guards are enforced.';



CREATE OR REPLACE VIEW "public"."reward_write_guard_status" WITH ("security_invoker"='true') AS
 SELECT "org_id",
    "max"("control_mode") FILTER (WHERE ("control_key" = 'legacy_reward_write'::"text")) AS "legacy_reward_write_mode",
    "max"("control_mode") FILTER (WHERE ("control_key" = 'canonical_reward_system'::"text")) AS "canonical_reward_system_mode",
    ("max"(("config_json")::"text") FILTER (WHERE ("control_key" = 'legacy_reward_write'::"text")))::"jsonb" AS "legacy_reward_write_config",
    ("max"(("config_json")::"text") FILTER (WHERE ("control_key" = 'canonical_reward_system'::"text")))::"jsonb" AS "canonical_reward_system_config",
    "max"("updated_at") AS "updated_at"
   FROM "public"."reward_write_controls"
  GROUP BY "org_id";


ALTER VIEW "public"."reward_write_guard_status" OWNER TO "postgres";


COMMENT ON VIEW "public"."reward_write_guard_status" IS 'Pivoted view of reward write freeze settings by org.';



CREATE TABLE IF NOT EXISTS "public"."site_closes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "site_id" "uuid" NOT NULL,
    "proposal_id" "uuid" NOT NULL,
    "recognized_revenue" numeric(15,2) DEFAULT 0 NOT NULL,
    "material_cost" numeric(15,2) DEFAULT 0 NOT NULL,
    "external_cost" numeric(15,2) DEFAULT 0 NOT NULL,
    "direct_cost" numeric(15,2) DEFAULT 0 NOT NULL,
    "overhead_allocated" numeric(15,2) DEFAULT 0 NOT NULL,
    "known_rework_cost" numeric(15,2) DEFAULT 0 NOT NULL,
    "approved_adjustments" numeric(15,2) DEFAULT 0 NOT NULL,
    "distributable_profit" numeric(15,2) DEFAULT 0 NOT NULL,
    "difficulty_band" "text" NOT NULL,
    "share_mode" "text" NOT NULL,
    "fixed_template_key" "text",
    "fixed_template_reason_code" "text",
    "share_snapshot" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "path_rule_version_id" "uuid",
    "path_rule_version" "text" NOT NULL,
    "path_rule_fingerprint" "text" NOT NULL,
    "calculation_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "closed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "closed_by" "jsonb",
    "status" "text" DEFAULT 'finalized'::"text" NOT NULL,
    "reopened_by_proposal_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "site_closes_difficulty_band_check" CHECK (("difficulty_band" = ANY (ARRAY['S1'::"text", 'S2'::"text", 'S3'::"text"]))),
    CONSTRAINT "site_closes_share_mode_check" CHECK (("share_mode" = ANY (ARRAY['auto_points'::"text", 'fixed_template'::"text"]))),
    CONSTRAINT "site_closes_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'finalized'::"text", 'reopened'::"text", 'superseded'::"text"])))
);


ALTER TABLE "public"."site_closes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."site_completion_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "site_id" "uuid" NOT NULL,
    "sequence_no" integer NOT NULL,
    "event_type" "text" NOT NULL,
    "effective_completed_at" timestamp with time zone NOT NULL,
    "reversed_event_id" "uuid",
    "actor_user_id" "uuid",
    "idempotency_key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "site_completion_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['recorded'::"text", 'reversed'::"text"]))),
    CONSTRAINT "site_completion_events_reversal_check" CHECK (((("event_type" = 'recorded'::"text") AND ("reversed_event_id" IS NULL)) OR (("event_type" = 'reversed'::"text") AND ("reversed_event_id" IS NOT NULL)))),
    CONSTRAINT "site_completion_events_sequence_no_check" CHECK (("sequence_no" > 0))
);


ALTER TABLE "public"."site_completion_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."site_completion_events" IS 'Immutable site completion facts. Completion and reversal are recorded as append-only events.';



COMMENT ON COLUMN "public"."site_completion_events"."sequence_no" IS 'Per-site immutable event sequence number. Revision root is event_id + sequence_no, not sites.completed_at.';



CREATE TABLE IF NOT EXISTS "public"."site_day_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "site_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "trade_families" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "role_type" "text" NOT NULL,
    "credited_unit" numeric(12,2) DEFAULT 0 NOT NULL,
    "memo" "text" DEFAULT ''::"text" NOT NULL,
    "locked_by_site_close_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "site_day_logs_role_type_check" CHECK (("role_type" = ANY (ARRAY['assist'::"text", 'lead'::"text", 'solo'::"text", 'support'::"text"])))
);


ALTER TABLE "public"."site_day_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."site_line_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_id" "uuid" NOT NULL,
    "item_name" "text" NOT NULL,
    "quantity" numeric,
    "unit_name" "text",
    "unit_price" numeric,
    "sort_order" integer DEFAULT 0,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."site_line_items" OWNER TO "postgres";


COMMENT ON TABLE "public"."site_line_items" IS '現場の工事項目（見積/作業内容）';



COMMENT ON COLUMN "public"."site_line_items"."item_name" IS '工事名';



COMMENT ON COLUMN "public"."site_line_items"."quantity" IS '数量（任意）';



COMMENT ON COLUMN "public"."site_line_items"."unit_name" IS '単位（任意）';



COMMENT ON COLUMN "public"."site_line_items"."unit_price" IS '単価（任意）';



COMMENT ON COLUMN "public"."site_line_items"."sort_order" IS '表示順';



COMMENT ON COLUMN "public"."site_line_items"."created_by" IS '登録者';



COMMENT ON COLUMN "public"."site_line_items"."updated_by" IS '最終変更者';



CREATE TABLE IF NOT EXISTS "public"."site_member_outcome_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "site_close_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "outcome_status" "text" NOT NULL,
    "rework_units" numeric(12,2) DEFAULT 0 NOT NULL,
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "site_member_outcome_snapshots_outcome_status_check" CHECK (("outcome_status" = ANY (ARRAY['ok'::"text", 'rework'::"text", 'unknown'::"text"])))
);


ALTER TABLE "public"."site_member_outcome_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."site_member_reward_inputs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "site_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "participation_units" numeric(12,2) DEFAULT 1.0 NOT NULL,
    "responsibility_level" "text" DEFAULT 'member'::"text" NOT NULL,
    "role_shares" "jsonb" DEFAULT '{"admin": 0, "client": 0, "quality": 0, "planning": 0}'::"jsonb" NOT NULL,
    "note" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "site_member_reward_inputs_participation_check" CHECK (("participation_units" >= (0)::numeric)),
    CONSTRAINT "site_member_reward_inputs_responsibility_level_check" CHECK (("responsibility_level" = ANY (ARRAY['owner'::"text", 'lead'::"text", 'member'::"text", 'support'::"text"]))),
    CONSTRAINT "site_member_reward_inputs_role_shares_check" CHECK ("public"."path_role_shares_valid"("role_shares"))
);


ALTER TABLE "public"."site_member_reward_inputs" OWNER TO "postgres";


COMMENT ON TABLE "public"."site_member_reward_inputs" IS 'PATH reward v2 site-level member summary inputs used for RolePay and ResponsibilityPay.';



COMMENT ON COLUMN "public"."site_member_reward_inputs"."role_shares" IS 'Relative weights for planning, quality, admin, client role slots. Values are normalized per role at calculation time.';



CREATE TABLE IF NOT EXISTS "public"."site_member_role_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "site_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "role_shares" "jsonb" DEFAULT '{"admin": 0, "client": 0, "quality": 0, "planning": 0}'::"jsonb" NOT NULL,
    "note" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "site_member_role_plans_role_shares_check" CHECK ("public"."path_role_shares_valid"("role_shares"))
);


ALTER TABLE "public"."site_member_role_plans" OWNER TO "postgres";


COMMENT ON TABLE "public"."site_member_role_plans" IS 'PATH site-level planned role shares entered before work starts.';



COMMENT ON COLUMN "public"."site_member_role_plans"."role_shares" IS 'Planned relative weights for planning, quality, admin, client role slots.';



CREATE TABLE IF NOT EXISTS "public"."sites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "address" "text",
    "area_sqm" numeric,
    "work_types" "text"[],
    "estimated_hours" numeric,
    "actual_hours" numeric DEFAULT 0,
    "revenue" numeric DEFAULT 0,
    "status" "text" DEFAULT 'active'::"text",
    "client_id" "uuid",
    "assigned_users" "uuid"[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone,
    "monster_name" "text",
    "monster_image_url" "text",
    "monster_attributes" "text"[],
    "deadline_date" "date",
    "monster_archetype" "text",
    "start_date" "date",
    "end_date" "date",
    "estimated_man_hours" numeric DEFAULT 0,
    "started_at" "date",
    "expected_completion_at" "date",
    "description" "text",
    "cautions" "text",
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "deletion_reason" "text",
    "org_id" "uuid" DEFAULT '00000000-0000-0000-0000-000000000001'::"uuid" NOT NULL,
    "schedule_mode" "text" DEFAULT 'continuous'::"text" NOT NULL,
    "working_weekdays" integer[],
    "custom_work_dates" "date"[],
    "required_worker_count" integer,
    CONSTRAINT "sites_required_worker_count_check" CHECK ((("required_worker_count" IS NULL) OR ("required_worker_count" >= 0))),
    CONSTRAINT "sites_schedule_mode_check" CHECK (("schedule_mode" = ANY (ARRAY['continuous'::"text", 'weekdays'::"text", 'custom'::"text"])))
);


ALTER TABLE "public"."sites" OWNER TO "postgres";


COMMENT ON COLUMN "public"."sites"."started_at" IS '工期開始日';



COMMENT ON COLUMN "public"."sites"."expected_completion_at" IS '完了予定日';



COMMENT ON COLUMN "public"."sites"."description" IS '作業内容 - what work is being done at this site';



COMMENT ON COLUMN "public"."sites"."cautions" IS '注意事項 - safety warnings and cautions for workers';



COMMENT ON COLUMN "public"."sites"."deleted_at" IS '論理削除日時';



COMMENT ON COLUMN "public"."sites"."deleted_by" IS '削除したユーザー';



COMMENT ON COLUMN "public"."sites"."deletion_reason" IS '削除理由';



COMMENT ON COLUMN "public"."sites"."schedule_mode" IS '現場の施工スケジュールモード: continuous / weekdays / custom';



COMMENT ON COLUMN "public"."sites"."working_weekdays" IS '曜日施工モード時の施工曜日。0=Sun ... 6=Sat';



COMMENT ON COLUMN "public"."sites"."custom_work_dates" IS '個別日施工モード時の実施工日一覧';



COMMENT ON COLUMN "public"."sites"."required_worker_count" IS 'Schedule v1 required worker count. NULL excludes the site from shortage calculations.';



CREATE TABLE IF NOT EXISTS "public"."skill_ledgers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "trade_family" "text" NOT NULL,
    "assist_units" numeric(12,2) DEFAULT 0 NOT NULL,
    "lead_units" numeric(12,2) DEFAULT 0 NOT NULL,
    "solo_units" numeric(12,2) DEFAULT 0 NOT NULL,
    "recent_90d_units" numeric(12,2) DEFAULT 0 NOT NULL,
    "ok_count" integer DEFAULT 0 NOT NULL,
    "rework_count" integer DEFAULT 0 NOT NULL,
    "last_performed_at" "date",
    "derived_labels" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."skill_ledgers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_config" (
    "key" "text" NOT NULL,
    "value" "text" NOT NULL,
    "description" "text",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."system_config" OWNER TO "postgres";


COMMENT ON TABLE "public"."system_config" IS 'システム設定（Gmail historyId等）';



CREATE TABLE IF NOT EXISTS "public"."tax_categories" (
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "rate" numeric NOT NULL,
    "is_reduced" boolean DEFAULT false,
    "effective_from" "date" NOT NULL,
    "effective_to" "date",
    "description" "text"
);


ALTER TABLE "public"."tax_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trade_families" (
    "key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "display_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."trade_families" OWNER TO "postgres";


ALTER TABLE ONLY "public"."account_master"
    ADD CONSTRAINT "account_master_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."accounting_audit_log"
    ADD CONSTRAINT "accounting_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."accounting_invoice_sources"
    ADD CONSTRAINT "accounting_invoice_sources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."accounting_invoices"
    ADD CONSTRAINT "accounting_invoices_invoice_no_key" UNIQUE ("invoice_no");



ALTER TABLE ONLY "public"."accounting_invoices"
    ADD CONSTRAINT "accounting_invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."accounting_journal_entries"
    ADD CONSTRAINT "accounting_journal_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."accounting_journal_entries"
    ADD CONSTRAINT "accounting_journal_entries_transaction_id_key" UNIQUE ("transaction_id");



ALTER TABLE ONLY "public"."accounting_journal_lines"
    ADD CONSTRAINT "accounting_journal_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."accounting_transaction_items"
    ADD CONSTRAINT "accounting_transaction_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."accounting_transactions"
    ADD CONSTRAINT "accounting_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_proposals"
    ADD CONSTRAINT "ai_proposals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."badge_application_votes"
    ADD CONSTRAINT "badge_application_votes_pkey" PRIMARY KEY ("application_id", "voter_id");



ALTER TABLE ONLY "public"."badge_applications"
    ADD CONSTRAINT "badge_applications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."badge_states"
    ADD CONSTRAINT "badge_states_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."battle_log"
    ADD CONSTRAINT "battle_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."communication_conversations"
    ADD CONSTRAINT "communication_conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."communication_links"
    ADD CONSTRAINT "communication_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."communication_logs"
    ADD CONSTRAINT "communication_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."communication_participants"
    ADD CONSTRAINT "communication_participants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."design_principles"
    ADD CONSTRAINT "design_principles_org_id_name_key" UNIQUE ("org_id", "name");



ALTER TABLE ONLY "public"."design_principles"
    ADD CONSTRAINT "design_principles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feature_flags"
    ADD CONSTRAINT "feature_flags_feature_key_key" UNIQUE ("feature_key");



ALTER TABLE ONLY "public"."feature_flags"
    ADD CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."finance_payout_postings"
    ADD CONSTRAINT "finance_payout_postings_org_id_proposal_id_member_id_postin_key" UNIQUE ("org_id", "proposal_id", "member_id", "posting_kind");



ALTER TABLE ONLY "public"."finance_payout_postings"
    ADD CONSTRAINT "finance_payout_postings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."focus_items"
    ADD CONSTRAINT "focus_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gmail_message_processing"
    ADD CONSTRAINT "gmail_message_processing_message_id_history_id_key" UNIQUE ("message_id", "history_id");



ALTER TABLE ONLY "public"."gmail_message_processing"
    ADD CONSTRAINT "gmail_message_processing_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."governance_events"
    ADD CONSTRAINT "governance_events_org_id_dedupe_key_key" UNIQUE ("org_id", "dedupe_key");



ALTER TABLE ONLY "public"."governance_events"
    ADD CONSTRAINT "governance_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_number_sequences"
    ADD CONSTRAINT "invoice_number_sequences_pkey" PRIMARY KEY ("fiscal_year");



ALTER TABLE ONLY "public"."lead_assignment_logs"
    ADD CONSTRAINT "lead_assignment_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ledger_entries"
    ADD CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ledger_events"
    ADD CONSTRAINT "ledger_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ledger_transactions"
    ADD CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."luqo_categories"
    ADD CONSTRAINT "luqo_categories_org_id_name_key" UNIQUE ("org_id", "name");



ALTER TABLE ONLY "public"."luqo_categories"
    ADD CONSTRAINT "luqo_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."luqo_period_scores"
    ADD CONSTRAINT "luqo_period_scores_org_id_member_id_period_key" UNIQUE ("org_id", "member_id", "period");



ALTER TABLE ONLY "public"."luqo_period_scores"
    ADD CONSTRAINT "luqo_period_scores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."luqo_reward_calculations"
    ADD CONSTRAINT "luqo_reward_calculations_org_id_period_key" UNIQUE ("org_id", "period");



ALTER TABLE ONLY "public"."luqo_reward_calculations"
    ADD CONSTRAINT "luqo_reward_calculations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."luqo_skill_catalog"
    ADD CONSTRAINT "luqo_skill_catalog_org_id_category_id_name_key" UNIQUE ("org_id", "category_id", "name");



ALTER TABLE ONLY "public"."luqo_skill_catalog"
    ADD CONSTRAINT "luqo_skill_catalog_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."luqo_star_achievements"
    ADD CONSTRAINT "luqo_star_achievements_org_id_member_id_star_id_key" UNIQUE ("org_id", "member_id", "star_id");



ALTER TABLE ONLY "public"."luqo_star_achievements"
    ADD CONSTRAINT "luqo_star_achievements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."member_business_profiles"
    ADD CONSTRAINT "member_business_profiles_org_id_member_id_key" UNIQUE ("org_id", "member_id");



ALTER TABLE ONLY "public"."member_business_profiles"
    ADD CONSTRAINT "member_business_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."member_skill_certifications"
    ADD CONSTRAINT "member_skill_certifications_org_id_member_id_skill_key_key" UNIQUE ("org_id", "member_id", "skill_key");



ALTER TABLE ONLY "public"."member_skill_certifications"
    ADD CONSTRAINT "member_skill_certifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."member_skill_profiles"
    ADD CONSTRAINT "member_skill_profiles_org_id_member_id_key" UNIQUE ("org_id", "member_id");



ALTER TABLE ONLY "public"."member_skill_profiles"
    ADD CONSTRAINT "member_skill_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."monster_archetypes"
    ADD CONSTRAINT "monster_archetypes_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."monster_archetypes"
    ADD CONSTRAINT "monster_archetypes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."monster_images"
    ADD CONSTRAINT "monster_images_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."monster_images"
    ADD CONSTRAINT "monster_images_site_id_key" UNIQUE ("site_id");



ALTER TABLE ONLY "public"."month_close_line_sources"
    ADD CONSTRAINT "month_close_line_sources_month_close_line_id_source_type_so_key" UNIQUE ("month_close_line_id", "source_type", "source_id");



ALTER TABLE ONLY "public"."month_close_line_sources"
    ADD CONSTRAINT "month_close_line_sources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."month_close_lines"
    ADD CONSTRAINT "month_close_lines_month_close_id_revenue_basis_id_dimension_key" UNIQUE ("month_close_id", "revenue_basis_id", "dimension_hash");



ALTER TABLE ONLY "public"."month_close_lines"
    ADD CONSTRAINT "month_close_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."month_closes"
    ADD CONSTRAINT "month_closes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."monthly_distribution_closes"
    ADD CONSTRAINT "monthly_distribution_closes_org_id_proposal_id_key" UNIQUE ("org_id", "proposal_id");



ALTER TABLE ONLY "public"."monthly_distribution_closes"
    ADD CONSTRAINT "monthly_distribution_closes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."monthly_distribution_corrections"
    ADD CONSTRAINT "monthly_distribution_corrections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."monthly_distribution_lines"
    ADD CONSTRAINT "monthly_distribution_lines_monthly_distribution_close_id_me_key" UNIQUE ("monthly_distribution_close_id", "member_id");



ALTER TABLE ONLY "public"."monthly_distribution_lines"
    ADD CONSTRAINT "monthly_distribution_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."monthly_evaluation_ai_reviews"
    ADD CONSTRAINT "monthly_evaluation_ai_reviews_org_id_month_member_id_key" UNIQUE ("org_id", "month", "member_id");



ALTER TABLE ONLY "public"."monthly_evaluation_ai_reviews"
    ADD CONSTRAINT "monthly_evaluation_ai_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."monthly_evaluation_confirmations"
    ADD CONSTRAINT "monthly_evaluation_confirmati_org_id_month_member_id_target_key" UNIQUE ("org_id", "month", "member_id", "target_type", "target_key");



ALTER TABLE ONLY "public"."monthly_evaluation_confirmations"
    ADD CONSTRAINT "monthly_evaluation_confirmations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."monthly_evaluation_finalizations"
    ADD CONSTRAINT "monthly_evaluation_finalizations_org_id_month_member_id_key" UNIQUE ("org_id", "month", "member_id");



ALTER TABLE ONLY "public"."monthly_evaluation_finalizations"
    ADD CONSTRAINT "monthly_evaluation_finalizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."monthly_evaluation_forms"
    ADD CONSTRAINT "monthly_evaluation_forms_org_id_month_member_id_key" UNIQUE ("org_id", "month", "member_id");



ALTER TABLE ONLY "public"."monthly_evaluation_forms"
    ADD CONSTRAINT "monthly_evaluation_forms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ocr_cache"
    ADD CONSTRAINT "ocr_cache_pkey" PRIMARY KEY ("hash");



ALTER TABLE ONLY "public"."org_invites"
    ADD CONSTRAINT "org_invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."org_invoice_settings"
    ADD CONSTRAINT "org_invoice_settings_pkey" PRIMARY KEY ("org_id");



ALTER TABLE ONLY "public"."org_memberships"
    ADD CONSTRAINT "org_memberships_org_id_user_id_key" UNIQUE ("org_id", "user_id");



ALTER TABLE ONLY "public"."org_memberships"
    ADD CONSTRAINT "org_memberships_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."path_ai_review_annotations"
    ADD CONSTRAINT "path_ai_review_annotations_org_id_month_member_id_reviewer__key" UNIQUE ("org_id", "month", "member_id", "reviewer_kind");



ALTER TABLE ONLY "public"."path_ai_review_annotations"
    ADD CONSTRAINT "path_ai_review_annotations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."path_assignment_restrictions"
    ADD CONSTRAINT "path_assignment_restrictions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."path_credited_units"
    ADD CONSTRAINT "path_credited_units_org_id_close_id_member_id_unit_type_sou_key" UNIQUE ("org_id", "close_id", "member_id", "unit_type", "source_id");



ALTER TABLE ONLY "public"."path_credited_units"
    ADD CONSTRAINT "path_credited_units_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."path_evidence_records"
    ADD CONSTRAINT "path_evidence_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."path_explanation_snapshots"
    ADD CONSTRAINT "path_explanation_snapshots_org_id_proposal_id_member_id_key" UNIQUE ("org_id", "proposal_id", "member_id");



ALTER TABLE ONLY "public"."path_explanation_snapshots"
    ADD CONSTRAINT "path_explanation_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."path_month_closes"
    ADD CONSTRAINT "path_month_closes_org_id_month_member_id_key" UNIQUE ("org_id", "month", "member_id");



ALTER TABLE ONLY "public"."path_month_closes"
    ADD CONSTRAINT "path_month_closes_org_id_proposal_id_key" UNIQUE ("org_id", "proposal_id");



ALTER TABLE ONLY "public"."path_month_closes"
    ADD CONSTRAINT "path_month_closes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."path_monthly_close_inputs"
    ADD CONSTRAINT "path_monthly_close_inputs_org_id_month_member_id_key" UNIQUE ("org_id", "month", "member_id");



ALTER TABLE ONLY "public"."path_monthly_close_inputs"
    ADD CONSTRAINT "path_monthly_close_inputs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."path_opportunity_audits"
    ADD CONSTRAINT "path_opportunity_audits_org_id_month_member_id_trade_family_key" UNIQUE ("org_id", "month", "member_id", "trade_family");



ALTER TABLE ONLY "public"."path_opportunity_audits"
    ADD CONSTRAINT "path_opportunity_audits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."path_reward_runs"
    ADD CONSTRAINT "path_reward_runs_org_id_proposal_id_key" UNIQUE ("org_id", "proposal_id");



ALTER TABLE ONLY "public"."path_reward_runs"
    ADD CONSTRAINT "path_reward_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."path_rule_versions"
    ADD CONSTRAINT "path_rule_versions_org_id_version_key" UNIQUE ("org_id", "version");



ALTER TABLE ONLY "public"."path_rule_versions"
    ADD CONSTRAINT "path_rule_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."path_site_item_profit_snapshots"
    ADD CONSTRAINT "path_site_item_profit_snapsho_org_id_month_site_id_item_key_key" UNIQUE ("org_id", "month", "site_id", "item_key");



ALTER TABLE ONLY "public"."path_site_item_profit_snapshots"
    ADD CONSTRAINT "path_site_item_profit_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."path_trade_endorsements"
    ADD CONSTRAINT "path_trade_endorsements_org_id_member_id_trade_family_key" UNIQUE ("org_id", "member_id", "trade_family");



ALTER TABLE ONLY "public"."path_trade_endorsements"
    ADD CONSTRAINT "path_trade_endorsements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."path_work_package_assignments"
    ADD CONSTRAINT "path_work_package_assignments_org_id_work_package_id_member_key" UNIQUE ("org_id", "work_package_id", "member_id", "role_type");



ALTER TABLE ONLY "public"."path_work_package_assignments"
    ADD CONSTRAINT "path_work_package_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."path_work_packages"
    ADD CONSTRAINT "path_work_packages_org_id_month_package_key_key" UNIQUE ("org_id", "month", "package_key");



ALTER TABLE ONLY "public"."path_work_packages"
    ADD CONSTRAINT "path_work_packages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."perk_application_votes"
    ADD CONSTRAINT "perk_application_votes_pkey" PRIMARY KEY ("application_id", "voter_id");



ALTER TABLE ONLY "public"."perk_applications"
    ADD CONSTRAINT "perk_applications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."perk_definitions"
    ADD CONSTRAINT "perk_definitions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."perk_states"
    ADD CONSTRAINT "perk_states_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."personal_schedules"
    ADD CONSTRAINT "personal_schedules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."policies"
    ADD CONSTRAINT "policies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."policy_bundle_versions"
    ADD CONSTRAINT "policy_bundle_versions_org_id_bundle_key_version_revision_key" UNIQUE ("org_id", "bundle_key", "version", "revision");



ALTER TABLE ONLY "public"."policy_bundle_versions"
    ADD CONSTRAINT "policy_bundle_versions_org_id_published_proposal_id_key" UNIQUE ("org_id", "published_proposal_id");



ALTER TABLE ONLY "public"."policy_bundle_versions"
    ADD CONSTRAINT "policy_bundle_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."posting_groups"
    ADD CONSTRAINT "posting_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."principle_observations"
    ADD CONSTRAINT "principle_observations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."proposal_executions"
    ADD CONSTRAINT "proposal_executions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."proposal_executions"
    ADD CONSTRAINT "proposal_executions_proposal_id_attempt_no_key" UNIQUE ("proposal_id", "attempt_no");



ALTER TABLE ONLY "public"."proposals"
    ADD CONSTRAINT "proposals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."revenue_basis"
    ADD CONSTRAINT "revenue_basis_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reward_calculation_snapshots"
    ADD CONSTRAINT "reward_calculation_snapshots_org_id_proposal_id_member_id_key" UNIQUE ("org_id", "proposal_id", "member_id");



ALTER TABLE ONLY "public"."reward_calculation_snapshots"
    ADD CONSTRAINT "reward_calculation_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reward_confirmations"
    ADD CONSTRAINT "reward_confirmations_monthly_distribution_close_id_member_i_key" UNIQUE ("monthly_distribution_close_id", "member_id");



ALTER TABLE ONLY "public"."reward_confirmations"
    ADD CONSTRAINT "reward_confirmations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reward_run_lines"
    ADD CONSTRAINT "reward_run_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reward_runs"
    ADD CONSTRAINT "reward_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reward_write_controls"
    ADD CONSTRAINT "reward_write_controls_pkey" PRIMARY KEY ("org_id", "control_key");



ALTER TABLE ONLY "public"."site_closes"
    ADD CONSTRAINT "site_closes_org_id_proposal_id_key" UNIQUE ("org_id", "proposal_id");



ALTER TABLE ONLY "public"."site_closes"
    ADD CONSTRAINT "site_closes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."site_completion_events"
    ADD CONSTRAINT "site_completion_events_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."site_completion_events"
    ADD CONSTRAINT "site_completion_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."site_completion_events"
    ADD CONSTRAINT "site_completion_events_site_id_sequence_no_key" UNIQUE ("site_id", "sequence_no");



ALTER TABLE ONLY "public"."site_day_logs"
    ADD CONSTRAINT "site_day_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."site_line_items"
    ADD CONSTRAINT "site_line_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."site_member_outcome_snapshots"
    ADD CONSTRAINT "site_member_outcome_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."site_member_outcome_snapshots"
    ADD CONSTRAINT "site_member_outcome_snapshots_site_close_id_member_id_key" UNIQUE ("site_close_id", "member_id");



ALTER TABLE ONLY "public"."site_member_reward_inputs"
    ADD CONSTRAINT "site_member_reward_inputs_org_id_site_id_member_id_key" UNIQUE ("org_id", "site_id", "member_id");



ALTER TABLE ONLY "public"."site_member_reward_inputs"
    ADD CONSTRAINT "site_member_reward_inputs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."site_member_role_plans"
    ADD CONSTRAINT "site_member_role_plans_org_id_site_id_member_id_key" UNIQUE ("org_id", "site_id", "member_id");



ALTER TABLE ONLY "public"."site_member_role_plans"
    ADD CONSTRAINT "site_member_role_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sites"
    ADD CONSTRAINT "sites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."skill_ledgers"
    ADD CONSTRAINT "skill_ledgers_org_id_member_id_trade_family_key" UNIQUE ("org_id", "member_id", "trade_family");



ALTER TABLE ONLY "public"."skill_ledgers"
    ADD CONSTRAINT "skill_ledgers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_config"
    ADD CONSTRAINT "system_config_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."tax_categories"
    ADD CONSTRAINT "tax_categories_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."trade_families"
    ADD CONSTRAINT "trade_families_pkey" PRIMARY KEY ("key");



CREATE INDEX "accounting_invoice_sources_invoice_idx" ON "public"."accounting_invoice_sources" USING "btree" ("invoice_id", "sort_order");



CREATE UNIQUE INDEX "accounting_invoice_sources_invoice_tx_unique" ON "public"."accounting_invoice_sources" USING "btree" ("invoice_id", "source_transaction_id");



CREATE UNIQUE INDEX "accounting_invoice_sources_primary_source_unique" ON "public"."accounting_invoice_sources" USING "btree" ("source_transaction_id") WHERE ("is_primary_document" = true);



CREATE INDEX "accounting_invoice_sources_source_idx" ON "public"."accounting_invoice_sources" USING "btree" ("source_transaction_id");



CREATE UNIQUE INDEX "accounting_invoices_active_supplement_unique" ON "public"."accounting_invoices" USING "btree" ("supplements_invoice_id") WHERE ("document_type" = 'invoice_supplement'::"text");



CREATE INDEX "accounting_invoices_issue_date_idx" ON "public"."accounting_invoices" USING "btree" ("issue_date" DESC);



CREATE INDEX "accounting_invoices_org_id_idx" ON "public"."accounting_invoices" USING "btree" ("org_id");



CREATE UNIQUE INDEX "accounting_invoices_primary_doc_unique" ON "public"."accounting_invoices" USING "btree" ("source_transaction_id") WHERE ("document_type" = ANY (ARRAY['standard_invoice'::"text", 'qualified_invoice'::"text"]));



CREATE INDEX "accounting_invoices_source_transaction_date_idx" ON "public"."accounting_invoices" USING "btree" ("source_transaction_date" DESC);



CREATE INDEX "accounting_journal_entries_entry_date_idx" ON "public"."accounting_journal_entries" USING "btree" ("entry_date" DESC);



CREATE INDEX "accounting_journal_entries_posting_group_idx" ON "public"."accounting_journal_entries" USING "btree" ("posting_group_id") WHERE ("posting_group_id" IS NOT NULL);



CREATE UNIQUE INDEX "accounting_journal_lines_entry_line_no_uniq" ON "public"."accounting_journal_lines" USING "btree" ("entry_id", "line_no");



CREATE INDEX "accounting_journal_lines_revenue_basis_idx" ON "public"."accounting_journal_lines" USING "btree" ("revenue_basis_id") WHERE ("revenue_basis_id" IS NOT NULL);



CREATE INDEX "accounting_journal_lines_site_idx" ON "public"."accounting_journal_lines" USING "btree" ("site_id") WHERE ("site_id" IS NOT NULL);



CREATE INDEX "accounting_transaction_items_tx_idx" ON "public"."accounting_transaction_items" USING "btree" ("transaction_id");



CREATE INDEX "accounting_transactions_category_idx" ON "public"."accounting_transactions" USING "btree" ("category");



CREATE INDEX "accounting_transactions_kind_idx" ON "public"."accounting_transactions" USING "btree" ("kind");



CREATE INDEX "accounting_transactions_recorded_date_idx" ON "public"."accounting_transactions" USING "btree" ("recorded_date" DESC);



CREATE INDEX "accounting_transactions_site_idx" ON "public"."accounting_transactions" USING "btree" ("site_id");



CREATE INDEX "accounting_transactions_status_idx" ON "public"."accounting_transactions" USING "btree" ("status");



CREATE UNIQUE INDEX "accounting_transactions_voids_transaction_unique" ON "public"."accounting_transactions" USING "btree" ("voids_transaction_id") WHERE ("voids_transaction_id" IS NOT NULL);



CREATE INDEX "ai_proposals_expires_idx" ON "public"."ai_proposals" USING "btree" ("expires_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "ai_proposals_type_status_idx" ON "public"."ai_proposals" USING "btree" ("proposal_type", "status", "created_at" DESC);



CREATE INDEX "audit_log_changed_at_idx" ON "public"."accounting_audit_log" USING "btree" ("changed_at" DESC);



CREATE INDEX "audit_log_record_idx" ON "public"."accounting_audit_log" USING "btree" ("table_name", "record_id");



CREATE INDEX "battle_log_created_idx" ON "public"."battle_log" USING "btree" ("created_at" DESC);



CREATE INDEX "battle_log_site_idx" ON "public"."battle_log" USING "btree" ("site_id");



CREATE INDEX "battle_log_user_idx" ON "public"."battle_log" USING "btree" ("user_id");



CREATE INDEX "clients_deleted_at_idx" ON "public"."clients" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "clients_org_id_deleted_at_idx" ON "public"."clients" USING "btree" ("org_id", "deleted_at");



CREATE INDEX "clients_org_id_idx" ON "public"."clients" USING "btree" ("org_id");



CREATE INDEX "communication_conversations_org_assignee_activity_idx" ON "public"."communication_conversations" USING "btree" ("org_id", "assignee_user_id", "last_activity_at" DESC);



CREATE UNIQUE INDEX "communication_conversations_org_channel_thread_idx" ON "public"."communication_conversations" USING "btree" ("org_id", "source_channel", "external_thread_key") WHERE ("external_thread_key" IS NOT NULL);



CREATE INDEX "communication_conversations_org_status_activity_idx" ON "public"."communication_conversations" USING "btree" ("org_id", "status", "last_activity_at" DESC);



CREATE UNIQUE INDEX "communication_links_conversation_proposal_idx" ON "public"."communication_links" USING "btree" ("conversation_id", "link_type", "proposal_id");



CREATE INDEX "communication_links_org_conversation_idx" ON "public"."communication_links" USING "btree" ("org_id", "conversation_id", "created_at" DESC);



CREATE INDEX "communication_logs_conversation_occurred_idx" ON "public"."communication_logs" USING "btree" ("conversation_id", "occurred_at", "created_at");



CREATE UNIQUE INDEX "communication_logs_external_source_id_idx" ON "public"."communication_logs" USING "btree" ("external_source", "external_id") WHERE (("external_source" IS NOT NULL) AND ("external_id" IS NOT NULL));



CREATE INDEX "communication_logs_org_channel_idx" ON "public"."communication_logs" USING "btree" ("org_id", "channel", "occurred_at" DESC);



CREATE UNIQUE INDEX "communication_participants_conversation_email_idx" ON "public"."communication_participants" USING "btree" ("conversation_id", "email") WHERE ("email" IS NOT NULL);



CREATE UNIQUE INDEX "communication_participants_conversation_profile_idx" ON "public"."communication_participants" USING "btree" ("conversation_id", "profile_id") WHERE ("profile_id" IS NOT NULL);



CREATE INDEX "communication_participants_org_conversation_idx" ON "public"."communication_participants" USING "btree" ("org_id", "conversation_id", "created_at");



CREATE INDEX "documents_client_idx" ON "public"."documents" USING "btree" ("client_id");



CREATE INDEX "documents_created_at_idx" ON "public"."documents" USING "btree" ("created_at" DESC);



CREATE INDEX "documents_doc_type_idx" ON "public"."documents" USING "btree" ("doc_type");



CREATE INDEX "documents_drive_file_id_idx" ON "public"."documents" USING "btree" ("drive_file_id");



CREATE INDEX "documents_drive_folder_id_idx" ON "public"."documents" USING "btree" ("drive_folder_id");



CREATE UNIQUE INDEX "documents_gmail_attachment_unique_idx" ON "public"."documents" USING "btree" ("gmail_message_id", "gmail_attachment_id") WHERE (("gmail_message_id" IS NOT NULL) AND ("gmail_attachment_id" IS NOT NULL));



CREATE INDEX "documents_site_idx" ON "public"."documents" USING "btree" ("site_id");



CREATE INDEX "finance_payout_postings_canonical_reward_run_idx" ON "public"."finance_payout_postings" USING "btree" ("canonical_reward_run_id") WHERE ("canonical_reward_run_id" IS NOT NULL);



CREATE INDEX "finance_payout_postings_org_month_idx" ON "public"."finance_payout_postings" USING "btree" ("org_id", "target_month", "posted_at" DESC);



CREATE INDEX "finance_payout_postings_posting_group_idx" ON "public"."finance_payout_postings" USING "btree" ("posting_group_id") WHERE ("posting_group_id" IS NOT NULL);



CREATE UNIQUE INDEX "finance_payout_postings_v31_canonical_member_once" ON "public"."finance_payout_postings" USING "btree" ("org_id", "canonical_reward_run_id", "member_id", "posting_kind") WHERE ("canonical_reward_run_id" IS NOT NULL);



CREATE INDEX "focus_items_org_creator_status_idx" ON "public"."focus_items" USING "btree" ("org_id", "created_by", "status", "created_at" DESC);



CREATE INDEX "focus_items_org_status_horizon_idx" ON "public"."focus_items" USING "btree" ("org_id", "status", "horizon", "scope", "created_at" DESC);



CREATE INDEX "gmail_message_processing_message_idx" ON "public"."gmail_message_processing" USING "btree" ("message_id", "created_at" DESC);



CREATE INDEX "gmail_message_processing_status_idx" ON "public"."gmail_message_processing" USING "btree" ("status", "updated_at" DESC);



CREATE INDEX "governance_events_org_created_idx" ON "public"."governance_events" USING "btree" ("org_id", "created_at" DESC);



CREATE INDEX "governance_events_org_type_idx" ON "public"."governance_events" USING "btree" ("org_id", "event_type", "created_at" DESC);



CREATE INDEX "idx_design_principles_status" ON "public"."design_principles" USING "btree" ("status");



CREATE INDEX "idx_principle_observations_principle_id" ON "public"."principle_observations" USING "btree" ("principle_id");



CREATE INDEX "idx_principle_observations_proposal_id" ON "public"."principle_observations" USING "btree" ("proposal_id");



CREATE INDEX "lead_assignment_logs_org_date_idx" ON "public"."lead_assignment_logs" USING "btree" ("org_id", "date" DESC, "site_id");



CREATE INDEX "ledger_entries_account_idx" ON "public"."ledger_entries" USING "btree" ("account_code");



CREATE INDEX "ledger_entries_transaction_idx" ON "public"."ledger_entries" USING "btree" ("transaction_id");



CREATE INDEX "ledger_events_org_type_idx" ON "public"."ledger_events" USING "btree" ("org_id", "event_type", "created_at" DESC);



CREATE INDEX "ledger_events_proposal_idx" ON "public"."ledger_events" USING "btree" ("proposal_id");



CREATE INDEX "ledger_transactions_date_idx" ON "public"."ledger_transactions" USING "btree" ("org_id", "transaction_date" DESC);



CREATE INDEX "ledger_transactions_event_idx" ON "public"."ledger_transactions" USING "btree" ("event_id");



CREATE INDEX "member_skill_certifications_org_member_idx" ON "public"."member_skill_certifications" USING "btree" ("org_id", "member_id", "verified_at" DESC);



CREATE INDEX "member_skill_certifications_review_flag_idx" ON "public"."member_skill_certifications" USING "btree" ("org_id", "review_required_flag", "verified_at" DESC);



CREATE INDEX "member_skill_certifications_status_idx" ON "public"."member_skill_certifications" USING "btree" ("org_id", "status", "verified_at" DESC);



CREATE INDEX "member_skill_profiles_level_idx" ON "public"."member_skill_profiles" USING "btree" ("org_id", "current_level", "updated_at" DESC);



CREATE INDEX "member_skill_profiles_org_member_idx" ON "public"."member_skill_profiles" USING "btree" ("org_id", "member_id", "updated_at" DESC);



CREATE INDEX "monster_images_site_idx" ON "public"."monster_images" USING "btree" ("site_id");



CREATE INDEX "month_close_line_sources_line_idx" ON "public"."month_close_line_sources" USING "btree" ("month_close_line_id", "created_at" DESC);



CREATE INDEX "month_close_line_sources_source_idx" ON "public"."month_close_line_sources" USING "btree" ("source_type", "source_id");



CREATE INDEX "month_close_lines_close_idx" ON "public"."month_close_lines" USING "btree" ("month_close_id", "created_at" DESC);



CREATE INDEX "month_close_lines_revenue_basis_idx" ON "public"."month_close_lines" USING "btree" ("revenue_basis_id");



CREATE INDEX "month_close_lines_site_idx" ON "public"."month_close_lines" USING "btree" ("site_id", "recognized_at" DESC);



CREATE INDEX "month_close_lines_source_posting_group_idx" ON "public"."month_close_lines" USING "btree" ("source_income_posting_group_id");



CREATE UNIQUE INDEX "month_closes_fixed_once_per_period" ON "public"."month_closes" USING "btree" ("org_id", "period_ym") WHERE ("status" = 'fixed'::"text");



CREATE INDEX "month_closes_org_period_created_idx" ON "public"."month_closes" USING "btree" ("org_id", "period_ym", "created_at" DESC);



CREATE INDEX "month_closes_supersedes_idx" ON "public"."month_closes" USING "btree" ("supersedes_month_close_id") WHERE ("supersedes_month_close_id" IS NOT NULL);



CREATE INDEX "monthly_distribution_closes_org_month_idx" ON "public"."monthly_distribution_closes" USING "btree" ("org_id", "month", "closed_at" DESC);



CREATE INDEX "monthly_distribution_closes_snapshot_hash_idx" ON "public"."monthly_distribution_closes" USING "btree" ("org_id", "snapshot_hash") WHERE ("snapshot_hash" IS NOT NULL);



CREATE INDEX "monthly_distribution_closes_status_idx" ON "public"."monthly_distribution_closes" USING "btree" ("org_id", "status", "month");



CREATE INDEX "monthly_distribution_corrections_org_member_idx" ON "public"."monthly_distribution_corrections" USING "btree" ("org_id", "member_id", "month" DESC);



CREATE INDEX "monthly_distribution_corrections_org_month_idx" ON "public"."monthly_distribution_corrections" USING "btree" ("org_id", "month", "status");



CREATE UNIQUE INDEX "monthly_distribution_corrections_seed_idempotency_idx" ON "public"."monthly_distribution_corrections" USING "btree" ("org_id", "scenario_id", "month", "member_id", "reason_code") WHERE ("scenario_id" IS NOT NULL);



CREATE INDEX "monthly_distribution_lines_close_idx" ON "public"."monthly_distribution_lines" USING "btree" ("monthly_distribution_close_id", "member_id");



CREATE INDEX "monthly_eval_ai_reviews_member_idx" ON "public"."monthly_evaluation_ai_reviews" USING "btree" ("org_id", "member_id", "generated_at" DESC);



CREATE INDEX "monthly_eval_ai_reviews_org_month_idx" ON "public"."monthly_evaluation_ai_reviews" USING "btree" ("org_id", "month", "generated_at" DESC);



CREATE INDEX "monthly_eval_ai_reviews_review_flag_idx" ON "public"."monthly_evaluation_ai_reviews" USING "btree" ("org_id", "review_required_flag", "generated_at" DESC);



CREATE INDEX "monthly_eval_confirmations_member_idx" ON "public"."monthly_evaluation_confirmations" USING "btree" ("org_id", "member_id", "confirmed_at" DESC);



CREATE INDEX "monthly_eval_confirmations_org_month_idx" ON "public"."monthly_evaluation_confirmations" USING "btree" ("org_id", "month", "confirmed_at" DESC);



CREATE INDEX "monthly_eval_finalizations_member_idx" ON "public"."monthly_evaluation_finalizations" USING "btree" ("org_id", "member_id", "finalized_at" DESC);



CREATE INDEX "monthly_eval_finalizations_org_month_idx" ON "public"."monthly_evaluation_finalizations" USING "btree" ("org_id", "month", "finalized_at" DESC);



CREATE INDEX "monthly_eval_forms_member_idx" ON "public"."monthly_evaluation_forms" USING "btree" ("org_id", "member_id", "submitted_at" DESC);



CREATE INDEX "monthly_eval_forms_org_month_idx" ON "public"."monthly_evaluation_forms" USING "btree" ("org_id", "month", "submitted_at" DESC);



CREATE INDEX "notifications_user_read_idx" ON "public"."notifications" USING "btree" ("user_id", "read", "created_at" DESC);



CREATE INDEX "ocr_cache_last_hit_idx" ON "public"."ocr_cache" USING "btree" ("last_hit_at" DESC);



CREATE INDEX "ocr_cache_source_attachment_idx" ON "public"."ocr_cache" USING "btree" ("source_attachment_id");



CREATE INDEX "ocr_cache_source_message_idx" ON "public"."ocr_cache" USING "btree" ("source_message_id");



CREATE UNIQUE INDEX "org_invites_active_email_idx" ON "public"."org_invites" USING "btree" ("org_id", "email_normalized") WHERE ("status" = 'pending'::"text");



CREATE INDEX "org_invites_org_email_status_idx" ON "public"."org_invites" USING "btree" ("org_id", "email_normalized", "status");



CREATE UNIQUE INDEX "org_invites_token_hash_idx" ON "public"."org_invites" USING "btree" ("token_hash");



CREATE INDEX "org_invoice_settings_status_idx" ON "public"."org_invoice_settings" USING "btree" ("invoice_issuer_status");



CREATE INDEX "org_memberships_org_role_status_idx" ON "public"."org_memberships" USING "btree" ("org_id", "role", "status");



CREATE INDEX "org_memberships_org_status_idx" ON "public"."org_memberships" USING "btree" ("org_id", "status");



CREATE INDEX "org_memberships_user_status_idx" ON "public"."org_memberships" USING "btree" ("user_id", "status");



CREATE UNIQUE INDEX "organizations_slug_lower_idx" ON "public"."organizations" USING "btree" ("lower"("slug")) WHERE ("slug" IS NOT NULL);



CREATE INDEX "organizations_status_idx" ON "public"."organizations" USING "btree" ("status");



CREATE INDEX "path_ai_review_annotations_org_month_idx" ON "public"."path_ai_review_annotations" USING "btree" ("org_id", "month", "member_id", "reviewer_kind");



CREATE INDEX "path_assignment_restrictions_org_member_idx" ON "public"."path_assignment_restrictions" USING "btree" ("org_id", "member_id", "started_at" DESC);



CREATE INDEX "path_credited_units_org_member_idx" ON "public"."path_credited_units" USING "btree" ("org_id", "member_id", "created_at" DESC);



CREATE INDEX "path_evidence_records_org_month_idx" ON "public"."path_evidence_records" USING "btree" ("org_id", "month", "member_id", "created_at" DESC);



CREATE INDEX "path_evidence_records_origin_idx" ON "public"."path_evidence_records" USING "btree" ("org_id", "origin_event_id");



CREATE INDEX "path_explanation_snapshots_org_month_idx" ON "public"."path_explanation_snapshots" USING "btree" ("org_id", "month", "rendered_at" DESC);



CREATE INDEX "path_month_closes_org_month_idx" ON "public"."path_month_closes" USING "btree" ("org_id", "month", "finalized_at" DESC);



CREATE INDEX "path_monthly_close_inputs_org_month_idx" ON "public"."path_monthly_close_inputs" USING "btree" ("org_id", "month", "submitted_at" DESC);



CREATE INDEX "path_opportunity_audits_org_month_idx" ON "public"."path_opportunity_audits" USING "btree" ("org_id", "month", "member_id");



CREATE INDEX "path_reward_runs_org_month_idx" ON "public"."path_reward_runs" USING "btree" ("org_id", "month", "approved_at" DESC);



CREATE INDEX "path_rule_versions_org_status_effective_idx" ON "public"."path_rule_versions" USING "btree" ("org_id", "status", "effective_from" DESC);



CREATE INDEX "path_site_item_profit_org_month_idx" ON "public"."path_site_item_profit_snapshots" USING "btree" ("org_id", "month", "site_id");



CREATE INDEX "path_trade_endorsements_org_member_idx" ON "public"."path_trade_endorsements" USING "btree" ("org_id", "member_id", "approved_at" DESC);



CREATE INDEX "path_work_package_assignments_org_member_idx" ON "public"."path_work_package_assignments" USING "btree" ("org_id", "member_id", "created_at" DESC);



CREATE INDEX "path_work_packages_org_month_idx" ON "public"."path_work_packages" USING "btree" ("org_id", "month", "site_id");



CREATE INDEX "personal_schedules_user_date_idx" ON "public"."personal_schedules" USING "btree" ("user_id", "start_date", "end_date");



CREATE INDEX "policies_active_idx" ON "public"."policies" USING "btree" ("is_active") WHERE ("is_active" = true);



CREATE INDEX "policies_org_type_idx" ON "public"."policies" USING "btree" ("org_id", "proposal_type", "priority" DESC);



CREATE INDEX "policy_bundle_versions_org_effective_idx" ON "public"."policy_bundle_versions" USING "btree" ("org_id", "bundle_key", "effective_from" DESC, "revision" DESC);



CREATE INDEX "posting_groups_org_type_posted_idx" ON "public"."posting_groups" USING "btree" ("org_id", "group_type", "posted_at" DESC);



CREATE INDEX "posting_groups_proposal_execution_idx" ON "public"."posting_groups" USING "btree" ("proposal_execution_id");



CREATE INDEX "posting_groups_revenue_basis_idx" ON "public"."posting_groups" USING "btree" ("revenue_basis_id") WHERE ("revenue_basis_id" IS NOT NULL);



CREATE UNIQUE INDEX "posting_groups_reversal_once" ON "public"."posting_groups" USING "btree" ("reverses_posting_group_id") WHERE ("reverses_posting_group_id" IS NOT NULL);



CREATE INDEX "posting_groups_reward_run_idx" ON "public"."posting_groups" USING "btree" ("reward_run_id") WHERE ("reward_run_id" IS NOT NULL);



CREATE UNIQUE INDEX "posting_groups_reward_run_unique" ON "public"."posting_groups" USING "btree" ("reward_run_id") WHERE ("reward_run_id" IS NOT NULL);



CREATE UNIQUE INDEX "posting_groups_v31_reward_run_payout_once" ON "public"."posting_groups" USING "btree" ("org_id", "reward_run_id", "group_type") WHERE (("reward_run_id" IS NOT NULL) AND ("group_type" = ANY (ARRAY['payout_post'::"text", 'payout_reverse'::"text"])));



CREATE INDEX "proposal_executions_org_proposal_started_idx" ON "public"."proposal_executions" USING "btree" ("org_id", "proposal_id", "started_at" DESC);



CREATE UNIQUE INDEX "proposal_executions_succeeded_once" ON "public"."proposal_executions" USING "btree" ("proposal_id") WHERE ("status" = 'succeeded'::"text");



CREATE INDEX "proposals_created_by_idx" ON "public"."proposals" USING "btree" ((("created_by" ->> 'id'::"text")));



CREATE INDEX "proposals_document_id_idx" ON "public"."proposals" USING "btree" ("document_id");



CREATE UNIQUE INDEX "proposals_idempotency_key_unique" ON "public"."proposals" USING "btree" ("idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "proposals_org_month_close_idx" ON "public"."proposals" USING "btree" ("org_id", "month_close_id", "created_at" DESC) WHERE ("month_close_id" IS NOT NULL);



CREATE INDEX "proposals_org_revenue_basis_idx" ON "public"."proposals" USING "btree" ("org_id", "revenue_basis_id", "created_at" DESC) WHERE ("revenue_basis_id" IS NOT NULL);



CREATE INDEX "proposals_org_status_idx" ON "public"."proposals" USING "btree" ("org_id", "status", "created_at" DESC);



CREATE INDEX "proposals_site_id_idx" ON "public"."proposals" USING "btree" ("site_id");



CREATE INDEX "proposals_supersedes_proposal_idx" ON "public"."proposals" USING "btree" ("supersedes_proposal_id") WHERE ("supersedes_proposal_id" IS NOT NULL);



CREATE INDEX "proposals_type_status_idx" ON "public"."proposals" USING "btree" ("type", "status");



CREATE INDEX "revenue_basis_org_site_created_idx" ON "public"."revenue_basis" USING "btree" ("org_id", "site_id", "created_at" DESC);



CREATE INDEX "revenue_basis_org_status_recognition_idx" ON "public"."revenue_basis" USING "btree" ("org_id", "status", "recognition_date" DESC);



CREATE UNIQUE INDEX "revenue_basis_origin_completion_unique" ON "public"."revenue_basis" USING "btree" ("origin_completion_event_id");



CREATE INDEX "reward_calc_snapshots_member_idx" ON "public"."reward_calculation_snapshots" USING "btree" ("org_id", "member_id", "finalized_at" DESC);



CREATE INDEX "reward_calc_snapshots_org_month_idx" ON "public"."reward_calculation_snapshots" USING "btree" ("org_id", "month", "finalized_at" DESC);



CREATE INDEX "reward_calc_snapshots_proposal_idx" ON "public"."reward_calculation_snapshots" USING "btree" ("proposal_id");



CREATE INDEX "reward_confirmations_org_close_idx" ON "public"."reward_confirmations" USING "btree" ("org_id", "monthly_distribution_close_id", "status");



CREATE INDEX "reward_confirmations_org_member_idx" ON "public"."reward_confirmations" USING "btree" ("org_id", "member_id", "updated_at" DESC);



CREATE INDEX "reward_run_lines_month_close_line_idx" ON "public"."reward_run_lines" USING "btree" ("month_close_line_id") WHERE ("month_close_line_id" IS NOT NULL);



CREATE INDEX "reward_run_lines_recipient_idx" ON "public"."reward_run_lines" USING "btree" ("recipient_id", "created_at" DESC);



CREATE INDEX "reward_run_lines_revenue_basis_idx" ON "public"."reward_run_lines" USING "btree" ("revenue_basis_id");



CREATE INDEX "reward_run_lines_run_idx" ON "public"."reward_run_lines" USING "btree" ("reward_run_id", "created_at" DESC);



CREATE UNIQUE INDEX "reward_run_lines_run_recipient_once" ON "public"."reward_run_lines" USING "btree" ("reward_run_id", "recipient_id");



CREATE INDEX "reward_runs_adjusts_idx" ON "public"."reward_runs" USING "btree" ("adjusts_reward_run_id") WHERE ("adjusts_reward_run_id" IS NOT NULL);



CREATE UNIQUE INDEX "reward_runs_fixed_calculation_once" ON "public"."reward_runs" USING "btree" ("month_close_id", "reward_rule_version_id") WHERE (("run_kind" = 'calculation'::"text") AND ("status" = 'fixed'::"text"));



CREATE UNIQUE INDEX "reward_runs_monthly_distribution_close_once" ON "public"."reward_runs" USING "btree" ("org_id", "monthly_distribution_close_id") WHERE ("monthly_distribution_close_id" IS NOT NULL);



CREATE INDEX "reward_runs_org_close_fixed_idx" ON "public"."reward_runs" USING "btree" ("org_id", "month_close_id", "fixed_at" DESC);



CREATE INDEX "reward_runs_org_status_fixed_idx" ON "public"."reward_runs" USING "btree" ("org_id", "status", "fixed_at" DESC);



CREATE UNIQUE INDEX "reward_runs_payout_posting_group_unique" ON "public"."reward_runs" USING "btree" ("payout_posting_group_id") WHERE ("payout_posting_group_id" IS NOT NULL);



CREATE UNIQUE INDEX "reward_runs_proposal_execution_unique" ON "public"."reward_runs" USING "btree" ("proposal_execution_id");



CREATE INDEX "reward_write_controls_org_mode_idx" ON "public"."reward_write_controls" USING "btree" ("org_id", "control_mode", "updated_at" DESC);



CREATE INDEX "site_closes_org_closed_idx" ON "public"."site_closes" USING "btree" ("org_id", "closed_at" DESC, "site_id");



CREATE INDEX "site_completion_events_org_site_created_idx" ON "public"."site_completion_events" USING "btree" ("org_id", "site_id", "created_at" DESC);



CREATE INDEX "site_completion_events_reversed_event_idx" ON "public"."site_completion_events" USING "btree" ("reversed_event_id") WHERE ("reversed_event_id" IS NOT NULL);



CREATE INDEX "site_day_logs_locked_idx" ON "public"."site_day_logs" USING "btree" ("locked_by_site_close_id") WHERE ("locked_by_site_close_id" IS NOT NULL);



CREATE INDEX "site_day_logs_org_date_idx" ON "public"."site_day_logs" USING "btree" ("org_id", "date" DESC, "site_id", "member_id");



CREATE UNIQUE INDEX "site_day_logs_org_date_site_member_uidx" ON "public"."site_day_logs" USING "btree" ("org_id", "date", "site_id", "member_id");



CREATE INDEX "site_line_items_site_id_idx" ON "public"."site_line_items" USING "btree" ("site_id");



CREATE INDEX "site_member_outcomes_org_close_idx" ON "public"."site_member_outcome_snapshots" USING "btree" ("org_id", "site_close_id", "member_id");



CREATE INDEX "site_member_reward_inputs_org_member_idx" ON "public"."site_member_reward_inputs" USING "btree" ("org_id", "member_id", "updated_at" DESC);



CREATE INDEX "site_member_reward_inputs_org_site_idx" ON "public"."site_member_reward_inputs" USING "btree" ("org_id", "site_id", "member_id");



CREATE INDEX "site_member_role_plans_org_member_idx" ON "public"."site_member_role_plans" USING "btree" ("org_id", "member_id", "updated_at" DESC);



CREATE INDEX "site_member_role_plans_org_site_idx" ON "public"."site_member_role_plans" USING "btree" ("org_id", "site_id", "member_id");



CREATE INDEX "sites_client_idx" ON "public"."sites" USING "btree" ("client_id");



CREATE INDEX "sites_date_range_idx" ON "public"."sites" USING "btree" ("start_date", "end_date") WHERE ("status" = ANY (ARRAY['active'::"text", 'planned'::"text"]));



CREATE INDEX "sites_deleted_at_idx" ON "public"."sites" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NOT NULL);



CREATE INDEX "sites_monster_archetype_idx" ON "public"."sites" USING "btree" ("monster_archetype");



CREATE INDEX "sites_org_id_idx" ON "public"."sites" USING "btree" ("org_id");



CREATE INDEX "sites_org_id_status_idx" ON "public"."sites" USING "btree" ("org_id", "status", "created_at" DESC);



CREATE INDEX "sites_status_idx" ON "public"."sites" USING "btree" ("status");



CREATE INDEX "skill_ledgers_org_member_idx" ON "public"."skill_ledgers" USING "btree" ("org_id", "member_id", "trade_family");



CREATE OR REPLACE TRIGGER "accounting_invoices_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."accounting_invoices" FOR EACH ROW EXECUTE FUNCTION "public"."accounting_audit_trigger"();



CREATE OR REPLACE TRIGGER "accounting_invoices_set_updated_at" BEFORE UPDATE ON "public"."accounting_invoices" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "accounting_journal_entries_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."accounting_journal_entries" FOR EACH ROW EXECUTE FUNCTION "public"."accounting_audit_trigger"();



CREATE OR REPLACE TRIGGER "accounting_journal_entries_prevent_fixed_reward_mutation" BEFORE DELETE OR UPDATE ON "public"."accounting_journal_entries" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_fixed_reward_run_line_mutation"();



CREATE OR REPLACE TRIGGER "accounting_journal_entries_set_updated_at" BEFORE UPDATE ON "public"."accounting_journal_entries" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "accounting_journal_lines_prevent_fixed_reward_mutation" BEFORE DELETE OR UPDATE ON "public"."accounting_journal_lines" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_fixed_reward_run_line_mutation"();



CREATE OR REPLACE TRIGGER "accounting_transactions_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."accounting_transactions" FOR EACH ROW EXECUTE FUNCTION "public"."accounting_audit_trigger"();



CREATE OR REPLACE TRIGGER "accounting_transactions_auto_assign_reviewer" BEFORE INSERT ON "public"."accounting_transactions" FOR EACH ROW EXECUTE FUNCTION "public"."accounting_auto_assign_reviewer"();



CREATE OR REPLACE TRIGGER "accounting_transactions_guard_void_chain" BEFORE INSERT OR UPDATE OF "status", "voids_transaction_id" ON "public"."accounting_transactions" FOR EACH ROW EXECUTE FUNCTION "public"."guard_accounting_void_chain"();



CREATE OR REPLACE TRIGGER "accounting_transactions_set_updated_at" BEFORE UPDATE ON "public"."accounting_transactions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "ai_proposals_set_updated_at" BEFORE UPDATE ON "public"."ai_proposals" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "clients_set_updated_at" BEFORE UPDATE ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "documents_set_updated_at" BEFORE UPDATE ON "public"."documents" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "member_business_profiles_set_updated_at" BEFORE UPDATE ON "public"."member_business_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "month_close_line_sources_prevent_fixed_mutation" BEFORE DELETE OR UPDATE ON "public"."month_close_line_sources" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_fixed_month_close_line_mutation"();



CREATE OR REPLACE TRIGGER "month_close_lines_prevent_fixed_mutation" BEFORE DELETE OR UPDATE ON "public"."month_close_lines" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_fixed_month_close_line_mutation"();



CREATE OR REPLACE TRIGGER "month_closes_prevent_fixed_mutation" BEFORE DELETE OR UPDATE ON "public"."month_closes" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_fixed_month_close_mutation"();



CREATE OR REPLACE TRIGGER "monthly_distribution_closes_set_updated_at" BEFORE UPDATE ON "public"."monthly_distribution_closes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "monthly_distribution_corrections_set_updated_at" BEFORE UPDATE ON "public"."monthly_distribution_corrections" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "monthly_distribution_lines_set_updated_at" BEFORE UPDATE ON "public"."monthly_distribution_lines" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "org_invites_set_updated_at" BEFORE UPDATE ON "public"."org_invites" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "org_invoice_settings_set_updated_at" BEFORE UPDATE ON "public"."org_invoice_settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "org_memberships_set_updated_at" BEFORE UPDATE ON "public"."org_memberships" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "organizations_set_updated_at" BEFORE UPDATE ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "path_ai_review_annotations_set_updated_at" BEFORE UPDATE ON "public"."path_ai_review_annotations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "path_monthly_close_inputs_set_updated_at" BEFORE UPDATE ON "public"."path_monthly_close_inputs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "path_opportunity_audits_set_updated_at" BEFORE UPDATE ON "public"."path_opportunity_audits" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "path_rule_versions_set_updated_at" BEFORE UPDATE ON "public"."path_rule_versions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "path_site_item_profit_snapshots_set_updated_at" BEFORE UPDATE ON "public"."path_site_item_profit_snapshots" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "path_trade_endorsements_set_updated_at" BEFORE UPDATE ON "public"."path_trade_endorsements" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "path_work_package_assignments_set_updated_at" BEFORE UPDATE ON "public"."path_work_package_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "path_work_packages_set_updated_at" BEFORE UPDATE ON "public"."path_work_packages" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "policies_set_updated_at" BEFORE UPDATE ON "public"."policies" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "policy_bundle_versions_set_updated_at" BEFORE UPDATE ON "public"."policy_bundle_versions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "posting_groups_prevent_fixed_reward_mutation" BEFORE DELETE OR UPDATE ON "public"."posting_groups" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_fixed_reward_run_line_mutation"();



CREATE OR REPLACE TRIGGER "proposals_canonical_reward_execution_guard" BEFORE UPDATE OF "status" ON "public"."proposals" FOR EACH ROW EXECUTE FUNCTION "public"."canonical_reward_execution_guard"();



CREATE OR REPLACE TRIGGER "proposals_path_evaluation_finalize_trigger" AFTER UPDATE ON "public"."proposals" FOR EACH ROW EXECUTE FUNCTION "public"."capture_path_evaluation_finalize"();



CREATE OR REPLACE TRIGGER "proposals_path_reward_snapshot_trigger" AFTER UPDATE ON "public"."proposals" FOR EACH ROW EXECUTE FUNCTION "public"."capture_path_reward_snapshot"();



CREATE OR REPLACE TRIGGER "proposals_set_updated_at" BEFORE UPDATE ON "public"."proposals" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "reward_confirmations_set_updated_at" BEFORE UPDATE ON "public"."reward_confirmations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "reward_run_lines_prevent_fixed_mutation" BEFORE DELETE OR UPDATE ON "public"."reward_run_lines" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_fixed_reward_run_line_mutation"();



CREATE OR REPLACE TRIGGER "reward_runs_prevent_fixed_mutation" BEFORE DELETE OR UPDATE ON "public"."reward_runs" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_fixed_reward_run_mutation"();



CREATE OR REPLACE TRIGGER "reward_write_controls_set_updated_at" BEFORE UPDATE ON "public"."reward_write_controls" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "site_closes_set_updated_at" BEFORE UPDATE ON "public"."site_closes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "site_day_logs_set_updated_at" BEFORE UPDATE ON "public"."site_day_logs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "site_member_outcomes_set_updated_at" BEFORE UPDATE ON "public"."site_member_outcome_snapshots" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "site_member_reward_inputs_set_updated_at" BEFORE UPDATE ON "public"."site_member_reward_inputs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "site_member_role_plans_set_updated_at" BEFORE UPDATE ON "public"."site_member_role_plans" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "skill_ledgers_set_updated_at" BEFORE UPDATE ON "public"."skill_ledgers" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_apply_personal_schedule_request_from_proposal" AFTER INSERT OR UPDATE OF "status" ON "public"."proposals" FOR EACH ROW EXECUTE FUNCTION "public"."apply_personal_schedule_request_from_proposal"();



CREATE OR REPLACE TRIGGER "trg_normalize_personal_schedule_row" BEFORE INSERT OR UPDATE ON "public"."personal_schedules" FOR EACH ROW EXECUTE FUNCTION "public"."normalize_personal_schedule_row"();



ALTER TABLE ONLY "public"."account_master"
    ADD CONSTRAINT "account_master_parent_code_fkey" FOREIGN KEY ("parent_code") REFERENCES "public"."account_master"("code");



ALTER TABLE ONLY "public"."accounting_audit_log"
    ADD CONSTRAINT "accounting_audit_log_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."accounting_invoice_sources"
    ADD CONSTRAINT "accounting_invoice_sources_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."accounting_invoices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."accounting_invoice_sources"
    ADD CONSTRAINT "accounting_invoice_sources_source_transaction_id_fkey" FOREIGN KEY ("source_transaction_id") REFERENCES "public"."accounting_transactions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."accounting_invoices"
    ADD CONSTRAINT "accounting_invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."accounting_invoices"
    ADD CONSTRAINT "accounting_invoices_source_transaction_id_fkey" FOREIGN KEY ("source_transaction_id") REFERENCES "public"."accounting_transactions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."accounting_invoices"
    ADD CONSTRAINT "accounting_invoices_supplements_invoice_id_fkey" FOREIGN KEY ("supplements_invoice_id") REFERENCES "public"."accounting_invoices"("id");



ALTER TABLE ONLY "public"."accounting_invoices"
    ADD CONSTRAINT "accounting_invoices_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."accounting_transactions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."accounting_journal_entries"
    ADD CONSTRAINT "accounting_journal_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."accounting_journal_entries"
    ADD CONSTRAINT "accounting_journal_entries_posting_group_id_fkey" FOREIGN KEY ("posting_group_id") REFERENCES "public"."posting_groups"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."accounting_journal_entries"
    ADD CONSTRAINT "accounting_journal_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."accounting_transactions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."accounting_journal_lines"
    ADD CONSTRAINT "accounting_journal_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "public"."accounting_journal_entries"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."accounting_journal_lines"
    ADD CONSTRAINT "accounting_journal_lines_revenue_basis_id_fkey" FOREIGN KEY ("revenue_basis_id") REFERENCES "public"."revenue_basis"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."accounting_journal_lines"
    ADD CONSTRAINT "accounting_journal_lines_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."accounting_transaction_items"
    ADD CONSTRAINT "accounting_transaction_items_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."accounting_transactions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."accounting_transactions"
    ADD CONSTRAINT "accounting_transactions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."accounting_transactions"
    ADD CONSTRAINT "accounting_transactions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."accounting_transactions"
    ADD CONSTRAINT "accounting_transactions_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."accounting_transactions"
    ADD CONSTRAINT "accounting_transactions_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id");



ALTER TABLE ONLY "public"."accounting_transactions"
    ADD CONSTRAINT "accounting_transactions_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id");



ALTER TABLE ONLY "public"."accounting_transactions"
    ADD CONSTRAINT "accounting_transactions_tax_category_fkey" FOREIGN KEY ("tax_category") REFERENCES "public"."tax_categories"("code");



ALTER TABLE ONLY "public"."accounting_transactions"
    ADD CONSTRAINT "accounting_transactions_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."accounting_transactions"
    ADD CONSTRAINT "accounting_transactions_voids_transaction_id_fkey" FOREIGN KEY ("voids_transaction_id") REFERENCES "public"."accounting_transactions"("id");



ALTER TABLE ONLY "public"."ai_proposals"
    ADD CONSTRAINT "ai_proposals_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."badge_application_votes"
    ADD CONSTRAINT "badge_application_votes_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."badge_applications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."badge_application_votes"
    ADD CONSTRAINT "badge_application_votes_voter_id_fkey" FOREIGN KEY ("voter_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."badge_applications"
    ADD CONSTRAINT "badge_applications_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."badge_states"
    ADD CONSTRAINT "badge_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."battle_log"
    ADD CONSTRAINT "battle_log_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."battle_log"
    ADD CONSTRAINT "battle_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."communication_conversations"
    ADD CONSTRAINT "communication_conversations_assignee_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."communication_conversations"
    ADD CONSTRAINT "communication_conversations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."communication_conversations"
    ADD CONSTRAINT "communication_conversations_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."communication_links"
    ADD CONSTRAINT "communication_links_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."communication_conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."communication_links"
    ADD CONSTRAINT "communication_links_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."communication_links"
    ADD CONSTRAINT "communication_links_log_id_fkey" FOREIGN KEY ("log_id") REFERENCES "public"."communication_logs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."communication_links"
    ADD CONSTRAINT "communication_links_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."communication_logs"
    ADD CONSTRAINT "communication_logs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."communication_conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."communication_logs"
    ADD CONSTRAINT "communication_logs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."communication_participants"
    ADD CONSTRAINT "communication_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."communication_conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."communication_participants"
    ADD CONSTRAINT "communication_participants_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."design_principles"
    ADD CONSTRAINT "design_principles_superseded_by_fkey" FOREIGN KEY ("superseded_by") REFERENCES "public"."design_principles"("id");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."finance_payout_postings"
    ADD CONSTRAINT "finance_payout_postings_accounting_entry_id_fkey" FOREIGN KEY ("accounting_entry_id") REFERENCES "public"."accounting_journal_entries"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."finance_payout_postings"
    ADD CONSTRAINT "finance_payout_postings_canonical_reward_run_id_fkey" FOREIGN KEY ("canonical_reward_run_id") REFERENCES "public"."reward_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."finance_payout_postings"
    ADD CONSTRAINT "finance_payout_postings_posting_group_id_fkey" FOREIGN KEY ("posting_group_id") REFERENCES "public"."posting_groups"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."finance_payout_postings"
    ADD CONSTRAINT "finance_payout_postings_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."finance_payout_postings"
    ADD CONSTRAINT "finance_payout_postings_reward_run_id_fkey" FOREIGN KEY ("reward_run_id") REFERENCES "public"."path_reward_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."focus_items"
    ADD CONSTRAINT "focus_items_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."focus_items"
    ADD CONSTRAINT "focus_items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."focus_items"
    ADD CONSTRAINT "focus_items_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."governance_events"
    ADD CONSTRAINT "governance_events_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lead_assignment_logs"
    ADD CONSTRAINT "lead_assignment_logs_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_assignment_logs"
    ADD CONSTRAINT "lead_assignment_logs_trade_family_fkey" FOREIGN KEY ("trade_family") REFERENCES "public"."trade_families"("key");



ALTER TABLE ONLY "public"."ledger_entries"
    ADD CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ledger_events"
    ADD CONSTRAINT "ledger_events_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ledger_transactions"
    ADD CONSTRAINT "ledger_transactions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."ledger_events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."luqo_reward_calculations"
    ADD CONSTRAINT "luqo_reward_calculations_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id");



ALTER TABLE ONLY "public"."luqo_skill_catalog"
    ADD CONSTRAINT "luqo_skill_catalog_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."luqo_categories"("id");



ALTER TABLE ONLY "public"."luqo_star_achievements"
    ADD CONSTRAINT "luqo_star_achievements_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id");



ALTER TABLE ONLY "public"."luqo_star_achievements"
    ADD CONSTRAINT "luqo_star_achievements_revoke_proposal_id_fkey" FOREIGN KEY ("revoke_proposal_id") REFERENCES "public"."proposals"("id");



ALTER TABLE ONLY "public"."luqo_star_achievements"
    ADD CONSTRAINT "luqo_star_achievements_star_id_fkey" FOREIGN KEY ("star_id") REFERENCES "public"."luqo_skill_catalog"("id");



ALTER TABLE ONLY "public"."monster_images"
    ADD CONSTRAINT "monster_images_archetype_id_fkey" FOREIGN KEY ("archetype_id") REFERENCES "public"."monster_archetypes"("id");



ALTER TABLE ONLY "public"."monster_images"
    ADD CONSTRAINT "monster_images_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."month_close_line_sources"
    ADD CONSTRAINT "month_close_line_sources_month_close_line_id_fkey" FOREIGN KEY ("month_close_line_id") REFERENCES "public"."month_close_lines"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."month_close_lines"
    ADD CONSTRAINT "month_close_lines_month_close_id_fkey" FOREIGN KEY ("month_close_id") REFERENCES "public"."month_closes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."month_close_lines"
    ADD CONSTRAINT "month_close_lines_revenue_basis_id_fkey" FOREIGN KEY ("revenue_basis_id") REFERENCES "public"."revenue_basis"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."month_close_lines"
    ADD CONSTRAINT "month_close_lines_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."month_close_lines"
    ADD CONSTRAINT "month_close_lines_source_income_posting_group_id_fkey" FOREIGN KEY ("source_income_posting_group_id") REFERENCES "public"."posting_groups"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."month_close_lines"
    ADD CONSTRAINT "month_close_lines_source_site_completion_event_id_fkey" FOREIGN KEY ("source_site_completion_event_id") REFERENCES "public"."site_completion_events"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."month_closes"
    ADD CONSTRAINT "month_closes_supersedes_month_close_id_fkey" FOREIGN KEY ("supersedes_month_close_id") REFERENCES "public"."month_closes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."monthly_distribution_closes"
    ADD CONSTRAINT "monthly_distribution_closes_canonical_month_close_id_fkey" FOREIGN KEY ("canonical_month_close_id") REFERENCES "public"."month_closes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."monthly_distribution_closes"
    ADD CONSTRAINT "monthly_distribution_closes_path_rule_version_id_fkey" FOREIGN KEY ("path_rule_version_id") REFERENCES "public"."path_rule_versions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."monthly_distribution_closes"
    ADD CONSTRAINT "monthly_distribution_closes_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."monthly_distribution_corrections"
    ADD CONSTRAINT "monthly_distribution_corrections_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."monthly_distribution_corrections"
    ADD CONSTRAINT "monthly_distribution_corrections_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."monthly_distribution_lines"
    ADD CONSTRAINT "monthly_distribution_lines_monthly_distribution_close_id_fkey" FOREIGN KEY ("monthly_distribution_close_id") REFERENCES "public"."monthly_distribution_closes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."monthly_evaluation_finalizations"
    ADD CONSTRAINT "monthly_evaluation_finalizations_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."org_invites"
    ADD CONSTRAINT "org_invites_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."org_invites"
    ADD CONSTRAINT "org_invites_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."org_invites"
    ADD CONSTRAINT "org_invites_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."org_invoice_settings"
    ADD CONSTRAINT "org_invoice_settings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."org_invoice_settings"
    ADD CONSTRAINT "org_invoice_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."org_memberships"
    ADD CONSTRAINT "org_memberships_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."org_memberships"
    ADD CONSTRAINT "org_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."path_assignment_restrictions"
    ADD CONSTRAINT "path_assignment_restrictions_source_proposal_id_fkey" FOREIGN KEY ("source_proposal_id") REFERENCES "public"."proposals"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."path_assignment_restrictions"
    ADD CONSTRAINT "path_assignment_restrictions_trade_family_fkey" FOREIGN KEY ("trade_family") REFERENCES "public"."trade_families"("key");



ALTER TABLE ONLY "public"."path_credited_units"
    ADD CONSTRAINT "path_credited_units_close_id_fkey" FOREIGN KEY ("close_id") REFERENCES "public"."path_month_closes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."path_evidence_records"
    ADD CONSTRAINT "path_evidence_records_trade_family_fkey" FOREIGN KEY ("trade_family") REFERENCES "public"."trade_families"("key");



ALTER TABLE ONLY "public"."path_explanation_snapshots"
    ADD CONSTRAINT "path_explanation_snapshots_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."path_explanation_snapshots"
    ADD CONSTRAINT "path_explanation_snapshots_reward_run_id_fkey" FOREIGN KEY ("reward_run_id") REFERENCES "public"."path_reward_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."path_month_closes"
    ADD CONSTRAINT "path_month_closes_policy_bundle_version_id_fkey" FOREIGN KEY ("policy_bundle_version_id") REFERENCES "public"."policy_bundle_versions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."path_month_closes"
    ADD CONSTRAINT "path_month_closes_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."path_opportunity_audits"
    ADD CONSTRAINT "path_opportunity_audits_source_proposal_id_fkey" FOREIGN KEY ("source_proposal_id") REFERENCES "public"."proposals"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."path_opportunity_audits"
    ADD CONSTRAINT "path_opportunity_audits_trade_family_fkey" FOREIGN KEY ("trade_family") REFERENCES "public"."trade_families"("key");



ALTER TABLE ONLY "public"."path_reward_runs"
    ADD CONSTRAINT "path_reward_runs_close_id_fkey" FOREIGN KEY ("close_id") REFERENCES "public"."path_month_closes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."path_reward_runs"
    ADD CONSTRAINT "path_reward_runs_correction_of_reward_run_id_fkey" FOREIGN KEY ("correction_of_reward_run_id") REFERENCES "public"."path_reward_runs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."path_reward_runs"
    ADD CONSTRAINT "path_reward_runs_policy_bundle_version_id_fkey" FOREIGN KEY ("policy_bundle_version_id") REFERENCES "public"."policy_bundle_versions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."path_reward_runs"
    ADD CONSTRAINT "path_reward_runs_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."path_site_item_profit_snapshots"
    ADD CONSTRAINT "path_site_item_profit_snapshots_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."path_site_item_profit_snapshots"
    ADD CONSTRAINT "path_site_item_profit_snapshots_trade_family_fkey" FOREIGN KEY ("trade_family") REFERENCES "public"."trade_families"("key");



ALTER TABLE ONLY "public"."path_trade_endorsements"
    ADD CONSTRAINT "path_trade_endorsements_source_proposal_id_fkey" FOREIGN KEY ("source_proposal_id") REFERENCES "public"."proposals"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."path_trade_endorsements"
    ADD CONSTRAINT "path_trade_endorsements_trade_family_fkey" FOREIGN KEY ("trade_family") REFERENCES "public"."trade_families"("key");



ALTER TABLE ONLY "public"."path_work_package_assignments"
    ADD CONSTRAINT "path_work_package_assignments_work_package_id_fkey" FOREIGN KEY ("work_package_id") REFERENCES "public"."path_work_packages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."path_work_packages"
    ADD CONSTRAINT "path_work_packages_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."path_work_packages"
    ADD CONSTRAINT "path_work_packages_site_item_profit_id_fkey" FOREIGN KEY ("site_item_profit_id") REFERENCES "public"."path_site_item_profit_snapshots"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."path_work_packages"
    ADD CONSTRAINT "path_work_packages_trade_family_fkey" FOREIGN KEY ("trade_family") REFERENCES "public"."trade_families"("key");



ALTER TABLE ONLY "public"."perk_application_votes"
    ADD CONSTRAINT "perk_application_votes_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."perk_applications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."perk_application_votes"
    ADD CONSTRAINT "perk_application_votes_voter_id_fkey" FOREIGN KEY ("voter_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."perk_applications"
    ADD CONSTRAINT "perk_applications_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."perk_applications"
    ADD CONSTRAINT "perk_applications_perk_id_fkey" FOREIGN KEY ("perk_id") REFERENCES "public"."perk_definitions"("id");



ALTER TABLE ONLY "public"."perk_states"
    ADD CONSTRAINT "perk_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."personal_schedules"
    ADD CONSTRAINT "personal_schedules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."policy_bundle_versions"
    ADD CONSTRAINT "policy_bundle_versions_published_proposal_id_fkey" FOREIGN KEY ("published_proposal_id") REFERENCES "public"."proposals"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."posting_groups"
    ADD CONSTRAINT "posting_groups_proposal_execution_id_fkey" FOREIGN KEY ("proposal_execution_id") REFERENCES "public"."proposal_executions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."posting_groups"
    ADD CONSTRAINT "posting_groups_revenue_basis_id_fkey" FOREIGN KEY ("revenue_basis_id") REFERENCES "public"."revenue_basis"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."posting_groups"
    ADD CONSTRAINT "posting_groups_reverses_posting_group_id_fkey" FOREIGN KEY ("reverses_posting_group_id") REFERENCES "public"."posting_groups"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."posting_groups"
    ADD CONSTRAINT "posting_groups_reward_run_id_fkey" FOREIGN KEY ("reward_run_id") REFERENCES "public"."reward_runs"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."principle_observations"
    ADD CONSTRAINT "principle_observations_principle_id_fkey" FOREIGN KEY ("principle_id") REFERENCES "public"."design_principles"("id");



ALTER TABLE ONLY "public"."principle_observations"
    ADD CONSTRAINT "principle_observations_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_current_site_id_fkey" FOREIGN KEY ("current_site_id") REFERENCES "public"."sites"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."proposal_executions"
    ADD CONSTRAINT "proposal_executions_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."proposals"
    ADD CONSTRAINT "proposals_adjusts_reward_run_id_fkey" FOREIGN KEY ("adjusts_reward_run_id") REFERENCES "public"."reward_runs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."proposals"
    ADD CONSTRAINT "proposals_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."proposals"
    ADD CONSTRAINT "proposals_month_close_id_fkey" FOREIGN KEY ("month_close_id") REFERENCES "public"."month_closes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."proposals"
    ADD CONSTRAINT "proposals_revenue_basis_id_fkey" FOREIGN KEY ("revenue_basis_id") REFERENCES "public"."revenue_basis"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."proposals"
    ADD CONSTRAINT "proposals_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."proposals"
    ADD CONSTRAINT "proposals_supersedes_proposal_id_fkey" FOREIGN KEY ("supersedes_proposal_id") REFERENCES "public"."proposals"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."revenue_basis"
    ADD CONSTRAINT "revenue_basis_origin_completion_event_id_fkey" FOREIGN KEY ("origin_completion_event_id") REFERENCES "public"."site_completion_events"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."revenue_basis"
    ADD CONSTRAINT "revenue_basis_reversed_by_event_id_fkey" FOREIGN KEY ("reversed_by_event_id") REFERENCES "public"."site_completion_events"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."revenue_basis"
    ADD CONSTRAINT "revenue_basis_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."reward_calculation_snapshots"
    ADD CONSTRAINT "reward_calculation_snapshots_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reward_confirmations"
    ADD CONSTRAINT "reward_confirmations_monthly_distribution_close_id_fkey" FOREIGN KEY ("monthly_distribution_close_id") REFERENCES "public"."monthly_distribution_closes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reward_run_lines"
    ADD CONSTRAINT "reward_run_lines_month_close_line_id_fkey" FOREIGN KEY ("month_close_line_id") REFERENCES "public"."month_close_lines"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reward_run_lines"
    ADD CONSTRAINT "reward_run_lines_revenue_basis_id_fkey" FOREIGN KEY ("revenue_basis_id") REFERENCES "public"."revenue_basis"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."reward_run_lines"
    ADD CONSTRAINT "reward_run_lines_reward_run_id_fkey" FOREIGN KEY ("reward_run_id") REFERENCES "public"."reward_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reward_runs"
    ADD CONSTRAINT "reward_runs_adjusts_reward_run_id_fkey" FOREIGN KEY ("adjusts_reward_run_id") REFERENCES "public"."reward_runs"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."reward_runs"
    ADD CONSTRAINT "reward_runs_month_close_id_fkey" FOREIGN KEY ("month_close_id") REFERENCES "public"."month_closes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."reward_runs"
    ADD CONSTRAINT "reward_runs_monthly_distribution_close_id_fkey" FOREIGN KEY ("monthly_distribution_close_id") REFERENCES "public"."monthly_distribution_closes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reward_runs"
    ADD CONSTRAINT "reward_runs_payout_posting_group_id_fkey" FOREIGN KEY ("payout_posting_group_id") REFERENCES "public"."posting_groups"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reward_runs"
    ADD CONSTRAINT "reward_runs_proposal_execution_id_fkey" FOREIGN KEY ("proposal_execution_id") REFERENCES "public"."proposal_executions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."site_closes"
    ADD CONSTRAINT "site_closes_path_rule_version_id_fkey" FOREIGN KEY ("path_rule_version_id") REFERENCES "public"."path_rule_versions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."site_closes"
    ADD CONSTRAINT "site_closes_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."site_closes"
    ADD CONSTRAINT "site_closes_reopened_by_proposal_id_fkey" FOREIGN KEY ("reopened_by_proposal_id") REFERENCES "public"."proposals"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."site_closes"
    ADD CONSTRAINT "site_closes_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."site_completion_events"
    ADD CONSTRAINT "site_completion_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."site_completion_events"
    ADD CONSTRAINT "site_completion_events_reversed_event_id_fkey" FOREIGN KEY ("reversed_event_id") REFERENCES "public"."site_completion_events"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."site_completion_events"
    ADD CONSTRAINT "site_completion_events_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."site_day_logs"
    ADD CONSTRAINT "site_day_logs_locked_by_site_close_id_fkey" FOREIGN KEY ("locked_by_site_close_id") REFERENCES "public"."site_closes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."site_day_logs"
    ADD CONSTRAINT "site_day_logs_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."site_line_items"
    ADD CONSTRAINT "site_line_items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."site_line_items"
    ADD CONSTRAINT "site_line_items_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."site_line_items"
    ADD CONSTRAINT "site_line_items_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."site_member_outcome_snapshots"
    ADD CONSTRAINT "site_member_outcome_snapshots_site_close_id_fkey" FOREIGN KEY ("site_close_id") REFERENCES "public"."site_closes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."site_member_reward_inputs"
    ADD CONSTRAINT "site_member_reward_inputs_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."site_member_role_plans"
    ADD CONSTRAINT "site_member_role_plans_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sites"
    ADD CONSTRAINT "sites_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."sites"
    ADD CONSTRAINT "sites_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."skill_ledgers"
    ADD CONSTRAINT "skill_ledgers_trade_family_fkey" FOREIGN KEY ("trade_family") REFERENCES "public"."trade_families"("key");



CREATE POLICY "Admins Manage AI Proposals" ON "public"."ai_proposals" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['admin'::"text", 'manager'::"text"]))))));



CREATE POLICY "Admins Read Config" ON "public"."system_config" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['admin'::"text", 'manager'::"text"]))))));



CREATE POLICY "Admins Write Config" ON "public"."system_config" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins Write Feature Flags" ON "public"."feature_flags" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Create Ledger Entries" ON "public"."ledger_entries" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Create Ledger Events" ON "public"."ledger_events" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Create Ledger Transactions" ON "public"."ledger_transactions" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Create Proposals" ON "public"."proposals" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Delete Accounting Invoice Sources" ON "public"."accounting_invoice_sources" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."accounting_invoices" "invoice"
  WHERE (("invoice"."id" = "accounting_invoice_sources"."invoice_id") AND (("invoice"."created_by" = "auth"."uid"()) OR "private"."has_org_role"(COALESCE("invoice"."org_id", '00000000-0000-0000-0000-000000000001'::"uuid"), ARRAY['admin'::"text"]))))));



CREATE POLICY "Delete Focus Items" ON "public"."focus_items" FOR DELETE TO "authenticated" USING (("private"."is_active_member"("org_id") AND (("scope" = 'org'::"text") OR ("created_by" = "auth"."uid"()))));



CREATE POLICY "Delete site_line_items" ON "public"."site_line_items" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sites" "site"
  WHERE (("site"."id" = "site_line_items"."site_id") AND "private"."is_active_member"("site"."org_id")))));



CREATE POLICY "Delete site_member_reward_inputs" ON "public"."site_member_reward_inputs" FOR DELETE TO "authenticated" USING ("private"."has_org_role"("org_id", ARRAY['admin'::"text"]));



CREATE POLICY "Delete site_member_role_plans" ON "public"."site_member_role_plans" FOR DELETE TO "authenticated" USING ("private"."has_org_role"("org_id", ARRAY['admin'::"text"]));



CREATE POLICY "Insert Accounting Invoice Sources" ON "public"."accounting_invoice_sources" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."accounting_invoices" "invoice"
  WHERE (("invoice"."id" = "accounting_invoice_sources"."invoice_id") AND (("invoice"."created_by" = "auth"."uid"()) OR "private"."has_org_role"(COALESCE("invoice"."org_id", '00000000-0000-0000-0000-000000000001'::"uuid"), ARRAY['admin'::"text"]))))));



CREATE POLICY "Insert Accounting Transaction Items" ON "public"."accounting_transaction_items" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert Accounting Transactions" ON "public"."accounting_transactions" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "created_by"));



CREATE POLICY "Insert Badge Applications" ON "public"."badge_applications" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "applicant_id"));



CREATE POLICY "Insert Badge Votes" ON "public"."badge_application_votes" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "voter_id"));



CREATE POLICY "Insert Communication Conversations" ON "public"."communication_conversations" FOR INSERT TO "authenticated" WITH CHECK ("private"."is_active_member"("org_id"));



CREATE POLICY "Insert Communication Links" ON "public"."communication_links" FOR INSERT TO "authenticated" WITH CHECK ("private"."is_active_member"("org_id"));



CREATE POLICY "Insert Communication Logs" ON "public"."communication_logs" FOR INSERT TO "authenticated" WITH CHECK ("private"."is_active_member"("org_id"));



CREATE POLICY "Insert Communication Participants" ON "public"."communication_participants" FOR INSERT TO "authenticated" WITH CHECK ("private"."is_active_member"("org_id"));



CREATE POLICY "Insert Documents" ON "public"."documents" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "uploaded_by"));



CREATE POLICY "Insert Focus Items" ON "public"."focus_items" FOR INSERT TO "authenticated" WITH CHECK (("private"."is_active_member"("org_id") AND ("created_by" = "auth"."uid"())));



CREATE POLICY "Insert Invoices" ON "public"."accounting_invoices" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "created_by"));



CREATE POLICY "Insert Journal Entries" ON "public"."accounting_journal_entries" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "created_by"));



CREATE POLICY "Insert Journal Lines" ON "public"."accounting_journal_lines" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."accounting_journal_entries" "e"
  WHERE (("e"."id" = "accounting_journal_lines"."entry_id") AND ("e"."created_by" = "auth"."uid"())))));



CREATE POLICY "Insert Org Invites As Admin" ON "public"."org_invites" FOR INSERT TO "authenticated" WITH CHECK ("private"."has_org_role"("org_id", ARRAY['admin'::"text"]));



CREATE POLICY "Insert Org Invoice Settings" ON "public"."org_invoice_settings" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "created_by") AND ("auth"."uid"() = "updated_by") AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'manager'::"text"])))))));



CREATE POLICY "Insert Own Schedules" ON "public"."personal_schedules" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Insert Perk Applications" ON "public"."perk_applications" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "applicant_id"));



CREATE POLICY "Insert Perk Votes" ON "public"."perk_application_votes" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "voter_id"));



CREATE POLICY "Insert Sites" ON "public"."sites" FOR INSERT TO "authenticated" WITH CHECK ("private"."is_active_member"("org_id"));



CREATE POLICY "Insert finance_payout_postings" ON "public"."finance_payout_postings" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert governance_events" ON "public"."governance_events" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert lead_assignment_logs" ON "public"."lead_assignment_logs" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert member_business_profiles" ON "public"."member_business_profiles" FOR INSERT TO "authenticated" WITH CHECK ("private"."has_org_role"("org_id", ARRAY['admin'::"text"]));



CREATE POLICY "Insert member_skill_certifications" ON "public"."member_skill_certifications" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert member_skill_profiles" ON "public"."member_skill_profiles" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert month_close_line_sources" ON "public"."month_close_line_sources" FOR INSERT TO "authenticated" WITH CHECK ("private"."is_active_member"("org_id"));



CREATE POLICY "Insert month_close_lines" ON "public"."month_close_lines" FOR INSERT TO "authenticated" WITH CHECK ("private"."is_active_member"("org_id"));



CREATE POLICY "Insert month_closes" ON "public"."month_closes" FOR INSERT TO "authenticated" WITH CHECK ("private"."is_active_member"("org_id"));



CREATE POLICY "Insert monthly_distribution_closes" ON "public"."monthly_distribution_closes" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert monthly_distribution_lines" ON "public"."monthly_distribution_lines" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert monthly_evaluation_ai_reviews" ON "public"."monthly_evaluation_ai_reviews" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert monthly_evaluation_confirmations" ON "public"."monthly_evaluation_confirmations" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert monthly_evaluation_finalizations" ON "public"."monthly_evaluation_finalizations" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert monthly_evaluation_forms" ON "public"."monthly_evaluation_forms" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert path_ai_review_annotations" ON "public"."path_ai_review_annotations" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert path_assignment_restrictions" ON "public"."path_assignment_restrictions" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert path_credited_units" ON "public"."path_credited_units" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert path_evidence_records" ON "public"."path_evidence_records" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert path_explanation_snapshots" ON "public"."path_explanation_snapshots" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert path_month_closes" ON "public"."path_month_closes" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert path_monthly_close_inputs" ON "public"."path_monthly_close_inputs" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert path_opportunity_audits" ON "public"."path_opportunity_audits" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert path_reward_runs" ON "public"."path_reward_runs" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert path_rule_versions" ON "public"."path_rule_versions" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert path_site_item_profit_snapshots" ON "public"."path_site_item_profit_snapshots" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert path_trade_endorsements" ON "public"."path_trade_endorsements" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert path_work_package_assignments" ON "public"."path_work_package_assignments" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert path_work_packages" ON "public"."path_work_packages" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert policy_bundle_versions" ON "public"."policy_bundle_versions" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert posting_groups" ON "public"."posting_groups" FOR INSERT TO "authenticated" WITH CHECK ("private"."is_active_member"("org_id"));



CREATE POLICY "Insert proposal_executions" ON "public"."proposal_executions" FOR INSERT TO "authenticated" WITH CHECK ("private"."is_active_member"("org_id"));



CREATE POLICY "Insert revenue_basis" ON "public"."revenue_basis" FOR INSERT TO "authenticated" WITH CHECK ("private"."is_active_member"("org_id"));



CREATE POLICY "Insert reward_confirmations" ON "public"."reward_confirmations" FOR INSERT TO "authenticated" WITH CHECK (("private"."is_active_member"("org_id") AND (("member_id" = "auth"."uid"()) OR "private"."has_org_role"("org_id", ARRAY['admin'::"text"]))));



CREATE POLICY "Insert reward_run_lines" ON "public"."reward_run_lines" FOR INSERT TO "authenticated" WITH CHECK ("private"."is_active_member"("org_id"));



CREATE POLICY "Insert reward_runs" ON "public"."reward_runs" FOR INSERT TO "authenticated" WITH CHECK ("private"."is_active_member"("org_id"));



CREATE POLICY "Insert site_closes" ON "public"."site_closes" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert site_completion_events" ON "public"."site_completion_events" FOR INSERT TO "authenticated" WITH CHECK ("private"."is_active_member"("org_id"));



CREATE POLICY "Insert site_day_logs" ON "public"."site_day_logs" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert site_line_items" ON "public"."site_line_items" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."sites" "site"
  WHERE (("site"."id" = "site_line_items"."site_id") AND "private"."is_active_member"("site"."org_id")))));



CREATE POLICY "Insert site_member_outcome_snapshots" ON "public"."site_member_outcome_snapshots" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Insert site_member_reward_inputs" ON "public"."site_member_reward_inputs" FOR INSERT TO "authenticated" WITH CHECK (("private"."is_active_member"("org_id") AND (("member_id" = "auth"."uid"()) OR "private"."has_org_role"("org_id", ARRAY['admin'::"text"])) AND (NOT (EXISTS ( SELECT 1
   FROM "public"."site_closes" "sc"
  WHERE (("sc"."org_id" = "site_member_reward_inputs"."org_id") AND ("sc"."site_id" = "site_member_reward_inputs"."site_id") AND ("sc"."status" = 'finalized'::"text")))))));



CREATE POLICY "Insert site_member_role_plans" ON "public"."site_member_role_plans" FOR INSERT TO "authenticated" WITH CHECK (("private"."is_active_member"("org_id") AND (("member_id" = "auth"."uid"()) OR "private"."has_org_role"("org_id", ARRAY['admin'::"text"])) AND (NOT (EXISTS ( SELECT 1
   FROM "public"."site_closes" "sc"
  WHERE (("sc"."org_id" = "site_member_role_plans"."org_id") AND ("sc"."site_id" = "site_member_role_plans"."site_id") AND ("sc"."status" = 'finalized'::"text")))))));



CREATE POLICY "Insert skill_ledgers" ON "public"."skill_ledgers" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Manage Policies" ON "public"."policies" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['admin'::"text", 'manager'::"text"]))))));



CREATE POLICY "Manage monthly_distribution_corrections" ON "public"."monthly_distribution_corrections" TO "authenticated" USING ("private"."has_org_role"("org_id", ARRAY['admin'::"text"])) WITH CHECK ("private"."has_org_role"("org_id", ARRAY['admin'::"text"]));



CREATE POLICY "Manage reward_write_controls" ON "public"."reward_write_controls" TO "authenticated" USING ("private"."has_org_role"("org_id", ARRAY['admin'::"text"])) WITH CHECK ("private"."has_org_role"("org_id", ARRAY['admin'::"text"]));



CREATE POLICY "Read AI Proposals" ON "public"."ai_proposals" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read Account Master" ON "public"."account_master" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read Accounting Invoice Sources" ON "public"."accounting_invoice_sources" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."accounting_invoices" "invoice"
  WHERE (("invoice"."id" = "accounting_invoice_sources"."invoice_id") AND "private"."is_active_member"(COALESCE("invoice"."org_id", '00000000-0000-0000-0000-000000000001'::"uuid"))))));



CREATE POLICY "Read Accounting Transaction Items" ON "public"."accounting_transaction_items" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read Accounting Transactions" ON "public"."accounting_transactions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read Audit Log" ON "public"."accounting_audit_log" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read Badge Applications" ON "public"."badge_applications" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read Badge States" ON "public"."badge_states" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read Badge Votes" ON "public"."badge_application_votes" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read Clients" ON "public"."clients" FOR SELECT TO "authenticated" USING ("private"."is_active_member"("org_id"));



CREATE POLICY "Read Communication Conversations" ON "public"."communication_conversations" FOR SELECT TO "authenticated" USING ("private"."is_active_member"("org_id"));



CREATE POLICY "Read Communication Links" ON "public"."communication_links" FOR SELECT TO "authenticated" USING ("private"."is_active_member"("org_id"));



CREATE POLICY "Read Communication Logs" ON "public"."communication_logs" FOR SELECT TO "authenticated" USING ("private"."is_active_member"("org_id"));



CREATE POLICY "Read Communication Participants" ON "public"."communication_participants" FOR SELECT TO "authenticated" USING ("private"."is_active_member"("org_id"));



CREATE POLICY "Read Documents" ON "public"."documents" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read Feature Flags" ON "public"."feature_flags" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read Focus Items" ON "public"."focus_items" FOR SELECT TO "authenticated" USING (("private"."is_active_member"("org_id") AND (("scope" = 'org'::"text") OR ("created_by" = "auth"."uid"()))));



CREATE POLICY "Read Invoice Sequences" ON "public"."invoice_number_sequences" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read Invoices" ON "public"."accounting_invoices" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read Journal Entries" ON "public"."accounting_journal_entries" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read Journal Lines" ON "public"."accounting_journal_lines" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read Ledger Entries" ON "public"."ledger_entries" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read Ledger Events" ON "public"."ledger_events" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read Ledger Transactions" ON "public"."ledger_transactions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read Org Invites As Admin" ON "public"."org_invites" FOR SELECT TO "authenticated" USING ("private"."has_org_role"("org_id", ARRAY['admin'::"text"]));



CREATE POLICY "Read Org Invoice Settings" ON "public"."org_invoice_settings" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read Organizations" ON "public"."organizations" FOR SELECT TO "authenticated" USING ("private"."is_active_member"("id"));



CREATE POLICY "Read Own Notifications" ON "public"."notifications" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Read Own Org Memberships" ON "public"."org_memberships" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Read Own Schedules" ON "public"."personal_schedules" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Read Perk Applications" ON "public"."perk_applications" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read Perk Definitions" ON "public"."perk_definitions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read Perk States" ON "public"."perk_states" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read Perk Votes" ON "public"."perk_application_votes" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read Policies" ON "public"."policies" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read Profiles" ON "public"."profiles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read Proposals" ON "public"."proposals" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read Sites" ON "public"."sites" FOR SELECT TO "authenticated" USING ("private"."is_active_member"("org_id"));



CREATE POLICY "Read Tax Categories" ON "public"."tax_categories" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read finance_payout_postings" ON "public"."finance_payout_postings" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read governance_events" ON "public"."governance_events" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read lead_assignment_logs" ON "public"."lead_assignment_logs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read member_business_profiles" ON "public"."member_business_profiles" FOR SELECT TO "authenticated" USING (("private"."is_active_member"("org_id") AND (("member_id" = "auth"."uid"()) OR "private"."has_org_role"("org_id", ARRAY['admin'::"text"]))));



CREATE POLICY "Read member_skill_certifications" ON "public"."member_skill_certifications" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read member_skill_profiles" ON "public"."member_skill_profiles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read month_close_line_sources" ON "public"."month_close_line_sources" FOR SELECT TO "authenticated" USING ("private"."is_active_member"("org_id"));



CREATE POLICY "Read month_close_lines" ON "public"."month_close_lines" FOR SELECT TO "authenticated" USING ("private"."is_active_member"("org_id"));



CREATE POLICY "Read month_closes" ON "public"."month_closes" FOR SELECT TO "authenticated" USING ("private"."is_active_member"("org_id"));



CREATE POLICY "Read monthly_distribution_closes" ON "public"."monthly_distribution_closes" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read monthly_distribution_corrections" ON "public"."monthly_distribution_corrections" FOR SELECT TO "authenticated" USING (("private"."is_active_member"("org_id") AND (("member_id" = "auth"."uid"()) OR "private"."has_org_role"("org_id", ARRAY['admin'::"text"]))));



CREATE POLICY "Read monthly_distribution_lines" ON "public"."monthly_distribution_lines" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read monthly_evaluation_ai_reviews" ON "public"."monthly_evaluation_ai_reviews" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read monthly_evaluation_confirmations" ON "public"."monthly_evaluation_confirmations" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read monthly_evaluation_finalizations" ON "public"."monthly_evaluation_finalizations" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read monthly_evaluation_forms" ON "public"."monthly_evaluation_forms" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read path_ai_review_annotations" ON "public"."path_ai_review_annotations" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read path_assignment_restrictions" ON "public"."path_assignment_restrictions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read path_credited_units" ON "public"."path_credited_units" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read path_evidence_records" ON "public"."path_evidence_records" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read path_explanation_snapshots" ON "public"."path_explanation_snapshots" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read path_month_closes" ON "public"."path_month_closes" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read path_monthly_close_inputs" ON "public"."path_monthly_close_inputs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read path_opportunity_audits" ON "public"."path_opportunity_audits" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read path_reward_runs" ON "public"."path_reward_runs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read path_rule_versions" ON "public"."path_rule_versions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read path_site_item_profit_snapshots" ON "public"."path_site_item_profit_snapshots" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read path_trade_endorsements" ON "public"."path_trade_endorsements" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read path_work_package_assignments" ON "public"."path_work_package_assignments" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read path_work_packages" ON "public"."path_work_packages" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read policy_bundle_versions" ON "public"."policy_bundle_versions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read posting_groups" ON "public"."posting_groups" FOR SELECT TO "authenticated" USING ("private"."is_active_member"("org_id"));



CREATE POLICY "Read proposal_executions" ON "public"."proposal_executions" FOR SELECT TO "authenticated" USING ("private"."is_active_member"("org_id"));



CREATE POLICY "Read revenue_basis" ON "public"."revenue_basis" FOR SELECT TO "authenticated" USING ("private"."is_active_member"("org_id"));



CREATE POLICY "Read reward_calculation_snapshots" ON "public"."reward_calculation_snapshots" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read reward_confirmations" ON "public"."reward_confirmations" FOR SELECT TO "authenticated" USING (("private"."is_active_member"("org_id") AND (("member_id" = "auth"."uid"()) OR "private"."has_org_role"("org_id", ARRAY['admin'::"text"]))));



CREATE POLICY "Read reward_run_lines" ON "public"."reward_run_lines" FOR SELECT TO "authenticated" USING ("private"."is_active_member"("org_id"));



CREATE POLICY "Read reward_runs" ON "public"."reward_runs" FOR SELECT TO "authenticated" USING ("private"."is_active_member"("org_id"));



CREATE POLICY "Read reward_write_controls" ON "public"."reward_write_controls" FOR SELECT TO "authenticated" USING ("private"."is_active_member"("org_id"));



CREATE POLICY "Read site_closes" ON "public"."site_closes" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read site_completion_events" ON "public"."site_completion_events" FOR SELECT TO "authenticated" USING ("private"."is_active_member"("org_id"));



CREATE POLICY "Read site_day_logs" ON "public"."site_day_logs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read site_line_items" ON "public"."site_line_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sites" "site"
  WHERE (("site"."id" = "site_line_items"."site_id") AND "private"."is_active_member"("site"."org_id")))));



CREATE POLICY "Read site_member_outcome_snapshots" ON "public"."site_member_outcome_snapshots" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read site_member_reward_inputs" ON "public"."site_member_reward_inputs" FOR SELECT TO "authenticated" USING ("private"."is_active_member"("org_id"));



CREATE POLICY "Read site_member_role_plans" ON "public"."site_member_role_plans" FOR SELECT TO "authenticated" USING ("private"."is_active_member"("org_id"));



CREATE POLICY "Read skill_ledgers" ON "public"."skill_ledgers" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Read trade_families" ON "public"."trade_families" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Update Accounting Invoice Sources" ON "public"."accounting_invoice_sources" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."accounting_invoices" "invoice"
  WHERE (("invoice"."id" = "accounting_invoice_sources"."invoice_id") AND (("invoice"."created_by" = "auth"."uid"()) OR "private"."has_org_role"(COALESCE("invoice"."org_id", '00000000-0000-0000-0000-000000000001'::"uuid"), ARRAY['admin'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."accounting_invoices" "invoice"
  WHERE (("invoice"."id" = "accounting_invoice_sources"."invoice_id") AND (("invoice"."created_by" = "auth"."uid"()) OR "private"."has_org_role"(COALESCE("invoice"."org_id", '00000000-0000-0000-0000-000000000001'::"uuid"), ARRAY['admin'::"text"]))))));



CREATE POLICY "Update Accounting Transaction Items" ON "public"."accounting_transaction_items" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Update Accounting Transactions" ON "public"."accounting_transactions" FOR UPDATE TO "authenticated" USING ((("auth"."uid"() = "created_by") OR ("auth"."uid"() = "reviewer_id")));



CREATE POLICY "Update Badge Applications" ON "public"."badge_applications" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Update Badge States" ON "public"."badge_states" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Update Communication Conversations" ON "public"."communication_conversations" FOR UPDATE TO "authenticated" USING ("private"."is_active_member"("org_id")) WITH CHECK ("private"."is_active_member"("org_id"));



CREATE POLICY "Update Communication Logs" ON "public"."communication_logs" FOR UPDATE TO "authenticated" USING ("private"."is_active_member"("org_id")) WITH CHECK ("private"."is_active_member"("org_id"));



CREATE POLICY "Update Communication Participants" ON "public"."communication_participants" FOR UPDATE TO "authenticated" USING ("private"."is_active_member"("org_id")) WITH CHECK ("private"."is_active_member"("org_id"));



CREATE POLICY "Update Documents" ON "public"."documents" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "uploaded_by"));



CREATE POLICY "Update Focus Items" ON "public"."focus_items" FOR UPDATE TO "authenticated" USING (("private"."is_active_member"("org_id") AND (("scope" = 'org'::"text") OR ("created_by" = "auth"."uid"())))) WITH CHECK (("private"."is_active_member"("org_id") AND (("scope" = 'org'::"text") OR ("created_by" = "auth"."uid"()))));



CREATE POLICY "Update Invoices" ON "public"."accounting_invoices" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "created_by"));



CREATE POLICY "Update Journal Entries" ON "public"."accounting_journal_entries" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "created_by"));



CREATE POLICY "Update Journal Lines" ON "public"."accounting_journal_lines" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."accounting_journal_entries" "e"
  WHERE (("e"."id" = "accounting_journal_lines"."entry_id") AND ("e"."created_by" = "auth"."uid"())))));



CREATE POLICY "Update Org Invites As Admin" ON "public"."org_invites" FOR UPDATE TO "authenticated" USING ("private"."has_org_role"("org_id", ARRAY['admin'::"text"])) WITH CHECK ("private"."has_org_role"("org_id", ARRAY['admin'::"text"]));



CREATE POLICY "Update Org Invoice Settings" ON "public"."org_invoice_settings" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'manager'::"text"])))))) WITH CHECK ((("auth"."uid"() = "updated_by") AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'manager'::"text"])))))));



CREATE POLICY "Update Organizations" ON "public"."organizations" FOR UPDATE TO "authenticated" USING ("private"."has_org_role"("id", ARRAY['admin'::"text"])) WITH CHECK ("private"."has_org_role"("id", ARRAY['admin'::"text"]));



CREATE POLICY "Update Own Notifications" ON "public"."notifications" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Update Own Schedules" ON "public"."personal_schedules" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Update Profiles" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id"));



CREATE POLICY "Update Proposals" ON "public"."proposals" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Update Sites" ON "public"."sites" FOR UPDATE TO "authenticated" USING ("private"."is_active_member"("org_id")) WITH CHECK ("private"."is_active_member"("org_id"));



CREATE POLICY "Update member_business_profiles" ON "public"."member_business_profiles" FOR UPDATE TO "authenticated" USING ("private"."has_org_role"("org_id", ARRAY['admin'::"text"])) WITH CHECK ("private"."has_org_role"("org_id", ARRAY['admin'::"text"]));



CREATE POLICY "Update member_skill_certifications" ON "public"."member_skill_certifications" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Update member_skill_profiles" ON "public"."member_skill_profiles" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Update month_close_line_sources" ON "public"."month_close_line_sources" FOR UPDATE TO "authenticated" USING ("private"."is_active_member"("org_id")) WITH CHECK ("private"."is_active_member"("org_id"));



CREATE POLICY "Update month_close_lines" ON "public"."month_close_lines" FOR UPDATE TO "authenticated" USING ("private"."is_active_member"("org_id")) WITH CHECK ("private"."is_active_member"("org_id"));



CREATE POLICY "Update month_closes" ON "public"."month_closes" FOR UPDATE TO "authenticated" USING ("private"."is_active_member"("org_id")) WITH CHECK ("private"."is_active_member"("org_id"));



CREATE POLICY "Update monthly_distribution_closes" ON "public"."monthly_distribution_closes" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Update monthly_distribution_lines" ON "public"."monthly_distribution_lines" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Update monthly_evaluation_ai_reviews" ON "public"."monthly_evaluation_ai_reviews" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Update monthly_evaluation_confirmations" ON "public"."monthly_evaluation_confirmations" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Update monthly_evaluation_finalizations" ON "public"."monthly_evaluation_finalizations" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Update monthly_evaluation_forms" ON "public"."monthly_evaluation_forms" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Update path_ai_review_annotations" ON "public"."path_ai_review_annotations" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Update path_monthly_close_inputs" ON "public"."path_monthly_close_inputs" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Update path_opportunity_audits" ON "public"."path_opportunity_audits" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Update path_reward_runs" ON "public"."path_reward_runs" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Update path_rule_versions" ON "public"."path_rule_versions" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Update path_site_item_profit_snapshots" ON "public"."path_site_item_profit_snapshots" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Update path_trade_endorsements" ON "public"."path_trade_endorsements" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Update path_work_package_assignments" ON "public"."path_work_package_assignments" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Update path_work_packages" ON "public"."path_work_packages" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Update policy_bundle_versions" ON "public"."policy_bundle_versions" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Update proposal_executions" ON "public"."proposal_executions" FOR UPDATE TO "authenticated" USING ("private"."is_active_member"("org_id")) WITH CHECK ("private"."is_active_member"("org_id"));



CREATE POLICY "Update revenue_basis" ON "public"."revenue_basis" FOR UPDATE TO "authenticated" USING ("private"."is_active_member"("org_id")) WITH CHECK ("private"."is_active_member"("org_id"));



CREATE POLICY "Update reward_confirmations" ON "public"."reward_confirmations" FOR UPDATE TO "authenticated" USING (("private"."is_active_member"("org_id") AND (("member_id" = "auth"."uid"()) OR "private"."has_org_role"("org_id", ARRAY['admin'::"text"])))) WITH CHECK (("private"."is_active_member"("org_id") AND (("member_id" = "auth"."uid"()) OR "private"."has_org_role"("org_id", ARRAY['admin'::"text"]))));



CREATE POLICY "Update reward_run_lines" ON "public"."reward_run_lines" FOR UPDATE TO "authenticated" USING ("private"."is_active_member"("org_id")) WITH CHECK ("private"."is_active_member"("org_id"));



CREATE POLICY "Update reward_runs" ON "public"."reward_runs" FOR UPDATE TO "authenticated" USING ("private"."is_active_member"("org_id")) WITH CHECK ("private"."is_active_member"("org_id"));



CREATE POLICY "Update site_closes" ON "public"."site_closes" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Update site_day_logs" ON "public"."site_day_logs" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Update site_line_items" ON "public"."site_line_items" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sites" "site"
  WHERE (("site"."id" = "site_line_items"."site_id") AND "private"."is_active_member"("site"."org_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."sites" "site"
  WHERE (("site"."id" = "site_line_items"."site_id") AND "private"."is_active_member"("site"."org_id")))));



CREATE POLICY "Update site_member_outcome_snapshots" ON "public"."site_member_outcome_snapshots" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Update site_member_reward_inputs" ON "public"."site_member_reward_inputs" FOR UPDATE TO "authenticated" USING (("private"."is_active_member"("org_id") AND (("member_id" = "auth"."uid"()) OR "private"."has_org_role"("org_id", ARRAY['admin'::"text"])) AND (NOT (EXISTS ( SELECT 1
   FROM "public"."site_closes" "sc"
  WHERE (("sc"."org_id" = "site_member_reward_inputs"."org_id") AND ("sc"."site_id" = "site_member_reward_inputs"."site_id") AND ("sc"."status" = 'finalized'::"text"))))))) WITH CHECK (("private"."is_active_member"("org_id") AND (("member_id" = "auth"."uid"()) OR "private"."has_org_role"("org_id", ARRAY['admin'::"text"])) AND (NOT (EXISTS ( SELECT 1
   FROM "public"."site_closes" "sc"
  WHERE (("sc"."org_id" = "site_member_reward_inputs"."org_id") AND ("sc"."site_id" = "site_member_reward_inputs"."site_id") AND ("sc"."status" = 'finalized'::"text")))))));



CREATE POLICY "Update site_member_role_plans" ON "public"."site_member_role_plans" FOR UPDATE TO "authenticated" USING (("private"."is_active_member"("org_id") AND (("member_id" = "auth"."uid"()) OR "private"."has_org_role"("org_id", ARRAY['admin'::"text"])) AND (NOT (EXISTS ( SELECT 1
   FROM "public"."site_closes" "sc"
  WHERE (("sc"."org_id" = "site_member_role_plans"."org_id") AND ("sc"."site_id" = "site_member_role_plans"."site_id") AND ("sc"."status" = 'finalized'::"text"))))))) WITH CHECK (("private"."is_active_member"("org_id") AND (("member_id" = "auth"."uid"()) OR "private"."has_org_role"("org_id", ARRAY['admin'::"text"])) AND (NOT (EXISTS ( SELECT 1
   FROM "public"."site_closes" "sc"
  WHERE (("sc"."org_id" = "site_member_role_plans"."org_id") AND ("sc"."site_id" = "site_member_role_plans"."site_id") AND ("sc"."status" = 'finalized'::"text")))))));



CREATE POLICY "Update skill_ledgers" ON "public"."skill_ledgers" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Upsert Badge States" ON "public"."badge_states" FOR INSERT TO "authenticated" WITH CHECK (true);



ALTER TABLE "public"."account_master" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accounting_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accounting_invoice_sources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accounting_invoices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accounting_journal_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accounting_journal_lines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accounting_transaction_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accounting_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_proposals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."badge_application_votes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."badge_applications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."badge_states" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."battle_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "battle_log_insert" ON "public"."battle_log" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "battle_log_select" ON "public"."battle_log" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."communication_conversations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."communication_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."communication_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."communication_participants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."design_principles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "design_principles_insert" ON "public"."design_principles" FOR INSERT TO "service_role" WITH CHECK (true);



CREATE POLICY "design_principles_select" ON "public"."design_principles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "design_principles_update" ON "public"."design_principles" FOR UPDATE TO "service_role" USING (true);



ALTER TABLE "public"."documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feature_flags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."finance_payout_postings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."focus_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gmail_message_processing" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."governance_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice_number_sequences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lead_assignment_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ledger_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ledger_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ledger_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."luqo_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."luqo_period_scores" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."luqo_reward_calculations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."luqo_skill_catalog" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."luqo_star_achievements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."member_business_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."member_skill_certifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."member_skill_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."monster_archetypes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "monster_archetypes_select" ON "public"."monster_archetypes" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."monster_images" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "monster_images_insert" ON "public"."monster_images" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "monster_images_select" ON "public"."monster_images" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "monster_images_update" ON "public"."monster_images" FOR UPDATE TO "authenticated" USING (true);



ALTER TABLE "public"."month_close_line_sources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."month_close_lines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."month_closes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."monthly_distribution_closes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."monthly_distribution_corrections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."monthly_distribution_lines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."monthly_evaluation_ai_reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."monthly_evaluation_confirmations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."monthly_evaluation_finalizations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."monthly_evaluation_forms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ocr_cache" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "org members can insert luqo_categories" ON "public"."luqo_categories" FOR INSERT WITH CHECK (true);



CREATE POLICY "org members can insert luqo_period_scores" ON "public"."luqo_period_scores" FOR INSERT WITH CHECK (true);



CREATE POLICY "org members can insert luqo_reward_calculations" ON "public"."luqo_reward_calculations" FOR INSERT WITH CHECK (true);



CREATE POLICY "org members can insert luqo_skill_catalog" ON "public"."luqo_skill_catalog" FOR INSERT WITH CHECK (true);



CREATE POLICY "org members can insert luqo_star_achievements" ON "public"."luqo_star_achievements" FOR INSERT WITH CHECK (true);



CREATE POLICY "org members can update luqo_period_scores" ON "public"."luqo_period_scores" FOR UPDATE USING (true);



CREATE POLICY "org members can update luqo_reward_calculations" ON "public"."luqo_reward_calculations" FOR UPDATE USING (true);



CREATE POLICY "org members can update luqo_skill_catalog" ON "public"."luqo_skill_catalog" FOR UPDATE USING (true);



CREATE POLICY "org members can update luqo_star_achievements" ON "public"."luqo_star_achievements" FOR UPDATE USING (true);



CREATE POLICY "org members can view luqo_categories" ON "public"."luqo_categories" FOR SELECT USING (true);



CREATE POLICY "org members can view luqo_period_scores" ON "public"."luqo_period_scores" FOR SELECT USING (true);



CREATE POLICY "org members can view luqo_reward_calculations" ON "public"."luqo_reward_calculations" FOR SELECT USING (true);



CREATE POLICY "org members can view luqo_skill_catalog" ON "public"."luqo_skill_catalog" FOR SELECT USING (true);



CREATE POLICY "org members can view luqo_star_achievements" ON "public"."luqo_star_achievements" FOR SELECT USING (true);



ALTER TABLE "public"."org_invites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."org_invoice_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."org_memberships" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."path_ai_review_annotations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."path_assignment_restrictions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."path_credited_units" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."path_evidence_records" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."path_explanation_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."path_month_closes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."path_monthly_close_inputs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."path_opportunity_audits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."path_reward_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."path_rule_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."path_site_item_profit_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."path_trade_endorsements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."path_work_package_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."path_work_packages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."perk_application_votes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."perk_applications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."perk_definitions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."perk_states" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."personal_schedules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."policies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."policy_bundle_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."posting_groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."principle_observations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "principle_observations_insert" ON "public"."principle_observations" FOR INSERT TO "service_role" WITH CHECK (true);



CREATE POLICY "principle_observations_select" ON "public"."principle_observations" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."proposal_executions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."proposals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."revenue_basis" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reward_calculation_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reward_confirmations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reward_run_lines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reward_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reward_write_controls" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "service_role_manage_gmail_message_processing" ON "public"."gmail_message_processing" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_manage_ocr_cache" ON "public"."ocr_cache" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."site_closes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."site_completion_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."site_day_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."site_line_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."site_member_outcome_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."site_member_reward_inputs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."site_member_role_plans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."skill_ledgers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."system_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tax_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."trade_families" ENABLE ROW LEVEL SECURITY;




GRANT USAGE ON SCHEMA "private" TO "authenticated";
GRANT USAGE ON SCHEMA "private" TO "service_role";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































REVOKE ALL ON FUNCTION "private"."has_org_role"("p_org_id" "uuid", "p_roles" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."has_org_role"("p_org_id" "uuid", "p_roles" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "private"."has_org_role"("p_org_id" "uuid", "p_roles" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "private"."is_active_member"("p_org_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_active_member"("p_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "private"."is_active_member"("p_org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."accounting_audit_trigger"() TO "anon";
GRANT ALL ON FUNCTION "public"."accounting_audit_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."accounting_audit_trigger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."accounting_auto_assign_reviewer"() TO "anon";
GRANT ALL ON FUNCTION "public"."accounting_auto_assign_reviewer"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."accounting_auto_assign_reviewer"() TO "service_role";



GRANT ALL ON FUNCTION "public"."apply_personal_schedule_request_from_proposal"() TO "anon";
GRANT ALL ON FUNCTION "public"."apply_personal_schedule_request_from_proposal"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_personal_schedule_request_from_proposal"() TO "service_role";



GRANT ALL ON FUNCTION "public"."approve_proposal_atomic"("p_org_id" "uuid", "p_proposal_id" "uuid", "p_approver" "jsonb", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."approve_proposal_atomic"("p_org_id" "uuid", "p_proposal_id" "uuid", "p_approver" "jsonb", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."approve_proposal_atomic"("p_org_id" "uuid", "p_proposal_id" "uuid", "p_approver" "jsonb", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."assert_reward_write_allowed"("p_org_id" "uuid", "p_route_key" "text", "p_proposal_type" "text", "p_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."assert_reward_write_allowed"("p_org_id" "uuid", "p_route_key" "text", "p_proposal_type" "text", "p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."assert_reward_write_allowed"("p_org_id" "uuid", "p_route_key" "text", "p_proposal_type" "text", "p_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."bootstrap_first_org"("p_user_id" "uuid", "p_name" "text", "p_slug" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."bootstrap_first_org"("p_user_id" "uuid", "p_name" "text", "p_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bootstrap_first_org"("p_user_id" "uuid", "p_name" "text", "p_slug" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."bootstrap_org"("p_user_id" "uuid", "p_name" "text", "p_slug" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."bootstrap_org"("p_user_id" "uuid", "p_name" "text", "p_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bootstrap_org"("p_user_id" "uuid", "p_name" "text", "p_slug" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."canonical_reward_execution_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."canonical_reward_execution_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."canonical_reward_execution_guard"() TO "service_role";



GRANT ALL ON FUNCTION "public"."capture_path_evaluation_finalize"() TO "anon";
GRANT ALL ON FUNCTION "public"."capture_path_evaluation_finalize"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."capture_path_evaluation_finalize"() TO "service_role";



GRANT ALL ON FUNCTION "public"."capture_path_reward_snapshot"() TO "anon";
GRANT ALL ON FUNCTION "public"."capture_path_reward_snapshot"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."capture_path_reward_snapshot"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_journal_balance"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_journal_balance"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_journal_balance"() TO "service_role";



GRANT ALL ON FUNCTION "public"."complete_site_rpc"("p_org_id" "uuid", "p_site_id" "uuid", "p_actor_user_id" "uuid", "p_effective_completed_at" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."complete_site_rpc"("p_org_id" "uuid", "p_site_id" "uuid", "p_actor_user_id" "uuid", "p_effective_completed_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_site_rpc"("p_org_id" "uuid", "p_site_id" "uuid", "p_actor_user_id" "uuid", "p_effective_completed_at" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."execute_proposal_atomic"("p_org_id" "uuid", "p_proposal_id" "uuid", "p_executor" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."execute_proposal_atomic"("p_org_id" "uuid", "p_proposal_id" "uuid", "p_executor" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."execute_proposal_atomic"("p_org_id" "uuid", "p_proposal_id" "uuid", "p_executor" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."find_proposal_id_by_idempotency_key"("p_org_id" "uuid", "p_idempotency_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."find_proposal_id_by_idempotency_key"("p_org_id" "uuid", "p_idempotency_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_proposal_id_by_idempotency_key"("p_org_id" "uuid", "p_idempotency_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_jp_fiscal_year"("d" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."get_jp_fiscal_year"("d" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_jp_fiscal_year"("d" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."guard_accounting_void_chain"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_accounting_void_chain"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_accounting_void_chain"() TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_personal_schedule_row"() TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_personal_schedule_row"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_personal_schedule_row"() TO "service_role";



GRANT ALL ON FUNCTION "public"."path_role_shares_valid"("p_role_shares" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."path_role_shares_valid"("p_role_shares" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."path_role_shares_valid"("p_role_shares" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_fixed_month_close_line_mutation"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_fixed_month_close_line_mutation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_fixed_month_close_line_mutation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_fixed_month_close_mutation"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_fixed_month_close_mutation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_fixed_month_close_mutation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_fixed_reward_run_line_mutation"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_fixed_reward_run_line_mutation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_fixed_reward_run_line_mutation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_fixed_reward_run_mutation"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_fixed_reward_run_mutation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_fixed_reward_run_mutation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."reject_proposal_atomic"("p_org_id" "uuid", "p_proposal_id" "uuid", "p_rejector" "jsonb", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reject_proposal_atomic"("p_org_id" "uuid", "p_proposal_id" "uuid", "p_rejector" "jsonb", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reject_proposal_atomic"("p_org_id" "uuid", "p_proposal_id" "uuid", "p_rejector" "jsonb", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."reverse_site_completion_rpc"("p_org_id" "uuid", "p_site_id" "uuid", "p_actor_user_id" "uuid", "p_effective_reversed_at" timestamp with time zone, "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reverse_site_completion_rpc"("p_org_id" "uuid", "p_site_id" "uuid", "p_actor_user_id" "uuid", "p_effective_reversed_at" timestamp with time zone, "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reverse_site_completion_rpc"("p_org_id" "uuid", "p_site_id" "uuid", "p_actor_user_id" "uuid", "p_effective_reversed_at" timestamp with time zone, "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_next_invoice_no"("p_issue_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_next_invoice_no"("p_issue_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_next_invoice_no"("p_issue_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."try_parse_amount_text"("p_value" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."try_parse_amount_text"("p_value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."try_parse_amount_text"("p_value" "text") TO "service_role";


















GRANT ALL ON TABLE "public"."account_master" TO "anon";
GRANT ALL ON TABLE "public"."account_master" TO "authenticated";
GRANT ALL ON TABLE "public"."account_master" TO "service_role";



GRANT ALL ON TABLE "public"."accounting_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."accounting_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."accounting_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."accounting_invoice_sources" TO "anon";
GRANT ALL ON TABLE "public"."accounting_invoice_sources" TO "authenticated";
GRANT ALL ON TABLE "public"."accounting_invoice_sources" TO "service_role";



GRANT ALL ON TABLE "public"."accounting_invoices" TO "anon";
GRANT ALL ON TABLE "public"."accounting_invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."accounting_invoices" TO "service_role";



GRANT ALL ON TABLE "public"."accounting_journal_entries" TO "anon";
GRANT ALL ON TABLE "public"."accounting_journal_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."accounting_journal_entries" TO "service_role";



GRANT ALL ON TABLE "public"."accounting_journal_lines" TO "anon";
GRANT ALL ON TABLE "public"."accounting_journal_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."accounting_journal_lines" TO "service_role";



GRANT ALL ON TABLE "public"."accounting_transaction_items" TO "anon";
GRANT ALL ON TABLE "public"."accounting_transaction_items" TO "authenticated";
GRANT ALL ON TABLE "public"."accounting_transaction_items" TO "service_role";



GRANT ALL ON TABLE "public"."accounting_transactions" TO "anon";
GRANT ALL ON TABLE "public"."accounting_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."accounting_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."ai_proposals" TO "anon";
GRANT ALL ON TABLE "public"."ai_proposals" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_proposals" TO "service_role";



GRANT ALL ON TABLE "public"."badge_application_votes" TO "anon";
GRANT ALL ON TABLE "public"."badge_application_votes" TO "authenticated";
GRANT ALL ON TABLE "public"."badge_application_votes" TO "service_role";



GRANT ALL ON TABLE "public"."badge_applications" TO "anon";
GRANT ALL ON TABLE "public"."badge_applications" TO "authenticated";
GRANT ALL ON TABLE "public"."badge_applications" TO "service_role";



GRANT ALL ON TABLE "public"."badge_states" TO "anon";
GRANT ALL ON TABLE "public"."badge_states" TO "authenticated";
GRANT ALL ON TABLE "public"."badge_states" TO "service_role";



GRANT ALL ON TABLE "public"."battle_log" TO "anon";
GRANT ALL ON TABLE "public"."battle_log" TO "authenticated";
GRANT ALL ON TABLE "public"."battle_log" TO "service_role";



GRANT ALL ON TABLE "public"."clients" TO "anon";
GRANT ALL ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT ALL ON TABLE "public"."communication_conversations" TO "anon";
GRANT ALL ON TABLE "public"."communication_conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."communication_conversations" TO "service_role";



GRANT ALL ON TABLE "public"."communication_links" TO "anon";
GRANT ALL ON TABLE "public"."communication_links" TO "authenticated";
GRANT ALL ON TABLE "public"."communication_links" TO "service_role";



GRANT ALL ON TABLE "public"."communication_logs" TO "anon";
GRANT ALL ON TABLE "public"."communication_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."communication_logs" TO "service_role";



GRANT ALL ON TABLE "public"."communication_participants" TO "anon";
GRANT ALL ON TABLE "public"."communication_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."communication_participants" TO "service_role";



GRANT ALL ON TABLE "public"."design_principles" TO "anon";
GRANT ALL ON TABLE "public"."design_principles" TO "authenticated";
GRANT ALL ON TABLE "public"."design_principles" TO "service_role";



GRANT ALL ON TABLE "public"."documents" TO "anon";
GRANT ALL ON TABLE "public"."documents" TO "authenticated";
GRANT ALL ON TABLE "public"."documents" TO "service_role";



GRANT ALL ON TABLE "public"."feature_flags" TO "anon";
GRANT ALL ON TABLE "public"."feature_flags" TO "authenticated";
GRANT ALL ON TABLE "public"."feature_flags" TO "service_role";



GRANT ALL ON TABLE "public"."finance_payout_postings" TO "anon";
GRANT ALL ON TABLE "public"."finance_payout_postings" TO "authenticated";
GRANT ALL ON TABLE "public"."finance_payout_postings" TO "service_role";



GRANT ALL ON TABLE "public"."focus_items" TO "anon";
GRANT ALL ON TABLE "public"."focus_items" TO "authenticated";
GRANT ALL ON TABLE "public"."focus_items" TO "service_role";



GRANT ALL ON TABLE "public"."gmail_message_processing" TO "anon";
GRANT ALL ON TABLE "public"."gmail_message_processing" TO "authenticated";
GRANT ALL ON TABLE "public"."gmail_message_processing" TO "service_role";



GRANT ALL ON TABLE "public"."governance_events" TO "anon";
GRANT ALL ON TABLE "public"."governance_events" TO "authenticated";
GRANT ALL ON TABLE "public"."governance_events" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_number_sequences" TO "anon";
GRANT ALL ON TABLE "public"."invoice_number_sequences" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_number_sequences" TO "service_role";



GRANT ALL ON TABLE "public"."lead_assignment_logs" TO "anon";
GRANT ALL ON TABLE "public"."lead_assignment_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_assignment_logs" TO "service_role";



GRANT ALL ON TABLE "public"."ledger_entries" TO "anon";
GRANT ALL ON TABLE "public"."ledger_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."ledger_entries" TO "service_role";



GRANT ALL ON TABLE "public"."ledger_events" TO "anon";
GRANT ALL ON TABLE "public"."ledger_events" TO "authenticated";
GRANT ALL ON TABLE "public"."ledger_events" TO "service_role";



GRANT ALL ON TABLE "public"."ledger_transactions" TO "anon";
GRANT ALL ON TABLE "public"."ledger_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."ledger_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."luqo_categories" TO "anon";
GRANT ALL ON TABLE "public"."luqo_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."luqo_categories" TO "service_role";



GRANT ALL ON TABLE "public"."luqo_period_scores" TO "anon";
GRANT ALL ON TABLE "public"."luqo_period_scores" TO "authenticated";
GRANT ALL ON TABLE "public"."luqo_period_scores" TO "service_role";



GRANT ALL ON TABLE "public"."luqo_reward_calculations" TO "anon";
GRANT ALL ON TABLE "public"."luqo_reward_calculations" TO "authenticated";
GRANT ALL ON TABLE "public"."luqo_reward_calculations" TO "service_role";



GRANT ALL ON TABLE "public"."luqo_skill_catalog" TO "anon";
GRANT ALL ON TABLE "public"."luqo_skill_catalog" TO "authenticated";
GRANT ALL ON TABLE "public"."luqo_skill_catalog" TO "service_role";



GRANT ALL ON TABLE "public"."luqo_star_achievements" TO "anon";
GRANT ALL ON TABLE "public"."luqo_star_achievements" TO "authenticated";
GRANT ALL ON TABLE "public"."luqo_star_achievements" TO "service_role";



GRANT ALL ON TABLE "public"."member_business_profiles" TO "anon";
GRANT ALL ON TABLE "public"."member_business_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."member_business_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."member_skill_certifications" TO "anon";
GRANT ALL ON TABLE "public"."member_skill_certifications" TO "authenticated";
GRANT ALL ON TABLE "public"."member_skill_certifications" TO "service_role";



GRANT ALL ON TABLE "public"."member_skill_profiles" TO "anon";
GRANT ALL ON TABLE "public"."member_skill_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."member_skill_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."monster_archetypes" TO "anon";
GRANT ALL ON TABLE "public"."monster_archetypes" TO "authenticated";
GRANT ALL ON TABLE "public"."monster_archetypes" TO "service_role";



GRANT ALL ON TABLE "public"."monster_images" TO "anon";
GRANT ALL ON TABLE "public"."monster_images" TO "authenticated";
GRANT ALL ON TABLE "public"."monster_images" TO "service_role";



GRANT ALL ON TABLE "public"."month_close_line_sources" TO "anon";
GRANT ALL ON TABLE "public"."month_close_line_sources" TO "authenticated";
GRANT ALL ON TABLE "public"."month_close_line_sources" TO "service_role";



GRANT ALL ON TABLE "public"."month_close_lines" TO "anon";
GRANT ALL ON TABLE "public"."month_close_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."month_close_lines" TO "service_role";



GRANT ALL ON TABLE "public"."month_closes" TO "anon";
GRANT ALL ON TABLE "public"."month_closes" TO "authenticated";
GRANT ALL ON TABLE "public"."month_closes" TO "service_role";



GRANT ALL ON TABLE "public"."monthly_distribution_closes" TO "anon";
GRANT ALL ON TABLE "public"."monthly_distribution_closes" TO "authenticated";
GRANT ALL ON TABLE "public"."monthly_distribution_closes" TO "service_role";



GRANT ALL ON TABLE "public"."monthly_distribution_corrections" TO "anon";
GRANT ALL ON TABLE "public"."monthly_distribution_corrections" TO "authenticated";
GRANT ALL ON TABLE "public"."monthly_distribution_corrections" TO "service_role";



GRANT ALL ON TABLE "public"."monthly_distribution_lines" TO "anon";
GRANT ALL ON TABLE "public"."monthly_distribution_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."monthly_distribution_lines" TO "service_role";



GRANT ALL ON TABLE "public"."monthly_evaluation_ai_reviews" TO "anon";
GRANT ALL ON TABLE "public"."monthly_evaluation_ai_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."monthly_evaluation_ai_reviews" TO "service_role";



GRANT ALL ON TABLE "public"."monthly_evaluation_confirmations" TO "anon";
GRANT ALL ON TABLE "public"."monthly_evaluation_confirmations" TO "authenticated";
GRANT ALL ON TABLE "public"."monthly_evaluation_confirmations" TO "service_role";



GRANT ALL ON TABLE "public"."monthly_evaluation_finalizations" TO "anon";
GRANT ALL ON TABLE "public"."monthly_evaluation_finalizations" TO "authenticated";
GRANT ALL ON TABLE "public"."monthly_evaluation_finalizations" TO "service_role";



GRANT ALL ON TABLE "public"."monthly_evaluation_forms" TO "anon";
GRANT ALL ON TABLE "public"."monthly_evaluation_forms" TO "authenticated";
GRANT ALL ON TABLE "public"."monthly_evaluation_forms" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."ocr_cache" TO "anon";
GRANT ALL ON TABLE "public"."ocr_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."ocr_cache" TO "service_role";



GRANT ALL ON TABLE "public"."org_invites" TO "anon";
GRANT ALL ON TABLE "public"."org_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."org_invites" TO "service_role";



GRANT ALL ON TABLE "public"."org_invoice_settings" TO "anon";
GRANT ALL ON TABLE "public"."org_invoice_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."org_invoice_settings" TO "service_role";



GRANT ALL ON TABLE "public"."org_memberships" TO "anon";
GRANT ALL ON TABLE "public"."org_memberships" TO "authenticated";
GRANT ALL ON TABLE "public"."org_memberships" TO "service_role";



GRANT ALL ON TABLE "public"."organizations" TO "anon";
GRANT ALL ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";



GRANT ALL ON TABLE "public"."path_ai_review_annotations" TO "anon";
GRANT ALL ON TABLE "public"."path_ai_review_annotations" TO "authenticated";
GRANT ALL ON TABLE "public"."path_ai_review_annotations" TO "service_role";



GRANT ALL ON TABLE "public"."path_assignment_restrictions" TO "anon";
GRANT ALL ON TABLE "public"."path_assignment_restrictions" TO "authenticated";
GRANT ALL ON TABLE "public"."path_assignment_restrictions" TO "service_role";



GRANT ALL ON TABLE "public"."path_credited_units" TO "anon";
GRANT ALL ON TABLE "public"."path_credited_units" TO "authenticated";
GRANT ALL ON TABLE "public"."path_credited_units" TO "service_role";



GRANT ALL ON TABLE "public"."path_evidence_records" TO "anon";
GRANT ALL ON TABLE "public"."path_evidence_records" TO "authenticated";
GRANT ALL ON TABLE "public"."path_evidence_records" TO "service_role";



GRANT ALL ON TABLE "public"."path_explanation_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."path_explanation_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."path_explanation_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."path_month_closes" TO "anon";
GRANT ALL ON TABLE "public"."path_month_closes" TO "authenticated";
GRANT ALL ON TABLE "public"."path_month_closes" TO "service_role";



GRANT ALL ON TABLE "public"."path_monthly_close_inputs" TO "anon";
GRANT ALL ON TABLE "public"."path_monthly_close_inputs" TO "authenticated";
GRANT ALL ON TABLE "public"."path_monthly_close_inputs" TO "service_role";



GRANT ALL ON TABLE "public"."path_opportunity_audits" TO "anon";
GRANT ALL ON TABLE "public"."path_opportunity_audits" TO "authenticated";
GRANT ALL ON TABLE "public"."path_opportunity_audits" TO "service_role";



GRANT ALL ON TABLE "public"."path_reward_runs" TO "anon";
GRANT ALL ON TABLE "public"."path_reward_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."path_reward_runs" TO "service_role";



GRANT ALL ON TABLE "public"."path_rule_versions" TO "anon";
GRANT ALL ON TABLE "public"."path_rule_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."path_rule_versions" TO "service_role";



GRANT ALL ON TABLE "public"."path_site_item_profit_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."path_site_item_profit_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."path_site_item_profit_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."path_trade_endorsements" TO "anon";
GRANT ALL ON TABLE "public"."path_trade_endorsements" TO "authenticated";
GRANT ALL ON TABLE "public"."path_trade_endorsements" TO "service_role";



GRANT ALL ON TABLE "public"."path_work_package_assignments" TO "anon";
GRANT ALL ON TABLE "public"."path_work_package_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."path_work_package_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."path_work_packages" TO "anon";
GRANT ALL ON TABLE "public"."path_work_packages" TO "authenticated";
GRANT ALL ON TABLE "public"."path_work_packages" TO "service_role";



GRANT ALL ON TABLE "public"."perk_application_votes" TO "anon";
GRANT ALL ON TABLE "public"."perk_application_votes" TO "authenticated";
GRANT ALL ON TABLE "public"."perk_application_votes" TO "service_role";



GRANT ALL ON TABLE "public"."perk_applications" TO "anon";
GRANT ALL ON TABLE "public"."perk_applications" TO "authenticated";
GRANT ALL ON TABLE "public"."perk_applications" TO "service_role";



GRANT ALL ON TABLE "public"."perk_definitions" TO "anon";
GRANT ALL ON TABLE "public"."perk_definitions" TO "authenticated";
GRANT ALL ON TABLE "public"."perk_definitions" TO "service_role";



GRANT ALL ON TABLE "public"."perk_states" TO "anon";
GRANT ALL ON TABLE "public"."perk_states" TO "authenticated";
GRANT ALL ON TABLE "public"."perk_states" TO "service_role";



GRANT ALL ON TABLE "public"."personal_schedules" TO "anon";
GRANT ALL ON TABLE "public"."personal_schedules" TO "authenticated";
GRANT ALL ON TABLE "public"."personal_schedules" TO "service_role";



GRANT ALL ON TABLE "public"."policies" TO "anon";
GRANT ALL ON TABLE "public"."policies" TO "authenticated";
GRANT ALL ON TABLE "public"."policies" TO "service_role";



GRANT ALL ON TABLE "public"."policy_bundle_versions" TO "anon";
GRANT ALL ON TABLE "public"."policy_bundle_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."policy_bundle_versions" TO "service_role";



GRANT ALL ON TABLE "public"."posting_groups" TO "anon";
GRANT ALL ON TABLE "public"."posting_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."posting_groups" TO "service_role";



GRANT ALL ON TABLE "public"."principle_observations" TO "anon";
GRANT ALL ON TABLE "public"."principle_observations" TO "authenticated";
GRANT ALL ON TABLE "public"."principle_observations" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."proposal_executions" TO "anon";
GRANT ALL ON TABLE "public"."proposal_executions" TO "authenticated";
GRANT ALL ON TABLE "public"."proposal_executions" TO "service_role";



GRANT ALL ON TABLE "public"."proposals" TO "anon";
GRANT ALL ON TABLE "public"."proposals" TO "authenticated";
GRANT ALL ON TABLE "public"."proposals" TO "service_role";



GRANT ALL ON TABLE "public"."revenue_basis" TO "anon";
GRANT ALL ON TABLE "public"."revenue_basis" TO "authenticated";
GRANT ALL ON TABLE "public"."revenue_basis" TO "service_role";



GRANT ALL ON TABLE "public"."reward_calculation_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."reward_calculation_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."reward_calculation_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."reward_confirmations" TO "anon";
GRANT ALL ON TABLE "public"."reward_confirmations" TO "authenticated";
GRANT ALL ON TABLE "public"."reward_confirmations" TO "service_role";



GRANT ALL ON TABLE "public"."reward_run_lines" TO "anon";
GRANT ALL ON TABLE "public"."reward_run_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."reward_run_lines" TO "service_role";



GRANT ALL ON TABLE "public"."reward_runs" TO "anon";
GRANT ALL ON TABLE "public"."reward_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."reward_runs" TO "service_role";



GRANT ALL ON TABLE "public"."reward_write_controls" TO "anon";
GRANT ALL ON TABLE "public"."reward_write_controls" TO "authenticated";
GRANT ALL ON TABLE "public"."reward_write_controls" TO "service_role";



GRANT ALL ON TABLE "public"."reward_write_guard_status" TO "anon";
GRANT ALL ON TABLE "public"."reward_write_guard_status" TO "authenticated";
GRANT ALL ON TABLE "public"."reward_write_guard_status" TO "service_role";



GRANT ALL ON TABLE "public"."site_closes" TO "anon";
GRANT ALL ON TABLE "public"."site_closes" TO "authenticated";
GRANT ALL ON TABLE "public"."site_closes" TO "service_role";



GRANT ALL ON TABLE "public"."site_completion_events" TO "anon";
GRANT ALL ON TABLE "public"."site_completion_events" TO "authenticated";
GRANT ALL ON TABLE "public"."site_completion_events" TO "service_role";



GRANT ALL ON TABLE "public"."site_day_logs" TO "anon";
GRANT ALL ON TABLE "public"."site_day_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."site_day_logs" TO "service_role";



GRANT ALL ON TABLE "public"."site_line_items" TO "anon";
GRANT ALL ON TABLE "public"."site_line_items" TO "authenticated";
GRANT ALL ON TABLE "public"."site_line_items" TO "service_role";



GRANT ALL ON TABLE "public"."site_member_outcome_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."site_member_outcome_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."site_member_outcome_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."site_member_reward_inputs" TO "anon";
GRANT ALL ON TABLE "public"."site_member_reward_inputs" TO "authenticated";
GRANT ALL ON TABLE "public"."site_member_reward_inputs" TO "service_role";



GRANT ALL ON TABLE "public"."site_member_role_plans" TO "anon";
GRANT ALL ON TABLE "public"."site_member_role_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."site_member_role_plans" TO "service_role";



GRANT ALL ON TABLE "public"."sites" TO "anon";
GRANT ALL ON TABLE "public"."sites" TO "authenticated";
GRANT ALL ON TABLE "public"."sites" TO "service_role";



GRANT ALL ON TABLE "public"."skill_ledgers" TO "anon";
GRANT ALL ON TABLE "public"."skill_ledgers" TO "authenticated";
GRANT ALL ON TABLE "public"."skill_ledgers" TO "service_role";



GRANT ALL ON TABLE "public"."system_config" TO "anon";
GRANT ALL ON TABLE "public"."system_config" TO "authenticated";
GRANT ALL ON TABLE "public"."system_config" TO "service_role";



GRANT ALL ON TABLE "public"."tax_categories" TO "anon";
GRANT ALL ON TABLE "public"."tax_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."tax_categories" TO "service_role";



GRANT ALL ON TABLE "public"."trade_families" TO "anon";
GRANT ALL ON TABLE "public"."trade_families" TO "authenticated";
GRANT ALL ON TABLE "public"."trade_families" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
