import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { supabaseAdmin } from "../lib/supabaseClient";

const router = Router();

// スタミナ取得
router.get("/:userId", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { data, error } = await supabaseAdmin
            .from("profiles")
            .select("stamina, holiday_days, holiday_target, current_site_id")
            .eq("id", req.params.userId)
            .single();

        if (error) throw error;
        res.json(data);
    } catch (err: any) {
        res.status(500).json({ error: "Internal server error" });
    }
});

// スタミナ更新
router.post("/update", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { delta, reason } = req.body;

        // 現在のスタミナを取得
        const { data: current } = await supabaseAdmin
            .from("profiles")
            .select("stamina")
            .eq("id", req.userId)
            .single();

        const newStamina = Math.max(0, Math.min(100, (current?.stamina || 100) + delta));

        const { data, error } = await supabaseAdmin
            .from("profiles")
            .update({ stamina: newStamina })
            .eq("id", req.userId)
            .select()
            .single();

        if (error) throw error;

        // イベントログ記録
        await supabaseAdmin.from("events").insert({
            user_id: req.userId,
            kind: "stamina_updated",
            text: reason || `スタミナ変更: ${delta > 0 ? "+" : ""}${delta}`,
            payload: { delta, newStamina },
        });

        res.json(data);
    } catch (err: any) {
        res.status(500).json({ error: "Internal server error" });
    }
});

// 休暇取得
router.post("/holidays/take", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { days = 1 } = req.body;

        // 現在の休暇日数を取得
        const { data: current } = await supabaseAdmin
            .from("profiles")
            .select("holiday_days, stamina")
            .eq("id", req.userId)
            .single();

        const newHolidayDays = (current?.holiday_days || 0) + days;
        // 休暇でスタミナ回復（1日につき20回復）
        const newStamina = Math.min(100, (current?.stamina || 100) + days * 20);

        const { data, error } = await supabaseAdmin
            .from("profiles")
            .update({
                holiday_days: newHolidayDays,
                stamina: newStamina,
                current_site_id: null, // 現場から離脱
            })
            .eq("id", req.userId)
            .select()
            .single();

        if (error) throw error;

        // イベントログ記録
        await supabaseAdmin.from("events").insert({
            user_id: req.userId,
            kind: "holiday_taken",
            text: `${days}日の休暇を取得`,
            payload: { days, totalHolidayDays: newHolidayDays },
        });

        res.json(data);
    } catch (err: any) {
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;
