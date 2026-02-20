import { createChain, setupMockFromSequence } from '../helpers/mockSupabase';

// supabaseAdmin をモジュールレベルでモック
jest.mock('../../lib/supabaseAdmin', () => ({
  supabaseAdmin: { from: jest.fn() },
}));

import { supabaseAdmin } from '../../lib/supabaseAdmin';
import {
  PrincipleService,
  calculateConfidence,
  calculateUncertainty,
  getDataLabel,
  toPrincipleConfidence,
} from '../../services/PrincipleService';

const mockFrom = supabaseAdmin.from as jest.Mock;
const TEST_ORG_ID = '00000000-0000-0000-0000-000000000001';

// ============================================================
// Pure functions
// ============================================================

describe('Pure functions', () => {
  describe('calculateConfidence', () => {
    it('Beta(1,1) → 0.5（一様事前分布）', () => {
      expect(calculateConfidence(1, 1)).toBe(0.5);
    });

    it('Beta(9,1) → 0.9', () => {
      expect(calculateConfidence(9, 1)).toBe(0.9);
    });

    it('Beta(1,9) → 0.1', () => {
      expect(calculateConfidence(1, 9)).toBeCloseTo(0.1);
    });

    it('Beta(50,50) → 0.5', () => {
      expect(calculateConfidence(50, 50)).toBe(0.5);
    });

    it('Beta(100,1) → ~0.99', () => {
      expect(calculateConfidence(100, 1)).toBeCloseTo(0.99, 1);
    });
  });

  describe('calculateUncertainty', () => {
    it('Beta(1,1) → 最大不確実性 (1/12)', () => {
      expect(calculateUncertainty(1, 1)).toBeCloseTo(1 / 12, 4);
    });

    it('α+βが大きいほど不確実性が低い', () => {
      const u1 = calculateUncertainty(5, 5);
      const u2 = calculateUncertainty(50, 50);
      expect(u2).toBeLessThan(u1);
    });

    it('Beta(100,1)は非常に低い不確実性', () => {
      expect(calculateUncertainty(100, 1)).toBeLessThan(0.001);
    });
  });

  describe('getDataLabel', () => {
    it('Beta(1,1) → insufficient（観測0回）', () => {
      expect(getDataLabel(1, 1)).toBe('insufficient');
    });

    it('Beta(2,1) → insufficient（観測1回）', () => {
      expect(getDataLabel(2, 1)).toBe('insufficient');
    });

    it('Beta(3,2) → moderate（観測3回）', () => {
      expect(getDataLabel(3, 2)).toBe('moderate');
    });

    it('Beta(8,4) → sufficient（観測10回）', () => {
      expect(getDataLabel(8, 4)).toBe('sufficient');
    });
  });

  describe('toPrincipleConfidence', () => {
    it('DesignPrinciple を PrincipleConfidence に正しく変換', () => {
      const principle = {
        id: 'test-id',
        org_id: TEST_ORG_ID,
        name: 'proposal_centric',
        description: '全状態変更はProposal経由',
        category: 'core' as const,
        alpha: 5,
        beta: 1,
        status: 'active' as const,
        superseded_by: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };

      const result = toPrincipleConfidence(principle);

      expect(result.confidence).toBeCloseTo(5 / 6, 4);
      expect(result.uncertainty).toBeCloseTo(
        (5 * 1) / (6 * 6 * 7), 4
      );
      expect(result.totalObservations).toBe(4); // 5+1-2
      expect(result.dataLabel).toBe('moderate');
      expect(result.name).toBe('proposal_centric');
    });
  });
});

// ============================================================
// PrincipleService
// ============================================================

describe('PrincipleService', () => {
  let service: PrincipleService;

  beforeEach(() => {
    service = new PrincipleService(TEST_ORG_ID);
    jest.clearAllMocks();
  });

  describe('listPrinciples', () => {
    it('全原則を確信度付きで返す', async () => {
      const mockData = [
        {
          id: 'p1', org_id: TEST_ORG_ID, name: 'proposal_centric',
          description: 'test', category: 'core', alpha: 5, beta: 1,
          status: 'active', superseded_by: null,
          created_at: '2026-01-01', updated_at: '2026-01-01',
        },
      ];

      const chain = createChain({ data: mockData, error: null });
      setupMockFromSequence(mockFrom, [chain]);

      const result = await service.listPrinciples();

      expect(result).toHaveLength(1);
      expect(result[0].confidence).toBeCloseTo(5 / 6, 4);
      expect(result[0].dataLabel).toBe('moderate');
    });
  });

  describe('recordObservation', () => {
    it('成功観測で α が +1 される', async () => {
      const principle = {
        id: 'p1', org_id: TEST_ORG_ID, name: 'proposal_centric',
        description: 'test', category: 'core', alpha: 5, beta: 1,
        status: 'active', superseded_by: null,
        created_at: '2026-01-01', updated_at: '2026-01-01',
      };

      const observation = {
        id: 'obs1', principle_id: 'p1', proposal_id: null,
        outcome: true, reason: 'Proposal executed successfully',
        observed_by: { type: 'system', id: 'sys', name: 'System' },
        alpha_before: 5, beta_before: 1, alpha_after: 6, beta_after: 1,
        created_at: '2026-01-01',
      };

      // 1. fetch principle, 2. insert observation, 3. update principle
      const fetchChain = createChain({ data: principle, error: null });
      const insertChain = createChain({ data: observation, error: null });
      const updateChain = createChain({ data: null, error: null });

      setupMockFromSequence(mockFrom, [fetchChain, insertChain, updateChain]);

      const result = await service.recordObservation({
        principleName: 'proposal_centric',
        outcome: true,
        reason: 'Proposal executed successfully',
        observedBy: { type: 'system', id: 'sys', name: 'System' },
      });

      expect(result.alpha_after).toBe(6);
      expect(result.beta_after).toBe(1);
    });

    it('失敗観測で β が +1 される', async () => {
      const principle = {
        id: 'p1', org_id: TEST_ORG_ID, name: 'proposal_centric',
        description: 'test', category: 'core', alpha: 5, beta: 1,
        status: 'active', superseded_by: null,
        created_at: '2026-01-01', updated_at: '2026-01-01',
      };

      const observation = {
        id: 'obs2', principle_id: 'p1', proposal_id: null,
        outcome: false, reason: 'Direct DB modification detected',
        observed_by: { type: 'system', id: 'sys', name: 'System' },
        alpha_before: 5, beta_before: 1, alpha_after: 5, beta_after: 2,
        created_at: '2026-01-01',
      };

      const fetchChain = createChain({ data: principle, error: null });
      const insertChain = createChain({ data: observation, error: null });
      const updateChain = createChain({ data: null, error: null });

      setupMockFromSequence(mockFrom, [fetchChain, insertChain, updateChain]);

      const result = await service.recordObservation({
        principleName: 'proposal_centric',
        outcome: false,
        reason: 'Direct DB modification detected',
        observedBy: { type: 'system', id: 'sys', name: 'System' },
      });

      expect(result.alpha_after).toBe(5);
      expect(result.beta_after).toBe(2);
    });

    it('存在しない原則でエラー', async () => {
      const fetchChain = createChain({ data: null, error: { message: 'not found' } });
      setupMockFromSequence(mockFrom, [fetchChain]);

      await expect(
        service.recordObservation({
          principleName: 'nonexistent',
          outcome: true,
          reason: 'test',
          observedBy: { type: 'system', id: 'sys', name: 'System' },
        })
      ).rejects.toThrow('PRINCIPLE_NOT_FOUND');
    });
  });
});
