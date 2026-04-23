jest.mock("../../lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { PathV31Service } from "../../services/PathV31Service";
import { createChain, setupMockFromSequence } from "../helpers/mockSupabase";

const mockFrom = supabaseAdmin.from as jest.Mock;

describe("PathV31Service day-log save", () => {
  const orgId = "00000000-0000-0000-0000-000000000001";
  const actor = {
    type: "human" as const,
    id: "33333333-3333-4333-8333-333333333333",
    name: "現場担当",
  };

  const baseInput: Parameters<PathV31Service["upsertDayLog"]>[0] = {
    date: "2026-05-01",
    site_id: "11111111-1111-4111-8111-111111111111",
    member_id: actor.id,
    trade_families: ["wall_finish"],
    role_type: "assist" as const,
    credited_unit: 1,
    memo: "initial",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function activeSiteChain() {
    return createChain({
      data: {
        id: baseInput.site_id,
        status: "active",
      },
      error: null,
    });
  }

  it("rejects writes for another member before touching the database", async () => {
    const service = new PathV31Service(orgId);

    await expect(
      service.upsertDayLog(
        {
          ...baseInput,
          member_id: "44444444-4444-4444-8444-444444444444",
        },
        actor,
      ),
    ).rejects.toThrow("DAY_LOG_MEMBER_FORBIDDEN");

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("updates an existing log by id", async () => {
    const service = new PathV31Service(orgId);
    const lookupChain = createChain({
      data: {
        id: "log-1",
        member_id: actor.id,
        locked_by_site_close_id: null,
      },
      error: null,
    });
    const updateChain = createChain({
      data: {
        id: "log-1",
        member_id: actor.id,
        site_id: baseInput.site_id,
        date: baseInput.date,
        credited_unit: 1.25,
        memo: "updated by id",
      },
      error: null,
    });

    setupMockFromSequence(mockFrom, [activeSiteChain(), lookupChain, updateChain]);

    const result = await service.upsertDayLog(
      {
        ...baseInput,
        id: "log-1",
        credited_unit: 1.25,
        memo: "updated by id",
      },
      actor,
    );

    expect(lookupChain.eq).toHaveBeenCalledWith("id", "log-1");
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        credited_unit: 1.25,
        memo: "updated by id",
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: "log-1",
        credited_unit: 1.25,
      }),
    );
  });

  it("updates an existing log by natural key", async () => {
    const service = new PathV31Service(orgId);
    const lookupChain = createChain({
      data: {
        id: "log-2",
        member_id: actor.id,
        locked_by_site_close_id: null,
      },
      error: null,
    });
    const updateChain = createChain({
      data: {
        id: "log-2",
        member_id: actor.id,
        site_id: baseInput.site_id,
        date: baseInput.date,
        credited_unit: 1.5,
        memo: "natural-key update",
      },
      error: null,
    });

    setupMockFromSequence(mockFrom, [activeSiteChain(), lookupChain, updateChain]);

    const result = await service.upsertDayLog(
      {
        ...baseInput,
        credited_unit: 1.5,
        memo: "natural-key update",
      },
      actor,
    );

    expect(lookupChain.eq).toHaveBeenCalledWith("date", baseInput.date);
    expect(lookupChain.eq).toHaveBeenCalledWith("site_id", baseInput.site_id);
    expect(lookupChain.eq).toHaveBeenCalledWith("member_id", actor.id);
    expect(updateChain.eq).toHaveBeenCalledWith("id", "log-2");
    expect(result).toEqual(
      expect.objectContaining({
        id: "log-2",
        credited_unit: 1.5,
      }),
    );
  });

  it("rejects locked day logs", async () => {
    const service = new PathV31Service(orgId);
    const lookupChain = createChain({
      data: {
        id: "log-3",
        member_id: actor.id,
        locked_by_site_close_id: "close-1",
      },
      error: null,
    });

    setupMockFromSequence(mockFrom, [activeSiteChain(), lookupChain]);

    await expect(service.upsertDayLog(baseInput, actor)).rejects.toThrow("DAY_LOG_LOCKED");
  });

  it("recovers from a duplicate insert race by reloading and updating the natural-key row", async () => {
    const service = new PathV31Service(orgId);
    const initialLookupChain = createChain({ data: null, error: null });
    const insertChain = createChain({
      data: null,
      error: {
        code: "23505",
        message: "duplicate key value violates unique constraint",
      },
    });
    const racedLookupChain = createChain({
      data: {
        id: "log-4",
        member_id: actor.id,
        locked_by_site_close_id: null,
      },
      error: null,
    });
    const updateChain = createChain({
      data: {
        id: "log-4",
        member_id: actor.id,
        site_id: baseInput.site_id,
        date: baseInput.date,
        credited_unit: 1.75,
        memo: "race recovered",
      },
      error: null,
    });

    setupMockFromSequence(mockFrom, [
      activeSiteChain(),
      initialLookupChain,
      insertChain,
      racedLookupChain,
      updateChain,
    ]);

    const result = await service.upsertDayLog(
      {
        ...baseInput,
        credited_unit: 1.75,
        memo: "race recovered",
      },
      actor,
    );

    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: orgId,
        member_id: actor.id,
      }),
    );
    expect(updateChain.eq).toHaveBeenCalledWith("id", "log-4");
    expect(result).toEqual(
      expect.objectContaining({
        id: "log-4",
        credited_unit: 1.75,
      }),
    );
  });

  it("rejects day-log writes after site completion", async () => {
    const service = new PathV31Service(orgId);
    const completedSiteChain = createChain({
      data: {
        id: baseInput.site_id,
        status: "completed",
      },
      error: null,
    });

    setupMockFromSequence(mockFrom, [completedSiteChain]);

    await expect(service.upsertDayLog(baseInput, actor)).rejects.toThrow("SITE_COMPLETED_DAY_LOG_IMMUTABLE");
  });
});
