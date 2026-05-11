jest.mock('../../lib/supabaseClient', () => ({
  supabaseAdmin: { from: jest.fn() },
}));

import { pickFromPool } from '../../services/ProposalAssignmentService';

describe('ProposalAssignmentService.pickFromPool (純関数)', () => {
  describe('基本動作', () => {
    it('候補ゼロなら null', () => {
      expect(pickFromPool([], [])).toBeNull();
    });

    it('候補1人なら必ずその人', () => {
      expect(pickFromPool(['user1'], [])).toBe('user1');
    });

    it('候補2人ならどちらか', () => {
      const r = pickFromPool(['user1', 'user2'], [], () => 0);
      expect(r).toBe('user1');
      const r2 = pickFromPool(['user1', 'user2'], [], () => 0.99);
      expect(r2).toBe('user2');
    });
  });

  describe('直近回避', () => {
    it('直近に当たった人を除外する', () => {
      const r = pickFromPool(['a', 'b', 'c'], ['a'], () => 0);
      expect(r).toBe('b');
    });

    it('直近に全員当たってたら元プールから選ぶ (フォールバック)', () => {
      const r = pickFromPool(['a', 'b'], ['a', 'b'], () => 0);
      expect(r).toBe('a');
    });

    it('直近回避後の候補が1人ならその人', () => {
      const r = pickFromPool(['a', 'b'], ['a'], () => 0.99);
      expect(r).toBe('b');
    });
  });

  describe('ランダム性 (rng の正しい呼び出し)', () => {
    it('rng が 0 を返せば最初の候補', () => {
      expect(pickFromPool(['x', 'y', 'z'], [], () => 0)).toBe('x');
    });

    it('rng が 0.5 を返せば真ん中の候補', () => {
      expect(pickFromPool(['x', 'y', 'z'], [], () => 0.5)).toBe('y');
    });

    it('rng が 0.99 に近ければ最後の候補', () => {
      expect(pickFromPool(['x', 'y', 'z'], [], () => 0.999)).toBe('z');
    });
  });

  describe('分布の偏りチェック (簡易)', () => {
    it('多数回試行で各候補がそれなりにヒットする', () => {
      const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
      let seed = 0;
      const fakeRng = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };
      for (let i = 0; i < 300; i += 1) {
        const r = pickFromPool(['a', 'b', 'c'], [], fakeRng);
        if (r) counts[r] += 1;
      }
      // 各候補が最低 30 回 (10%) は当たることを期待
      expect(counts.a).toBeGreaterThan(30);
      expect(counts.b).toBeGreaterThan(30);
      expect(counts.c).toBeGreaterThan(30);
    });
  });
});
