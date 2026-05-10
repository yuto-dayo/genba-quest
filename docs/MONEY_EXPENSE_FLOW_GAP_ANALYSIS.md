# Money / Expense Flow — Gap Analysis

[MONEY_EXPENSE_FLOW.md](./MONEY_EXPENSE_FLOW.md) Phase 1 仕様に対する、既存コードの現状とギャップ分析。

> Status: Draft (2026-05-10)
> Branch: `feature/expense-approval-policy`
> Audit scope: `server/src/services/PolicyEngine.ts`, `server/src/routes/accounting.ts`, `frontend/src/pages/Money.tsx`, `frontend/src/components/ExpenseModal.tsx`, `supabase/migrations/`

---

## 0. サマリ

すでに**かなり多くの基盤が揃っている**。Phase 1の追加コストは思ったより小さい。ただし1件**重大な漏れバグ**を発見：T番号(`invoice_number`)はフロント入力UIまで実装済みだが、**バックエンド側でdestructureされず捨てられている**。

| 領域 | 評価 | コメント |
|---|---|---|
| Proposal/Policy基盤 | ✅ ほぼ揃い | PolicyEngine、AI自己承認禁止ガード、ActorRef型まで実装済 |
| Ledger / 仕訳 | ✅ 完成 | canonical_expense_posting RPC稼働中 |
| 立替精算機構 | ✅ 完成 | paid_by / claimant / settlement / reimbursement 揃い |
| OCR / 重複検知 | ✅ 実装済 | ExpenseModalで稼働 |
| scope (4値拡張) | ⚠️ 部分 | 現状 job/overhead の2値、拡張要 |
| T番号 | ⚠️ 漏れバグ | フロント入力 → バックエンドで捨てられている |
| field_change_log | ❌ 未実装 | append-onlyログ機構なし |
| バケットダッシュボード | ❌ 未実装 | 「承認待ち件数」表示のみ |
| 詳細ビュー（履歴付き） | ❌ 未実装 | TransactionDetailModalはあるが履歴なし |
| 異常検知フラグ配列 | ⚠️ 部分 | `risk_level: LOW/HIGH` 単一値、拡張要 |
| 閾値ロジック | ⚠️ 要移設 | accounting.ts にハードコード、Policyへ移すべき |
| closed (月次lock) | ❌ 未実装 | |
| 逆仕訳UI | ❌ 未実装 | |

---

## 1. 既存資産の棚卸し

### 1.1 PolicyEngine（[server/src/services/PolicyEngine.ts](../server/src/services/PolicyEngine.ts)）

**揃っているもの:**
- `expense.create / expense.update / expense.void` を ProposalType に登録済（L15-17）
- `ActorType: 'human' | 'ai' | 'system' | 'integration'`（L58）
- `evaluateProposal()` でポリシーマッチング、auto_approve/required_approvals/aiCanApproveを返す
- `canApprove()` で **AI自己承認禁止** ガード実装済（L281-286）
- `policies` テーブルからPolicy条件を読み込み、優先度順マッチ

**Phase 1 で活用するポイント:**
- 経費の閾値ルール（10万円超 = asset_candidate、scope=job_advance 等）は **policies テーブルに登録するだけ**で動く
- 新ProposalType追加不要（`expense.create`既存をそのまま使う）

### 1.2 Expense作成エンドポイント（[server/src/routes/accounting.ts](../server/src/routes/accounting.ts):1208）

**揃っているもの:**
- `expense_scope`: `"job" | "overhead"` の2値バリデーション（L1250）
- `category`: material / tool / travel / food / fuel / utility / other
- `tax_category`: 10_STANDARD / 08_REDUCED / 00_EXEMPT / 00_TAXFREE
- `expense_item_code`: parking / toll / consumable / cleaning / waste / fee / other（雑費サブカテゴリ）
- `risk_level: "LOW" | "HIGH"` 自動判定（L1340-1362）
- `review_status` フィールド（`EXPENSE_REVIEW_NOT_REQUIRED` 定数あり）
- `paid_by` / `claimant_member_id` / `settlement_type` / `payment_account` / `reimbursement_status` (立替精算)
- `source_document_id` / `input_sources`（OCR出処）
- `metadata_json`（拡張領域、L1458-1465）
- `idempotency-key` による冪等性
- `canonical_expense_posting` RPC で Ledger転記

**閾値ロジック（要Policyへ移設）:**
```javascript
// accounting.ts:1357-1362
if (
    (normalizedCategory === "material" || normalizedCategory === "tool") && total > 30000 ||
    (normalizedCategory === "food" || normalizedCategory === "travel") && total > 5000
) {
    risk_level = "HIGH";
}
```
→ ハードコード。`policies` テーブルに移し、PolicyEngine経由評価にすべき。

### 1.3 ExpenseModal（[frontend/src/components/ExpenseModal.tsx](../frontend/src/components/ExpenseModal.tsx)）

**揃っているもの:**
- 3ステップフロー: upload → ocr → form
- レシート画像アップロード + OCR解析（[L143以降]）
- OCR項目の自動入力 + `inputSources: { field: "ocr" | "manual" }` 記録
- 重複検知（同日同店同金額）
- 仕訳プレビュー（JournalPreview）
- フォーム項目: vendor / date / 税抜・税額・税込 / category / tax_category / item_code / cost_center / site_id / **invoice_number** / payment_method

**重大ギャップ — T番号(invoice_number)が消える:**
- フロント L129: `invoice_number: ""` でstate保持
- フロント L334: OCR成功時 `newFormData.invoice_number = String(invoiceNum.value)` で値設定
- フロント L792: `value={formData.invoice_number}` で入力UI表示
- **バック L1211-1233: req.body destructure に `invoice_number` が含まれていない** ← T番号情報は捨てられる
- **バック側で `invoice_number` 列も `metadata_json` への保存もなし**

→ **インボイス制度対応が破綻している**。Phase 1 のはじめに必ず修正すべき。

### 1.4 Money画面（[frontend/src/pages/Money.tsx](../frontend/src/pages/Money.tsx)）

**揃っているもの:**
- PL サマリ（売上 / 経費 / 利益 / 分配可能 / 承認待ち件数）— L763-773
- 月切替 UI
- 検索 / フィルター（kind / dateFrom / dateTo / query）
- 取引一覧（fetchTransactions / searchTransactions）
- 承認カード（ApprovalCard）
- 経費・売上・請求書モーダル
- TransactionDetailModal / ProposalDetailModal

**未実装（Phase 1で追加）:**
- バケット別ダッシュボード（未割当 / 要確認 / verified待ち / posted / asset候補 / advance滞留）
- バケットごとの件数・金額・滞留日数表示
- 各バケットを開く専用タブ
- 現場別黒字カード
- 詳細ビューに編集履歴セクション
- AI推定理由の表示
- Job候補チップス（起票時）

### 1.5 既存DBスキーマ

最新マイグレーション（2026-05-09 〜 05-10）で以下が稼働：
- `canonical_expense_posting_rpc` (05-09)
- `harden_legacy_accounting_base_rpcs` (05-09)
- `add_party_org_boundary_helpers` (05-10)
- `wire_idempotency_lookup_to_canonical_rpcs` (05-10)

経費テーブルはすでに `metadata_json` を持っているので、Phase 1 では**新規テーブル不要**で `metadata_json` 内に拡張可能（ただし整合性を見る場合は専用列推奨）。

---

## 2. Phase 1 ギャップを埋めるための作業ブレークダウン

### 2.1 即修正（バグ）

**T-FIX-1: invoice_number(T番号) の永続化**
- 場所: `server/src/routes/accounting.ts` L1211 destructure に `invoice_number` 追加
- 場所: L1435〜 `insertExpenseTransaction` の `metadata_json` または専用列に保存
- 場所: `postCanonicalExpense` 引数にも `invoiceNumber` 追加
- 影響: インボイス制度対応の前提
- 工数: 30分〜1時間

### 2.2 DBマイグレーション（最小限）

**M-1: expense_scope 4値拡張**
- 既存CHECK制約を `('job', 'job_advance', 'stockpile', 'overhead')` に拡張
- 既存データはすべて `job` か `overhead` なので無影響
- 工数: 1マイグレーションファイル

**M-2: flags 配列列追加**
```sql
ALTER TABLE accounting_transactions
ADD COLUMN flags TEXT[] DEFAULT ARRAY[]::TEXT[];
```
- 異常検知フラグ用
- 工数: 1マイグレーション + index

**M-3: field_change_log テーブル新設**
```sql
CREATE TABLE expense_field_change_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES accounting_transactions(id),
  field TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  changed_by JSONB NOT NULL,        -- ActorRef
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL,              -- manual | ai_inference | system_auto
  reason TEXT,
  org_id UUID NOT NULL
);
CREATE INDEX ON expense_field_change_log(expense_id, changed_at DESC);
```
- append-only（UPDATE/DELETE はRLSで禁止）
- 工数: 1マイグレーション + RLS

**M-4: review_status拡張**
- 現状: `EXPENSE_REVIEW_NOT_REQUIRED` のみ参照
- 拡張: `captured / classified / verified / posted / closed` の5値（または既存の値を使う）
- 工数: 1マイグレーション

**M-5: invoice_number 列追加**
- T-FIX-1 のために `metadata_json` ではなく専用列推奨（検索性のため）
- 工数: 1マイグレーション

### 2.3 サーバー実装

**S-1: scope 4値ロジック分岐**
- accounting.ts:1250 のバリデーション拡張
- `job_advance` の場合: site_id は planned/contracted ステータスを許容
- `stockpile` の場合: site_id null許容、cost_center=HQ自動セット
- 工数: 1〜2時間

**S-2: 閾値ロジックをPolicyへ移設**
- accounting.ts:1357-1362 のハードコード閾値を削除
- `policies` テーブルに `expense.create` 用ポリシーを seed
  - `category in [material, tool] AND amount > 30000` → review_required
  - `category=tool AND amount >= 100000` → flag: asset_candidate
- PolicyEngine.evaluateProposal() の結果から flags を導出
- 工数: 半日

**S-3: field_change_log 書き込み機構**
- expense create / update 時に変更フィールドを diff 計算 → log insert
- ActorRef 解決（req.userId, AI tag, system tag）
- 工数: 半日

**S-4: 異常検知ルールエンジン（Phase 1 はルールベース）**
- 経費insert後 hookで以下評価:
  - missing_job / missing_receipt / missing_invoice_number / asset_candidate / duplicate_suspected / advance_stale
- `flags[]` に書き込み
- 工数: 1日

**S-5: バケット集計エンドポイント**
- `GET /api/accounting/expense_buckets?month=2026-05` を新設
- 各バケットの件数・金額・最古滞留日を返す
- 工数: 半日

### 2.4 フロントエンド実装

**F-1: バケットダッシュボード**
- Money.tsx の上部 PLサマリ下に追加
- 6バケット（未割当 / 要確認 / verified待ち / posted / asset候補 / advance滞留）
- タップで該当タブを開く
- 工数: 1〜2日

**F-2: 詳細ビュー**
- 既存 TransactionDetailModal を拡張、または新規 ExpenseDetailModal
- 編集履歴セクション、AI推定理由、フラグ表示、verifyボタン
- 工数: 2〜3日

**F-3: 起票時のJob候補チップス**
- ExpenseModal に scope ピッカー（4値）
- 候補ランキング表示（時刻/場所/予定/直近着工）
- 工数: 2日

**F-4: Money.tsxのT番号入力 → 送信ペイロードへ追加**
- T-FIX-1 のフロント側、apiクライアント `createExpense()` に `invoice_number` 追加
- 工数: 30分

### 2.5 工数サマリ

| 区分 | 工数目安 |
|---|---|
| バグ修正 (T-FIX-1) | 1時間 |
| DBマイグレーション (M-1〜M-5) | 半日 |
| サーバー実装 (S-1〜S-5) | 3〜4日 |
| フロント実装 (F-1〜F-4) | 5〜7日 |
| **Phase 1 合計** | **9〜12日** |

---

## 3. 推奨着手順（依存関係順）

```
[1] T-FIX-1: invoice_number漏れ修正 (バグ即潰し)
    │
[2] M-1〜M-5: DBマイグレーション一式
    │
[3] S-1: scope 4値ロジック (DBに依存)
    │
[4] S-3: field_change_log 書き込み (DBに依存)
    │
[5] S-4: 異常検知ルール (flags列に依存)
    │
[6] S-2: 閾値ポリシー移設 (S-4と並行可)
    │
[7] S-5: バケット集計エンドポイント
    │
[8] F-1: バケットダッシュボード
    │
[9] F-2: 詳細ビュー (履歴含む)
    │
[10] F-3: Job候補チップス
    │
[11] F-4: T番号送信修正 (T-FIX-1のフロント側)
```

並列可能ペア: (S-2, S-4), (F-1, F-2 一部)

---

## 4. リスクと注意

### 4.1 後方互換性
- `expense_scope` 既存値 `job/overhead` はそのまま有効
- 既存データの flags は空配列で初期化
- field_change_log は新規発生分のみ記録（過去はマイグレートしない）

### 4.2 RLS / セキュリティ
- `expense_field_change_log` は append-only RLS必須
- T番号は機密ではないが、組織境界のRLSは必須
- canonical_expense_posting RPC との整合確認

### 4.3 既存「risk_level / requiresReview」概念との衝突
- 現状: `risk_level: HIGH` だと `requiresReview` で別フローへ分岐（Proposal経由）
- 新仕様: `review_status: captured/classified/verified/posted/closed`
- → 移行戦略: risk_level は flags[] の一部として扱い（`risk:high`）、review_status は別ライフサイクルとして並走させる
- 既存の `requiresReview === true → Proposal生成` ロジックはそのまま温存（影響なし）

### 4.4 ApprovalCard とのつながり
- 既存 ApprovalCard は `pending` Proposal を表示
- 新バケット「verified待ち」とは概念が違う（Proposal の承認とは別軸）
- → 別UIで並べる。ApprovalCard は残す

---

## 5. オープン論点（Phase 1着手前に詰めるべき）

1. **review_status の値定義**: 既存DB列を使うのか、新列を切るのか
2. **field_change_log の粒度**: 全フィールドか、重要フィールドのみか
3. **flags[] のenum**: 文字列配列か専用列セットか
4. **canonical_expense_posting RPC への scope/flags 引き渡し方法**: RPC引数追加 vs metadata_json経由
5. **Phase 1 で「verified」遷移を入れるか**: 既存「未起票→起票」の即時postedフローと並走するか、置換するか

これらは実装着手前に1ファイル「`docs/MONEY_EXPENSE_FLOW_PHASE1_DECISIONS.md`」に決定事項を残す予定。

---

## 6. まとめ — 良いニュースと悪いニュース

**良いニュース:**
- 設計の8割は既にコードに存在する（Proposal、Policy、Ledger、立替精算、OCR、重複検知）
- Phase 1の新規実装は主に **可視化UI** と **field_change_log + flags** の追加
- 9〜12日で番頭レス可視性のMVPに到達できる見込み

**悪いニュース:**
- **T番号がバックエンドで捨てられているバグ**は即修正すべき（インボイス制度対応に直結）
- 閾値ハードコードが残っている（Policy化は必須）
- field_change_log と バケットUI は新規実装、Phase 1の主要工数

→ **次は γ（UIモック）に進み、F-1/F-2/F-3 のビジュアル仕様を固めて実装スコープを確定する。**
