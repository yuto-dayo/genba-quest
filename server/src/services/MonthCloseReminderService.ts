import { supabaseAdmin } from "../lib/supabaseAdmin";

const REPORTING_MONTH_PATTERN = /^\d{4}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type MonthCloseReminderError = {
  org_id: string;
  reason: string;
};

export type MonthCloseReminderSummary = {
  target_month: string;
  orgs_processed: number;
  orgs_already_finalized: number;
  notifications_inserted: number;
  errors: MonthCloseReminderError[];
};

export type MonthCloseReminderOptions = {
  month?: string;
  force?: boolean;
};

type OrgRow = {
  id: string;
};

type MembershipRow = {
  user_id: string;
};

type ExistingNotificationRow = {
  user_id: string;
};

function formatYearMonth(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function previousMonthInJst(now: Date): string {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const previousMonthUtc = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() - 1, 1));
  return formatYearMonth(previousMonthUtc);
}

function jstDayWindow(now: Date): { startIso: string; endIso: string } {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const startUtcMs = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - JST_OFFSET_MS;
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000;
  return {
    startIso: new Date(startUtcMs).toISOString(),
    endIso: new Date(endUtcMs).toISOString(),
  };
}

function assertMonth(month: string): void {
  if (!REPORTING_MONTH_PATTERN.test(month)) {
    throw new Error("INVALID_MONTH_FORMAT");
  }

  const monthPart = Number(month.slice(5, 7));
  if (monthPart < 1 || monthPart > 12) {
    throw new Error("INVALID_MONTH_FORMAT");
  }
}

function uniqueUuidValues(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => UUID_PATTERN.test(value))));
}

export class MonthCloseReminderService {
  constructor(private readonly now: Date = new Date()) {}

  async remindClose(options: MonthCloseReminderOptions = {}): Promise<MonthCloseReminderSummary> {
    const targetMonth = options.month ?? previousMonthInJst(this.now);
    assertMonth(targetMonth);

    const orgs = await this.listActiveOrgs();
    const summary: MonthCloseReminderSummary = {
      target_month: targetMonth,
      orgs_processed: 0,
      orgs_already_finalized: 0,
      notifications_inserted: 0,
      errors: [],
    };

    for (const org of orgs) {
      summary.orgs_processed += 1;

      try {
        if (!options.force && await this.isMonthFinalized(org.id, targetMonth)) {
          summary.orgs_already_finalized += 1;
          continue;
        }

        const inserted = await this.notifyOrgMembers(org.id, targetMonth);
        summary.notifications_inserted += inserted;
      } catch (error) {
        summary.errors.push({
          org_id: org.id,
          reason: error instanceof Error ? error.message : "UNKNOWN_ERROR",
        });
      }
    }

    return summary;
  }

  private async listActiveOrgs(): Promise<OrgRow[]> {
    const { data, error } = await supabaseAdmin
      .from("organizations")
      .select("id")
      .eq("status", "active");

    if (error) {
      throw new Error(`Failed to list organizations: ${error.message}`);
    }

    return ((data ?? []) as OrgRow[]).filter((org) => UUID_PATTERN.test(org.id));
  }

  private async isMonthFinalized(orgId: string, month: string): Promise<boolean> {
    const { data, error } = await supabaseAdmin
      .from("month_closes")
      .select("id")
      .eq("org_id", orgId)
      .eq("period_ym", month)
      .eq("status", "fixed")
      .limit(1);

    if (error) {
      throw new Error(`Failed to check month finalization: ${error.message}`);
    }

    return Array.isArray(data) && data.length > 0;
  }

  private async listActiveMemberUserIds(orgId: string): Promise<string[]> {
    const { data, error } = await supabaseAdmin
      .from("org_memberships")
      .select("user_id")
      .eq("org_id", orgId)
      .eq("status", "active");

    if (error) {
      throw new Error(`Failed to list active members: ${error.message}`);
    }

    return uniqueUuidValues(((data ?? []) as MembershipRow[]).map((row) => row.user_id));
  }

  private async notifyOrgMembers(orgId: string, month: string): Promise<number> {
    const userIds = await this.listActiveMemberUserIds(orgId);
    if (userIds.length === 0) {
      return 0;
    }

    const existingUserIds = await this.listExistingReminderUserIds(orgId, month, userIds);
    const missingUserIds = userIds.filter((userId) => !existingUserIds.has(userId));
    if (missingUserIds.length === 0) {
      return 0;
    }

    const { error } = await supabaseAdmin.from("notifications").insert(
      missingUserIds.map((userId) => ({
        user_id: userId,
        type: "month_close_reminder",
        title: "月確定の確認",
        message: `${month} の月確定がまだ完了していません。内容を確認してください。`,
        data: {
          task_type: "month_close_reminder",
          org_id: orgId,
          month,
        },
      })),
    );

    if (error) {
      throw new Error(`Failed to insert month close reminders: ${error.message}`);
    }

    return missingUserIds.length;
  }

  private async listExistingReminderUserIds(
    orgId: string,
    month: string,
    userIds: string[],
  ): Promise<Set<string>> {
    const window = jstDayWindow(this.now);
    const { data, error } = await supabaseAdmin
      .from("notifications")
      .select("user_id")
      .in("user_id", userIds)
      .eq("type", "month_close_reminder")
      .eq("data->>org_id", orgId)
      .eq("data->>month", month)
      .gte("created_at", window.startIso)
      .lt("created_at", window.endIso);

    if (error) {
      throw new Error(`Failed to list existing month close reminders: ${error.message}`);
    }

    return new Set(
      ((data ?? []) as ExistingNotificationRow[])
        .map((row) => row.user_id)
        .filter((userId) => UUID_PATTERN.test(userId)),
    );
  }
}
