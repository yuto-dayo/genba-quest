import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";
import { ProposalService } from "../../services/ProposalService";
import { ActorRef } from "../../services/PolicyEngine";

const shouldRunIntegration = process.env.RUN_DB_INTEGRATION_TESTS === "1";
const describeIntegration = shouldRunIntegration ? describe : describe.skip;

describeIntegration("Sherpa proposal human-approval path integration", () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for integration tests");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  let orgId: string;
  let proposalService: ProposalService;

  const sherpaActor: ActorRef = {
    type: "ai",
    id: "sherpa",
    name: "Sherpa",
  };

  const aiApprover: ActorRef = {
    type: "ai",
    id: "ai-approver",
    name: "Sherpa Approver",
  };

  const humanApprover: ActorRef = {
    type: "human",
    id: "11111111-1111-4111-8111-111111111111",
    name: "Human Approver",
  };

  const humanRejector: ActorRef = {
    type: "human",
    id: "22222222-2222-4222-8222-222222222222",
    name: "Human Rejector",
  };

  jest.setTimeout(30_000);

  beforeEach(() => {
    orgId = randomUUID();
    proposalService = new ProposalService(orgId);
  });

  afterEach(async () => {
    await cleanupOrgData(orgId);
  });

  it("blocks AI self-approval for Sherpa-created proposal and allows human approval", async () => {
    const submitted = await proposalService.createAndSubmit({
      org_id: orgId,
      type: "expense.create",
      payload: {
        amount: 12000,
        category: "material",
        description: "sherpa approval path integration",
      },
      description: "sherpa approval path integration",
      created_by: sherpaActor,
    });

    expect(submitted.proposal.status).toBe("pending");
    expect(submitted.autoApproved).toBe(false);
    expect(submitted.autoExecuted).toBe(false);

    await expect(
      proposalService.approve(submitted.proposal.id, aiApprover, "ai self-approval attempt")
    ).rejects.toThrow("AI_SELF_APPROVAL_PROHIBITED");

    const afterAiAttempt = await proposalService.getById(submitted.proposal.id);
    expect(afterAiAttempt?.status).toBe("pending");

    const approved = await proposalService.approve(
      submitted.proposal.id,
      humanApprover,
      "human approval"
    );

    expect(approved.isFullyApproved).toBe(true);
    expect(approved.proposal.status === "executed" || approved.proposal.status === "approved").toBe(true);
    if (approved.autoExecuted) {
      expect(approved.proposal.status).toBe("executed");
    } else {
      expect(approved.proposal.status).toBe("approved");
    }
  });

  it("allows human rejection for Sherpa-created pending proposal", async () => {
    const submitted = await proposalService.createAndSubmit({
      org_id: orgId,
      type: "expense.create",
      payload: {
        amount: 18000,
        category: "tool",
        description: "sherpa rejection path integration",
      },
      description: "sherpa rejection path integration",
      created_by: sherpaActor,
    });

    expect(submitted.proposal.status).toBe("pending");

    const rejected = await proposalService.reject(
      submitted.proposal.id,
      humanRejector,
      "manual rejection from today queue"
    );

    expect(rejected.status).toBe("rejected");
    expect(rejected.rejection_reason).toBe("manual rejection from today queue");
    expect(rejected.approvals.some((item) => item.decision === "reject")).toBe(true);
  });

  async function cleanupOrgData(testOrgId: string): Promise<void> {
    const { error: ledgerEventDeleteError } = await supabase
      .from("ledger_events")
      .delete()
      .eq("org_id", testOrgId);
    if (ledgerEventDeleteError) {
      throw new Error(`Failed to cleanup ledger events: ${ledgerEventDeleteError.message}`);
    }

    const { error: proposalDeleteError } = await supabase
      .from("proposals")
      .delete()
      .eq("org_id", testOrgId);
    if (proposalDeleteError) {
      throw new Error(`Failed to cleanup proposals: ${proposalDeleteError.message}`);
    }
  }
});
