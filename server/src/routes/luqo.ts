/**
 * LUQO API Router
 * legacy LUQO は read-only / compatibility layer を前提に扱う
 */

import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { LUQOService } from '../services/LUQOService';

const router = Router();

function requireOrgId(req: AuthenticatedRequest): string {
  if (!req.orgId) {
    throw new Error('ORG_CONTEXT_REQUIRED');
  }

  return req.orgId;
}

function createService(req: AuthenticatedRequest): LUQOService {
  return new LUQOService(requireOrgId(req));
}

function handleLuqoError(res: Response, error: unknown): void {
  const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  const badRequestCodes = new Set([
    'INVALID_MONTH_FORMAT',
    'INVALID_MEMBER_ID',
    'INVALID_MEMBER_NAME',
    'INVALID_PROFIT_AMOUNT',
    'MEMBERS_REQUIRED',
    'DUPLICATE_MEMBER_ID',
    'UNKNOWN_MEMBER_IN_ORG',
  ]);

  if (code === 'ORG_CONTEXT_REQUIRED') {
    res.status(403).json({ error: code });
    return;
  }

  if (badRequestCodes.has(code)) {
    res.status(400).json({ error: code });
    return;
  }

  console.error('[LUQO] route error:', error);
  res.status(500).json({ error: 'Internal server error' });
}

router.get('/categories', async (req: AuthenticatedRequest, res) => {
  try {
    const categories = await createService(req).getCategories();
    res.json({ categories });
  } catch (error) {
    handleLuqoError(res, error);
  }
});

router.get('/catalog', async (req: AuthenticatedRequest, res) => {
  try {
    const categoryId = req.query.category_id as string | undefined;
    const service = createService(req);
    const [catalog, { techMax, speedMax }] = await Promise.all([
      service.getCatalog(categoryId),
      service.getCatalogMaxPoints(),
    ]);

    res.json({ catalog, tech_max: techMax, speed_max: speedMax });
  } catch (error) {
    handleLuqoError(res, error);
  }
});

router.get('/members/:memberId/achievements', async (req: AuthenticatedRequest, res) => {
  try {
    const memberId = Array.isArray(req.params.memberId) ? req.params.memberId[0] : req.params.memberId;
    const service = createService(req);
    const [achievements, totals] = await Promise.all([
      service.getMemberAchievements(memberId),
      service.getMemberStarTotals(memberId),
    ]);

    res.json({ achievements, ...totals });
  } catch (error) {
    handleLuqoError(res, error);
  }
});

router.get('/scores', async (req: AuthenticatedRequest, res) => {
  try {
    const period = (Array.isArray(req.query.period) ? req.query.period[0] : req.query.period) as string | undefined;
    const memberId = (Array.isArray(req.query.member_id) ? req.query.member_id[0] : req.query.member_id) as
      | string
      | undefined;
    const scores = await createService(req).getPeriodScores(period, memberId);
    res.json({ scores });
  } catch (error) {
    handleLuqoError(res, error);
  }
});

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

    if (!period || !Array.isArray(members) || members.length === 0) {
      res.status(400).json({ error: 'period, members are required' });
      return;
    }

    const preview = await createService(req).calcRewardPreview(period, profit, company_rate, members);
    res.json(preview);
  } catch (error) {
    handleLuqoError(res, error);
  }
});

router.get('/reward/calculations', async (req: AuthenticatedRequest, res) => {
  try {
    const period = typeof req.query.period === 'string' ? req.query.period : undefined;
    const calculations = await createService(req).getRewardCalculations(period);
    res.json({ calculations });
  } catch (error) {
    handleLuqoError(res, error);
  }
});

export default router;
