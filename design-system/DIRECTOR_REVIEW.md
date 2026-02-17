# GENBA QUEST 半DAO設計 - ディレクターレビュー

**Reviewer**: プロダクトディレクター視点
**Review Date**: 2026-02-02
**Target**: SEMI_DAO_DESIGN.md v1.0

---

## 📊 総合評価

| 項目 | スコア | コメント |
|------|--------|---------|
| ビジョンの明確性 | ⭐⭐⭐⭐⭐ | "半DAO"コンセプトが一貫している |
| 技術的実現可能性 | ⭐⭐⭐⭐☆ | 既存実装を活かせる。AI部分は検証必要 |
| ユーザー価値 | ⭐⭐⭐☆☆ | 技術仕様は良いが、ユーザーストーリー不足 |
| スコープ管理 | ⭐⭐☆☆☆ | 8週間で4フェーズは野心的すぎる |
| リスク管理 | ⭐⭐⭐☆☆ | 段階的だが、変更管理が未定義 |

**総合**: ⭐⭐⭐⭐☆ (4.0/5.0)

---

## ✅ 強み

### 1. 明確な技術ビジョン
```
従来: 人間が全て処理
半DAO: AI/自動化 → 人間が承認
```
この図式が非常に分かりやすい。

### 2. 段階的アプローチ
- Phase 1-4 に分割
- 各フェーズが独立して価値を提供
- リスク分散できている

### 3. 既存資産の活用
- 経費承認フロー（実装済み）を拡張
- パーク投票システムを応用
- Sherpa AIを統合

### 4. 詳細な技術設計
- SQLスキーマが具体的
- API仕様が明確
- 実装サンプルコード付き

---

## ⚠️ リスク・懸念点

### 🔴 Critical（高リスク）

#### 1. スコープクリープの危険

**問題:**
- 8週間で4フェーズは極めて野心的
- 1フェーズ = 2週間は、設計・実装・テスト・デバッグを含めると非現実的
- 品質より納期優先になるリスク

**影響:**
- 中途半端な実装
- バグの温床
- ユーザー信頼の喪失

**推奨対策:**
```markdown
## 修正案: MVP-First アプローチ

### Sprint 1-2 (2週間): MVP
- 統合承認ダッシュボード（経費+パークのみ）
- ワンクリック承認（ルールベース）
- 基本的な優先度表示

### Sprint 3 (1週間): ユーザーテスト
- 実際のユーザーに使ってもらう
- フィードバック収集
- 改善ポイント特定

### Sprint 4-5 (2週間): Phase 1 完成度向上
- バグ修正
- UX改善
- パフォーマンス最適化

### Sprint 6以降: Phase 2 or Phase 1.5
- ユーザーフィードバックを元に優先順位再決定
```

#### 2. AI信頼性の過信

**問題:**
- 設計書では「AI信頼度95%」を想定
- 実際の初期モデルは60-70%程度の可能性が高い
- ユーザーが期待外れと感じる

**影響:**
- 「AI推奨を信じたら間違っていた」→ 使われなくなる
- "AI疲れ"（AIの提案を全てチェックする羽目に）

**推奨対策:**
```typescript
// AI推奨の段階的導入

// Phase 1: AIアシスタント（控えめ）
{
  ai_recommendation: "参考情報",
  label: "AIの参考意見",
  disclaimer: "最終判断は人間が行ってください"
}

// Phase 1.5: AI信頼度が検証されてから
{
  ai_recommendation: "approve",
  confidence: 0.85,
  label: "AI推奨: 承認",
  show_reasoning: true  // 理由を必ず表示
}

// Phase 2: 高信頼度のみワンクリック提案
if (ai_confidence > 0.9 && historical_accuracy > 0.95) {
  show_quick_approve_button = true;
}
```

#### 3. ユーザーストーリーの不足

**問題:**
- 技術仕様は詳細だが「誰が何のために使うか」が不明瞭
- "Build it and they will come" の罠

**影響:**
- 作ったけど使われない
- 実際のペインポイントを解決できていない

**推奨対策:**
```markdown
## ペルソナ定義

### 佐藤さん（経理担当・承認者）
- 年齢: 45歳
- 役割: 経理部長、承認権限 ¥100,000
- 課題: 毎日20件の経費承認、1件5分 = 100分/日
- ゴール: 承認時間を50%削減したい

**ユーザージャーニー（Before）:**
1. メールで経費申請を受け取る
2. 添付ファイルを開く
3. 領収書を確認
4. 金額・カテゴリをチェック
5. 承認/否認メールを返信
6. 次の申請へ...（×20回）

**ユーザージャーニー（After - 半DAO）:**
1. ダッシュボードを開く
2. 「AI推奨: 承認可能 15件」を確認
3. 一括承認ボタンをクリック（5秒）
4. 残り5件（高額・要確認）のみ個別レビュー
5. 合計時間: 25分（75分削減！）

**成功指標:**
- 承認時間: 100分 → 25分
- 満足度: ⭐⭐⭐⭐⭐
- NPS: 9/10
```

### 🟡 Medium（中リスク）

#### 4. 変更管理が未定義

**問題:**
- 既存ワークフローからどう移行するか不明
- ユーザーの抵抗・混乱のリスク

**推奨対策:**
```markdown
## 変更管理プラン

### フェーズ0: パイロット
- 1-2名の協力的なユーザーで先行テスト
- フィードバックを即座に反映

### フェーズ1: オプトイン
- 希望者のみ新UIを使える
- 既存UIも並行稼働
- "新UIを試す" トグルスイッチ

### フェーズ2: 段階的ロールアウト
- 週に2-3名ずつ移行
- 問題があれば即座にロールバック

### フェーズ3: 全面移行
- 全員が新UIに慣れた後
- 旧UIを廃止
```

#### 5. パフォーマンス・スケーラビリティ

**問題:**
- `unified_approval_view` は複雑なJOIN
- 承認件数が100件超えた場合のパフォーマンス未検証

**推奨対策:**
```sql
-- マテリアライズドビューの検討
CREATE MATERIALIZED VIEW unified_approval_cache AS
SELECT ... FROM approval_queue ...;

-- 定期的にリフレッシュ
REFRESH MATERIALIZED VIEW CONCURRENTLY unified_approval_cache;

-- インデックス最適化
CREATE INDEX CONCURRENTLY idx_approval_priority_date
  ON approval_queue(priority DESC, due_date ASC)
  WHERE status = 'pending';
```

---

## 💡 改善提案

### 提案1: MVPの明確化

```markdown
## MVP (Minimum Viable Product) 定義

### 含める機能（Must Have）
- ✅ 統合承認ダッシュボード
  - 経費承認のみ（パークは後回し）
  - 優先度表示（urgent/high/normal）
  - 一覧表示 + フィルタリング
- ✅ ワンクリック承認
  - 条件: 金額 ≤ ¥5,000 AND OCR信頼度 ≥ 80%
  - ルールベース（AIは使わない）
- ✅ 一括承認
  - 最大10件まで

### 含めない機能（Nice to Have → Phase 1.5以降）
- ❌ AI自動提案エンジン
- ❌ 複雑なルールエンジンUI
- ❌ パーク承認の統合
- ❌ トークンエコノミー

### 成功指標
- 📊 承認時間を平均50%削減
- 😊 ユーザー満足度 4/5以上
- 🐛 Critical バグ 0件
- 📈 採用率 80%以上（2週間後）
```

### 提案2: リスク管理表

| リスク | 影響 | 確率 | 対策 | 責任者 |
|--------|------|------|------|--------|
| AI精度が低い | 高 | 高 | Phase 1ではAI使わず、ルールベースのみ | Tech Lead |
| ユーザーが使わない | 高 | 中 | パイロットテスト、オプトイン方式 | PM |
| パフォーマンス問題 | 中 | 中 | インデックス最適化、キャッシング | Backend Dev |
| スコープクリープ | 高 | 高 | MVP明確化、Sprint毎レビュー | PM/PO |
| 既存フロー破壊 | 高 | 低 | 並行稼働、ロールバックプラン | DevOps |

### 提案3: フィーチャーフラグ設計

```typescript
// server/src/config/features.ts

export const FEATURES = {
  // Phase 1
  UNIFIED_DASHBOARD: {
    enabled: true,
    rollout_percentage: 100,  // 全ユーザー
    description: '統合承認ダッシュボード'
  },

  // Phase 1.5
  AI_RECOMMENDATIONS: {
    enabled: false,  // まだ無効
    rollout_percentage: 0,
    description: 'AI推奨表示（参考情報のみ）'
  },

  // Phase 2
  AI_PROPOSALS: {
    enabled: false,
    rollout_percentage: 0,
    description: 'AI自動提案エンジン'
  },

  // 細かい機能
  QUICK_APPROVE: {
    enabled: true,
    rules: {
      max_amount: 5000,
      min_ocr_confidence: 0.8
    },
    description: 'ワンクリック承認'
  },

  BATCH_APPROVE: {
    enabled: true,
    max_items: 10,
    description: '一括承認'
  }
};

// ユーザーごとのオプトイン
export async function isFeatureEnabledForUser(
  userId: string,
  featureKey: keyof typeof FEATURES
): Promise<boolean> {
  const feature = FEATURES[featureKey];

  if (!feature.enabled) return false;

  // ロールアウト率チェック
  const userHash = hashUserId(userId);
  if (userHash % 100 >= feature.rollout_percentage) {
    return false;
  }

  // ユーザー個別設定
  const { data } = await supabase
    .from('user_feature_prefs')
    .select('opted_in_features')
    .eq('user_id', userId)
    .single();

  return data?.opted_in_features?.includes(featureKey) ?? true;
}
```

### 提案4: データ駆動の意思決定

```markdown
## データ収集・分析計画

### Phase 1 で収集するメトリクス

#### 利用状況
- DAU (Daily Active Users)
- 承認件数/日
- 平均承認時間
- ワンクリック承認使用率
- 一括承認使用率

#### 品質
- エラー率
- ロード時間（p50, p95, p99）
- API レスポンスタイム

#### ユーザー満足度
- NPS (Net Promoter Score)
- CSAT (Customer Satisfaction)
- フィードバックコメント

### ダッシュボード例

```typescript
// admin/analytics-dashboard
{
  phase1_metrics: {
    avg_approval_time_before: 100,  // 分
    avg_approval_time_after: 28,    // 分
    time_saved_percentage: 72,      // %

    quick_approve_usage: 65,        // %
    batch_approve_usage: 45,        // %

    user_satisfaction: 4.2,         // /5.0
    nps: 8.5,                       // /10

    errors_per_day: 0.5,            // 件
    p95_load_time: 1.2              // 秒
  }
}
```

**意思決定ルール:**
- ✅ 全指標が目標達成 → Phase 2 開始
- ⚠️ 一部未達成 → Phase 1.5 で改善
- 🔴 重大な問題 → ロールバック検討
```

---

## 🎯 修正版ロードマップ提案

### Sprint 1-2 (2週間): MVP開発

**Goal**: 統合承認ダッシュボードの基本機能

**Scope:**
- [ ] approval_queue テーブル作成
- [ ] 経費承認の統合（パークは後回し）
- [ ] ApprovalDashboard コンポーネント
- [ ] ワンクリック承認（ルールベース）
- [ ] 基本的な優先度表示

**Success Criteria:**
- ビルド成功
- 型エラー0件
- 基本動作確認完了

---

### Sprint 3 (1週間): パイロットテスト

**Goal**: 実ユーザーでの検証

**Activities:**
- 1-2名のパワーユーザーで先行テスト
- フィードバック収集（毎日）
- 即座にバグ修正・UX改善
- メトリクス収集開始

**Success Criteria:**
- Critical バグ 0件
- ユーザー満足度 3.5/5以上
- 承認時間削減効果を確認

---

### Sprint 4-5 (2週間): Phase 1 完成度向上

**Goal**: 品質・UX向上

**Scope:**
- [ ] パイロットフィードバック反映
- [ ] パフォーマンス最適化
- [ ] エラーハンドリング強化
- [ ] ログ・監視の整備
- [ ] ドキュメント作成

**Success Criteria:**
- 全ユーザーロールアウト可能な品質
- 承認時間50%削減達成
- NPS 8/10以上

---

### Sprint 6 (1週間): 段階的ロールアウト

**Goal**: 全ユーザーへの展開

**Activities:**
- オプトイン方式で段階的に展開
- 毎日メトリクスをモニタリング
- 問題があれば即座に対処

**Success Criteria:**
- 採用率80%以上
- エラー率 < 0.1%
- ロールバック不要

---

### Sprint 7 (1週間): 振り返り & Phase 2 計画

**Goal**: Phase 1 の総括と次の優先順位決定

**Activities:**
- レトロスペクティブ
- メトリクス総括
- ユーザーインタビュー
- Phase 2 vs Phase 1.5 の判断

**Deliverables:**
- Phase 1 完了レポート
- Phase 2 詳細設計（または Phase 1.5）

---

### Sprint 8以降: Phase 1.5 or Phase 2

**判断基準:**

```
IF (承認時間削減 >= 50% AND ユーザー満足度 >= 4.0 AND バグ < 3件/週):
  → Phase 2 (AI自動提案) に進む
ELSE IF (ユーザーから「AI提案欲しい」の声が多い):
  → Phase 1.5 (AI参考情報の追加)
ELSE:
  → Phase 1 の改善継続
```

---

## 📋 チェックリスト: 実装前の確認事項

### プロダクト視点
- [ ] MVP定義が明確か
- [ ] ユーザーストーリーが具体的か
- [ ] 成功指標が測定可能か
- [ ] パイロットテスト計画があるか
- [ ] ロールバックプランがあるか

### 技術視点
- [ ] 既存コードとの整合性は取れているか
- [ ] パフォーマンス検証計画があるか
- [ ] エラーハンドリングは十分か
- [ ] ログ・監視は整備されているか
- [ ] セキュリティレビュー済みか

### 組織視点
- [ ] ステークホルダーの合意があるか
- [ ] 変更管理プランがあるか
- [ ] トレーニング資料は準備できているか
- [ ] サポート体制は整っているか

---

## 🎬 結論

### 総評

設計書は**技術的には優れている**が、**プロダクトマネジメントの観点で改善余地あり**。

### 推奨アクション

1. **MVPを再定義** - Phase 1を半分に縮小、品質重視
2. **ユーザーストーリー追加** - ペルソナ・ジャーニーマップ作成
3. **AI機能は慎重に** - Phase 2は検証後に判断
4. **データ駆動** - メトリクス収集・分析基盤を最初から
5. **段階的ロールアウト** - パイロット → オプトイン → 全体

### Next Steps

```bash
# 1. MVP定義の明確化
design-system/MVP_DEFINITION.md を作成

# 2. ユーザーストーリー追加
design-system/USER_STORIES.md を作成

# 3. 修正版ロードマップ
design-system/ROADMAP_V2.md を作成

# 4. リスク管理表
design-system/RISK_MANAGEMENT.md を作成

# 5. 実装開始
design-executor スキルを使って Sprint 1 開始
```

---

**Reviewed by**: Claude (Product Director Mode)
**Approved for**: MVP実装（Phase 1 縮小版）
**Requires**: MVP再定義 + ユーザーストーリー作成
