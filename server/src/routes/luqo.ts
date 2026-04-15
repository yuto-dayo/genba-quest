/**
 * LUQO API Router
 * カタログ・スコア・報酬計算のREAD系API
 * 状態変更は全てProposal経由（POST /api/v1/proposals）
 */

import { Router } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { LUQOService } from '../services/LUQOService';

const router = Router();

const getOrgId = (req: AuthenticatedRequest): string =>
  process.env.DEFAULT_ORG_ID || '00000000-0000-0000-0000-000000000001';

// ============================================================
// GET /api/v1/luqo/categories — カテゴリ一覧
// ============================================================
router.get('/categories', async (req: AuthenticatedRequest, res) => {
  try {
    const service = new LUQOService(getOrgId(req));
    const categories = await service.getCategories();
    res.json({ categories });
  } catch (err) {
    console.error('[LUQO] GET /categories error:', err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// ============================================================
// GET /api/v1/luqo/catalog — スキルカタログ一覧
// Query: ?category_id=<uuid>
// ============================================================
router.get('/catalog', async (req: AuthenticatedRequest, res) => {
  try {
    const service = new LUQOService(getOrgId(req));
    const categoryId = req.query.category_id as string | undefined;
    const [catalog, { techMax, speedMax }] = await Promise.all([
      service.getCatalog(categoryId),
      service.getCatalogMaxPoints(),
    ]);
    res.json({ catalog, tech_max: techMax, speed_max: speedMax });
  } catch (err) {
    console.error('[LUQO] GET /catalog error:', err);
    res.status(500).json({ error: 'Failed to fetch catalog' });
  }
});

// ============================================================
// GET /api/v1/luqo/members/:memberId/achievements — スター取得一覧
// ============================================================
router.get('/members/:memberId/achievements', async (req: AuthenticatedRequest, res) => {
  try {
    const service = new LUQOService(getOrgId(req));
    const memberId = Array.isArray(req.params.memberId) ? req.params.memberId[0] : req.params.memberId;
    const achievements = await service.getMemberAchievements(memberId);
    const totals = await service.getMemberStarTotals(memberId);
    res.json({ achievements, ...totals });
  } catch (err) {
    console.error('[LUQO] GET /members/:id/achievements error:', err);
    res.status(500).json({ error: 'Failed to fetch achievements' });
  }
});

// ============================================================
// GET /api/v1/luqo/scores — 月次スコア一覧
// Query: ?period=2026-02&member_id=<uuid>
// ============================================================
router.get('/scores', async (req: AuthenticatedRequest, res) => {
  try {
    const service = new LUQOService(getOrgId(req));
    const period = (Array.isArray(req.query.period) ? req.query.period[0] : req.query.period) as string | undefined;
    const memberId = (Array.isArray(req.query.member_id) ? req.query.member_id[0] : req.query.member_id) as string | undefined;
    const scores = await service.getPeriodScores(period, memberId);
    res.json({ scores });
  } catch (err) {
    console.error('[LUQO] GET /scores error:', err);
    res.status(500).json({ error: 'Failed to fetch scores' });
  }
});

// ============================================================
// POST /api/v1/luqo/reward/preview — 報酬計算プレビュー（未確定）
// Body: { period, profit, company_rate, members: [{member_id, name, days, tech_stars, speed_stars}] }
// ============================================================
router.post('/reward/preview', async (req: AuthenticatedRequest, res) => {
  try {
    const { period, profit, company_rate = 0, members } = req.body as {
      period: string;
      profit: number;
      company_rate?: number;
      members: Array<{
        member_id: string;
        name: string;
        days: number;
        tech_stars: number;
        speed_stars: number;
      }>;
    };

    if (!period || !profit || !Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ error: 'period, profit, members are required' });
    }

    const service = new LUQOService(getOrgId(req));
    const preview = await service.calcRewardPreview(period, profit, company_rate, members);
    res.json(preview);
  } catch (err) {
    console.error('[LUQO] POST /reward/preview error:', err);
    res.status(500).json({ error: 'Failed to calculate reward preview' });
  }
});

// ============================================================
// GET /api/v1/luqo/reward/calculations — 確定済み報酬計算履歴
// Query: ?period=2026-02
// ============================================================
router.get('/reward/calculations', async (req: AuthenticatedRequest, res) => {
  try {
    const service = new LUQOService(getOrgId(req));
    const period = req.query.period as string | undefined;
    const calculations = await service.getRewardCalculations(period);
    res.json({ calculations });
  } catch (err) {
    console.error('[LUQO] GET /reward/calculations error:', err);
    res.status(500).json({ error: 'Failed to fetch reward calculations' });
  }
});

export default router;
