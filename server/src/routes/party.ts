import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { supabaseAdmin } from "../lib/supabaseClient";

const router = Router();

// パーティステータス取得
router.get("/status", async (_req: AuthenticatedRequest, res: Response) => {
    try {
        // 全メンバー情報取得
        const { data: members, error: membersError } = await supabaseAdmin
            .from("profiles")
            .select(`
        id,
        name,
        email,
        stamina,
        holiday_days,
        holiday_target,
        current_site_id
      `);

        if (membersError) throw membersError;

        // 各メンバーの詳細情報を構築
        const partyStatus = await Promise.all(
            (members || []).map(async (member) => {
                // 現在の現場情報
                let currentSite = null;
                if (member.current_site_id) {
                    const { data: site } = await supabaseAdmin
                        .from("sites")
                        .select("id, name, status")
                        .eq("id", member.current_site_id)
                        .single();
                    currentSite = site;
                }

                // パーク保有数
                const { data: perkState } = await supabaseAdmin
                    .from("perk_states")
                    .select("state")
                    .eq("user_id", member.id)
                    .single();

                const perkCount = perkState?.state
                    ? Object.values(perkState.state).filter(Boolean).length
                    : 0;

                // 休暇ペース計算（年初からの経過日数に基づく）
                const now = new Date();
                const yearStart = new Date(now.getFullYear(), 0, 1);
                const daysPassed = Math.floor((now.getTime() - yearStart.getTime()) / (1000 * 60 * 60 * 24));
                const expectedHolidays = Math.floor((member.holiday_target / 365) * daysPassed);
                const holidayPace = member.holiday_days >= expectedHolidays ? "on_track" : "behind";

                return {
                    id: member.id,
                    name: member.name,
                    stamina: member.stamina,
                    staminaStatus: member.stamina > 60 ? "good" : member.stamina > 30 ? "warning" : "critical",
                    currentSite,
                    isOnHoliday: !member.current_site_id,
                    holidayDays: member.holiday_days,
                    holidayTarget: member.holiday_target,
                    holidayPace,
                    perkCount,
                };
            })
        );

        // ギルド全体サマリー
        const { data: salesData } = await supabaseAdmin
            .from("sites")
            .select("revenue")
            .eq("status", "completed");

        const totalSales = salesData?.reduce((sum, s) => sum + (s.revenue || 0), 0) || 0;

        res.json({
            members: partyStatus,
            guildSummary: {
                totalMembers: members?.length || 0,
                totalSales,
                avgStamina: Math.round(
                    (members?.reduce((sum, m) => sum + (m.stamina || 0), 0) || 0) / (members?.length || 1)
                ),
            },
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
