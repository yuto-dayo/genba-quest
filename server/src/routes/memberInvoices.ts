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
import { requireOrgMembership } from "../middleware/orgMembership";
import { resolveActiveOrgMembership } from "../lib/orgAccess";
import { ActorRef } from "../services/PolicyEngine";
import { ProposalService } from "../services/ProposalService";
import {
    MemberInvoiceService,
    memberInvoiceService,
} from "../services/MemberInvoiceService";

const router = Router();
router.use(requireOrgMembership("member"));

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
        // Phase 2-2b
        MEMBER_INVOICE_NOT_FOUND: 404,
        MEMBER_INVOICE_NOT_IN_ISSUED_STATE: 409,
        MEMBER_INVOICE_MARK_PAID_OWNER_CANNOT_SELF_APPROVE: 403,
        MEMBER_INVOICE_MARK_PAID_APPROVER_MUST_BE_HUMAN: 403,
        MEMBER_INVOICE_MARK_PAID_APPROVER_MUST_BE_ADMIN: 403,
        MEMBER_INVOICE_MARK_PAID_INVOICE_MISSING: 400,
        INVOICE_REVIEW_ASSIGNMENT_NOT_FOUND: 403,
        INVOICE_REVIEW_ASSIGNMENT_EXPIRED: 403,
        INVOICE_REVIEW_ASSIGNMENT_COMPLETED: 403,
        MEMBER_INVOICE_VOID_APPROVER_MUST_BE_HUMAN: 403,
        MEMBER_INVOICE_VOID_APPROVER_MUST_BE_OWNER: 403,
        MEMBER_INVOICE_VOID_CREATOR_MUST_BE_OWNER: 403,
        MEMBER_INVOICE_VOID_INVOICE_MISSING: 400,
        MEMBER_INVOICE_VOID_REASON_REQUIRED: 400,
        MEMBER_INVOICE_VOID_REASON_TOO_LONG: 400,
        INVALID_STATUS_FILTER: 400,
    };
    const status = map[code] ?? 500;
    if (status === 500) {
        console.error("[MEMBER_INVOICE] unhandled error:", err);
    }
    res.status(status).json({ error: code });
}

function buildPaymentSummary(invoice: Awaited<ReturnType<MemberInvoiceService["findById"]>>) {
    if (!invoice) {
        return null;
    }
    return {
        id: invoice.id,
        org_id: invoice.org_id,
        invoice_no: invoice.invoice_no,
        period_month: invoice.period_month,
        amount_total: invoice.amount_total,
        status: invoice.status,
        source: invoice.source,
        issued_at: invoice.issued_at,
        paid_at: invoice.paid_at ?? null,
        paid_proposal_id: invoice.paid_proposal_id ?? null,
        paid_method: invoice.paid_method ?? null,
    };
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
                // Phase 2-2b: accrual 仕訳 (Dr 外注費 / Cr 未払金) を立てるため
                // execute_proposal_atomic RPC が読む内部 transfer 用フィールドを埋める。
                amount: draft.amount_total,
                debit_account_code: "5600", // 外注費
                credit_account_code: "2110", // 未払金
                description: `${draft.label} 請求書発行 (member-led)`,
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
                userId: req.userId!,
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

// ============================================================
// Phase 2-2b
// ============================================================

// GET /org/invoices/admin-actionable
// admin が支払い対象 (status=issued) を選ぶための最小情報リスト。PII 含まない。
router.get(
    "/org/invoices/admin-actionable",
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            const membership = await resolveActiveOrgMembership(req, "admin");
            const statusRaw = typeof req.query.status === "string" ? req.query.status : "issued";
            if (!["issued", "paid", "void"].includes(statusRaw)) {
                throw new Error("INVALID_STATUS_FILTER");
            }
            const invoices = await getService().listAdminActionableInvoices({
                orgId: membership.org_id,
                status: statusRaw as "issued" | "paid" | "void",
                userId: req.userId!,
            });
            res.json({ invoices });
        } catch (err) {
            handleError(res, err);
        }
    },
);

// POST /member-invoices/:invoiceId/mark-paid
// admin が「振込が完了した」事実を Proposal として記録する。
// 申請者 = 承認者 = admin (発行者本人=member は禁止)。
router.post(
    "/member-invoices/:invoiceId/mark-paid",
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            const membership = await resolveActiveOrgMembership(req, "admin");
            const invoiceId = req.params.invoiceId;
            if (!isUuid(invoiceId)) {
                throw new Error("MEMBER_INVOICE_NOT_FOUND");
            }

            const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<
                string,
                unknown
            >;
            const paidAt = typeof body.paid_at === "string" ? body.paid_at : new Date().toISOString();
            const paidMethod = typeof body.paid_method === "string" ? body.paid_method : null;

            const service = getService();
            const invoice = await service.findById(invoiceId);
            if (!invoice || invoice.org_id !== membership.org_id) {
                throw new Error("MEMBER_INVOICE_NOT_FOUND");
            }
            if (invoice.member_id === req.userId) {
                // assertCanApprove でも弾けるが route 入口でも早期に止める
                throw new Error("MEMBER_INVOICE_MARK_PAID_OWNER_CANNOT_SELF_APPROVE");
            }
            if (invoice.status !== "issued") {
                throw new Error("MEMBER_INVOICE_NOT_IN_ISSUED_STATE");
            }

            const proposalService = new ProposalService(membership.org_id);
            const actor = buildActor(req);

            const created = await proposalService.create({
                type: "invoice.member_mark_paid",
                payload: {
                    invoice_id: invoice.id,
                    invoice_no: invoice.invoice_no,
                    paid_at: paidAt,
                    paid_method: paidMethod,
                    // 仕訳: Dr 未払金 / Cr 現金 (execute RPC が自動生成)
                    amount: invoice.amount_total,
                    debit_account_code: "2110",
                    credit_account_code: "1100",
                    description: `${invoice.invoice_no} 支払い`,
                },
                description: `${invoice.invoice_no} を支払い済みに記録 (¥${invoice.amount_total.toLocaleString()})`,
                created_by: actor,
                org_id: membership.org_id,
            });

            await proposalService.submit(created.id, actor);
            const approved = await proposalService.approve(created.id, actor);

            const updated = await service.findById(invoice.id);

            res.status(201).json({
                proposal: approved.proposal,
                invoice: buildPaymentSummary(updated),
            });
        } catch (err) {
            handleError(res, err);
        }
    },
);

// POST /member-invoices/:invoiceId/void
// 発行者本人が自分の請求書を取り消す。issued 状態のみ対象。
router.post(
    "/member-invoices/:invoiceId/void",
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            const membership = await resolveActiveOrgMembership(req, "member");
            const invoiceId = req.params.invoiceId;
            if (!isUuid(invoiceId)) {
                throw new Error("MEMBER_INVOICE_NOT_FOUND");
            }

            const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<
                string,
                unknown
            >;
            const reasonRaw = typeof body.reason === "string" ? body.reason.trim() : "";
            if (reasonRaw.length < 2) {
                throw new Error("MEMBER_INVOICE_VOID_REASON_REQUIRED");
            }
            if (reasonRaw.length > 500) {
                throw new Error("MEMBER_INVOICE_VOID_REASON_TOO_LONG");
            }

            const service = getService();
            const invoice = await service.findById(invoiceId);
            if (!invoice || invoice.org_id !== membership.org_id) {
                throw new Error("MEMBER_INVOICE_NOT_FOUND");
            }
            if (invoice.member_id !== req.userId) {
                throw new Error("MEMBER_INVOICE_VOID_CREATOR_MUST_BE_OWNER");
            }
            if (invoice.status !== "issued") {
                throw new Error("MEMBER_INVOICE_NOT_IN_ISSUED_STATE");
            }

            const proposalService = new ProposalService(membership.org_id);
            const actor = buildActor(req);

            const created = await proposalService.create({
                type: "invoice.member_void",
                payload: {
                    invoice_id: invoice.id,
                    invoice_no: invoice.invoice_no,
                    reason: reasonRaw,
                    void_at: new Date().toISOString(),
                    // 逆仕訳: Dr 未払金 / Cr 外注費 (発行時 entry を打ち消す)
                    amount: invoice.amount_total,
                    debit_account_code: "2110",
                    credit_account_code: "5600",
                    description: `${invoice.invoice_no} 取り消し`,
                },
                description: `${invoice.invoice_no} を本人取り消し (理由: ${reasonRaw.slice(0, 60)})`,
                created_by: actor,
                org_id: membership.org_id,
            });

            await proposalService.submit(created.id, actor);
            const approved = await proposalService.approve(created.id, actor);

            const updated = await service.findById(invoice.id);

            res.status(201).json({
                proposal: approved.proposal,
                invoice: updated,
            });
        } catch (err) {
            handleError(res, err);
        }
    },
);

export default router;
