-- Continue broad RLS hardening for org-scoped tables.
--
-- Scope:
-- - Direct org_id tables outside Proposal / Ledger / Accounting.
-- - Keep authenticated reads org-scoped via private.is_active_member(org_id).
-- - Remove direct authenticated writes; application writes use server/service-role paths
--   or security-definer RPCs with their own authorization checks.

-- Governance / principle read models.
DROP POLICY IF EXISTS "design_principles_insert" ON public.design_principles;
DROP POLICY IF EXISTS "design_principles_select" ON public.design_principles;
DROP POLICY IF EXISTS "design_principles_update" ON public.design_principles;
DROP POLICY IF EXISTS "Insert governance_events" ON public.governance_events;
DROP POLICY IF EXISTS "Read governance_events" ON public.governance_events;
DROP POLICY IF EXISTS "Insert lead_assignment_logs" ON public.lead_assignment_logs;
DROP POLICY IF EXISTS "Read lead_assignment_logs" ON public.lead_assignment_logs;
DROP POLICY IF EXISTS "Read Policies" ON public.policies;

CREATE POLICY "design_principles_select"
  ON public.design_principles
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read governance_events"
  ON public.governance_events
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read lead_assignment_logs"
  ON public.lead_assignment_logs
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read Policies"
  ON public.policies
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

-- LUQO tables.
DROP POLICY IF EXISTS "org members can insert luqo_categories" ON public.luqo_categories;
DROP POLICY IF EXISTS "org members can view luqo_categories" ON public.luqo_categories;
DROP POLICY IF EXISTS "org members can insert luqo_period_scores" ON public.luqo_period_scores;
DROP POLICY IF EXISTS "org members can view luqo_period_scores" ON public.luqo_period_scores;
DROP POLICY IF EXISTS "org members can update luqo_period_scores" ON public.luqo_period_scores;
DROP POLICY IF EXISTS "org members can insert luqo_reward_calculations" ON public.luqo_reward_calculations;
DROP POLICY IF EXISTS "org members can view luqo_reward_calculations" ON public.luqo_reward_calculations;
DROP POLICY IF EXISTS "org members can update luqo_reward_calculations" ON public.luqo_reward_calculations;
DROP POLICY IF EXISTS "org members can insert luqo_skill_catalog" ON public.luqo_skill_catalog;
DROP POLICY IF EXISTS "org members can view luqo_skill_catalog" ON public.luqo_skill_catalog;
DROP POLICY IF EXISTS "org members can update luqo_skill_catalog" ON public.luqo_skill_catalog;
DROP POLICY IF EXISTS "org members can insert luqo_star_achievements" ON public.luqo_star_achievements;
DROP POLICY IF EXISTS "org members can view luqo_star_achievements" ON public.luqo_star_achievements;
DROP POLICY IF EXISTS "org members can update luqo_star_achievements" ON public.luqo_star_achievements;

CREATE POLICY "org members can view luqo_categories"
  ON public.luqo_categories
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "org members can view luqo_period_scores"
  ON public.luqo_period_scores
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "org members can view luqo_reward_calculations"
  ON public.luqo_reward_calculations
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "org members can view luqo_skill_catalog"
  ON public.luqo_skill_catalog
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "org members can view luqo_star_achievements"
  ON public.luqo_star_achievements
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

-- Skill / monthly evaluation / reward distribution tables.
DROP POLICY IF EXISTS "Insert member_skill_certifications" ON public.member_skill_certifications;
DROP POLICY IF EXISTS "Read member_skill_certifications" ON public.member_skill_certifications;
DROP POLICY IF EXISTS "Update member_skill_certifications" ON public.member_skill_certifications;
DROP POLICY IF EXISTS "Insert member_skill_profiles" ON public.member_skill_profiles;
DROP POLICY IF EXISTS "Read member_skill_profiles" ON public.member_skill_profiles;
DROP POLICY IF EXISTS "Update member_skill_profiles" ON public.member_skill_profiles;
DROP POLICY IF EXISTS "Insert monthly_distribution_closes" ON public.monthly_distribution_closes;
DROP POLICY IF EXISTS "Read monthly_distribution_closes" ON public.monthly_distribution_closes;
DROP POLICY IF EXISTS "Update monthly_distribution_closes" ON public.monthly_distribution_closes;
DROP POLICY IF EXISTS "Insert monthly_distribution_lines" ON public.monthly_distribution_lines;
DROP POLICY IF EXISTS "Read monthly_distribution_lines" ON public.monthly_distribution_lines;
DROP POLICY IF EXISTS "Update monthly_distribution_lines" ON public.monthly_distribution_lines;
DROP POLICY IF EXISTS "Insert monthly_evaluation_ai_reviews" ON public.monthly_evaluation_ai_reviews;
DROP POLICY IF EXISTS "Read monthly_evaluation_ai_reviews" ON public.monthly_evaluation_ai_reviews;
DROP POLICY IF EXISTS "Update monthly_evaluation_ai_reviews" ON public.monthly_evaluation_ai_reviews;
DROP POLICY IF EXISTS "Insert monthly_evaluation_confirmations" ON public.monthly_evaluation_confirmations;
DROP POLICY IF EXISTS "Read monthly_evaluation_confirmations" ON public.monthly_evaluation_confirmations;
DROP POLICY IF EXISTS "Update monthly_evaluation_confirmations" ON public.monthly_evaluation_confirmations;
DROP POLICY IF EXISTS "Insert monthly_evaluation_finalizations" ON public.monthly_evaluation_finalizations;
DROP POLICY IF EXISTS "Read monthly_evaluation_finalizations" ON public.monthly_evaluation_finalizations;
DROP POLICY IF EXISTS "Update monthly_evaluation_finalizations" ON public.monthly_evaluation_finalizations;
DROP POLICY IF EXISTS "Insert monthly_evaluation_forms" ON public.monthly_evaluation_forms;
DROP POLICY IF EXISTS "Read monthly_evaluation_forms" ON public.monthly_evaluation_forms;
DROP POLICY IF EXISTS "Update monthly_evaluation_forms" ON public.monthly_evaluation_forms;
DROP POLICY IF EXISTS "Read Org Invoice Settings" ON public.org_invoice_settings;
DROP POLICY IF EXISTS "Read reward_calculation_snapshots" ON public.reward_calculation_snapshots;

CREATE POLICY "Read member_skill_certifications"
  ON public.member_skill_certifications
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read member_skill_profiles"
  ON public.member_skill_profiles
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read monthly_distribution_closes"
  ON public.monthly_distribution_closes
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read monthly_distribution_lines"
  ON public.monthly_distribution_lines
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read monthly_evaluation_ai_reviews"
  ON public.monthly_evaluation_ai_reviews
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read monthly_evaluation_confirmations"
  ON public.monthly_evaluation_confirmations
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read monthly_evaluation_finalizations"
  ON public.monthly_evaluation_finalizations
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read monthly_evaluation_forms"
  ON public.monthly_evaluation_forms
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read Org Invoice Settings"
  ON public.org_invoice_settings
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read reward_calculation_snapshots"
  ON public.reward_calculation_snapshots
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

-- PATH module tables.
DROP POLICY IF EXISTS "Insert path_ai_review_annotations" ON public.path_ai_review_annotations;
DROP POLICY IF EXISTS "Read path_ai_review_annotations" ON public.path_ai_review_annotations;
DROP POLICY IF EXISTS "Update path_ai_review_annotations" ON public.path_ai_review_annotations;
DROP POLICY IF EXISTS "Insert path_assignment_restrictions" ON public.path_assignment_restrictions;
DROP POLICY IF EXISTS "Read path_assignment_restrictions" ON public.path_assignment_restrictions;
DROP POLICY IF EXISTS "Insert path_credited_units" ON public.path_credited_units;
DROP POLICY IF EXISTS "Read path_credited_units" ON public.path_credited_units;
DROP POLICY IF EXISTS "Insert path_evidence_records" ON public.path_evidence_records;
DROP POLICY IF EXISTS "Read path_evidence_records" ON public.path_evidence_records;
DROP POLICY IF EXISTS "Insert path_explanation_snapshots" ON public.path_explanation_snapshots;
DROP POLICY IF EXISTS "Read path_explanation_snapshots" ON public.path_explanation_snapshots;
DROP POLICY IF EXISTS "Insert path_month_closes" ON public.path_month_closes;
DROP POLICY IF EXISTS "Read path_month_closes" ON public.path_month_closes;
DROP POLICY IF EXISTS "Insert path_monthly_close_inputs" ON public.path_monthly_close_inputs;
DROP POLICY IF EXISTS "Read path_monthly_close_inputs" ON public.path_monthly_close_inputs;
DROP POLICY IF EXISTS "Update path_monthly_close_inputs" ON public.path_monthly_close_inputs;
DROP POLICY IF EXISTS "Insert path_opportunity_audits" ON public.path_opportunity_audits;
DROP POLICY IF EXISTS "Read path_opportunity_audits" ON public.path_opportunity_audits;
DROP POLICY IF EXISTS "Update path_opportunity_audits" ON public.path_opportunity_audits;
DROP POLICY IF EXISTS "Insert path_reward_runs" ON public.path_reward_runs;
DROP POLICY IF EXISTS "Read path_reward_runs" ON public.path_reward_runs;
DROP POLICY IF EXISTS "Update path_reward_runs" ON public.path_reward_runs;
DROP POLICY IF EXISTS "Insert path_rule_versions" ON public.path_rule_versions;
DROP POLICY IF EXISTS "Read path_rule_versions" ON public.path_rule_versions;
DROP POLICY IF EXISTS "Update path_rule_versions" ON public.path_rule_versions;
DROP POLICY IF EXISTS "Insert path_site_item_profit_snapshots" ON public.path_site_item_profit_snapshots;
DROP POLICY IF EXISTS "Read path_site_item_profit_snapshots" ON public.path_site_item_profit_snapshots;
DROP POLICY IF EXISTS "Update path_site_item_profit_snapshots" ON public.path_site_item_profit_snapshots;
DROP POLICY IF EXISTS "Insert path_trade_endorsements" ON public.path_trade_endorsements;
DROP POLICY IF EXISTS "Read path_trade_endorsements" ON public.path_trade_endorsements;
DROP POLICY IF EXISTS "Update path_trade_endorsements" ON public.path_trade_endorsements;
DROP POLICY IF EXISTS "Insert path_work_package_assignments" ON public.path_work_package_assignments;
DROP POLICY IF EXISTS "Read path_work_package_assignments" ON public.path_work_package_assignments;
DROP POLICY IF EXISTS "Update path_work_package_assignments" ON public.path_work_package_assignments;
DROP POLICY IF EXISTS "Insert path_work_packages" ON public.path_work_packages;
DROP POLICY IF EXISTS "Read path_work_packages" ON public.path_work_packages;
DROP POLICY IF EXISTS "Update path_work_packages" ON public.path_work_packages;
DROP POLICY IF EXISTS "Insert policy_bundle_versions" ON public.policy_bundle_versions;
DROP POLICY IF EXISTS "Read policy_bundle_versions" ON public.policy_bundle_versions;
DROP POLICY IF EXISTS "Update policy_bundle_versions" ON public.policy_bundle_versions;

CREATE POLICY "Read path_ai_review_annotations"
  ON public.path_ai_review_annotations
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read path_assignment_restrictions"
  ON public.path_assignment_restrictions
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read path_credited_units"
  ON public.path_credited_units
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read path_evidence_records"
  ON public.path_evidence_records
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read path_explanation_snapshots"
  ON public.path_explanation_snapshots
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read path_month_closes"
  ON public.path_month_closes
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read path_monthly_close_inputs"
  ON public.path_monthly_close_inputs
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read path_opportunity_audits"
  ON public.path_opportunity_audits
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read path_reward_runs"
  ON public.path_reward_runs
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read path_rule_versions"
  ON public.path_rule_versions
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read path_site_item_profit_snapshots"
  ON public.path_site_item_profit_snapshots
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read path_trade_endorsements"
  ON public.path_trade_endorsements
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read path_work_package_assignments"
  ON public.path_work_package_assignments
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read path_work_packages"
  ON public.path_work_packages
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read policy_bundle_versions"
  ON public.policy_bundle_versions
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

-- Site close and site outcome tables.
DROP POLICY IF EXISTS "Insert site_closes" ON public.site_closes;
DROP POLICY IF EXISTS "Read site_closes" ON public.site_closes;
DROP POLICY IF EXISTS "Update site_closes" ON public.site_closes;
DROP POLICY IF EXISTS "Insert site_day_logs" ON public.site_day_logs;
DROP POLICY IF EXISTS "Read site_day_logs" ON public.site_day_logs;
DROP POLICY IF EXISTS "Update site_day_logs" ON public.site_day_logs;
DROP POLICY IF EXISTS "Insert site_member_outcome_snapshots" ON public.site_member_outcome_snapshots;
DROP POLICY IF EXISTS "Read site_member_outcome_snapshots" ON public.site_member_outcome_snapshots;
DROP POLICY IF EXISTS "Update site_member_outcome_snapshots" ON public.site_member_outcome_snapshots;
DROP POLICY IF EXISTS "Insert skill_ledgers" ON public.skill_ledgers;
DROP POLICY IF EXISTS "Read skill_ledgers" ON public.skill_ledgers;
DROP POLICY IF EXISTS "Update skill_ledgers" ON public.skill_ledgers;

CREATE POLICY "Read site_closes"
  ON public.site_closes
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read site_day_logs"
  ON public.site_day_logs
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read site_member_outcome_snapshots"
  ON public.site_member_outcome_snapshots
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));

CREATE POLICY "Read skill_ledgers"
  ON public.skill_ledgers
  FOR SELECT
  TO authenticated
  USING (private.is_active_member(org_id));
