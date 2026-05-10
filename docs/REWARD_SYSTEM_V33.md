# PATH 報酬システム V3.3 設計書 — 透明ガバナンス + 5段階レベル

**ステータス**: Phase 0 (設計確定) — 実装は別ブランチ `feat/path-reward-v33-transparent` で進める

**前提**: 現行 V3.2 simple ([PathV32SimpleRewardService.ts](../server/src/services/PathV32SimpleRewardService.ts)) を置き換える。MVP 北極星「請求漏れゼロ + 黒字可視化」を阻害せず、DAO思想 (番頭レス可視性) に直結する改善。

---

## 1. 背景と課題

### 現行 V3.2 simple の問題

1. **後勝ち問題**: 現場完了の度に Proposal が出て `path_member_level_history` を upsert。同月内に複数現場が完了すると、最後に承認された申告で月レベルが決まる。「月初 L3 → 月末 L1 を申告 → 月末値が L1」のような非直感的挙動が起きる
2. **入力 / 出力の粒度ミスマッチ**: 職人は「今日の自分は補助だった/主導だった」程度の認識しか即答できないが、L1〜L4 の4択を毎回求められる。認知負荷高
3. **番頭ボトルネック**: 現場完了 × メンバー数 ぶん Proposal が出る。番頭1人の承認権限に依存、不在時に詰まる
4. **格差が緩い**: L1=580 / L3=1000 で 1.72倍。利益を出せる熟練のインセンティブとして弱い

### V3.3 の方針

- **3段階入力 → 加重平均 → 5段階出力** で入力の粗さを集約で補う
- **後勝ちではなく加重平均** で全現場の申告が比例的に効く
- **番頭承認を廃止**、チーム員ピアレビューのガバナンスへ
- **重み係数の非線形化**(乗数 1.25)で熟練の取り分を 2.4 倍まで広げる

---

## 2. 確定した設計判断

| Q | 判断 |
|---|---|
| **Q1** 入力粒度 | 3段階: **補助 / 標準 / 主導** (スコア 1/2/3) |
| **Q2** 出力粒度 | 5段階: L1〜L5。重みは乗数 **1.25** の幾何級数 |
| **Q3** ガバナンス | 番頭承認廃止、**チーム全員に公開 + ピアレビュー (Objection + Co-sign)** |
| Q3 sub | Co-sign 必要数 N | `max(2, ceil(team_size / 3))`、本人同意で N-1 |
| Q4 集約方式 | **加重平均** (現場ごとの tier × その現場での出勤日数) |
| - 異議の対象 | (a) 個別の現場申告 (`tier`) を直す。月レベルは自動再計算 |
| - 月途中の見込み変動 | 申告シートに「これを申告すると見込みが L3→L4 に上がります」プレビュー |
| - 新人初期レベル | L1 デフォルト |
| - 最低稼働日数 | 設けない (1日でも出勤+申告あれば計算対象) |

---

## 3. 重み係数 (1.25 乗数)

```
weight(L_n) = 1000 / 1.25^(5-n)  (milli)
```

| 月評価 | ラベル | 重み | L1比 |
|---|---|---|---|
| L1 | 見習い | 410 | 1.00x |
| L2 | 補助主体 | 512 | 1.25x |
| L3 | 標準 | 640 | 1.56x |
| L4 | 中堅 | 800 | 1.95x |
| L5 | 熟練 | 1000 | **2.44x** |

同じ出勤日数なら L5 と L1 で月収約 2.4 倍。L4-L5 の絶対差 (200) > L1-L2 の絶対差 (102) なので、上に行くほど旨味が増す設計。

---

## 4. 集約ロジック

### 入力データ
各メンバーの月内申告: `(member_id, site_id, tier ∈ {1,2,3}, work_days_at_site)`

### スコア計算

```
month_score(member, month) =
  Σ (tier_at_site × work_days_at_site) / Σ work_days_at_site
```

`work_days_at_site` は当該月に **closed + finalized** な現場での出勤日数のみカウント。

### 5段階バケット

| month_score 範囲 | 月評価 |
|---|---|
| score < 1.3 | L1 |
| 1.3 ≦ score < 1.8 | L2 |
| 1.8 ≦ score < 2.2 | L3 |
| 2.2 ≦ score < 2.7 | L4 |
| 2.7 ≦ score | L5 |

### 計算例

A さんが3つの現場を完了:
- 現場 X: 主導 (3) × 5日
- 現場 Y: 標準 (2) × 8日
- 現場 Z: 補助 (1) × 2日

```
month_score = (3×5 + 2×8 + 1×2) / (5+8+2) = 33 / 15 = 2.20
→ L4 (中堅)
重み係数 = 800 milli
```

職人への説明: **「主導の現場が 5日、標準が 8日、補助が 2日。加重平均で 2.2 になり L4 です」** で根拠が明示できる。

---

## 5. データモデル

### 新規: `site_member_level_drafts`

現場ごとの3段階自己申告を蓄積。

```sql
CREATE TABLE site_member_level_drafts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL,
    site_id         uuid NOT NULL REFERENCES sites(id),
    member_id       uuid NOT NULL,
    tier            int2 NOT NULL CHECK (tier IN (1, 2, 3)),
    work_days       int2 NOT NULL DEFAULT 0,
    self_comment    text,
    evidence        jsonb,
    submitted_at    timestamptz NOT NULL DEFAULT now(),
    locked_at       timestamptz,                                -- 月末 lock 後は Objection 経由のみ修正可
    UNIQUE (org_id, site_id, member_id)                         -- 1人1現場1申告
);

CREATE INDEX ON site_member_level_drafts (org_id, member_id, submitted_at DESC);
CREATE INDEX ON site_member_level_drafts (org_id, site_id);
```

### 新規: `level_objections`

ピアレビューの異議申し立てとCo-sign。

```sql
CREATE TABLE level_objections (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                  uuid NOT NULL,
    target_member_id        uuid NOT NULL,
    target_month            text NOT NULL,                      -- "2026-05"
    target_draft_id         uuid NOT NULL REFERENCES site_member_level_drafts(id),
    objector_id             uuid NOT NULL,
    proposed_tier           int2 NOT NULL CHECK (proposed_tier IN (1, 2, 3)),
    reason                  text NOT NULL,
    evidence                jsonb,
    co_signs                jsonb NOT NULL DEFAULT '[]',        -- [{user_id, signed_at, comment}]
    target_self_response    jsonb,                              -- 本人弁解
    required_co_signs       int2 NOT NULL,                      -- スナップショット: 当時のチームサイズで計算
    status                  text NOT NULL DEFAULT 'open',       -- open / accepted / rejected / expired
    expires_at              timestamptz NOT NULL,
    resolved_at             timestamptz,
    resolved_tier           int2,                               -- accepted 時の最終 tier
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON level_objections (org_id, target_member_id, target_month);
CREATE INDEX ON level_objections (org_id, status, expires_at);
```

### 修正: `path_member_level_history`

5段階 enum 拡張 + 集約スナップショット保存。

```sql
ALTER TYPE path_level ADD VALUE 'L4';
ALTER TYPE path_level ADD VALUE 'L5';

ALTER TABLE path_member_level_history
    ADD COLUMN computed_score      numeric(5, 2),  -- 加重平均値
    ADD COLUMN aggregation_snapshot jsonb;          -- 集約時の全申告スナップショット
```

### サービス側定数

```ts
// PathV33RewardService.ts
export const PATH_V33_LEVEL_WEIGHT_MILLI = {
    L1: 410,
    L2: 512,
    L3: 640,
    L4: 800,
    L5: 1000,
} as const;

export const PATH_V33_TIER_LABELS = {
    1: "補助",
    2: "標準",
    3: "主導",
} as const;

export const PATH_V33_LEVEL_LABELS = {
    L1: "見習い",
    L2: "補助主体",
    L3: "標準",
    L4: "中堅",
    L5: "熟練",
} as const;

export const PATH_V33_SCORE_BUCKETS: Array<{ min: number; level: PathV33Level }> = [
    { min: 2.7, level: "L5" },
    { min: 2.2, level: "L4" },
    { min: 1.8, level: "L3" },
    { min: 1.3, level: "L2" },
    { min: 0,   level: "L1" },
];
```

---

## 6. ガバナンス: Objection + Co-sign

### Co-sign 必要数 N

```
N = max(2, ceil(team_size / 3))
ただし target_member 本人が同意した場合は N - 1
```

| チームサイズ | N (本人非同意) | N (本人同意) |
|---|---|---|
| 2-3 | 2 | 1 |
| 4-6 | 2 | 1 |
| 7-9 | 3 | 2 |
| 10-12 | 4 | 3 |
| 13-15 | 5 | 4 |

`required_co_signs` は Objection 提出時の `team_size` から計算してテーブルにスナップショット保存(後でチームサイズが変わっても発動条件は変わらない)。

### Objection ライフサイクル

```
[Step 1] 誰かが申告フィードを見て違和感を感じる
   ↓
[Step 2] その人が Objection を提出
   - target_draft_id (どの現場申告に対する異議か)
   - proposed_tier (こうあるべき)
   - reason (必須)
   - evidence (推奨)
   ↓
[Step 3] 関係者通知:
   - target_member 本人 (弁解の機会)
   - チーム全員 (Co-sign 求める)
   ↓
[Step 4] 議論期間 (デフォルト 48h)
   - 本人が target_self_response を追記可能
   - 他メンバーが co_signs に追記可能
   - objector も追加コメント可能
   ↓
[Step 5a] required_co_signs に到達 → status = accepted
   - target draft の tier を proposed_tier に書き換え
   - 当該月の score / level を再計算 + 通知配信
   ↓
[Step 5b] expires_at 到達でも到達せず → status = expired
   - 何もしない (元の申告がそのまま)
```

### 月末ロックとの関係

- 月末 +3日: 全申告 lock (`locked_at` 設定)
- 月末 +7日: Objection 提出締切
- 月末 +8日: 残った open Objection を expired に強制移行 + 月確定 reward run 起動

---

## 7. UI 動線

### 入口の単一化: 確認ベル経由

```
[現場完了]
   ↓
通知発火 (`notifications`.task_type = "site_level_draft")
   ↓
🔔確認 [N] バッジ点灯  ← 既存の bell + inbox インフラ
   ↓ ベルタップ
NotificationInbox に "現場 X のレベル申告" 行
   ↓ 行タップ
LevelDraftSheet 開く
```

### LevelDraftSheet (新規)

```
─────────────────────────────────
 現場 X のレベル申告
─────────────────────────────────

 自分の day_logs (証拠)
 ・5/3 パテ作業 (3単位)
 ・5/4 クロス施工 (5単位)
 ・5/6 仕上げ (4単位)
 出勤合計: 3日

 [補助]  [標準]  [●主導]  ← タップで切替

 自由コメント (任意)
 [____________________]

 ★ 申告プレビュー
   今月の見込み: L3 (640) → L4 (800)
   試算金額: ¥185,000 → ¥231,000

 [この内容で申告する]
─────────────────────────────────
```

### 廃止: Today 現場カードの役割チップ

`/Today` の現場カードに付いてる役割クイック選択チップは廃止。**ベル一本化** で入口を絞る。

### 個人ダッシュボード (`/path` 既存ページ拡張)

- 今月の申告履歴 (タイムライン)
- 当月見込みレベル + score + 重み + 試算金額
- 月末確定モードの状態 (「lock まであと N 日」「Objection X件」)

### チームフィード (`/path/team` 新規 or `/path` のタブ)

- 全メンバーの申告タイムライン (リアルタイム)
- メンバー別フィルタ / 現場別フィルタ
- 各申告に「異議を出す」ボタン

### 月末確定モーダル (新規)

- 全員の見込みレベル一覧 (member, level, score, 試算金額)
- 各行の内訳 (どの現場で何 tier 申告か)
- Open な Objection リスト
- カウントダウン (確定まで N 日)

### Objection UI (既存 ProposalDetailModal の registry に追加)

- proposalBody に `<ObjectionBody>` を追加
- 既存の Co-sign UI ボタン群 (「同意する」「弁解を追記」) を実装
- NotificationInbox に Objection タイプを追加 (`level.objection`)

---

## 8. 実装フェーズ

### Phase 0: 設計確定 ✅ 本ドキュメント
### Phase 1: スキーマ + 集約ロジック (1日)
- migration: 3テーブル変更/新設
- `aggregateMonthlyLevel(memberId, month)` 純粋関数 + unit test
- 既存 V3.2 と並行稼働 (shadow mode で計算結果を比較)

### Phase 2: 個人申告 UI (0.5日)
- `<LevelDraftSheet>` 新規
- 既存 `SiteDetailModal` の levelDraft セクションを差し替え or 廃止
- Today 現場カードの役割チップ削除

### Phase 3: フィード + 個人ダッシュボード (1日)
- `/path/team` (チームフィード)
- `/path` 個人ダッシュボード化

### Phase 4: Objection + Co-sign (1.5日)
- 新 Proposal type `level.objection`
- `<ObjectionBody>` 追加 (proposalBody registry に登録)
- Co-sign API (`POST /api/v1/level-objections/:id/co-sign`)
- NotificationInbox に objection タイプ

### Phase 5: 月末確定 + 自動 lock (1日)
- 月末 +3, +7, +8 の cron
- 確定モーダル
- reward_run 起動 hook

### Phase 6: 旧フロー廃止 + データ移行 (0.5日)
- 既存 `path_member_level_history` (L1-L4) を新スケール (L1-L5) にマッピング
- 旧 `pathV32SimpleLevelUpdate` proposal type を deprecated 化
- shadow mode 切り替え → V3.3 を正本化

**合計 ~5.5日**

---

## 9. 移行計画

### 既存レベルのマッピング

旧 V3.2 simple は L1=580 / L2=760 / L3=1000 の3段階。新 V3.3 は5段階。マッピング:

| 旧 (V3.2) | 新 (V3.3) | 根拠 |
|---|---|---|
| L1 | L2 (補助主体) | 旧 L1 は新 L1 (見習い) より上位 |
| L2 | L3 (標準) | 中間レベル |
| L3 | L4 (中堅) | 旧最上位 = 新中堅 |
| (なし) | L1 | 新規入社者用 |
| (なし) | L5 | 主導役を量的に証明したメンバー用 |

注: 旧データを移すと一時的に **誰も L5 に居ない** 状態になるが、これは正しい。L5 は新フローで申告と Objection の検証を経て獲得するもの。

### 申告データの初期化

旧 `path_member_level_history` の各レコードを新 `site_member_level_drafts` に逆生成するのは非現実的(現場-メンバー-tier の対応が無いため)。代わりに:

- 過去月: 旧履歴の最新値を新 enum で `path_member_level_history` に保存(後勝ち継続)
- 当月以降: V3.3 集約で計算

### Shadow mode (Phase 1-5 並行稼働)

Phase 5 完了までは V3.2 と V3.3 を並行で計算し、reward run は V3.2 を正、V3.3 をログのみ。Phase 6 で切り替え。

---

## 10. オープンリスク

### R1: 申告のサンプル不足
1ヶ月で1現場しか完了しないメンバーは加重平均が偏る。

**対策案**: 過去2-3ヶ月のローリングウィンドウで補完するオプションを Phase 2 以降で検討。Phase 1 では純粋に当月のみ。

### R2: 月途中の見込み変動が職人にストレス
申告するたびに見込みレベルが動く → 「上がった/下がった」体験。

**対策**: 申告シートで **プレビュー表示** (「申告すると L3 → L4 になります」) して納得感を作る。+ 月途中の見込みは "確定値" ではなく "予想値" であることを UI で明示 (例: 「今月の見込み (確定は月末+8日)」)。

### R3: チーム規模が小さい時の Co-sign 集まらない問題
3人チームで N=2 だが、Objection を出した本人(objector)は Co-sign に含めるか?

**仕様**: objector の Co-sign は **自動カウント** (本人 + 1人で N=2 達成可能)。target_member 本人が同意した場合は N-1。

### R4: 自己申告のインフレ
番頭承認が無い + ピア圧のみだと、皆が「主導」と申告するインフレが起きる可能性。

**対策**:
- チームフィードで全員が見えること自体が抑止力 (社会的圧力)
- evidence (day_logs / 役割証拠) を必須化
- 月次で score の分布を統計表示 ("今月の平均 score = 1.8" など) → 異常値が目立つ
- 必要なら Phase 6 以降で「Objection 申立件数の多いメンバー」を可視化

### R5: 報酬計算の不可逆性
月末 +8日に自動確定 + reward run 起動。後で間違いに気づいた時の reversal 経路を確保しておく必要。

**対策**: 既存の `reward.adjust` proposal 経路で reversal 可能。Phase 6 で動作確認。

---

## 11. 関連ドキュメント

- 旧設計: [docs/REWARD_SYSTEM.md](./REWARD_SYSTEM.md) (V3.2 までの仕様)
- 思想根拠: [docs/DESIGN_PHILOSOPHY.md](./DESIGN_PHILOSOPHY.md)
- 関連サービス: [server/src/services/PathV32SimpleRewardService.ts](../server/src/services/PathV32SimpleRewardService.ts), [server/src/services/PathGovernedModuleService.ts](../server/src/services/PathGovernedModuleService.ts)

---

**版数**: 0.1.0 (Phase 0 確定)
**最終更新**: 2026-05-11
