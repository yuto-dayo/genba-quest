const mockListPrinciples = jest.fn();
const mockGetPrinciple = jest.fn();
const mockGetObservations = jest.fn();
const mockRecordObservation = jest.fn();

jest.mock("../../services/PrincipleService", () => ({
  PrincipleService: jest.fn().mockImplementation(() => ({
    listPrinciples: mockListPrinciples,
    getPrinciple: mockGetPrinciple,
    getObservations: mockGetObservations,
    recordObservation: mockRecordObservation,
  })),
}));

import principlesRouter from "../../routes/principles";
import { PrincipleService } from "../../services/PrincipleService";

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

function getHandler(path: string, method: "get" | "post") {
  const layer = (principlesRouter as any).stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.[method]
  );

  if (!layer) {
    throw new Error(`${method.toUpperCase()} handler not found for path: ${path}`);
  }

  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

describe("principles router", () => {
  const listHandler = getHandler("/", "get");
  const getByNameHandler = getHandler("/:name", "get");
  const listObservationsHandler = getHandler("/:name/observations", "get");
  const createObservationHandler = getHandler("/:name/observations", "post");
  const mockPrincipleServiceCtor = PrincipleService as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("GET / returns data from service", async () => {
    mockListPrinciples.mockResolvedValue([{ id: "p-1", name: "proposal-centric" }]);

    const req = { query: {}, orgId: "org-1" } as any;
    const res = createMockRes();

    await listHandler(req, res);

    expect(mockPrincipleServiceCtor).toHaveBeenCalledWith("org-1");
    expect(mockListPrinciples).toHaveBeenCalledWith(undefined);
    expect(res.json).toHaveBeenCalledWith({
      data: [{ id: "p-1", name: "proposal-centric" }],
    });
  });

  it("GET /:name returns 400 when name is invalid", async () => {
    const req = { params: { name: ["bad"] }, orgId: "org-1" } as any;
    const res = createMockRes();

    await getByNameHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid principle name" });
    expect(mockGetPrinciple).not.toHaveBeenCalled();
  });

  it("GET /:name/observations returns 400 when name is invalid", async () => {
    const req = { params: { name: [] }, query: {}, orgId: "org-1" } as any;
    const res = createMockRes();

    await listObservationsHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid principle name" });
    expect(mockGetObservations).not.toHaveBeenCalled();
  });

  it("POST /:name/observations returns 400 when name is invalid", async () => {
    const req = {
      params: {},
      body: { outcome: true, reason: "ok" },
      userId: "user-1",
      userName: "Tester",
      orgId: "org-1",
    } as any;
    const res = createMockRes();

    await createObservationHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid principle name" });
    expect(mockRecordObservation).not.toHaveBeenCalled();
  });
});
