/**
 * Monster Routes
 * 現場をモンスター化して管理するAPI
 */

import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { supabaseAdmin } from "../lib/supabaseClient";
import {
    generateMonsterImage,
    findMatchingArchetype,
    getAllArchetypes,
    type MonsterGenerationResult,
} from "../services/monsterService";

const router = Router();

// ============================================================
// Monster Archetypes
// ============================================================

/**
 * GET /archetypes
 * 全アーキタイプを取得
 */
router.get("/archetypes", async (_req: AuthenticatedRequest, res: Response) => {
    try {
        const archetypes = await getAllArchetypes();
        res.json(archetypes);
    } catch (err: any) {
        console.error("Get archetypes error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// ============================================================
// Monster Generation
// ============================================================

/**
 * POST /generate/:siteId
 * サイトのモンスター画像を生成
 */
router.post("/generate/:siteId", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { siteId } = req.params;
        const { force = false } = req.body;

        // 既存のモンスター画像をチェック
        const { data: existingImage } = await supabaseAdmin
            .from("monster_images")
            .select("*")
            .eq("site_id", siteId)
            .single();

        if (existingImage && !force) {
            res.json({
                cached: true,
                monster: existingImage,
                message: "Monster already exists. Use force=true to regenerate.",
            });
            return;
        }

        // サイト情報を取得
        const { data: site, error: siteError } = await supabaseAdmin
            .from("sites")
            .select("*")
            .eq("id", siteId)
            .single();

        if (siteError || !site) {
            res.status(404).json({ error: "Site not found" });
            return;
        }

        // モンスター画像を生成
        const result: MonsterGenerationResult = await generateMonsterImage(site);

        // Supabase Storageに保存
        const timestamp = Date.now();
        const storagePath = `monsters/${siteId}/${timestamp}.png`;
        const imageBuffer = Buffer.from(result.imageBase64, "base64");

        const { error: uploadError } = await supabaseAdmin.storage
            .from("genba-documents")
            .upload(storagePath, imageBuffer, {
                contentType: "image/png",
                upsert: true,
            });

        if (uploadError) {
            console.error("Storage upload error:", uploadError);
            throw new Error(`Failed to upload image: ${uploadError.message}`);
        }

        // 公開URLを取得
        const { data: urlData } = supabaseAdmin.storage
            .from("genba-documents")
            .getPublicUrl(storagePath);

        const imageUrl = urlData.publicUrl;

        // monster_imagesテーブルにUpsert
        const { data: monsterImage, error: insertError } = await supabaseAdmin
            .from("monster_images")
            .upsert(
                {
                    site_id: siteId,
                    archetype_id: result.archetypeId,
                    image_url: imageUrl,
                    storage_path: storagePath,
                    prompt_used: result.promptUsed,
                    generation_cost: 0.15,
                },
                { onConflict: "site_id" }
            )
            .select()
            .single();

        if (insertError) {
            console.error("Insert monster image error:", insertError);
            throw insertError;
        }

        // sitesテーブルのモンスター情報を更新
        await supabaseAdmin
            .from("sites")
            .update({
                monster_name: result.monsterName,
                monster_image_url: imageUrl,
                monster_attributes: result.attributes,
                monster_archetype: result.archetypeName,
            })
            .eq("id", siteId);

        res.status(201).json({
            cached: false,
            monster: monsterImage,
            name: result.monsterName,
            nameJa: result.monsterNameJa,
            attributes: result.attributes,
            archetype: result.archetypeName,
        });
    } catch (err: any) {
        console.error("Monster generation error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// ============================================================
// Monster Battle Data
// ============================================================

/**
 * GET /battle/:siteId
 * サイトのバトルデータを取得（HP、ワーカー等）
 */
router.get("/battle/:siteId", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { siteId } = req.params;

        // サイト情報を取得
        const { data: site, error } = await supabaseAdmin
            .from("sites")
            .select(`
                *,
                client:clients(id, name)
            `)
            .eq("id", siteId)
            .single();

        if (error) throw error;

        // モンスター画像を取得
        const { data: monsterImage } = await supabaseAdmin
            .from("monster_images")
            .select("*")
            .eq("site_id", siteId)
            .single();

        // HP計算（残り作業時間）
        const maxHp = site.estimated_hours || 100;
        const currentHp = Math.max(0, maxHp - (site.actual_hours || 0));
        const hpPercentage = Math.round((currentHp / maxHp) * 100);

        // 残り日数計算
        let daysLeft: number | null = null;
        if (site.deadline_date) {
            const deadline = new Date(site.deadline_date);
            const now = new Date();
            daysLeft = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        }

        // アサインされたワーカーを取得
        const { data: workers } = await supabaseAdmin
            .from("profiles")
            .select("id, username, full_name, stamina, avatar_url")
            .eq("current_site_id", siteId);

        res.json({
            site,
            monster: {
                name: site.monster_name || site.name,
                nameJa: site.monster_name || site.name,
                imageUrl: site.monster_image_url || monsterImage?.image_url,
                attributes: site.monster_attributes || [],
                archetype: site.monster_archetype,
            },
            hp: {
                current: currentHp,
                max: maxHp,
                percentage: hpPercentage,
            },
            daysLeft,
            workers: workers || [],
            isDefeated: currentHp <= 0 || site.status === "completed",
        });
    } catch (err: any) {
        console.error("Get battle data error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * GET /active
 * 稼働中の全モンスター（サイト）を取得
 */
router.get("/active", async (_req: AuthenticatedRequest, res: Response) => {
    try {
        // 稼働中のサイトを取得
        const { data: sites, error } = await supabaseAdmin
            .from("sites")
            .select(`
                *,
                client:clients(id, name),
                monster_images(*)
            `)
            .in("status", ["active", "in_progress"])
            .order("created_at", { ascending: false });

        if (error) throw error;

        // 各サイトのワーカー情報を取得
        const siteIds = (sites || []).map(s => s.id);
        const { data: allWorkers } = await supabaseAdmin
            .from("profiles")
            .select("id, username, full_name, stamina, avatar_url, current_site_id")
            .in("current_site_id", siteIds.length > 0 ? siteIds : ["00000000-0000-0000-0000-000000000000"]);

        // ワーカーをサイトIDでグループ化
        const workersBySite = new Map<string, any[]>();
        for (const worker of allWorkers || []) {
            const existing = workersBySite.get(worker.current_site_id) || [];
            existing.push(worker);
            workersBySite.set(worker.current_site_id, existing);
        }

        // モンスターデータを構築
        const monsters = (sites || []).map((site) => {
            const maxHp = site.estimated_hours || 100;
            const currentHp = Math.max(0, maxHp - (site.actual_hours || 0));

            let daysLeft: number | null = null;
            if (site.deadline_date) {
                const deadline = new Date(site.deadline_date);
                const now = new Date();
                daysLeft = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            }

            return {
                site,
                monster: {
                    name: site.monster_name || site.name,
                    nameJa: site.monster_name || site.name,
                    imageUrl: site.monster_image_url || ((site.monster_images && Array.isArray(site.monster_images) && site.monster_images.length > 0) ? site.monster_images[0].image_url : null),
                    attributes: site.monster_attributes || [],
                    archetype: site.monster_archetype,
                },
                hp: {
                    current: currentHp,
                    max: maxHp,
                    percentage: Math.round((currentHp / maxHp) * 100),
                },
                daysLeft,
                workers: workersBySite.get(site.id) || [],
                isDefeated: currentHp <= 0,
            };
        });

        res.json(monsters);
    } catch (err: any) {
        console.error("Get active monsters error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * GET /defeated
 * 討伐済み（完了）のモンスターを取得
 */
router.get("/defeated", async (_req: AuthenticatedRequest, res: Response) => {
    try {
        const { data: sites, error } = await supabaseAdmin
            .from("sites")
            .select(`
                *,
                client:clients(id, name),
                monster_images(*)
            `)
            .eq("status", "completed")
            .order("completed_at", { ascending: false })
            .limit(20);

        if (error) throw error;

        const monsters = (sites || []).map((site) => {
            const maxHp = site.estimated_hours || 100;

            return {
                site,
                monster: {
                    name: site.monster_name || site.name,
                    nameJa: site.monster_name || site.name,
                    imageUrl: site.monster_image_url || ((site.monster_images && Array.isArray(site.monster_images) && site.monster_images.length > 0) ? site.monster_images[0].image_url : null),
                    attributes: site.monster_attributes || [],
                    archetype: site.monster_archetype,
                },
                hp: {
                    current: 0,
                    max: maxHp,
                    percentage: 0,
                },
                daysLeft: null,
                workers: [],
                isDefeated: true,
                completedAt: site.completed_at,
            };
        });

        res.json(monsters);
    } catch (err: any) {
        console.error("Get defeated monsters error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// ============================================================
// Battle Actions
// ============================================================

/**
 * POST /attack/:siteId
 * 攻撃（作業時間を記録）
 */
router.post("/attack/:siteId", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { siteId } = req.params;
        const { hoursWorked, comment } = req.body;

        if (!hoursWorked || hoursWorked <= 0) {
            res.status(400).json({ error: "hoursWorked must be a positive number" });
            return;
        }

        // 現在のサイト状態を取得
        const { data: site, error: siteError } = await supabaseAdmin
            .from("sites")
            .select("actual_hours, estimated_hours, status")
            .eq("id", siteId)
            .single();

        if (siteError || !site) {
            res.status(404).json({ error: "Site not found" });
            return;
        }

        if (site.status === "completed") {
            res.status(400).json({ error: "This monster has already been defeated" });
            return;
        }

        const newActualHours = (site.actual_hours || 0) + hoursWorked;
        const damage = hoursWorked; // 1時間 = 1ダメージ

        // サイトの作業時間を更新
        await supabaseAdmin
            .from("sites")
            .update({ actual_hours: newActualHours })
            .eq("id", siteId);

        // モンスター撃破判定
        const remainingHp = Math.max(0, (site.estimated_hours || 100) - newActualHours);
        const isDefeated = remainingHp <= 0;

        if (isDefeated) {
            await supabaseAdmin
                .from("sites")
                .update({
                    status: "completed",
                    completed_at: new Date().toISOString(),
                })
                .eq("id", siteId);
        }

        // バトルログを記録
        const { data: battleLog, error: logError } = await supabaseAdmin
            .from("battle_log")
            .insert({
                site_id: siteId,
                user_id: req.userId!,
                action_type: "attack",
                hours_worked: hoursWorked,
                damage_dealt: damage,
                comment,
            })
            .select()
            .single();

        if (logError) {
            console.error("Battle log insert error:", logError);
            // ログ失敗は致命的ではないので続行
        }

        res.json({
            battleLog,
            damage,
            remainingHp,
            isDefeated,
            message: isDefeated
                ? "VICTORY! Monster defeated!"
                : `Dealt ${damage} damage! ${remainingHp} HP remaining.`,
        });
    } catch (err: any) {
        console.error("Attack error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * GET /battle-log/:siteId
 * サイトのバトルログを取得
 */
router.get("/battle-log/:siteId", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { siteId } = req.params;
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

        const { data: logs, error } = await supabaseAdmin
            .from("battle_log")
            .select(`
                *,
                user:profiles(id, username, full_name, avatar_url)
            `)
            .eq("site_id", siteId)
            .order("created_at", { ascending: false })
            .limit(limit);

        if (error) throw error;

        res.json(logs || []);
    } catch (err: any) {
        console.error("Get battle log error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * POST /strategy/:siteId
 * 戦略（コメント・計画）を記録
 */
router.post("/strategy/:siteId", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { siteId } = req.params;
        const { comment } = req.body;

        if (!comment || comment.trim().length === 0) {
            res.status(400).json({ error: "Comment is required" });
            return;
        }

        // サイト存在確認
        const { data: site, error: siteError } = await supabaseAdmin
            .from("sites")
            .select("id")
            .eq("id", siteId)
            .single();

        if (siteError || !site) {
            res.status(404).json({ error: "Site not found" });
            return;
        }

        // 戦略ログを記録
        const { data: battleLog, error: logError } = await supabaseAdmin
            .from("battle_log")
            .insert({
                site_id: siteId,
                user_id: req.userId!,
                action_type: "strategy",
                hours_worked: 0,
                damage_dealt: 0,
                comment: comment.trim(),
            })
            .select()
            .single();

        if (logError) throw logError;

        res.status(201).json({
            battleLog,
            message: "Strategy recorded successfully",
        });
    } catch (err: any) {
        console.error("Strategy error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;
