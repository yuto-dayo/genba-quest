jest.mock("../../lib/supabaseAdmin", () => ({
  supabaseAdmin: { from: jest.fn() },
}));

jest.mock("../../services/communication-contact-read-model", () => ({
  listCommunicationContacts: jest.fn(),
  getCommunicationContactDetail: jest.fn(),
  getCommunicationInsightsSummary: jest.fn(),
}));

import communicationsRouter from "../../routes/communications";
import {
  getCommunicationContactDetail,
  getCommunicationInsightsSummary,
  listCommunicationContacts,
} from "../../services/communication-contact-read-model";

type MockRes = {
  status: jest.Mock;
  json: jest.Mock;
};

function createMockRes(): MockRes {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  } as unknown as MockRes;
  res.status.mockReturnValue(res);
  return res;
}

function getHandler(method: "get", path: string) {
  const layer = (communicationsRouter as any).stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.[method]
  );

  if (!layer) {
    throw new Error(`${method.toUpperCase()} handler not found for path: ${path}`);
  }

  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

describe("communications contact routes", () => {
  const contactsHandler = getHandler("get", "/contacts");
  const contactDetailHandler = getHandler("get", "/contacts/:contactKey");
  const insightsHandler = getHandler("get", "/insights/summary");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("GET /contacts normalizes board filters and returns the service payload", async () => {
    (listCommunicationContacts as jest.Mock).mockResolvedValue({
      items: [{ contact_key: "tanaka@example.com", status: "waiting_internal" }],
      total_count: 1,
    });

    const req = {
      orgId: "org-1",
      query: {
        q: "田中",
        status: ["waiting_internal", "overdue"],
        ownerUserId: ["member-1"],
        risk: ["no_owner"],
        includeResolved: "true",
        sort: "latest_activity",
        page: "2",
        pageSize: "25",
      },
    } as any;
    const res = createMockRes();

    await contactsHandler(req, res);

    expect(listCommunicationContacts).toHaveBeenCalledWith({
      orgId: "org-1",
      q: "田中",
      statuses: ["waiting_internal", "overdue"],
      ownerUserIds: ["member-1"],
      riskFlags: ["no_owner"],
      includeResolved: true,
      sort: "latest_activity",
      page: 2,
      pageSize: 25,
    });
    expect(res.json).toHaveBeenCalledWith({
      items: [{ contact_key: "tanaka@example.com", status: "waiting_internal" }],
      total_count: 1,
    });
  });

  it("GET /contacts returns 400 for invalid risk filter", async () => {
    const req = {
      orgId: "org-1",
      query: { risk: ["invalid"] },
    } as any;
    const res = createMockRes();

    await contactsHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(listCommunicationContacts).not.toHaveBeenCalled();
  });

  it("GET /contacts/:contactKey returns detail from the service", async () => {
    (getCommunicationContactDetail as jest.Mock).mockResolvedValue({
      summary: { contact_key: "tanaka@example.com" },
      why_now: [],
      conversations: [],
      recent_logs: [],
      related_proposals: [],
      default_conversation_id: null,
    });

    const req = {
      orgId: "org-1",
      params: { contactKey: "tanaka@example.com" },
    } as any;
    const res = createMockRes();

    await contactDetailHandler(req, res);

    expect(getCommunicationContactDetail).toHaveBeenCalledWith("org-1", "tanaka@example.com");
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.objectContaining({ contact_key: "tanaka@example.com" }),
      })
    );
  });

  it("GET /insights/summary returns the service result", async () => {
    (getCommunicationInsightsSummary as jest.Mock).mockResolvedValue({
      hygiene: {
        open_contacts: 2,
        owner_coverage_rate: 0.5,
        next_action_coverage_rate: 1,
        overdue_rate: 0.5,
        overdue_count: 1,
        no_next_action_count: 0,
        no_owner_count: 1,
      },
      stagnation: { stale_7d_count: 1, by_status: [], by_owner: [] },
      proposal_health: { in_flight_stale_count: 1, follow_up_missing_after_link_count: 1 },
      owner_workload: [],
      reason_clusters: [],
      client_health: [],
    });

    const req = { orgId: "org-1", query: {} } as any;
    const res = createMockRes();

    await insightsHandler(req, res);

    expect(getCommunicationInsightsSummary).toHaveBeenCalledWith("org-1");
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        hygiene: expect.objectContaining({ open_contacts: 2 }),
        proposal_health: expect.objectContaining({ follow_up_missing_after_link_count: 1 }),
      })
    );
  });
});
