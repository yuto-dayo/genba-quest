import { Router, Response } from "express";
import { resolveActiveOrgMembership } from "../lib/orgAccess";
import type { AuthenticatedRequest } from "../middleware/authMiddleware";
import { requireOrgMembership } from "../middleware/orgMembership";
import { LegalRecordService } from "../services/LegalRecordService";

const router = Router();
router.use(requireOrgMembership("member"));

function parseYear(value: unknown): number {
  const year = typeof value === "string" ? Number(value) : Number(value ?? 0);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error("LEGAL_RECORD_YEAR_INVALID");
  }
  return year;
}

function paramString(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : value ?? "";
}

function assertAdmin(role: string): void {
  if (role !== "admin") {
    throw new Error("ORG_ROLE_REQUIRED");
  }
}

function filenameHeader(filename: string): string {
  return `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function handleLegalRecordError(res: Response, error: unknown): void {
  const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  if (code === "ORG_ROLE_REQUIRED" || code === "ORG_MEMBERSHIP_REQUIRED") {
    res.status(403).json({ error: code });
    return;
  }
  if (code === "LEGAL_RECORD_YEAR_INVALID") {
    res.status(400).json({ error: code });
    return;
  }
  if (code === "LEGAL_RECORD_MEMBER_NOT_FOUND") {
    res.status(404).json({ error: code });
    return;
  }
  console.error("[legal-records] route error:", error);
  res.status(500).json({ error: "Internal server error" });
}

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const membership = await resolveActiveOrgMembership(req, "member");
    assertAdmin(membership.role);
    const year = parseYear(req.query.year);
    const service = new LegalRecordService(membership.org_id);
    const submissions = await service.listSubmissions(year);
    res.json({ fiscal_year: year, submissions });
  } catch (error) {
    handleLegalRecordError(res, error);
  }
});

router.post("/compile", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const membership = await resolveActiveOrgMembership(req, "member");
    assertAdmin(membership.role);
    const year = parseYear((req.body as Record<string, unknown>)?.year);
    const service = new LegalRecordService(membership.org_id);
    const submissions = await service.compileAnnualPayouts(year);
    res.json({ fiscal_year: year, submissions });
  } catch (error) {
    handleLegalRecordError(res, error);
  }
});

router.get("/submission-file", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const membership = await resolveActiveOrgMembership(req, "member");
    assertAdmin(membership.role);
    const year = parseYear(req.query.year);
    const service = new LegalRecordService(membership.org_id);
    const file = await service.generateSubmissionFile(year);
    res.setHeader("Content-Type", "text/csv; charset=Shift_JIS");
    res.setHeader("Content-Disposition", filenameHeader(file.filename));
    res.setHeader("X-Legal-Record-Count", String(file.count));
    res.send(file.buffer);
  } catch (error) {
    handleLegalRecordError(res, error);
  }
});

router.get("/member-copies.zip", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const membership = await resolveActiveOrgMembership(req, "member");
    assertAdmin(membership.role);
    const year = parseYear(req.query.year);
    const service = new LegalRecordService(membership.org_id);
    const file = await service.generateMemberCopyZip(year);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", filenameHeader(file.filename));
    res.setHeader("X-Legal-Record-Count", String(file.count));
    res.send(file.buffer);
  } catch (error) {
    handleLegalRecordError(res, error);
  }
});

router.get("/members/:memberId", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const membership = await resolveActiveOrgMembership(req, "member");
    assertAdmin(membership.role);
    const year = parseYear(req.query.year);
    const service = new LegalRecordService(membership.org_id);
    const submission = await service.getMemberDetail(year, paramString(req.params.memberId));
    if (!submission) {
      res.status(404).json({ error: "LEGAL_RECORD_MEMBER_NOT_FOUND" });
      return;
    }
    res.json({ submission });
  } catch (error) {
    handleLegalRecordError(res, error);
  }
});

router.get("/members/:memberId/member-copy", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const membership = await resolveActiveOrgMembership(req, "member");
    assertAdmin(membership.role);
    const year = parseYear(req.query.year);
    const service = new LegalRecordService(membership.org_id);
    const file = await service.generateMemberCopy(year, paramString(req.params.memberId));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", filenameHeader(file.filename));
    res.send(file.buffer);
  } catch (error) {
    handleLegalRecordError(res, error);
  }
});

router.patch("/members/:memberId/submitted", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const membership = await resolveActiveOrgMembership(req, "member");
    assertAdmin(membership.role);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const year = parseYear(body.year);
    const submittedAt = typeof body.submitted_at === "string" ? body.submitted_at : null;
    const service = new LegalRecordService(membership.org_id);
    const submission = await service.markSubmitted(year, paramString(req.params.memberId), submittedAt);
    res.json({ submission });
  } catch (error) {
    handleLegalRecordError(res, error);
  }
});

export default router;
