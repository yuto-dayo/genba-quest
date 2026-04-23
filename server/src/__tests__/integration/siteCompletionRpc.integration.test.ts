import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

type CompleteSiteRpcResult = {
  site_id: string;
  site_completion_event_id: string | null;
  revenue_basis_id: string | null;
  income_proposal_id: string | null;
  idempotent: boolean;
};

type ReverseSiteCompletionRpcResult = {
  site_id: string;
  reversal_event_id: string | null;
  revenue_basis_id: string | null;
  income_reverse_proposal_id: string | null;
  reward_adjust_proposal_id: string | null;
  idempotent: boolean;
};

const shouldRunIntegration = process.env.RUN_DB_INTEGRATION_TESTS === "1";
const describeIntegration = shouldRunIntegration ? describe : describe.skip;

describeIntegration("site completion RPC integration", () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for integration tests");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  let orgId: string;
  let actorUserId: string;

  jest.setTimeout(30_000);

  beforeEach(async () => {
    orgId = randomUUID();
    actorUserId = await createTestUser();
  });

  afterEach(async () => {
    await cleanupOrgData(orgId);
    await cleanupTestUser(actorUserId);
  });

  it("complete_site_rpc creates completion lineage and stays idempotent on re-run", async () => {
    const siteId = await insertSite({
      orgId,
      revenue: "98000.00",
      name: "Integration Complete Site",
    });

    const first = await completeSiteRpc(orgId, siteId, "2026-04-18T09:30:00Z");
    expect(first.error).toBeNull();

    const firstResult = normalizeRpcResult<CompleteSiteRpcResult>(first.data);
    expect(firstResult?.site_id).toBe(siteId);
    expect(firstResult?.idempotent).toBe(false);
    expect(firstResult?.site_completion_event_id).toBeTruthy();
    expect(firstResult?.revenue_basis_id).toBeTruthy();
    expect(firstResult?.income_proposal_id).toBeTruthy();

    const site = await fetchSite(siteId);
    expect(site.status).toBe("completed");
    expect(site.completed_at).toBe("2026-04-18T09:30:00+00:00");

    const eventCountAfterFirst = await countRows("site_completion_events", orgId);
    const revenueBasisCountAfterFirst = await countRows("revenue_basis", orgId);
    const proposalCountAfterFirst = await countRows("proposals", orgId);
    expect(eventCountAfterFirst).toBe(1);
    expect(revenueBasisCountAfterFirst).toBe(1);
    expect(proposalCountAfterFirst).toBe(1);

    const incomeProposal = await fetchIncomeProposal(firstResult?.income_proposal_id ?? "");
    expect(incomeProposal.type).toBe("income.create");
    expect(incomeProposal.status).toBe("approved");
    expect(incomeProposal.revenue_basis_id).toBe(firstResult?.revenue_basis_id ?? null);
    expect(incomeProposal.payload?.site_completion_event_id).toBe(
      firstResult?.site_completion_event_id ?? null
    );

    const second = await completeSiteRpc(orgId, siteId, "2026-04-18T09:30:00Z");
    expect(second.error).toBeNull();

    const secondResult = normalizeRpcResult<CompleteSiteRpcResult>(second.data);
    expect(secondResult?.idempotent).toBe(true);
    expect(secondResult?.site_completion_event_id).toBe(firstResult?.site_completion_event_id ?? null);
    expect(secondResult?.revenue_basis_id).toBe(firstResult?.revenue_basis_id ?? null);
    expect(secondResult?.income_proposal_id).toBe(firstResult?.income_proposal_id ?? null);

    const eventCountAfterSecond = await countRows("site_completion_events", orgId);
    const revenueBasisCountAfterSecond = await countRows("revenue_basis", orgId);
    const proposalCountAfterSecond = await countRows("proposals", orgId);
    expect(eventCountAfterSecond).toBe(1);
    expect(revenueBasisCountAfterSecond).toBe(1);
    expect(proposalCountAfterSecond).toBe(1);
  });

  it("reverse_site_completion_rpc reverses the lineage, cancels approved income proposal, and stays idempotent", async () => {
    const siteId = await insertSite({
      orgId,
      revenue: "125000.00",
      name: "Integration Reversal Site",
    });

    const completed = await completeSiteRpc(orgId, siteId, "2026-04-18T09:30:00Z");
    expect(completed.error).toBeNull();
    const completedResult = normalizeRpcResult<CompleteSiteRpcResult>(completed.data);

    const firstReverse = await reverseSiteCompletionRpc(
      orgId,
      siteId,
      "2026-04-19T03:00:00Z",
      "integration reversal"
    );
    expect(firstReverse.error).toBeNull();

    const firstReverseResult = normalizeRpcResult<ReverseSiteCompletionRpcResult>(firstReverse.data);
    expect(firstReverseResult?.site_id).toBe(siteId);
    expect(firstReverseResult?.idempotent).toBe(false);
    expect(firstReverseResult?.reversal_event_id).toBeTruthy();
    expect(firstReverseResult?.revenue_basis_id).toBe(completedResult?.revenue_basis_id ?? null);
    expect(firstReverseResult?.income_reverse_proposal_id).toBeNull();
    expect(firstReverseResult?.reward_adjust_proposal_id).toBeNull();

    const site = await fetchSite(siteId);
    expect(site.status).toBe("completion_reversed");
    expect(site.completed_at).toBeNull();

    const revenueBasis = await fetchRevenueBasis(firstReverseResult?.revenue_basis_id ?? "");
    expect(revenueBasis.status).toBe("reversed");
    expect(revenueBasis.reversed_by_event_id).toBe(firstReverseResult?.reversal_event_id ?? null);

    const incomeProposal = await fetchIncomeProposal(completedResult?.income_proposal_id ?? "");
    expect(incomeProposal.status).toBe("canceled");

    const eventCountAfterFirst = await countRows("site_completion_events", orgId);
    const revenueBasisCountAfterFirst = await countRows("revenue_basis", orgId);
    const proposalCountAfterFirst = await countRows("proposals", orgId);
    expect(eventCountAfterFirst).toBe(2);
    expect(revenueBasisCountAfterFirst).toBe(1);
    expect(proposalCountAfterFirst).toBe(1);

    const secondReverse = await reverseSiteCompletionRpc(
      orgId,
      siteId,
      "2026-04-19T03:00:00Z",
      "integration reversal"
    );
    expect(secondReverse.error).toBeNull();

    const secondReverseResult = normalizeRpcResult<ReverseSiteCompletionRpcResult>(secondReverse.data);
    expect(secondReverseResult?.idempotent).toBe(true);
    expect(secondReverseResult?.reversal_event_id).toBe(firstReverseResult?.reversal_event_id ?? null);
    expect(secondReverseResult?.revenue_basis_id).toBe(firstReverseResult?.revenue_basis_id ?? null);
    expect(secondReverseResult?.income_reverse_proposal_id).toBeNull();
    expect(secondReverseResult?.reward_adjust_proposal_id).toBeNull();

    const eventCountAfterSecond = await countRows("site_completion_events", orgId);
    const revenueBasisCountAfterSecond = await countRows("revenue_basis", orgId);
    const proposalCountAfterSecond = await countRows("proposals", orgId);
    expect(eventCountAfterSecond).toBe(2);
    expect(revenueBasisCountAfterSecond).toBe(1);
    expect(proposalCountAfterSecond).toBe(1);
  });

  async function insertSite(params: {
    orgId: string;
    revenue: string;
    name: string;
  }): Promise<string> {
    const siteId = randomUUID();
    const { error } = await supabase.from("sites").insert({
      id: siteId,
      org_id: params.orgId,
      name: params.name,
      revenue: params.revenue,
      status: "active",
    });

    if (error) {
      throw new Error(`Failed to insert test site: ${error.message}`);
    }

    return siteId;
  }

  async function completeSiteRpc(
    testOrgId: string,
    siteId: string,
    effectiveCompletedAt: string
  ) {
    return supabase.rpc("complete_site_rpc", {
      p_org_id: testOrgId,
      p_site_id: siteId,
      p_actor_user_id: actorUserId,
      p_effective_completed_at: effectiveCompletedAt,
    });
  }

  async function reverseSiteCompletionRpc(
    testOrgId: string,
    siteId: string,
    effectiveReversedAt: string,
    reason: string
  ) {
    return supabase.rpc("reverse_site_completion_rpc", {
      p_org_id: testOrgId,
      p_site_id: siteId,
      p_actor_user_id: actorUserId,
      p_effective_reversed_at: effectiveReversedAt,
      p_reason: reason,
    });
  }

  async function createTestUser(): Promise<string> {
    const email = `integration-site-completion-${randomUUID()}@example.com`;
    const password = `P@ssword-${randomUUID()}-Aa1`;

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (error || !data.user?.id) {
      throw new Error(`Failed to create auth user: ${error?.message ?? "unknown error"}`);
    }

    return data.user.id;
  }

  async function fetchSite(siteId: string) {
    const { data, error } = await supabase
      .from("sites")
      .select("status, completed_at")
      .eq("id", siteId)
      .single();

    if (error) {
      throw new Error(`Failed to fetch site: ${error.message}`);
    }

    return data;
  }

  async function fetchIncomeProposal(proposalId: string) {
    const { data, error } = await supabase
      .from("proposals")
      .select("type, status, payload, revenue_basis_id")
      .eq("id", proposalId)
      .single();

    if (error) {
      throw new Error(`Failed to fetch income proposal: ${error.message}`);
    }

    return data;
  }

  async function fetchRevenueBasis(revenueBasisId: string) {
    const { data, error } = await supabase
      .from("revenue_basis")
      .select("status, reversed_by_event_id")
      .eq("id", revenueBasisId)
      .single();

    if (error) {
      throw new Error(`Failed to fetch revenue basis: ${error.message}`);
    }

    return data;
  }

  async function countRows(table: string, testOrgId: string): Promise<number> {
    const { count, error } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("org_id", testOrgId);

    if (error) {
      throw new Error(`Failed to count ${table}: ${error.message}`);
    }

    return count ?? 0;
  }

  async function cleanupOrgData(testOrgId: string): Promise<void> {
    const tables = ["proposals", "revenue_basis", "site_completion_events", "sites"] as const;

    for (const table of tables) {
      const { error } = await supabase.from(table).delete().eq("org_id", testOrgId);
      if (error) {
        throw new Error(`Failed to cleanup ${table}: ${error.message}`);
      }
    }
  }

  async function cleanupTestUser(userId: string): Promise<void> {
    if (!userId) {
      return;
    }

    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) {
      throw new Error(`Failed to cleanup auth user: ${error.message}`);
    }
  }
});

function normalizeRpcResult<T>(data: unknown): T | null {
  if (!data) {
    return null;
  }

  if (Array.isArray(data)) {
    return (data[0] || null) as T | null;
  }

  return data as T;
}
