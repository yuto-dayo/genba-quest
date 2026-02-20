import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { supabaseAdmin } from "../lib/supabaseAdmin";

const router = Router();

/**
 * GET /api/v1/notifications
 * 自分宛の通知一覧を取得
 */
router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const unreadOnly = req.query.unread_only === "true";
    const limit = Math.min(Number(req.query.limit) || 50, 100);

    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    let query = supabaseAdmin
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (unreadOnly) {
      query = query.eq("read", false);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to fetch notifications: ${error.message}`);
    }

    res.json(data || []);
  } catch (err: any) {
    console.error("Get notifications error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/v1/notifications/:id/read
 * 通知を既読化
 */
router.post("/:id/read", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const notificationId = req.params.id as string;

    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from("notifications")
      .update({ read: true })
      .eq("id", notificationId)
      .eq("user_id", userId)
      .select()
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to mark notification as read: ${error.message}`);
    }

    if (!data) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }

    res.json(data);
  } catch (err: any) {
    console.error("Mark notification read error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/v1/notifications/read-all
 * 自分の未読通知を一括既読化
 */
router.post("/read-all", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from("notifications")
      .update({ read: true })
      .eq("user_id", userId)
      .eq("read", false)
      .select("id");

    if (error) {
      throw new Error(`Failed to mark all notifications as read: ${error.message}`);
    }

    res.json({
      updated_count: data?.length || 0,
    });
  } catch (err: any) {
    console.error("Mark all notifications read error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
