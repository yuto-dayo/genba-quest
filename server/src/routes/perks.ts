import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { supabaseAdmin } from "../lib/supabaseClient";

const router = Router();

// ============================================================
// パーク定義（DBD風・生産性順）
// ============================================================

export type PerkLevel = "bronze" | "silver" | "gold";

export interface PerkEffect {
    multiplier: number;
    description: string;
}

export interface PerkDefinition {
    id: string;
    category: string;
    label: string;
    labelEn: string;
    description: string;
    unlockOrder: number;
    effects: {
        bronze: PerkEffect;
        silver: PerkEffect;
        gold: PerkEffect;
    };
    icon: string;
}

// 生産性順でソート済み（unlockOrder: 小さい = 先に解放可能）
const PERK_DEFINITIONS: PerkDefinition[] = [
    // === 高生産性（優先解放）===
    {
        id: "floor",
        category: "床施工",
        label: "床職人",
        labelEn: "FLOOR MASTER",
        description: "床材施工の効率化",
        unlockOrder: 1,
        effects: {
            bronze: { multiplier: 1.05, description: "床施工効率 +5%" },
            silver: { multiplier: 1.10, description: "床施工効率 +10%" },
            gold: { multiplier: 1.20, description: "床施工効率 +20%" },
        },
        icon: "Layers",
    },
    {
        id: "cross",
        category: "クロス",
        label: "クロス職人",
        labelEn: "CROSS WEAVER",
        description: "壁紙施工の技術",
        unlockOrder: 2,
        effects: {
            bronze: { multiplier: 1.05, description: "クロス施工効率 +5%" },
            silver: { multiplier: 1.10, description: "クロス施工効率 +10%" },
            gold: { multiplier: 1.20, description: "クロス施工効率 +20%" },
        },
        icon: "Wallpaper",
    },
    {
        id: "exterior_wall",
        category: "外壁",
        label: "外壁職人",
        labelEn: "WALL GUARDIAN",
        description: "外壁施工の専門技術",
        unlockOrder: 3,
        effects: {
            bronze: { multiplier: 1.05, description: "外壁施工効率 +5%" },
            silver: { multiplier: 1.12, description: "外壁施工効率 +12%" },
            gold: { multiplier: 1.25, description: "外壁施工効率 +25%" },
        },
        icon: "Building2",
    },
    // === 中生産性 ===
    {
        id: "waterproofing",
        category: "防水",
        label: "防水職人",
        labelEn: "WATER SEALER",
        description: "防水施工の専門技術",
        unlockOrder: 4,
        effects: {
            bronze: { multiplier: 1.05, description: "防水施工効率 +5%" },
            silver: { multiplier: 1.10, description: "防水施工効率 +10%" },
            gold: { multiplier: 1.18, description: "防水施工効率 +18%" },
        },
        icon: "Droplets",
    },
    {
        id: "dynoc",
        category: "ダイノック",
        label: "ダイノック職人",
        labelEn: "SHEET ARTIST",
        description: "化粧シート施工の技術",
        unlockOrder: 5,
        effects: {
            bronze: { multiplier: 1.04, description: "ダイノック効率 +4%" },
            silver: { multiplier: 1.08, description: "ダイノック効率 +8%" },
            gold: { multiplier: 1.15, description: "ダイノック効率 +15%" },
        },
        icon: "Stamp",
    },
    {
        id: "painting",
        category: "塗装",
        label: "塗装職人",
        labelEn: "COLOR MASTER",
        description: "塗装施工の専門技術",
        unlockOrder: 6,
        effects: {
            bronze: { multiplier: 1.04, description: "塗装効率 +4%" },
            silver: { multiplier: 1.08, description: "塗装効率 +8%" },
            gold: { multiplier: 1.15, description: "塗装効率 +15%" },
        },
        icon: "PaintBucket",
    },
    // === サポートスキル ===
    {
        id: "safety",
        category: "共通",
        label: "安全管理",
        labelEn: "SAFETY WARDEN",
        description: "安全・衛生管理の能力",
        unlockOrder: 7,
        effects: {
            bronze: { multiplier: 1.02, description: "事故率 -10%" },
            silver: { multiplier: 1.05, description: "事故率 -25%" },
            gold: { multiplier: 1.10, description: "事故率 -50%" },
        },
        icon: "ShieldCheck",
    },
    {
        id: "leadership",
        category: "共通",
        label: "リーダーシップ",
        labelEn: "TEAM LEADER",
        description: "チームをまとめる能力",
        unlockOrder: 8,
        effects: {
            bronze: { multiplier: 1.03, description: "チーム効率 +3%" },
            silver: { multiplier: 1.06, description: "チーム効率 +6%" },
            gold: { multiplier: 1.12, description: "チーム効率 +12%" },
        },
        icon: "Users",
    },
    {
        id: "efficiency",
        category: "共通",
        label: "効率化マスター",
        labelEn: "EFFICIENCY GURU",
        description: "作業効率の最適化能力",
        unlockOrder: 9,
        effects: {
            bronze: { multiplier: 1.03, description: "全体効率 +3%" },
            silver: { multiplier: 1.06, description: "全体効率 +6%" },
            gold: { multiplier: 1.10, description: "全体効率 +10%" },
        },
        icon: "Gauge",
    },
];

// ティア情報
const LEVEL_INFO = {
    bronze: { label: "Bronze", labelJa: "ブロンズ", color: "#CD7F32", order: 1 },
    silver: { label: "Silver", labelJa: "シルバー", color: "#C0C0C0", order: 2 },
    gold: { label: "Gold", labelJa: "ゴールド", color: "#FFD700", order: 3 },
};

// ============================================================
// エンドポイント
// ============================================================

// パーク定義一覧
router.get("/definitions", async (_req: AuthenticatedRequest, res: Response) => {
    res.json({
        perks: PERK_DEFINITIONS.sort((a, b) => a.unlockOrder - b.unlockOrder),
        levels: LEVEL_INFO,
    });
});

// 現在のユーザーのパーク状態取得（current-user shorthand）
router.get("/state/current-user", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.userId;
        if (!userId) {
            res.status(401).json({ error: "User not authenticated" });
            return;
        }

        const { data, error } = await supabaseAdmin
            .from("badge_states")
            .select("*")
            .eq("user_id", userId)
            .single();

        if (error && error.code !== "PGRST116") throw error;

        res.json(data || {
            user_id: userId,
            badges: {},
            pending_animations: [],
        });
    } catch (err: any) {
        res.status(500).json({ error: "Internal server error" });
    }
});

// ユーザーのパーク状態取得（ID指定）
router.get("/state/:userId", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { data, error } = await supabaseAdmin
            .from("badge_states")
            .select("*")
            .eq("user_id", req.params.userId)
            .single();

        if (error && error.code !== "PGRST116") throw error;

        res.json(data || {
            user_id: req.params.userId,
            badges: {},
            pending_animations: [],
        });
    } catch (err: any) {
        res.status(500).json({ error: "Internal server error" });
    }
});

// パーク申請
router.post("/apply", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { perk_id, level, reason } = req.body as {
            perk_id: string;
            level: PerkLevel;
            reason?: string;
        };

        // パークIDの検証
        const perk = PERK_DEFINITIONS.find((p) => p.id === perk_id);
        if (!perk) {
            res.status(400).json({ error: "Invalid perk_id" });
            return;
        }

        // レベルの検証
        if (!["bronze", "silver", "gold"].includes(level)) {
            res.status(400).json({ error: "Invalid level" });
            return;
        }

        // 現在のパーク状態を取得
        const { data: currentState } = await supabaseAdmin
            .from("badge_states")
            .select("badges")
            .eq("user_id", req.userId)
            .single();

        const currentLevel = currentState?.badges?.[perk_id] as PerkLevel | undefined;

        // ティア進行の検証（Bronze → Silver → Gold）
        if (level === "silver" && currentLevel !== "bronze") {
            res.status(400).json({ error: "Bronze取得後にSilverを申請できます" });
            return;
        }
        if (level === "gold" && currentLevel !== "silver") {
            res.status(400).json({ error: "Silver取得後にGoldを申請できます" });
            return;
        }
        if (currentLevel && LEVEL_INFO[currentLevel].order >= LEVEL_INFO[level].order) {
            res.status(400).json({ error: "既に同じかそれ以上のティアを取得済みです" });
            return;
        }

        // 既存の保留中申請チェック
        const { data: pendingApp } = await supabaseAdmin
            .from("badge_applications")
            .select("id")
            .eq("applicant_id", req.userId)
            .eq("badge_id", perk_id)
            .eq("status", "pending")
            .single();

        if (pendingApp) {
            res.status(400).json({ error: "既に申請中です" });
            return;
        }

        const { data, error } = await supabaseAdmin
            .from("badge_applications")
            .insert({
                applicant_id: req.userId,
                badge_id: perk_id,
                level,
                reason: reason || "",
                status: "pending",
            })
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(data);
    } catch (err: any) {
        res.status(500).json({ error: "Internal server error" });
    }
});

// パーク申請一覧（保留中）
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

        // パーク定義情報を付加
        const enriched = (data || []).map((app) => ({
            ...app,
            perk: PERK_DEFINITIONS.find((p) => p.id === app.badge_id),
        }));

        res.json(enriched);
    } catch (err: any) {
        res.status(500).json({ error: "Internal server error" });
    }
});

// パーク申請に投票
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

            // 承認された場合、パーク状態を更新 + アニメーションキューに追加
            if (newStatus === "approved" && application) {
                const { data: currentState } = await supabaseAdmin
                    .from("badge_states")
                    .select("badges, pending_animations")
                    .eq("user_id", application.applicant_id)
                    .single();

                const newBadges = {
                    ...(currentState?.badges || {}),
                    [application.badge_id]: application.level,
                };

                // アニメーションキーを追加（例: "floor_bronze"）
                const animationKey = `${application.badge_id}_${application.level}`;
                const pendingAnimations = [
                    ...((currentState?.pending_animations as string[]) || []),
                    animationKey,
                ];

                await supabaseAdmin
                    .from("badge_states")
                    .upsert({
                        user_id: application.applicant_id,
                        badges: newBadges,
                        pending_animations: pendingAnimations,
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
        res.status(500).json({ error: "Internal server error" });
    }
});

// アニメーション消化（表示後にクリア）
router.post("/clear-animation", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { perk_key } = req.body as { perk_key: string };

        const { data: current } = await supabaseAdmin
            .from("badge_states")
            .select("pending_animations")
            .eq("user_id", req.userId)
            .single();

        const newAnimations = ((current?.pending_animations as string[]) || [])
            .filter((a) => a !== perk_key);

        await supabaseAdmin
            .from("badge_states")
            .update({
                pending_animations: newAnimations,
                updated_at: new Date().toISOString(),
            })
            .eq("user_id", req.userId);

        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;
