import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { supabaseAdmin } from "../lib/supabaseClient";

const router = Router();

// ============================================================
// バッジ定義（コード内で管理、DBに依存しない）
// ============================================================

export type BadgeLevel = "bronze" | "silver" | "gold";

export interface BadgeDefinition {
    id: string;
    category: string;
    label: string;
    description: string;
}

// シンプルなバッジ定義（カテゴリ×3段階）
const BADGE_DEFINITIONS: BadgeDefinition[] = [
    // クロス（壁紙）
    { id: "cross", category: "クロス", label: "クロス職人", description: "壁紙施工の技術" },
    // 床
    { id: "floor", category: "床", label: "床職人", description: "床材施工の技術" },
    // ダイノック
    { id: "dynoc", category: "ダイノック", label: "ダイノック職人", description: "化粧シート施工の技術" },
    // 共通
    { id: "safety", category: "共通", label: "安全管理", description: "安全・衛生管理の能力" },
    { id: "leadership", category: "共通", label: "リーダーシップ", description: "チームをまとめる能力" },
];

// レベルの表示名
const LEVEL_LABELS: Record<BadgeLevel, string> = {
    bronze: "初級",
    silver: "中級",
    gold: "上級",
};

// ============================================================
// エンドポイント
// ============================================================

// バッジ定義一覧
router.get("/definitions", async (_req: AuthenticatedRequest, res: Response) => {
    res.json({
        badges: BADGE_DEFINITIONS,
        levels: LEVEL_LABELS,
    });
});

// ユーザーのバッジ状態取得
router.get("/state/:userId", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { data, error } = await supabaseAdmin
            .from("badge_states")
            .select("*")
            .eq("user_id", req.params.userId)
            .single();

        if (error && error.code !== "PGRST116") throw error;

        // 未取得の場合は空のステートを返す
        res.json(data || { user_id: req.params.userId, badges: {} });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// バッジ申請
router.post("/apply", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { badge_id, level, reason } = req.body as {
            badge_id: string;
            level: BadgeLevel;
            reason?: string;
        };

        // バッジIDの検証
        const badge = BADGE_DEFINITIONS.find((b) => b.id === badge_id);
        if (!badge) {
            res.status(400).json({ error: "Invalid badge_id" });
            return;
        }

        // レベルの検証
        if (!["bronze", "silver", "gold"].includes(level)) {
            res.status(400).json({ error: "Invalid level" });
            return;
        }

        const { data, error } = await supabaseAdmin
            .from("badge_applications")
            .insert({
                applicant_id: req.userId,
                badge_id,
                level,
                reason: reason || "",
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

// バッジ申請一覧（保留中）
router.get("/applications", async (_req: AuthenticatedRequest, res: Response) => {
    try {
        const { data, error } = await supabaseAdmin
            .from("badge_applications")
            .select(`
                *,
                applicant:profiles!applicant_id(username, full_name)
            `)
            .eq("status", "pending")
            .order("created_at", { ascending: false });

        if (error) throw error;
        res.json(data || []);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// バッジ申請に投票
router.post("/vote", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { application_id, vote } = req.body as {
            application_id: string;
            vote: "approve" | "reject";
        };

        // 投票を記録
        const { error: voteError } = await supabaseAdmin
            .from("badge_application_votes")
            .insert({
                application_id,
                voter_id: req.userId,
                vote,
            });

        if (voteError) throw voteError;

        // 投票結果をチェック（過半数で決定）
        const { data: votes } = await supabaseAdmin
            .from("badge_application_votes")
            .select("vote")
            .eq("application_id", application_id);

        const approvals = votes?.filter((v) => v.vote === "approve").length || 0;
        const rejections = votes?.filter((v) => v.vote === "reject").length || 0;

        const { count: memberCount } = await supabaseAdmin
            .from("profiles")
            .select("*", { count: "exact", head: true });

        const majority = Math.floor((memberCount || 3) / 2) + 1;

        let newStatus: string | null = null;

        if (approvals >= majority) {
            newStatus = "approved";
        } else if (rejections >= majority) {
            newStatus = "rejected";
        }

        if (newStatus) {
            // 申請ステータスを更新
            const { data: application } = await supabaseAdmin
                .from("badge_applications")
                .update({ status: newStatus })
                .eq("id", application_id)
                .select()
                .single();

            // 承認された場合、バッジ状態を更新
            if (newStatus === "approved" && application) {
                const { data: currentState } = await supabaseAdmin
                    .from("badge_states")
                    .select("badges")
                    .eq("user_id", application.applicant_id)
                    .single();

                const newBadges = {
                    ...(currentState?.badges || {}),
                    [application.badge_id]: application.level,
                };

                await supabaseAdmin
                    .from("badge_states")
                    .upsert({
                        user_id: application.applicant_id,
                        badges: newBadges,
                        updated_at: new Date().toISOString(),
                    });
            }
        }

        res.json({
            success: true,
            approvals,
            rejections,
            required: majority,
            status: newStatus || "pending",
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
