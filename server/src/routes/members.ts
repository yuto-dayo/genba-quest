import { Router, Response } from "express";
import { resolveActiveOrgMembership } from "../lib/orgAccess";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { requireOrgMembership } from "../middleware/orgMembership";
import { InvoiceRegistrationService } from "../services/InvoiceRegistrationService";
import { MemberTaxClassificationService } from "../services/MemberTaxClassificationService";

const router = Router();
router.use(requireOrgMembership("member"));

const service = new MemberTaxClassificationService();
const invoiceRegistrationService = new InvoiceRegistrationService();

function handleMembersError(res: Response, error: unknown): void {
  const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";

  if (
    code === "USER_CONTEXT_REQUIRED" ||
    code === "ORG_ONBOARDING_REQUIRED" ||
    code === "ORG_MEMBERSHIP_REQUIRED" ||
    code === "ORG_ROLE_REQUIRED"
  ) {
    res.status(403).json({ error: code });
    return;
  }

  if (
    code === "INVALID_ORG_ID" ||
    code === "MEMBER_CLASSIFICATION_AS_OF_INVALID" ||
    code === "MEMBER_INVOICE_STATUS_AS_OF_INVALID"
  ) {
    res.status(400).json({ error: code });
    return;
  }

  console.error("[members] route error:", error);
  res.status(500).json({ error: "Internal server error" });
}

router.get("/:memberId/tax-classification", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const membership = await resolveActiveOrgMembership(req, "member");
    const memberId = Array.isArray(req.params.memberId) ? req.params.memberId[0] : req.params.memberId;
    if (!memberId) {
      res.status(400).json({ error: "MEMBER_ID_REQUIRED" });
      return;
    }

    if (membership.role !== "admin" && memberId !== req.userId) {
      res.status(403).json({ error: "ORG_ROLE_REQUIRED" });
      return;
    }

    const asOf = typeof req.query.asOf === "string" ? req.query.asOf : null;
    const [active, history] = await Promise.all([
      service.getActive({ orgId: membership.org_id, memberId, asOf }),
      service.getHistory({ orgId: membership.org_id, memberId }),
    ]);

    res.json({ active, history });
  } catch (error) {
    handleMembersError(res, error);
  }
});

router.get("/:memberId/invoice-status", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const membership = await resolveActiveOrgMembership(req, "member");
    const memberId = Array.isArray(req.params.memberId) ? req.params.memberId[0] : req.params.memberId;
    if (!memberId) {
      res.status(400).json({ error: "MEMBER_ID_REQUIRED" });
      return;
    }

    if (membership.role !== "admin" && memberId !== req.userId) {
      res.status(403).json({ error: "ORG_ROLE_REQUIRED" });
      return;
    }

    const asOf = typeof req.query.asOf === "string" ? req.query.asOf : null;
    const status = await invoiceRegistrationService.getMemberInvoiceStatus({
      orgId: membership.org_id,
      memberId,
      asOf,
    });

    res.json(status);
  } catch (error) {
    handleMembersError(res, error);
  }
});

export default router;
