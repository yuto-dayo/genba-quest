/**
 * Seed: Design Principles
 * DESIGN_PHILOSOPHY.md の設計原則を design_principles テーブルに投入
 *
 * 使い方: npx tsx server/src/scripts/seed-principles.ts
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";

// ============================================================
// 設計原則の定義（DESIGN_PHILOSOPHY.md から抽出）
// ============================================================
// alpha/beta の初期値:
//   - Beta(1,1) = 一様事前分布（何もわからない）
//   - Beta(3,1) = 「たぶん正しい」（業界ベストプラクティス）
//   - Beta(5,1) = 「かなり確信がある」（既に検証済み）

interface PrincipleSeed {
  name: string;
  description: string;
  category: 'core' | 'policy' | 'architecture' | 'process';
  alpha: number;
  beta: number;
}

const PRINCIPLES: PrincipleSeed[] = [
  // --- 核心原則（3本柱）---
  {
    name: 'proposal_centric',
    description: '全状態変更はProposal経由。直接書き換えは存在しない。',
    category: 'core',
    alpha: 5, beta: 1, // A-0で既に検証済み
  },
  {
    name: 'event_oriented_ledger',
    description: 'Event志向Ledger。追記のみ、逆仕訳で修正、借方=貸方。',
    category: 'core',
    alpha: 3, beta: 1, // 設計済みだが本番検証は少ない
  },
  {
    name: 'ai_policy_subordination',
    description: 'AIはPolicyに従属。AI自己承認禁止（絶対ゲート）。',
    category: 'core',
    alpha: 5, beta: 1, // PolicyEngineで実装済み
  },

  // --- ポリシー ---
  {
    name: 'auto_approve_threshold_5000',
    description: '5,000円以下は自動承認。',
    category: 'policy',
    alpha: 2, beta: 1, // まだ十分な検証データなし
  },
  {
    name: 'single_approval_30000',
    description: '5,001〜30,000円は1名承認。',
    category: 'policy',
    alpha: 2, beta: 1,
  },
  {
    name: 'dual_approval_above_30000',
    description: '30,000円超は2名承認。',
    category: 'policy',
    alpha: 2, beta: 1,
  },

  // --- アーキテクチャ ---
  {
    name: 'transaction_boundary',
    description: '承認 + Event発行 + 状態更新 = 1つのDBトランザクション。',
    category: 'architecture',
    alpha: 4, beta: 1, // RPC関数で実装済み
  },
  {
    name: 'idempotent_execution',
    description: 'Proposal実行は必ず冪等。',
    category: 'architecture',
    alpha: 3, beta: 1,
  },
  {
    name: 'ledger_balance_invariant',
    description: '借方合計 = 貸方合計（必須）。',
    category: 'architecture',
    alpha: 3, beta: 1,
  },
  {
    name: 'actor_ref_types',
    description: 'ActorRef types: human | ai | integration | system。全操作にアクター情報を付与。',
    category: 'architecture',
    alpha: 4, beta: 1, // 全Proposalで使用中
  },

  // --- プロセス ---
  {
    name: 'two_table_compression',
    description: '全domain = proposals + events の2テーブル + Read Model(View)で解釈。',
    category: 'architecture',
    alpha: 2, beta: 1, // Phase 2で本格実装予定
  },
  {
    name: 'phased_evolution',
    description: '段階的フェーズ移行: A-0→A-1→B→C→D。各フェーズで検証してから次へ。',
    category: 'process',
    alpha: 3, beta: 1,
  },
];

// ============================================================
// メイン
// ============================================================

async function main() {
  console.log("=== Seeding Design Principles ===");
  console.log(`Target org: ${DEFAULT_ORG_ID}`);
  console.log(`Principles to seed: ${PRINCIPLES.length}`);

  let inserted = 0;
  let skipped = 0;

  for (const p of PRINCIPLES) {
    // upsert: 既に存在する場合はスキップ（alpha/betaを上書きしない）
    const { data: existing } = await supabase
      .from('design_principles')
      .select('id')
      .eq('org_id', DEFAULT_ORG_ID)
      .eq('name', p.name)
      .maybeSingle();

    if (existing) {
      console.log(`  [SKIP] ${p.name} (already exists)`);
      skipped++;
      continue;
    }

    const { error } = await supabase
      .from('design_principles')
      .insert({
        org_id: DEFAULT_ORG_ID,
        name: p.name,
        description: p.description,
        category: p.category,
        alpha: p.alpha,
        beta: p.beta,
      });

    if (error) {
      console.error(`  [ERROR] ${p.name}: ${error.message}`);
    } else {
      const confidence = (p.alpha / (p.alpha + p.beta)).toFixed(2);
      console.log(`  [OK] ${p.name} (α=${p.alpha}, β=${p.beta}, confidence=${confidence})`);
      inserted++;
    }
  }

  console.log(`\n=== Done: ${inserted} inserted, ${skipped} skipped ===`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
