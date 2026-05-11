/**
 * Profile View Consent Router
 * ============================================================
 * 拡張プロフィール閲覧 (振込先 / インボイス番号 / 住所 / 緊急連絡) の本人承認フロー。
 *
 * DAO 原則:
 *  - admin による監視 UI は作らない (個別 grant のリストは「自分視点」のみ)
 *  - 個人情報は本人 Proposal 承認なしに admin 取得不可
 *  - revoke は本人のみ可能
 *  - 全アクセスを governance_events に記録
 */

import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { resolveActiveOrgMembership } from "../lib/orgAccess";
import { supabaseAdmin } from "../lib/supabaseClient";
import { ActorRef } from "../services/PolicyEngine";
import { ProposalService } from "../services/ProposalService";
import { assignReviewer } from "../services/ProposalAssignmentService";
import {
    ProfileViewConsentService,
    profileViewConsentService,
} from "../services/ProfileViewConsentService";

const router = Router();

const MIN_PURPOSE_LENGTH = 4;
const MAX_PURPOSE_LENGTH = 500;
const DEFAULT_DURATION_HOURS = 24;
const MAX_DURATION_HOURS = 24 * 7;

function buildActor(req: AuthenticatedRequest): ActorRef {
    return {
        type: "human",
        id: req.userId!,
        name: req.userName || "Unknown User",
    };
}

function isUuid(value: unknown): value is string {
    return (
        typeof value === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    );
}

function getConsentService(): ProfileViewConsentService {
    return profileViewConsentService;
}

function handleConsentError(res: Response, err: unknown): void {
    const code = err instanceof Error ? err.message : "UNKNOWN_ERROR";

    const map: Record<string, number> = {
        PROFILE_VIEW_GRANT_NOT_FOUND: 404,
        PROFILE_VIEW_GRANT_REVOKE_NOT_ALLOWED: 403,
        PROFILE_VIEW_GRANT_REQUIRED: 403,
        PROFILE_VIEW_REQUEST_PURPOSE_TOO_SHORT: 400,
        PROFILE_VIEW_REQUEST_PURPOSE_TOO_LONG: 400,
        PROFILE_VIEW_REQUEST_TARGET_REQUIRED: 400,
        PROFILE_VIEW_REQUEST_DURATION_INVALID: 400,
        PROFILE_VIEW_REQUEST_SELF_REQUEST_PROHIBITED: 400,
        PROFILE_VIEW_REQUEST_REQUESTER_MUST_BE_ADMIN: 403,
        PROFILE_VIEW_REQUEST_TARGET_NOT_IN_ORG: 404,
        PROFILE_NOT_FOUND: 404,
    };

    const status = map[code] ?? 500;
    if (status === 500) {
        console.error("[PROFILE_VIEW_CONSENT] unhandled error:", err);
    }
    res.status(status).json({ error: code });
}

// ============================================================
// POST /profile-view-requests
// admin が本人承認を伴う閲覧 Proposal を発行する。
// ============================================================
router.post("/profile-view-requests", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const membership = await resolveActiveOrgMembership(req, "admin");

        const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<
            string,
            unknown
        >;
        const targetUserId = body.target_user_id;
        const purposeRaw = body.purpose;
        const durationRaw = body.duration_hours;

        if (!isUuid(targetUserId)) {
            throw new Error("PROFILE_VIEW_REQUEST_TARGET_REQUIRED");
        }

        if (targetUserId === req.userId) {
            throw new Error("PROFILE_VIEW_REQUEST_SELF_REQUEST_PROHIBITED");
        }

        const purpose = typeof purposeRaw === "string" ? purposeRaw.trim() : "";
        if (purpose.length < MIN_PURPOSE_LENGTH) {
            throw new Error("PROFILE_VIEW_REQUEST_PURPOSE_TOO_SHORT");
        }
        if (purpose.length > MAX_PURPOSE_LENGTH) {
            throw new Error("PROFILE_VIEW_REQUEST_PURPOSE_TOO_LONG");
        }

        const durationHours = (() => {
            if (durationRaw == null) return DEFAULT_DURATION_HOURS;
            const numeric = typeof durationRaw === "number" ? durationRaw : Number(durationRaw);
            if (!Number.isFinite(numeric) || numeric <= 0) {
                throw new Error("PROFILE_VIEW_REQUEST_DURATION_INVALID");
            }
            return Math.min(Math.max(1, Math.floor(numeric)), MAX_DURATION_HOURS);
        })();

        // target が同じ org の active member であることを確認 (覗き見対象は自分の組織のメンバーに限る)
        const { data: targetMembership, error: membershipError } = await supabaseAdmin
            .from("org_memberships")
            .select("user_id,status")
            .eq("org_id", membership.org_id)
            .eq("user_id", targetUserId)
            .eq("status", "active")
            .maybeSingle();

        if (membershipError) {
            throw membershipError;
        }
        if (!targetMembership) {
            throw new Error("PROFILE_VIEW_REQUEST_TARGET_NOT_IN_ORG");
        }

        const service = new ProposalService(membership.org_id);
        const actor = buildActor(req);

        const created = await service.create({
            type: "profile.view_request",
            payload: {
                target_user_id: targetUserId,
                requesting_admin_id: req.userId,
                purpose,
                duration_hours: durationHours,
            },
            description: `拡張プロフィール閲覧の本人承認 (目的: ${purpose.slice(0, 80)})`,
            created_by: actor,
            org_id: membership.org_id,
        });

        // draft → pending へ即時遷移 (本人の承認待ち)
        const submitted = await service.submit(created.id, actor);

        // ランダム割当ではなく target_user_id を確実に承認担当として上書き割当する。
        // assignOnSubmit が起票直後にランダム reviewer を入れている可能性があるので、
        // reason='reassigned' で active な割当を閉じてから新規割当する。
        try {
            await assignReviewer({
                org_id: membership.org_id,
                proposal_id: submitted.proposal.id,
                reviewer_id: targetUserId,
                reason: "reassigned",
            });
        } catch (assignErr) {
            console.error("[PROFILE_VIEW_CONSENT] failed to pin assignment to target:", assignErr);
            // 割当失敗はクリティカルではない (assertCanApprove で防御線あり)
        }

        res.status(201).json({
            proposal: submitted.proposal,
            auto_approved: submitted.autoApproved,
            auto_executed: submitted.autoExecuted,
        });
    } catch (err) {
        handleConsentError(res, err);
    }
});

// ============================================================
// POST /profile-view-grants/:grantId/revoke
// 本人 (target) が grant を取り消す。
// ============================================================
router.post(
    "/profile-view-grants/:grantId/revoke",
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            await resolveActiveOrgMembership(req, "member");

            const grantId = req.params.grantId;
            if (!isUuid(grantId)) {
                throw new Error("PROFILE_VIEW_GRANT_NOT_FOUND");
            }

            const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;
            const service = getConsentService();
            const updated = await service.revokeGrant({
                grantId,
                revokingUserId: req.userId!,
                revokingUserName: req.userName ?? null,
                reason,
            });

            res.json({ grant: updated });
        } catch (err) {
            handleConsentError(res, err);
        }
    },
);

// ============================================================
// GET /profile-view-grants/incoming
// 自分 (target) 宛の grant を一覧する。
// ============================================================
router.get(
    "/profile-view-grants/incoming",
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            const membership = await resolveActiveOrgMembership(req, "member");
            const service = getConsentService();
            const grants = await service.listGrantsForTarget({
                orgId: membership.org_id,
                targetUserId: req.userId!,
            });

            res.json({ grants });
        } catch (err) {
            handleConsentError(res, err);
        }
    },
);

// ============================================================
// GET /profile-view-grants/outgoing
// 自分 (admin) が申請した grant を一覧する。他 admin の grant は意図的に見せない。
// ============================================================
router.get(
    "/profile-view-grants/outgoing",
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            const membership = await resolveActiveOrgMembership(req, "admin");
            const service = getConsentService();
            const grants = await service.listGrantsForRequester({
                orgId: membership.org_id,
                requestingAdminId: req.userId!,
            });

            res.json({ grants });
        } catch (err) {
            handleConsentError(res, err);
        }
    },
);

// ============================================================
// GET /profile-view-extended/:userId
// admin が拡張プロフィールを取得する。active grant が必要 (自分自身を除く)。
// アクセス記録 (governance.profile_view.accessed) が必ず追記される。
// ============================================================
router.get(
    "/profile-view-extended/:userId",
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            const membership = await resolveActiveOrgMembership(req, "member");
            const targetUserId = req.params.userId;
            if (!isUuid(targetUserId)) {
                throw new Error("PROFILE_VIEW_REQUEST_TARGET_REQUIRED");
            }

            // 自分自身でない場合は admin 権限が必要 (overhead だが防御的)
            if (targetUserId !== req.userId && membership.role !== "admin") {
                throw new Error("PROFILE_VIEW_REQUEST_REQUESTER_MUST_BE_ADMIN");
            }

            const service = getConsentService();
            const result = await service.getExtendedProfileForViewer({
                orgId: membership.org_id,
                targetUserId,
                viewer: buildActor(req),
            });

            res.json(result);
        } catch (err) {
            handleConsentError(res, err);
        }
    },
);

export default router;
