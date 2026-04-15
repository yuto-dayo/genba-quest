# 2026-04-08 PATH 評価・報酬ロジック v2 実装仕様

## 目的

PATH v2 を、制度説明ではなく実装可能な仕様として固定する。

この文書は次を定義する。

- PATH Core / Craft Evidence / Culture Signals の責務境界
- 既存 LUQO 実装からの移行方針
- Proposal / DB / API / UI の責務分離
- 月次評価、プロフィール認定、報酬計算の接続方法
- 段階導入の順序

## 結論

- PATH v2 は採用する
- ただしビッグバン移行はしない
- 既存 LUQO は破棄せず、細技能と文化要素を補助レイヤーへ退避させる
- 報酬の主系は `reward.calculate` に寄せる
- AI は候補生成と要約のみを担当し、確定は人間が行う

## プロダクト判断

### 採用する理由

- メンバー入力を軽くできる
- 管理側レビューを根拠付きにできる
- 詳細技能をプロフィールへ継続蓄積できる
- 報酬計算を固定ロジックで再現できる
- 組織拡大時も「誰に何を任せられるか」が崩れにくい

### 捨てるもの

- LUQO 総合点を報酬本体へ直接入れる設計
- 細技能を月次主評価に戻す設計
- AI 自動確定前提の運用
- 月次入力の長文依存

## 設計原則

### 1. 3レイヤーを混ぜない

- PATH Core: 月次評価、報酬計算、Level反映、承認、監査ログ
- Craft Evidence: 主評価項目の根拠、詳細技能タグ、現場実績、認定履歴
- Culture Signals: 学習、支援、改善、安全性の補助シグナル

### 2. 固定ロジックはコードで明示する

- 報酬計算式は定数と関数で明示する
- 月次係数の丸めルールをコード化する
- 「不明」は必ず `unverified` または `review_required` に倒す

### 3. 候補と確定を分ける

- AI出力は常に candidate
- 熟練者確認は review
- プロフィール current 値と報酬確定値は approved/finalized のみ保持する

### 4. 報酬説明責任を優先する

- 報酬差の主役は Level
- 月次評価は微調整
- Culture Signals は補助根拠であり、直接係数ではない

## 既存 LUQO からの移行方針

現行 LUQO は以下を一体で持っている。

- スキルカタログ
- スター実績
- 月次 LUQO スコア
- LUQO 報酬計算

参照:

- [LUQOService.ts](/Users/yutoyoshino/Documents/genba-quest/server/src/services/LUQOService.ts)
- [024_luqo_system.sql](/Users/yutoyoshino/Documents/genba-quest/server/sql/024_luqo_system.sql)

PATH v2 では次のように再配置する。

- `luqo_skill_catalog` と達成実績のうち細技能相当は Craft Evidence へ移管する
- LUQO の文化・学習系入力は Culture Signals の候補ソースとして扱う
- `luqo.reward.calculate` は主系から外し、PATH の報酬確定は `reward.calculate` に統一する
- 旧 LUQO 画面は移行期間中 read-only 互換層として残してよい

## 責務境界

### PATH Core

Authoritative な確定値を持つ。

- 月次評価確定
- 報酬計算スナップショット
- 現在 Level
- Level 変更履歴
- 承認結果
- 監査ログ

### Craft Evidence

任せられる範囲の根拠を持つ。

- 月末フォーム回答
- AI整理結果
- 熟練者確認
- 主評価項目の状態候補
- 詳細技能認定
- 現場実績
- 認定履歴

### Culture Signals

評価補助シグナルを持つ。

- 学習行動
- 支援行動
- 改善行動
- 安全性シグナル
- 要レビュー抽出根拠

## Proposal 方針

主系の確定操作は既存 Proposal type に寄せる。

| Action | Proposal type | Notes |
| --- | --- | --- |
| 月末フォーム提出 | `evaluation.submit` | 提出内容自体は証跡、確定評価ではない |
| 月次評価確定 | `evaluation.finalize` | A/R/Q と candidate 状態を人が確定 |
| 詳細技能認定 | `skill.achieve` | `status` を payload に持たせる |
| 詳細技能取り消し/再確認差し戻し | `skill.revoke` | 永久剥奪ではなく現時点の取消 |
| 月次報酬確定 | `reward.calculate` | 計算入力と定数版をスナップショット保存 |

### Proposal を使わないもの

以下は raw evidence のため append-only 保存を許可する。

- 月末フォームの下書き
- AI整理結果の生成物
- 文化シグナルの収集ログ

理由:

- これらは確定ドメイン状態ではなく証跡レイヤーである
- すべてを Proposal 化すると UX と運用コストが悪化する
- ただし、これらを根拠に current profile / reward / level を更新する時点では Proposal 必須

## 報酬計算仕様

### 固定式

```ts
const BASE_POOL_RATE = 0.85;
const VARIABLE_POOL_RATE = 0.15;

const LEVEL_COEFFICIENTS = {
  L1: 0.85,
  L2: 1.0,
  L3: 1.15,
  L4: 1.3,
} as const;

const MONTHLY_COEFFICIENT_RULES = [
  { min: 0, max: 1, coefficient: 0.9 },
  { min: 2, max: 4, coefficient: 1.0 },
  { min: 5, max: 6, coefficient: 1.1 },
] as const;
```

```ts
M = sales - outsourcing - materials - parking - transport - directMisc - commonCost - reserve;
B = M * BASE_POOL_RATE;
V = M * VARIABLE_POOL_RATE;

Wb_i = workDays_i * levelCoefficient_i;
Base_i = B * Wb_i / sum(Wb);

Mp_i = A_i + R_i + Q_i;
C_i = coefficientByMonthlyPoint(Mp_i);
Var_i = V * C_i / sum(C);

Reward_i = Base_i + Var_i;
```

### 月次評価入力

- `A`, `R`, `Q` は 0 / 1 / 2
- 直接入力ではなくレビュー結果として確定する
- Quality Gate に該当する月は速度寄与や役割寄与を打ち消せる構造にする

### スナップショット必須項目

報酬確定時に以下を保存する。

- `month`
- `member_id`
- `work_days`
- `level`
- `level_coefficient`
- `A`, `R`, `Q`
- `monthly_point_total`
- `monthly_coefficient`
- `profit_inputs_snapshot`
- `constant_snapshot`
- `policy_snapshot`
- `base_reward`
- `variable_reward`
- `total_reward`
- `proposal_id`

この保存がない報酬計算は PATH v2 として不採用。

## 主評価項目

月次の主評価項目は以下の 6 項目に固定する。

1. クロス施工力
2. パテ・下地処理力
3. 段取り・準備力
4. 品質安定力
5. 現場信頼形成力
6. 教育・支援力

UI の状態選択肢は以下に固定する。

- `unverified`
- `assist_required`
- `conditional`
- `near_independent`
- `stable_independent`

内部丸めルール:

- `unverified` / `assist_required` -> 未確認寄り
- `conditional` -> 条件付き確認
- `near_independent` / `stable_independent` -> 単独完了候補

## データモデル

### 1. `monthly_evaluation_forms`

月末フォーム回答の生データ。

- `month`
- `member_id`
- `selected_big_skill_states jsonb`
- `selected_roles jsonb`
- `site_ids jsonb`
- `photo_flag`
- `rework_flag`
- `comment`
- `submitted_at`

### 2. `monthly_evaluation_ai_reviews`

AI の候補整理結果。

- `month`
- `member_id`
- `monthly_summary`
- `candidate_states jsonb`
- `candidate_skill_tags jsonb`
- `profile_update_candidates jsonb`
- `promotion_candidate_flag`
- `reasons jsonb`
- `evidence_summary jsonb`
- `unknown_points jsonb`
- `review_required_flag`
- `generated_at`

### 3. `monthly_evaluation_confirmations`

熟練者確認と確認状態。

- `month`
- `member_id`
- `target_type`
- `target_key`
- `confirmation_status`
- `comment`
- `confirmed_by`
- `confirmed_at`

### 4. `member_skill_profiles`

個人プロフィールの current 値。

- `member_id`
- `current_level`
- `current_level_since`
- `cross_work_status`
- `putty_foundation_status`
- `planning_preparation_status`
- `quality_stability_status`
- `site_trust_status`
- `education_support_status`
- `updated_at`

### 5. `member_skill_certifications`

詳細技能認定。

- `id`
- `member_id`
- `skill_key`
- `category`
- `status`
- `verified_by`
- `verified_at`
- `evidence_count`
- `last_site_id`
- `note`
- `review_required_flag`

### 6. `member_level_histories`

- `member_id`
- `before_level`
- `after_level`
- `review_period`
- `approved_by`
- `approved_at`
- `reason_summary`

### 7. `reward_calculation_snapshots`

報酬の再現用スナップショット。

- `month`
- `member_id`
- `calculation_version`
- `input_snapshot jsonb`
- `result_snapshot jsonb`
- `proposal_id`
- `finalized_at`

### 8. `culture_signal_logs`

- `member_id`
- `month`
- `signal_type`
- `source_type`
- `source_ref`
- `summary`
- `review_required_flag`
- `created_at`

## API / UI 方針

### メンバー UI

- 現在 Level
- 今月の稼働
- 月末フォーム進捗
- 今月確認済み内容
- 最近認定された技能
- 次 Level の概要条件

### 管理 UI

- 月末フォーム回答一覧
- AI整理結果
- 主評価項目候補
- 詳細技能候補
- プロフィール更新候補
- 昇格候補
- 熟練者フィードバック
- 要レビュー一覧
- 報酬計算結果
- 監査ログ

### UI 原則

- 3画面以内
- 選択式中心
- 短文自由記述のみ
- 「入力する UI」より「AIが整理した内容を確認する UI」を優先する

## ガードレール

### 必須

- 根拠不足は減額に使わない
- フォーム未提出で自動減額しない
- 不明時は `unverified` / `review_required`
- AI は Level を確定しない
- AI は詳細技能認定を確定しない
- 文化シグナルを主計算に使わない

### 品質ゲート

以下は定数化する。

- `QUALITY_GATE_RULES`
- `PROMOTION_MIN_EVIDENCE_COUNT`
- `CULTURE_SIGNAL_TYPES`
- `SKILL_TAG_KEYS`
- `BIG_SKILL_STATE_OPTIONS`
- `PROFILE_CERTIFICATION_STATUS_OPTIONS`
- `REVIEW_STATUS_OPTIONS`

## 実装順序

### Phase 1: PATH Core 最小導入

- `reward_calculation_snapshots` を追加
- PATH 計算エンジンを追加
- `reward.calculate` で PATH 報酬確定を通す
- 旧 LUQO 報酬との shadow compare を実装する

成功条件:

- 同一月の再計算で結果が一致する
- 計算根拠を API で説明できる

### Phase 2: 月末フォームと AI 整理

- 月末フォーム read/write
- AI整理結果保存
- 管理画面で candidate 表示
- `evaluation.finalize` の確定フロー実装

成功条件:

- 月次評価の候補と確定が分離される
- 不明項目が安全側に倒れる

### Phase 3: プロフィール認定

- `member_skill_profiles` を追加
- `member_skill_certifications` を追加
- `skill.achieve` / `skill.revoke` で認定更新

成功条件:

- 個人プロフィールに詳細技能が蓄積される
- 月次評価とプロフィール認定が混ざらない

### Phase 4: Culture Signals

- `culture_signal_logs` を追加
- 要レビュー抽出と昇格補助根拠に接続

成功条件:

- 補助シグナルは見える
- 報酬主計算には入らない

## 移行ルール

- 最初の 1-2 か月は旧 LUQO と PATH を並行比較する
- PATH を確定系に昇格させるのは shadow compare が安定してからにする
- 旧 LUQO データは削除せず read-only 互換として保持する

## Open Questions

- `evaluation.submit` を完全 Proposal 化するか、evidence append-only とするか
- 既存 `profiles` テーブルへ PATH current 値を寄せるか、専用 profile テーブルを新設するか
- Level 要件表示を固定文面で持つか、ルールベースで生成するか

## 採用判断

この方針は採用する。

理由は、制度の美しさよりも次を同時に満たせるからである。

- 現場 UX を壊さない
- 管理レビューを根拠付きにできる
- 報酬計算を説明可能にできる
- LUQO の資産を無駄にしない
- DAO/Proposal 中心設計に大きく逆行しない
