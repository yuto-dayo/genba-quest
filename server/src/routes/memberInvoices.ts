/**
 * Member Invoices Router (Phase 2-2a)
 * ============================================================
 * 本人主導の請求書フロー (member → org)。
 *
 * DAO 原則:
 *  - admin による「他人の請求書一覧」UI は意図的に存在させない
 *  - 個別の請求書 (snapshot 含む) は本人のみが読める
 *  - admin が読めるのは status × period_month の集計だけ (PII なし)
 *  - 申請者 = 承認者 = 本人。AI / admin / system は介在しない
 */

import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { resolveActiveOrgMembership } from "../lib/orgAccess";
import { ActorRef } from "../services/PolicyEngine";
import { ProposalService } from "../services/ProposalService";
import {
    MemberInvoiceService,
    memberInvoiceService,
} from "../services/MemberInvoiceService";

const router = Router();

function buildActor(req: AuthenticatedRequest): ActorRef {
    return {
        type: "human",
        id: req.userId!,
        name: req.userName || "Member",
    };
}

function getService(): MemberInvoiceService {
    return memberInvoiceService;
}

function isUuid(value: unknown): value is string {
    return (
        typeof value === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    );
}

function handleError(res: Response, err: unknown): void {
    const code = err instanceof Error ? err.message : "UNKNOWN_ERROR";
    const map: Record<string, number> = {
        MEMBER_INVOICE_INVALID_PAYLOAD: 400,
        MEMBER_INVOICE_INVALID_PERIOD: 400,
        MEMBER_INVOICE_INVALID_SOURCE: 400,
        MEMBER_INVOICE_AMOUNT_INVALID: 400,
        MEMBER_INVOICE_DRAFT_NOT_FOUND: 404,
        MEMBER_INVOICE_CREATOR_MUST_BE_SELF: 403,
        MEMBER_INVOICE_APPROVER_MUST_BE_SELF: 403,
        MEMBER_INVOICE_APPROVER_MUST_BE_HUMAN: 403,
        MEMBER_BANK_INFO_INCOMPLETE: 422,
        MEMBER_PROFILE_NOT_FOUND: 404,
        ADMIN_ROLE_REQUIRED: 403,
        NOT_MEMBER_OF_ORG: 403,
    };
    const status = map[code] ?? 500;
    if (status === 500) {
        console.error("[MEMBER_INVOICE] unhandled error:", err);
    }
    res.status(status).json({ error: code });
}

// ============================================================
// GET /member-invoices/drafts
// 自分宛 (申請者本人視点) のドラフト候補。読まれるのは calling user 自身のぶんのみ。
// ============================================================
router.get("/member-invoices/drafts", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const membership = await resolveActiveOrgMembership(req, "member");
        const drafts = await getService().listDraftCandidatesForMember({
            orgId: membership.org_id,
            memberId: req.userId!,
        });
        res.json({ drafts });
    } catch (err) {
        handleError(res, err);
    }
});

// ============================================================
// POST /member-invoices/issue
// 本人が「この内容で請求書を発行する」を確定する。
// Proposal を起票 → submit → 自分で approve (auto execute) → member_invoices に行が立つ。
// ============================================================
router.post("/member-invoices/issue", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const membership = await resolveActiveOrgMembership(req, "member");
        const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<
            string,
            unknown
        >;
        const source = typeof body.source === "string" ? body.source : null;
        const sourceRefId = typeof body.source_ref_id === "string" ? body.source_ref_id : null;
        const periodMonth = typeof body.period_month === "string" ? body.period_month : null;

        if (!source || !["path_reward", "monthly_distribution", "manual"].includes(source)) {
            throw new Error("MEMBER_INVOICE_INVALID_SOURCE");
        }
        if (!periodMonth || !/^\d{4}-\d{2}$/.test(periodMonth)) {
            throw new Error("MEMBER_INVOICE_INVALID_PERIOD");
        }

        const service = getService();

        // ドラフトをサーバ側で再評価する (画面側の改ざんを信用しない)。
        const drafts = await service.listDraftCandidatesForMember({
            orgId: membership.org_id,
            memberId: req.userId!,
        });
        const draft = drafts.find(
            (item) =>
                item.source === source &&
                item.source_ref_id === sourceRefId &&
                item.period_month === periodMonth,
        );
        if (!draft) {
            throw new Error("MEMBER_INVOICE_DRAFT_NOT_FOUND");
        }

        // 本人プロフィールから snapshot を組み立てる (振込先未入力なら 422 で停止)
        const snapshot = await service.buildSnapshotForMember(req.userId!);

        const proposalService = new ProposalService(membership.org_id);
        const actor = buildActor(req);

        const created = await proposalService.create({
            type: "invoice.member_issue",
            payload: {
                member_id: req.userId,
                period_month: draft.period_month,
                source: draft.source,
                source_ref_id: draft.source_ref_id,
                amount_total: draft.amount_total,
                line_items: draft.line_items,
                snapshot_profile: {
                    trade_name: snapshot.trade_name,
                    invoice_registration_no: snapshot.invoice_registration_no,
                    bank: snapshot.bank,
                    address: snapshot.address,
                },
            },
            description: `${draft.label} の請求書発行 (¥${draft.amount_total.toLocaleString()})`,
            created_by: actor,
            org_id: membership.org_id,
        });

        // draft → pending → approved (本人承認) → executed まで一気に進める
        await proposalService.submit(created.id, actor);
        const approveResult = await proposalService.approve(created.id, actor);

        const invoice = await service.findByProposalId(created.id);

        res.status(201).json({
            proposal: approveResult.proposal,
            invoice,
        });
    } catch (err) {
        handleError(res, err);
    }
});

// ============================================================
// GET /member-invoices/mine
// 自分が発行した請求書の一覧 (本人視点のみ)。
// ============================================================
router.get("/member-invoices/mine", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const membership = await resolveActiveOrgMembership(req, "member");
        const invoices = await getService().listIssuedInvoicesForMember({
            orgId: membership.org_id,
            memberId: req.userId!,
        });
        res.json({ invoices });
    } catch (err) {
        handleError(res, err);
    }
});

// ============================================================
// GET /org/invoices/outstanding-summary
// admin 向けの集計 (PII を含まない)。RPC 内で admin 権限を強制する。
// ============================================================
router.get(
    "/org/invoices/outstanding-summary",
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            const membership = await resolveActiveOrgMembership(req, "admin");
            const summary = await getService().getOutstandingSummary({
                orgId: membership.org_id,
            });
            // status ごとの粗集計も同梱
            const totals = summary.reduce(
                (acc, row) => {
                    if (row.status === "issued") {
                        acc.issued.count += row.invoice_count;
                        acc.issued.amount += row.total_amount;
                    } else if (row.status === "paid") {
                        acc.paid.count += row.invoice_count;
                        acc.paid.amount += row.total_amount;
                    }
                    return acc;
                },
                {
                    issued: { count: 0, amount: 0 },
                    paid: { count: 0, amount: 0 },
                },
            );
            res.json({ summary, totals });
        } catch (err) {
            handleError(res, err);
        }
    },
);

export default router;
