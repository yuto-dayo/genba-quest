jest.mock("../../lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { MonthCloseReminderService } from "../../services/MonthCloseReminderService";
import { createChain, setupMockFromSequence } from "../helpers/mockSupabase";

describe("MonthCloseReminderService", () => {
  const orgId = "00000000-0000-4000-8000-000000000001";
  const userIdA = "11111111-1111-4111-8111-111111111111";
  const userIdB = "22222222-2222-4222-8222-222222222222";
  const now = new Date("2026-06-03T00:30:00+09:00");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("inserts reminders for active members when the previous month is not finalized", async () => {
    const organizations = createChain({ data: [{ id: orgId }], error: null });
    const finalizedCheck = createChain({ data: [], error: null });
    const memberships = createChain({
      data: [{ user_id: userIdA }, { user_id: userIdB }],
      error: null,
    });
    const existingReminders = createChain({ data: [], error: null });
    const notificationInsert = createChain({ data: null, error: null });
    setupMockFromSequence(supabaseAdmin.from as jest.Mock, [
      organizations,
      finalizedCheck,
      memberships,
      existingReminders,
      notificationInsert,
    ]);

    const result = await new MonthCloseReminderService(now).remindClose();

    expect(result).toEqual({
      target_month: "2026-05",
      orgs_processed: 1,
      orgs_already_finalized: 0,
      notifications_inserted: 2,
      errors: [],
    });
    expect(notificationInsert.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        user_id: userIdA,
        type: "month_close_reminder",
        data: expect.objectContaining({ org_id: orgId, month: "2026-05" }),
      }),
      expect.objectContaining({
        user_id: userIdB,
        type: "month_close_reminder",
        data: expect.objectContaining({ org_id: orgId, month: "2026-05" }),
      }),
    ]);
  });

  it("skips finalized orgs without inserting notifications", async () => {
    const organizations = createChain({ data: [{ id: orgId }], error: null });
    const finalizedCheck = createChain({ data: [{ id: "33333333-3333-4333-8333-333333333333" }], error: null });
    setupMockFromSequence(supabaseAdmin.from as jest.Mock, [organizations, finalizedCheck]);

    const result = await new MonthCloseReminderService(now).remindClose({ month: "2026-05" });

    expect(result).toEqual({
      target_month: "2026-05",
      orgs_processed: 1,
      orgs_already_finalized: 1,
      notifications_inserted: 0,
      errors: [],
    });
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2);
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith("notifications");
  });
});
