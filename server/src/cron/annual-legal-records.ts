import type { Request, Response } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { LegalRecordService } from "../services/LegalRecordService";

type OrgRow = {
  id: string;
  name: string | null;
};

type AdminRow = {
  org_id: string;
  user_id: string;
};

function targetYear(): number {
  return new Date().getUTCFullYear() - 1;
}

async function notifyAdmins(orgId: string, message: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("org_memberships")
    .select("org_id,user_id")
    .eq("org_id", orgId)
    .eq("role", "admin")
    .eq("status", "active");

  if (error) {
    throw new Error(`LEGAL_RECORD_ADMIN_LOAD_FAILED: ${error.message}`);
  }

  const rows = ((data ?? []) as AdminRow[]).map((admin) => ({
    user_id: admin.user_id,
    type: "system_alert",
    title: "法定調書の年次集計が完了しました",
    message,
    data: { org_id: orgId, domain: "legal_records" },
    read: false,
  }));

  if (rows.length === 0) return;
  const { error: insertError } = await supabaseAdmin.from("notifications").insert(rows);
  if (insertError) {
    throw new Error(`LEGAL_RECORD_NOTIFICATION_FAILED: ${insertError.message}`);
  }
}

export async function handleAnnualLegalRecordsCron(_req: Request, res: Response): Promise<void> {
  try {
    const year = targetYear();
    const { data, error } = await supabaseAdmin
      .from("organizations")
      .select("id,name")
      .eq("status", "active");

    if (error) {
      throw new Error(`LEGAL_RECORD_ORG_LOAD_FAILED: ${error.message}`);
    }

    const results = [];
    for (const org of (data ?? []) as OrgRow[]) {
      const service = new LegalRecordService(org.id);
      const submissions = await service.compileAnnualPayouts(year);
      await notifyAdmins(
        org.id,
        `${org.name ?? "組織"} の ${year} 年分支払調書対象者は ${submissions.length} 名です。Settings の法定調書から提出ファイルを確認してください。`,
      );
      results.push({ org_id: org.id, count: submissions.length });
    }

    res.json({ ok: true, fiscal_year: year, results });
  } catch (error) {
    console.error("[legal-records-cron] failed:", error);
    res.status(500).json({ error: "LEGAL_RECORD_CRON_FAILED" });
  }
}
