import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { supabaseAdmin } from "../lib/supabaseClient";

const router = Router();

// パーク定義一覧
router.get("/definitions", async (_req: AuthenticatedRequest, res: Response) => {
    try {
        const { data, error } = await supabaseAdmin
            .from("perk_definitions")
            .select("*")
            .order("category", { ascending: true });

        if (error) throw error;
        res.json(data);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ユーザーのパーク状態取得
router.get("/state/:userId", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { data, error } = await supabaseAdmin
            .from("perk_states")
            .select("*")
            .eq("user_id", req.params.userId)
            .single();

        if (error && error.code !== "PGRST116") throw error;
        res.json(data || { user_id: req.params.userId, state: {} });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// パーク申請
router.post("/apply", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { perk_id, reason } = req.body;

        const { data, error } = await supabaseAdmin
            .from("perk_applications")
            .insert({
                applicant_id: req.userId,
                perk_id,
                reason,
                status: "pending",
            })
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(data);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// パーク申請に投票
router.post("/vote", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { application_id, vote } = req.body;

        // 投票を記録
        const { error: voteError } = await supabaseAdmin
            .from("perk_application_votes")
            .insert({
                application_id,
                voter_id: req.userId,
                vote,
            });

        if (voteError) throw voteError;

        // 投票結果をチェック（過半数承認で取得）
        const { data: votes } = await supabaseAdmin
            .from("perk_application_votes")
            .select("vote")
            .eq("application_id", application_id);

        const approvals = votes?.filter((v) => v.vote === "approve").length || 0;
        const { count: memberCount } = await supabaseAdmin
            .from("profiles")
            .select("*", { count: "exact", head: true });

        const majority = Math.floor((memberCount || 3) / 2) + 1;

        if (approvals >= majority) {
            // 申請を承認
            const { data: application } = await supabaseAdmin
                .from("perk_applications")
                .update({ status: "approved" })
                .eq("id", application_id)
                .select()
                .single();

            // パーク状態を更新
            if (application) {
                const { data: currentState } = await supabaseAdmin
                    .from("perk_states")
                    .select("state")
                    .eq("user_id", application.applicant_id)
                    .single();

                const newState = {
                    ...(currentState?.state || {}),
                    [application.perk_id]: true,
                };

                await supabaseAdmin
                    .from("perk_states")
                    .upsert({
                        user_id: application.applicant_id,
                        state: newState,
                        updated_at: new Date().toISOString(),
                    });
            }
        }

        res.json({ success: true, approvals, required: majority });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
