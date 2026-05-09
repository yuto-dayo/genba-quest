import { supabaseAdmin } from "../lib/supabaseClient";

const SITE_SELECT = "*";

const COMPLETE_SITE_KNOWN_ERRORS = [
  "SITE_NOT_FOUND",
  "SITE_REVENUE_REQUIRED_FOR_AUTO_INCOME",
  "SITE_COMPLETION_ALREADY_ACTIVE",
  "RPC_MEMBERSHIP_REQUIRED",
] as const;

const REVERSE_SITE_COMPLETION_KNOWN_ERRORS = [
  "SITE_NOT_FOUND",
  "SITE_COMPLETION_NOT_ACTIVE",
  "RPC_MEMBERSHIP_REQUIRED",
] as const;

export interface SiteCompletionRpcPayload {
  site_id: string;
  site_completion_event_id: string | null;
  revenue_basis_id: string | null;
  income_proposal_id: string | null;
  idempotent: boolean;
}

export interface SiteCompletionReversalRpcPayload {
  site_id: string;
  reversal_event_id: string | null;
  revenue_basis_id: string | null;
  income_reverse_proposal_id: string | null;
  reward_adjust_proposal_id: string | null;
  idempotent: boolean;
}

export interface SiteRecord {
  id: string;
  org_id: string;
  status: string;
  completed_at: string | null;
  [key: string]: unknown;
}

export interface CompleteSiteInput {
  siteId: string;
  actorUserId: string;
  membershipId?: string | null;
  effectiveCompletedAt?: string;
}

export interface ReverseSiteCompletionInput {
  siteId: string;
  actorUserId: string;
  membershipId?: string | null;
  effectiveReversedAt?: string;
  reason?: string | null;
}

export interface CompleteSiteResult extends SiteCompletionRpcPayload {
  site: SiteRecord;
}

export interface ReverseSiteCompletionResult extends SiteCompletionReversalRpcPayload {
  site: SiteRecord;
}

export class SiteCompletionService {
  constructor(private readonly orgId: string) {}

  async completeSite(input: CompleteSiteInput): Promise<CompleteSiteResult> {
    const rpcResult = await this.callCompleteSiteRpc(input);
    const site = await this.fetchSite(input.siteId);

    if (!rpcResult.idempotent) {
      await this.createSiteLevelDraftNotifications(site).catch((error) => {
        console.warn("[SITE_COMPLETION] Failed to create site level draft notifications:", error);
      });
    }

    return {
      ...rpcResult,
      site,
    };
  }

  async reverseSiteCompletion(
    input: ReverseSiteCompletionInput
  ): Promise<ReverseSiteCompletionResult> {
    const rpcResult = await this.callReverseSiteCompletionRpc(input);
    const site = await this.fetchSite(input.siteId);

    return {
      ...rpcResult,
      site,
    };
  }

  private async callCompleteSiteRpc(
    input: CompleteSiteInput
  ): Promise<SiteCompletionRpcPayload> {
    const rpcClient = supabaseAdmin as unknown as {
      rpc?: (
        fn: string,
        args?: Record<string, unknown>
      ) => Promise<{ data: unknown; error: { message?: string } | null }>;
    };

    if (typeof rpcClient.rpc !== "function") {
      throw new Error("SITE_COMPLETION_RPC_NOT_AVAILABLE");
    }

    const { data, error } = await rpcClient.rpc("complete_site_rpc", {
      p_org_id: this.orgId,
      p_site_id: input.siteId,
      p_actor_user_id: input.actorUserId,
      p_membership_id: input.membershipId ?? null,
      p_effective_completed_at: input.effectiveCompletedAt ?? null,
    });

    if (error) {
      throw this.normalizeRpcError(
        error.message,
        "complete_site_rpc",
        COMPLETE_SITE_KNOWN_ERRORS,
        "SITE_COMPLETION_RPC_NOT_AVAILABLE"
      );
    }

    const payload = this.normalizeRpcPayload<SiteCompletionRpcPayload>(data);
    if (!payload) {
      throw new Error("SITE_COMPLETION_RPC_EMPTY_RESULT");
    }

    return payload;
  }

  private async callReverseSiteCompletionRpc(
    input: ReverseSiteCompletionInput
  ): Promise<SiteCompletionReversalRpcPayload> {
    const rpcClient = supabaseAdmin as unknown as {
      rpc?: (
        fn: string,
        args?: Record<string, unknown>
      ) => Promise<{ data: unknown; error: { message?: string } | null }>;
    };

    if (typeof rpcClient.rpc !== "function") {
      throw new Error("SITE_COMPLETION_REVERSAL_RPC_NOT_AVAILABLE");
    }

    const { data, error } = await rpcClient.rpc("reverse_site_completion_rpc", {
      p_org_id: this.orgId,
      p_site_id: input.siteId,
      p_actor_user_id: input.actorUserId,
      p_membership_id: input.membershipId ?? null,
      p_effective_reversed_at: input.effectiveReversedAt ?? null,
      p_reason: input.reason ?? null,
    });

    if (error) {
      throw this.normalizeRpcError(
        error.message,
        "reverse_site_completion_rpc",
        REVERSE_SITE_COMPLETION_KNOWN_ERRORS,
        "SITE_COMPLETION_REVERSAL_RPC_NOT_AVAILABLE"
      );
    }

    const payload = this.normalizeRpcPayload<SiteCompletionReversalRpcPayload>(data);
    if (!payload) {
      throw new Error("SITE_COMPLETION_REVERSAL_RPC_EMPTY_RESULT");
    }

    return payload;
  }

  private async fetchSite(siteId: string): Promise<SiteRecord> {
    const { data, error } = await supabaseAdmin
      .from("sites")
      .select(SITE_SELECT)
      .eq("id", siteId)
      .eq("org_id", this.orgId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      throw new Error("SITE_NOT_FOUND");
    }

    return data as SiteRecord;
  }

  private async createSiteLevelDraftNotifications(site: SiteRecord): Promise<void> {
    if (site.status !== "completed") {
      return;
    }

    const assignedUserIds = normalizeStringArray(site.assigned_users);
    if (assignedUserIds.length === 0) {
      return;
    }

    const siteName = typeof site.name === "string" && site.name.trim()
      ? site.name.trim()
      : "完了した現場";
    const completedAt = typeof site.completed_at === "string" ? site.completed_at : null;
    const uniqueUserIds = Array.from(new Set(assignedUserIds));

    const { error } = await supabaseAdmin.from("notifications").insert(
      uniqueUserIds.map((userId) => ({
        user_id: userId,
        type: "system_alert",
        title: `現場完了: ${siteName}`,
        message: "現場内容を見ながら、自分の役割とPATHレベルを入力してください。",
        data: {
          task_type: "site_level_draft",
          site_id: site.id,
          site_name: siteName,
          member_id: userId,
          completed_at: completedAt,
        },
      })),
    );

    if (error) {
      throw new Error(`Failed to create site level draft notifications: ${error.message}`);
    }
  }

  private normalizeRpcPayload<T>(data: unknown): T | null {
    if (!data) {
      return null;
    }

    if (Array.isArray(data)) {
      return (data[0] || null) as T | null;
    }

    if (typeof data === "object") {
      return data as T;
    }

    return null;
  }

  private normalizeRpcError(
    message: string | undefined,
    functionName: string,
    knownErrors: readonly string[],
    missingFunctionError: string
  ): Error {
    const safeMessage = message || "";
    const functionMissing =
      safeMessage.includes(functionName) &&
      (safeMessage.includes("does not exist") ||
        safeMessage.includes("Could not find the function"));

    if (functionMissing) {
      return new Error(missingFunctionError);
    }

    for (const errorCode of knownErrors) {
      if (safeMessage.includes(errorCode)) {
        return new Error(errorCode);
      }
    }

    return new Error(safeMessage || "SITE_COMPLETION_RPC_FAILED");
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}
