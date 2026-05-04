-- Fix lint-only warnings inherited from the remote baseline.
-- This migration keeps behavior unchanged and only removes unused PL/pgSQL
-- variables plus fixes search_path on the touched SECURITY DEFINER functions.

DO $$
DECLARE
  function_sql text;
BEGIN
  SELECT pg_get_functiondef('public.approve_proposal_atomic(uuid,uuid,jsonb,text)'::regprocedure)
  INTO function_sql;

  function_sql := replace(
    function_sql,
    'LANGUAGE plpgsql SECURITY DEFINER',
    'LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''public'', ''pg_temp'''
  );
  function_sql := replace(function_sql, E'  v_execute_result jsonb;\n', '');
  function_sql := replace(
    function_sql,
    'v_execute_result := public.execute_proposal_atomic(',
    'PERFORM public.execute_proposal_atomic('
  );

  EXECUTE function_sql;
END;
$$;

DO $$
DECLARE
  function_sql text;
BEGIN
  SELECT pg_get_functiondef('public.assert_reward_write_allowed(uuid,text,text,jsonb)'::regprocedure)
  INTO function_sql;

  function_sql := replace(
    function_sql,
    'LANGUAGE plpgsql SECURITY DEFINER',
    'LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''public'', ''pg_temp'''
  );
  function_sql := replace(
    function_sql,
    E'  RETURN jsonb_build_object(\n',
    E'  PERFORM v_legacy_config;\n\n  RETURN jsonb_build_object(\n'
  );

  EXECUTE function_sql;
END;
$$;

DO $$
DECLARE
  function_sql text;
BEGIN
  SELECT pg_get_functiondef('public.execute_proposal_atomic(uuid,uuid,jsonb)'::regprocedure)
  INTO function_sql;

  function_sql := replace(
    function_sql,
    'LANGUAGE plpgsql SECURITY DEFINER',
    'LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''public'', ''pg_temp'''
  );
  function_sql := replace(function_sql, E'  v_luqo_cat_id uuid;\n', '');

  EXECUTE function_sql;
END;
$$;
