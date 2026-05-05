import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";
import { ProposalService } from "../../services/ProposalService";
import { ActorRef } from "../../services/PolicyEngine";
import { PathV32SimpleRewardService } from "../../services/PathV32SimpleRewardService";

const shouldRunIntegration = process.env.RUN_DB_INTEGRATION_TESTS === "1";
const describeIntegration = shouldRunIntegration ? describe : describe.skip;

describeIntegration("PATH V3.2 reward DB smoke", () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for integration tests");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const createdIds = {
    orgMemberships: [] as string[],
    proposals: [] as string[],
    sites: [] as string[],
    siteCompletionEvents: [] as string[],
    revenueBasis: [] as string[],
    siteCloses: [] as string[],
    siteCloseMemberUnits: [] as string[],
    profiles: [] as string[],
    pathRuleVersions: [] as string[],
  };

  jest.setTimeout(60_000);

  afterEach(async () => {
    await cleanupSmokeData();
  });

  it("builds a PATH V3.2 monthly distribution proposal against a fixed canonical month", async () => {
    const candidate = await findReusableFixedMonthClose();
    if (!candidate) {
      console.warn("[path-v32-smoke] skipped: no reusable fixed month_close exists");
      return;
    }

    const users = await loadTwoAuthUsers();
    const creator: ActorRef = { type: "human", id: users[0].id, name: users[0].name };
    const memberB: ActorRef = { type: "human", id: users[1].id, name: users[1].name };

    await ensureProfiles([creator, memberB]);
    await insertOrgMembership(candidate.org_id, creator, "admin");
    await insertOrgMembership(candidate.org_id, memberB, "member");

    const siteId = randomUUID();
    const siteCompleteProposalId = randomUUID();
    const siteCompletionEventId = randomUUID();
    const revenueBasisId = randomUUID();
    const siteCloseId = randomUUID();
    const unitAId = randomUUID();
    const unitBId = randomUUID();
    const closedAt = `${candidate.period_ym}-15T09:00:00.000Z`;
    const workDate = `${candidate.period_ym}-15`;

    await insert("sites", [
      {
        id: siteId,
        org_id: candidate.org_id,
        name: "PATH V3.2 smoke site",
        status: "completed",
        revenue: 180000,
        completed_at: closedAt,
      },
    ]);
    createdIds.sites.push(siteId);

    await insert("proposals", [
      {
        id: siteCompleteProposalId,
        org_id: candidate.org_id,
        type: "site.complete",
        status: "executed",
        site_id: siteId,
        created_by: creator,
        executed_by: creator,
        executed_at: closedAt,
        description: "PATH V3.2 smoke site complete",
        payload: { smoke: "path-v32-reward", site_id: siteId },
        policy_ref: "smoke",
        approvals: [],
        required_approvals: 0,
      },
    ]);
    createdIds.proposals.push(siteCompleteProposalId);

    await insert("site_completion_events", [
      {
        id: siteCompletionEventId,
        org_id: candidate.org_id,
        site_id: siteId,
        sequence_no: 1,
        event_type: "recorded",
        effective_completed_at: closedAt,
        actor_user_id: creator.id,
        idempotency_key: `path-v32-smoke:${siteCompletionEventId}`,
      },
    ]);
    createdIds.siteCompletionEvents.push(siteCompletionEventId);

    await insert("revenue_basis", [
      {
        id: revenueBasisId,
        org_id: candidate.org_id,
        site_id: siteId,
        origin_completion_event_id: siteCompletionEventId,
        status: "active",
        recognition_date: workDate,
        metadata_json: { smoke: "path-v32-reward" },
      },
    ]);
    createdIds.revenueBasis.push(revenueBasisId);

    await insert("site_closes", [
      {
        id: siteCloseId,
        org_id: candidate.org_id,
        site_id: siteId,
        proposal_id: siteCompleteProposalId,
        recognized_revenue: 180000,
        material_cost: 30000,
        external_cost: 10000,
        direct_cost: 0,
        overhead_allocated: 0,
        known_rework_cost: 0,
        approved_adjustments: 0,
        distributable_profit: 140000,
        difficulty_band: "S1",
        share_mode: "auto_points",
        share_snapshot: [],
        path_rule_version: "3.2.0-simple",
        path_rule_fingerprint: "path-v32-smoke",
        calculation_snapshot: { smoke: "path-v32-reward" },
        closed_at: closedAt,
        closed_by: creator,
        status: "finalized",
      },
    ]);
    createdIds.siteCloses.push(siteCloseId);

    await insert("site_close_member_units", [
      {
        id: unitAId,
        org_id: candidate.org_id,
        site_close_id: siteCloseId,
        site_id: siteId,
        member_id: creator.id,
        work_date: workDate,
        participation_role: "lead",
        memo: "path-v32-smoke",
        source: "integration",
      },
      {
        id: unitBId,
        org_id: candidate.org_id,
        site_close_id: siteCloseId,
        site_id: siteId,
        member_id: memberB.id,
        work_date: workDate,
        participation_role: "assist",
        memo: "path-v32-smoke",
        source: "integration",
      },
    ]);
    createdIds.siteCloseMemberUnits.push(unitAId, unitBId);

    const existingRuleId = await findPathRuleVersionId(candidate.org_id);
    const rewardService = new PathV32SimpleRewardService(candidate.org_id);
    const preview = await rewardService.previewMonthlyDistribution(candidate.period_ym);
    expect(preview.calculation_system).toBe("path_v32_simple");
    expect(preview.site_profit_total).toBeGreaterThanOrEqual(140000);
    expect(preview.members.find((member) => member.member_id === creator.id)?.rounded_amount).toBeGreaterThan(0);
    expect(preview.members.find((member) => member.member_id === memberB.id)?.rounded_amount).toBeGreaterThan(0);

    const payload = await rewardService.buildMonthlyDistributionProposalPayload(candidate.period_ym, creator);
    expect(payload.month_close_id).toBe(candidate.id);
    expect(payload.calculation_system).toBe("path_v32_simple");
    expect(Array.isArray(payload.member_payouts)).toBe(true);

    if (!existingRuleId && typeof payload.reward_rule_version_id === "string") {
      createdIds.pathRuleVersions.push(payload.reward_rule_version_id);
    }

    const proposalService = new ProposalService(candidate.org_id);
    const created = await proposalService.createAndSubmit({
      type: "reward.calculate",
      description: `${candidate.period_ym} PATH V3.2 smoke monthly distribution`,
      payload,
      created_by: creator,
      org_id: candidate.org_id,
    });
    createdIds.proposals.push(created.proposal.id);

    expect(created.proposal.status).toBe("pending");
    expect(created.autoExecuted).toBe(false);
  });

  async function findReusableFixedMonthClose(): Promise<{ id: string; org_id: string; period_ym: string } | null> {
    const { data, error } = await supabase
      .from("month_closes")
      .select("id, org_id, period_ym")
      .eq("status", "fixed")
      .limit(50);
    if (error) {
      throw new Error(`Failed to find fixed month closes: ${error.message}`);
    }

    for (const row of data ?? []) {
      const { data: organization, error: organizationError } = await supabase
        .from("organizations")
        .select("id")
        .eq("id", row.org_id)
        .maybeSingle();
      if (organizationError) {
        throw new Error(`Failed to inspect organization: ${organizationError.message}`);
      }
      if (!organization?.id) {
        continue;
      }

      const { count, error: countError } = await supabase
        .from("reward_runs")
        .select("id", { count: "exact", head: true })
        .eq("month_close_id", row.id)
        .eq("calculation_system", "path_v32_simple");
      if (countError) {
        throw new Error(`Failed to inspect reward runs: ${countError.message}`);
      }
      if ((count ?? 0) === 0) {
        return row as { id: string; org_id: string; period_ym: string };
      }
    }

    return null;
  }

  async function loadTwoAuthUsers(): Promise<Array<{ id: string; name: string }>> {
    const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 2 });
    if (error) {
      throw new Error(`Failed to load auth users: ${error.message}`);
    }

    const users = (data.users ?? []).map((user) => ({
      id: user.id,
      name: user.email ?? user.id,
    }));
    if (users.length < 2) {
      throw new Error("At least two auth users are required for PATH V3.2 reward smoke");
    }

    return users;
  }

  async function ensureProfiles(actors: ActorRef[]): Promise<void> {
    const ids = actors.map((actor) => actor.id);
    const { data, error } = await supabase.from("profiles").select("id").in("id", ids);
    if (error) {
      throw new Error(`Failed to load smoke profiles: ${error.message}`);
    }

    const existing = new Set((data ?? []).map((row) => row.id));
    const missing = actors.filter((actor) => !existing.has(actor.id));
    if (missing.length === 0) {
      return;
    }

    await insert(
      "profiles",
      missing.map((actor, index) => ({
        id: actor.id,
        username: `smoke_${index}_${actor.id.slice(0, 8)}`,
        full_name: actor.name,
        role: index === 0 ? "admin" : "member",
      })),
    );
    createdIds.profiles.push(...missing.map((actor) => actor.id));
  }

  async function insertOrgMembership(orgId: string, actor: ActorRef, role: "admin" | "member"): Promise<void> {
    const { data: existing, error: existingError } = await supabase
      .from("org_memberships")
      .select("id")
      .eq("org_id", orgId)
      .eq("user_id", actor.id)
      .maybeSingle();
    if (existingError) {
      throw new Error(`Failed to inspect org_memberships: ${existingError.message}`);
    }
    if (existing?.id) {
      return;
    }

    const id = randomUUID();
    await insert("org_memberships", [
      {
        id,
        org_id: orgId,
        user_id: actor.id,
        role,
        status: "active",
        joined_at: new Date().toISOString(),
      },
    ]);
    createdIds.orgMemberships.push(id);
  }

  async function findPathRuleVersionId(orgId: string): Promise<string | null> {
    const { data, error } = await supabase
      .from("path_rule_versions")
      .select("id")
      .eq("org_id", orgId)
      .eq("version", "3.2.0-simple")
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to inspect PATH rule version: ${error.message}`);
    }
    return typeof data?.id === "string" ? data.id : null;
  }

  async function insert(table: string, rows: Array<Record<string, unknown>>): Promise<void> {
    const { error } = await supabase.from(table).insert(rows);
    if (error) {
      throw new Error(`Failed to insert ${table}: ${error.message}`);
    }
  }

  async function deleteGovernanceEventsByProposalIds(proposalIds: string[]): Promise<void> {
    if (proposalIds.length === 0) {
      return;
    }
    const { error } = await supabase.from("governance_events").delete().in("proposal_id", proposalIds);
    if (error) {
      throw new Error(`Failed to cleanup governance_events: ${error.message}`);
    }
  }

  async function deleteByIds(table: string, ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const { error } = await supabase.from(table).delete().in("id", ids);
    if (error) {
      throw new Error(`Failed to cleanup ${table}: ${error.message}`);
    }
  }

  async function cleanupSmokeData(): Promise<void> {
    await deleteByIds("site_close_member_units", createdIds.siteCloseMemberUnits);
    await deleteByIds("site_closes", createdIds.siteCloses);
    await deleteByIds("revenue_basis", createdIds.revenueBasis);
    await deleteByIds("site_completion_events", createdIds.siteCompletionEvents);
    await deleteByIds("sites", createdIds.sites);
    await deleteGovernanceEventsByProposalIds(createdIds.proposals);
    await deleteByIds("proposals", createdIds.proposals);
    await deleteByIds("org_memberships", createdIds.orgMemberships);
    await deleteByIds("path_rule_versions", createdIds.pathRuleVersions);
    await deleteByIds("profiles", createdIds.profiles);

    createdIds.orgMemberships = [];
    createdIds.proposals = [];
    createdIds.sites = [];
    createdIds.siteCompletionEvents = [];
    createdIds.revenueBasis = [];
    createdIds.siteCloses = [];
    createdIds.siteCloseMemberUnits = [];
    createdIds.profiles = [];
    createdIds.pathRuleVersions = [];
  }
});
