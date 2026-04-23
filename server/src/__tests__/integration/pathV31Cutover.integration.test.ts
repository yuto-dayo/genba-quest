import "dotenv/config";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { ProposalService } from "../../services/ProposalService";
import { ActorRef } from "../../services/PolicyEngine";
import { PathV31Service } from "../../services/PathV31Service";

const shouldRunIntegration = process.env.RUN_DB_INTEGRATION_TESTS === "1";
const describeIntegration = shouldRunIntegration ? describe : describe.skip;

describeIntegration("PATH v3.1 cutover integration", () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for integration tests");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let availableUsers: Array<{ id: string; name: string }>;
  let orgId: string;
  let creator: ActorRef;
  let approver: ActorRef;
  let memberB: { id: string; name: string };
  let proposalService: ProposalService;
  let pathV31Service: PathV31Service;

  jest.setTimeout(60_000);

  beforeAll(async () => {
    const { data, error } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 4,
    });

    if (error) {
      throw new Error(`Failed to load integration auth users: ${error.message}`);
    }

    availableUsers = (data?.users ?? [])
      .map((user) => ({
        id: String(user.id),
        name:
          (typeof user.user_metadata?.name === "string" && user.user_metadata.name.length > 0
            ? user.user_metadata.name
            : typeof user.email === "string" && user.email.length > 0
              ? user.email
              : String(user.id)),
      }))
      .filter((row) => row.id.length > 0);

    if (availableUsers.length < 2) {
      throw new Error("At least two auth users are required for PATH v3.1 integration tests");
    }
  });

  beforeEach(() => {
    orgId = randomUUID();
    creator = {
      type: "human",
      id: availableUsers[0].id,
      name: availableUsers[0].name,
    };
    approver = {
      type: "human",
      id: availableUsers[1].id,
      name: availableUsers[1].name,
    };
    memberB = {
      id: approver.id,
      name: approver.name,
    };
    proposalService = new ProposalService(orgId);
    pathV31Service = new PathV31Service(orgId);
  });

  afterEach(async () => {
    if (!orgId || !creator || !approver || !memberB) {
      return;
    }
    await cleanupOrgData(orgId, [creator.id, approver.id]);
  });

  it("locks and reopens day logs, rebuilds site closes, previews monthly distribution, and records cold-start lead recommendations", async () => {
    const positiveSiteId = randomUUID();
    const negativeSiteId = randomUUID();
    await insertSites([
      { id: positiveSiteId, name: "渋谷マンション" },
      { id: negativeSiteId, name: "赤字改修" },
    ]);

    const positiveDayLog = await pathV31Service.upsertDayLog(
      {
        date: "2026-05-02",
        site_id: positiveSiteId,
        member_id: creator.id,
        trade_families: ["wall_finish"],
        role_type: "assist",
        credited_unit: 1,
        memo: "positive close seed",
      },
      creator,
    );

    const negativeDayLog = await pathV31Service.upsertDayLog(
      {
        date: "2026-05-03",
        site_id: negativeSiteId,
        member_id: memberB.id,
        trade_families: ["wall_finish"],
        role_type: "assist",
        credited_unit: 1,
        memo: "negative close seed",
      },
      approver,
    );

    const firstClosePayload = await pathV31Service.buildSiteCloseProposalPayload(
      {
        site_id: positiveSiteId,
        included_day_log_ids: [String(positiveDayLog.id)],
        recognized_revenue: 320000,
        material_cost: 40000,
        external_cost: 20000,
        direct_cost: 0,
        overhead_allocated: 10000,
        known_rework_cost: 0,
        approved_adjustments: 0,
        difficulty_band: "S1",
        share_mode: "auto_points",
        outcome_snapshots: [
          {
            member_id: creator.id,
            outcome_status: "ok",
            source: "integration",
            notes: "first close",
          },
        ],
        closed_at: "2026-05-04T09:00:00.000Z",
      },
      creator,
    );

    const firstCloseProposal = await proposalService.createAndSubmit({
      type: "site.close.finalize",
      description: "PATH v3.1 positive site close",
      payload: firstClosePayload,
      created_by: creator,
      org_id: orgId,
      site_id: positiveSiteId,
    });
    expect(firstCloseProposal.proposal.status).toBe("pending");

    const approvedFirstClose = await proposalService.approve(
      firstCloseProposal.proposal.id,
      approver,
      "finalize positive site close",
    );
    expect(approvedFirstClose.autoExecuted).toBe(true);
    expect(approvedFirstClose.proposal.status).toBe("executed");

    const firstSiteClose = await fetchSingleRow(
      "site_closes",
      "id, status, proposal_id, distributable_profit, share_snapshot",
      "proposal_id",
      firstCloseProposal.proposal.id,
    );
    expect(firstSiteClose.status).toBe("finalized");
    expect(Number(firstSiteClose.distributable_profit)).toBe(250000);

    const lockedLog = await fetchSingleRow(
      "site_day_logs",
      "id, locked_by_site_close_id, credited_unit, memo",
      "id",
      String(positiveDayLog.id),
    );
    expect(lockedLog.locked_by_site_close_id).toBe(firstSiteClose.id);

    const outcomeSnapshot = await fetchSingleRow(
      "site_member_outcome_snapshots",
      "site_close_id, member_id, outcome_status, source, notes",
      "site_close_id",
      firstSiteClose.id,
    );
    expect(outcomeSnapshot.member_id).toBe(creator.id);
    expect(outcomeSnapshot.outcome_status).toBe("ok");

    const skillLedgerAfterFirstClose = await fetchSingleRow(
      "skill_ledgers",
      "member_id, trade_family, assist_units, lead_units, solo_units, ok_count, rework_count",
      "member_id",
      creator.id,
    );
    expect(skillLedgerAfterFirstClose.trade_family).toBe("wall_finish");
    expect(Number(skillLedgerAfterFirstClose.assist_units)).toBeGreaterThan(0);
    expect(Number(skillLedgerAfterFirstClose.ok_count)).toBe(1);

    await expect(
      pathV31Service.upsertDayLog(
        {
          id: String(positiveDayLog.id),
          date: "2026-05-02",
          site_id: positiveSiteId,
          member_id: creator.id,
          trade_families: ["wall_finish"],
          role_type: "assist",
          credited_unit: 1.25,
          memo: "should be rejected while locked",
        },
        creator,
      ),
    ).rejects.toThrow("SITE_CLOSE_REOPEN_REQUIRED");

    const reopenPayload = await pathV31Service.buildSiteCloseReopenProposalPayload(
      {
        site_close_id: String(firstSiteClose.id),
        reason_code: "integration_reopen",
        note: "unlock day log for correction",
      },
      creator,
    );

    const reopenProposal = await proposalService.createAndSubmit({
      type: "site.close.reopen",
      description: "PATH v3.1 reopen close",
      payload: reopenPayload,
      created_by: creator,
      org_id: orgId,
      site_id: positiveSiteId,
    });
    expect(reopenProposal.proposal.status).toBe("pending");

    const approvedReopen = await proposalService.approve(
      reopenProposal.proposal.id,
      approver,
      "reopen positive site close",
    );
    expect(approvedReopen.autoExecuted).toBe(true);
    expect(approvedReopen.proposal.status).toBe("executed");

    const reopenedSiteClose = await fetchSingleRow(
      "site_closes",
      "id, status, reopened_by_proposal_id",
      "id",
      String(firstSiteClose.id),
    );
    expect(reopenedSiteClose.status).toBe("reopened");
    expect(reopenedSiteClose.reopened_by_proposal_id).toBe(reopenProposal.proposal.id);

    const unlockedLog = await fetchSingleRow(
      "site_day_logs",
      "id, locked_by_site_close_id",
      "id",
      String(positiveDayLog.id),
    );
    expect(unlockedLog.locked_by_site_close_id).toBeNull();

    const correctedDayLog = await pathV31Service.upsertDayLog(
      {
        id: String(positiveDayLog.id),
        date: "2026-05-02",
        site_id: positiveSiteId,
        member_id: creator.id,
        trade_families: ["wall_finish"],
        role_type: "assist",
        credited_unit: 1.25,
        memo: "corrected after reopen",
      },
      creator,
    );
    expect(Number(correctedDayLog.credited_unit)).toBe(1.25);

    const reclosePayload = await pathV31Service.buildSiteCloseProposalPayload(
      {
        site_id: positiveSiteId,
        included_day_log_ids: [String(positiveDayLog.id)],
        recognized_revenue: 320000,
        material_cost: 40000,
        external_cost: 20000,
        direct_cost: 0,
        overhead_allocated: 10000,
        known_rework_cost: 0,
        approved_adjustments: 0,
        difficulty_band: "S1",
        share_mode: "auto_points",
        outcome_snapshots: [
          {
            member_id: creator.id,
            outcome_status: "ok",
            source: "integration",
            notes: "reclose snapshot",
          },
        ],
        closed_at: "2026-05-05T09:00:00.000Z",
      },
      creator,
    );

    const recloseProposal = await proposalService.createAndSubmit({
      type: "site.close.finalize",
      description: "PATH v3.1 positive site reclose",
      payload: reclosePayload,
      created_by: creator,
      org_id: orgId,
      site_id: positiveSiteId,
    });

    const approvedReclose = await proposalService.approve(
      recloseProposal.proposal.id,
      approver,
      "reclose positive site after correction",
    );
    expect(approvedReclose.autoExecuted).toBe(true);

    const secondSiteClose = await fetchSingleRow(
      "site_closes",
      "id, proposal_id, status, closed_at",
      "proposal_id",
      recloseProposal.proposal.id,
    );
    expect(secondSiteClose.id).not.toBe(firstSiteClose.id);
    expect(secondSiteClose.status).toBe("finalized");

    const relockedLog = await fetchSingleRow(
      "site_day_logs",
      "id, locked_by_site_close_id, credited_unit, memo",
      "id",
      String(positiveDayLog.id),
    );
    expect(relockedLog.locked_by_site_close_id).toBe(secondSiteClose.id);
    expect(Number(relockedLog.credited_unit)).toBe(1.25);
    expect(relockedLog.memo).toBe("corrected after reopen");

    const negativeClosePayload = await pathV31Service.buildSiteCloseProposalPayload(
      {
        site_id: negativeSiteId,
        included_day_log_ids: [String(negativeDayLog.id)],
        recognized_revenue: 10000,
        material_cost: 30000,
        external_cost: 10000,
        direct_cost: 0,
        overhead_allocated: 10000,
        known_rework_cost: 0,
        approved_adjustments: 0,
        difficulty_band: "S1",
        share_mode: "auto_points",
        outcome_snapshots: [
          {
            member_id: memberB.id,
            outcome_status: "unknown",
            source: "integration",
            notes: "red site close",
          },
        ],
        closed_at: "2026-05-06T09:00:00.000Z",
      },
      creator,
    );

    const negativeCloseProposal = await proposalService.createAndSubmit({
      type: "site.close.finalize",
      description: "PATH v3.1 red site close",
      payload: negativeClosePayload,
      created_by: creator,
      org_id: orgId,
      site_id: negativeSiteId,
    });

    const approvedNegativeClose = await proposalService.approve(
      negativeCloseProposal.proposal.id,
      approver,
      "finalize red site close",
    );
    expect(approvedNegativeClose.autoExecuted).toBe(true);

    const negativeSiteClose = await fetchSingleRow(
      "site_closes",
      "id, distributable_profit, status",
      "proposal_id",
      negativeCloseProposal.proposal.id,
    );
    expect(negativeSiteClose.status).toBe("finalized");
    expect(Number(negativeSiteClose.distributable_profit)).toBe(-40000);

    const monthlyPreview = await pathV31Service.previewMonthlyDistribution("2026-05");
    expect(monthlyPreview.members).toHaveLength(2);

    const creatorPreview = monthlyPreview.members.find(
      (member) => member.member_id === creator.id,
    );
    const memberBPreview = monthlyPreview.members.find(
      (member) => member.member_id === memberB.id,
    );
    expect(creatorPreview).toBeTruthy();
    expect(memberBPreview).toBeTruthy();
    expect((creatorPreview?.raw_result_weight ?? 0) > 0).toBe(true);
    expect(memberBPreview?.raw_result_weight).toBe(0);
    expect((memberBPreview?.floor_pay ?? 0) > 0).toBe(true);
    expect((memberBPreview?.result_pay ?? 0) >= 0).toBe(true);
    expect((memberBPreview?.total_pay ?? 0) >= 0).toBe(true);

    const distributionPayload = await pathV31Service.buildMonthlyDistributionProposalPayload(
      "2026-05",
      creator,
    );
    expect(distributionPayload.calculation_system).toBe("path_v31");
    expect(distributionPayload.month).toBe("2026-05");
    expect(
      Array.isArray(distributionPayload.member_payouts) &&
        distributionPayload.member_payouts.length,
    ).toBe(2);

    const recommendation = await pathV31Service.recommendLeadAssignment(
      {
        date: "2026-05-07",
        site_id: positiveSiteId,
        trade_family: "wall_finish",
        difficulty_band: "S1",
        candidate_member_ids: [creator.id, memberB.id],
        chosen_member_id: creator.id,
        override_reason_code: "dispatcher_override",
      },
      creator,
    );

    const ranking = recommendation.ranking as Array<Record<string, unknown>>;
    const recommendationLog = recommendation.log as Record<string, unknown>;
    expect(ranking.length).toBeGreaterThan(0);
    expect(recommendation.recommendation).toEqual(
      expect.objectContaining({
        confidence: "low",
      }),
    );
    expect(recommendationLog.override_reason_code).toBe("dispatcher_override");
  });

  async function fetchSingleRow(
    table: string,
    columns: string,
    key = "org_id",
    value: string = orgId,
  ): Promise<Record<string, any>> {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq(key, value)
      .single();

    if (error) {
      throw new Error(`Failed to fetch single row from ${table}: ${error.message}`);
    }

    return data as Record<string, any>;
  }

  async function fetchRows(
    table: string,
    columns: string,
    key = "org_id",
    value: string = orgId,
  ): Promise<Array<Record<string, any>>> {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq(key, value);

    if (error) {
      throw new Error(`Failed to fetch rows from ${table}: ${error.message}`);
    }

    return (data ?? []) as Array<Record<string, any>>;
  }

  async function cleanupOrgData(testOrgId: string, userIds: string[]): Promise<void> {
    const { data: proposalRows, error: proposalRowsError } = await supabase
      .from("proposals")
      .select("id")
      .eq("org_id", testOrgId);

    if (proposalRowsError) {
      throw new Error(`Failed to load proposals for cleanup: ${proposalRowsError.message}`);
    }

    const proposalIds = (proposalRows ?? [])
      .map((row) => row.id)
      .filter((value): value is string => typeof value === "string" && value.length > 0);

    const tables = [
      "monthly_distribution_lines",
      "monthly_distribution_closes",
      "lead_assignment_logs",
      "site_member_outcome_snapshots",
      "site_day_logs",
      "site_closes",
      "skill_ledgers",
      "reward_runs",
      "proposal_executions",
      "governance_events",
      "path_rule_versions",
      "sites",
    ];

    for (const table of tables) {
      const { error } = await supabase.from(table).delete().eq("org_id", testOrgId);
      if (error) {
        throw new Error(`Failed to cleanup ${table}: ${error.message}`);
      }
    }

    if (proposalIds.length > 0 && userIds.length > 0) {
      const { data: notifications, error: notificationsLoadError } = await supabase
        .from("notifications")
        .select("id, data, user_id")
        .in("user_id", Array.from(new Set(userIds)));

      if (notificationsLoadError) {
        throw new Error(`Failed to load notifications for cleanup: ${notificationsLoadError.message}`);
      }

      const notificationIds = (notifications ?? [])
        .filter((row) => {
          const data = row.data;
          if (!data || typeof data !== "object") {
            return false;
          }
          const proposalId = (data as Record<string, unknown>).proposal_id;
          return typeof proposalId === "string" && proposalIds.includes(proposalId);
        })
        .map((row) => row.id)
        .filter((value): value is string => typeof value === "string" && value.length > 0);

      if (notificationIds.length > 0) {
        const { error: notificationsDeleteError } = await supabase
          .from("notifications")
          .delete()
          .in("id", notificationIds);

        if (notificationsDeleteError) {
          throw new Error(`Failed to cleanup notifications: ${notificationsDeleteError.message}`);
        }
      }
    }

    const { error: proposalsDeleteError } = await supabase
      .from("proposals")
      .delete()
      .eq("org_id", testOrgId);

    if (proposalsDeleteError) {
      throw new Error(`Failed to cleanup proposals: ${proposalsDeleteError.message}`);
    }
  }

  async function insertSites(
    sites: Array<{ id: string; name: string }>,
  ): Promise<void> {
    const { error } = await supabase.from("sites").insert(
      sites.map((site) => ({
        id: site.id,
        org_id: orgId,
        name: site.name,
        status: "active",
      })),
    );

    if (error) {
      throw new Error(`Failed to insert integration sites: ${error.message}`);
    }
  }
});
