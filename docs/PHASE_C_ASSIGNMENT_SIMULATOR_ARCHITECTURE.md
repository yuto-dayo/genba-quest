# Phase C: 現場シミュレーターUI アーキテクチャ計画

最終更新: 2026-02-20
対象フェーズ: Phase C（UI刷新） / Phase D（自動化接続の先行設計）

---

## 1. 目的

「直感的にアサインを組むUI」を、既存の `Proposal + Policy + Ledger` に厳密接続し、
GENBA QUEST を次の状態に引き上げる。

- 現場運営: シフト/空き/必要人員をパズル的に編成できる
- 経営可視化: 承認された編成がそのまま会計・報酬計算の根拠になる
- 監査可能性: 「誰が、なぜ、どの警告を越えて確定したか」を追跡できる

---

## 2. スコープ

### In Scope（Phase C）

- Calendarを「閲覧中心」から「編成シミュレーター」へ拡張
- 職人の稼働率・空き状況・ダブルブッキング警告の可視化
- 現場ごとの必要スロット（必要スキル/人数）の可視化
- ドラッグ操作結果を Proposal として確定（承認フロー接続）
- 確定結果を Ledger Event と月次集計の起点にする

### Out of Scope（Phase Cでは未対応）

- 完全自律のAI自動承認（AI自己承認禁止は維持）
- 高度最適化アルゴリズム（巡回最適化や混合整数計画）
- 給与計算の最終確定実行（Proposal作成まで）

---

## 3. 非機能ゴール

- 100人規模・90日表示で操作遅延を体感 150ms 未満に抑える
- 競合時に「静かに上書き」しない（必ず衝突検知）
- 全確定操作に監査メタデータ（actor/reason/rule snapshot）を保持

---

## 4. 設計原則（DAO整合）

1. 状態変更は Proposal 経由（ドラッグ中は非永続）
2. 承認 + Event発行 + 状態更新を1トランザクション化
3. AI自己承認禁止ゲートを最優先（Policyより先に評価）
4. Ledgerは追記のみ、修正は逆イベントで表現
5. Read Model と Write Model を分離し、UIはRead Modelのみ参照

---

## 5. 全体アーキテクチャ

```text
UI Drag&Drop (Simulation State)
  -> Preview API (conflict/policy hints)
  -> Commit API
    -> Proposal batch (assignment.create/update/cancel)
      -> Policy evaluation
      -> Approval / Auto-approval
      -> execute_proposal_atomic
        -> Assignment projection update
        -> Ledger event append
        -> Read model refresh
```

### 5.1 2層状態モデル

- Simulation Layer（未確定）
  - フロントの Zustand ストアに保持
  - 何度操作しても DB には反映しない
- Committed Layer（確定）
  - Proposalが `approved/executed` になった時だけ反映
  - 監査対象はこの層のみ

---

## 6. ドメインモデル（Phase C追加）

### 6.1 Assignment Slot（現場側の必要枠）

```ts
type AssignmentSlot = {
  slot_id: string;
  site_id: string;
  date: string; // YYYY-MM-DD
  required_skill: string; // plaster, electrical, helper...
  required_level: 'bronze' | 'silver' | 'gold';
  required_count: number;
  filled_count: number;
  status: 'ok' | 'shortage';
};
```

### 6.2 Worker Capacity（職人の稼働枠）

```ts
type WorkerCapacity = {
  user_id: string;
  week_key: string; // YYYY-WW
  assigned_days: number;
  max_days: number;
  free_days: number;
  warning: 'none' | 'near_limit' | 'over_limit';
};
```

### 6.3 Simulation Draft（未確定操作）

```ts
type SimulationDraft = {
  draft_id: string;
  range: { from: string; to: string };
  operations: Array<{
    op: 'create' | 'move' | 'remove';
    assignment_id?: string;
    user_id: string;
    site_id: string;
    date: string;
  }>;
};
```

---

## 7. UI設計（シミュレーター）

### 7.1 画面構造

- 左: 職人リスト（バッジ/稼働率ゲージ/空き日数）
- 中央: 日付グリッド（ドラッグ対象）
- 右: 現場スロット（必要スキルと不足数）
- 下部: 警告パネル（競合/ポリシー/override理由）

### 7.2 インタラクション

1. 職人アイコンをスロットへドラッグ
2. 即時バリデーション（競合・スキル・稼働上限）
3. 問題なければ仮配置（Simulation Layer）
4. 問題があれば警告表示:
   - `BLOCK`: 確定不可
   - `WARN`: override理由必須で確定可能
5. 「承認へ送る」で Proposal バッチ生成

---

## 8. 警告とPolicy境界

### 8.1 判定クラス

| Class | 例 | UI挙動 | Proposal挙動 |
|---|---|---|---|
| BLOCK | 組織外メンバー、必須データ欠落 | 赤で操作不可 | 作成しない |
| WARN | ダブルブッキング、週上限超過、スキル不足 | 黄で要確認 | override理由付きで作成可 |
| INFO | 育成枠、推奨スキル不一致 | 青で提案表示 | 通常作成 |

### 8.2 override設計

`WARN` で強行する場合、payload に以下を必須保持:

```json
{
  "override": {
    "reason": "育成目的で配置",
    "risk_codes": ["double_booking", "skill_gap"],
    "requested_by": { "type": "human", "id": "..." }
  }
}
```

override付き Proposal は自動承認禁止（最低1人承認必須）。

---

## 9. Proposalマッピング

| UI操作 | Proposal type | 備考 |
|---|---|---|
| 新規配置 | `assignment.create` | 初回配置 |
| 日時/現場変更 | `assignment.update` | 既存アサイン移動 |
| 取り消し | `assignment.cancel` | 逆イベント前提 |
| 月次報酬算定トリガー | `reward.calculate` | system/ai が提案のみ |

バッチ確定時も「1変更 = 1 Proposal」を維持し、監査粒度を落とさない。

---

## 10. Ledger/Event連携

### 10.1 記録タイミング

- ドラッグ中: 記録しない
- Proposal executed時: Ledger Event 追記

### 10.2 Event種別

- `assignment.scheduled`
- `assignment.rescheduled`
- `assignment.cancelled`

### 10.3 月次連携

月次ジョブ（system actor）が以下を実施:

1. `assignment.*` event を期間集計
2. 現場別売上見込・職人別稼働実績を算出
3. `reward.calculate` Proposal を自動作成
4. 人間承認後に実行

---

## 11. API / Read Model計画

### 11.1 Read API

- `GET /api/v1/simulator/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/v1/simulator/capacity?week=YYYY-WW`
- `GET /api/v1/simulator/site-slots?from=&to=`

### 11.2 Simulation API

- `POST /api/v1/simulator/preview`
  - 入力: draft operations
  - 出力: `conflicts[]`, `policyHints[]`, `projectedCapacity`
- `POST /api/v1/simulator/commit`
  - 入力: draft + optional override reasons
  - 出力: created proposals + auto-approved count + pending count

### 11.3 Read Model候補

- `calendar_assignments_view`
- `worker_capacity_view`
- `site_slot_coverage_view`
- `assignment_conflicts_view`

---

## 12. 実装計画（詳細）

### M3-C1: Read ModelとAPI土台

実装:
- Calendar/Coverage/Capacity の read model を追加
- simulator read API を追加

DoD:
- 90日範囲の取得が 500ms 以内
- Calendar 画面が既存API依存なしで描画可能

### M3-C2: フロントシミュレーター

実装:
- Drag&Drop編成UI
- Simulation Zustand ストア
- 警告パネル（BLOCK/WARN/INFO）

DoD:
- DB未更新のまま仮配置を複数回編集できる
- ダブルブッキング検知を視覚表示できる

### M3-C3: Commit→Proposal化

実装:
- commit API で Proposal バッチ生成
- override理由必須バリデーション
- 承認待ちカードへの即時反映

DoD:
- 1回の確定で複数 Proposal が正しく生成される
- Proposal payload に warning/override 情報が保持される

### M3-C4: Ledger接続

実装:
- `assignment.*` 実行時 event 追記
- 月次算定ジョブの Proposal 作成まで接続

DoD:
- executed後に event が重複なく記録される
- `reward.calculate` Proposal を期間指定で生成できる

### M3-C5: 安定化

実装:
- E2Eテスト・監査クエリ・運用Runbook整備
- メトリクス（conflict発生率、override率）追加

DoD:
- 主要E2Eシナリオが CI で安定
- 障害時の切り戻し手順が Runbook 化

---

## 13. 検証計画

### 13.1 E2E（必須）

1. 同日二重配置で WARN + override理由必須
2. 必要スキル不足のまま強行して承認待ち化
3. AI提案アサインを AI が承認できないこと
4. 承認後に assignment event が Ledger に追記されること
5. 月次で `reward.calculate` Proposal が自動作成されること

### 13.2 回帰

- `execute_proposal_atomic` 系統合テスト
- Proposal status (`pending`) のUI表示回帰
- 既存 Today/Sites/Money への影響確認

---

## 14. リスクと先回り対応

| リスク | 内容 | 対応 |
|---|---|---|
| 競合更新 | 複数親方が同時編集 | commit時に楽観ロック + 再試行導線 |
| UI過負荷 | 大規模表示で遅延 | 範囲分割取得 + 仮想化 |
| override濫用 | ルール逸脱が常態化 | override率メトリクスと月次レビュー |
| 会計連携の誤集計 | イベント重複/欠落 | idempotency key + 監査クエリ常設 |

---

## 15. 直近アクション（着手順）

1. M3-C1 の read model スキーマ草案を作成
2. `preview` / `commit` API 契約を OpenAPI 下書き化
3. Calendar UI の情報設計モック（PC/モバイル）を確定
4. E2E 5シナリオを先にテストケース化
