import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { supabaseAdmin } from "../lib/supabaseClient";

const router = Router();

// 現場一覧取得
router.get("/", async (_req: AuthenticatedRequest, res: Response) => {
    try {
        const { data, error } = await supabaseAdmin
            .from("sites")
            .select(`
        *,
        client:clients(id, name)
      `)
            .order("created_at", { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err: any) {
        res.status(500).json({ error: "Internal server error" });
    }
});

// 現場詳細取得
router.get("/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { data, error } = await supabaseAdmin
            .from("sites")
            .select(`
        *,
        client:clients(id, name)
      `)
            .eq("id", req.params.id)
            .single();

        if (error) throw error;
        res.json(data);
    } catch (err: any) {
        res.status(500).json({ error: "Internal server error" });
    }
});

// 現場登録
router.post("/", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { name, address, area_sqm, work_types, estimated_hours, revenue, client_id } = req.body;

        const { data, error } = await supabaseAdmin
            .from("sites")
            .insert({
                name,
                address,
                area_sqm,
                work_types,
                estimated_hours,
                revenue,
                client_id,
                status: "active",
            })
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(data);
    } catch (err: any) {
        res.status(500).json({ error: "Internal server error" });
    }
});

// 現場更新
router.put("/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { name, address, area_sqm, work_types, estimated_hours, actual_hours, revenue, status } = req.body;

        const { data, error } = await supabaseAdmin
            .from("sites")
            .update({
                name,
                address,
                area_sqm,
                work_types,
                estimated_hours,
                actual_hours,
                revenue,
                status,
            })
            .eq("id", req.params.id)
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (err: any) {
        res.status(500).json({ error: "Internal server error" });
    }
});

// 現場完了処理
router.post("/:id/complete", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { data, error } = await supabaseAdmin
            .from("sites")
            .update({
                status: "completed",
                completed_at: new Date().toISOString(),
            })
            .eq("id", req.params.id)
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (err: any) {
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;
