# 2026-03-18 適格請求書機能 実装仕様

## 目的

適格請求書まわりの要件を、2026年3月18日時点で確認できる国税庁の一次情報に合わせて、GENBA QUEST の実装仕様へ落とす。

この文書は次を定義する。

- 法的に外せない要件
- 現行実装との差分
- DB / API / UI / PDF の具体仕様
- 最短の実装順序

## 一次情報の確認結果

以下は国税庁の一次情報で確認した。

| Source | Confirmed point | System rule |
| --- | --- | --- |
| [No.6498 適格請求書等保存方式（インボイス制度）](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6498.htm) | 適格請求書等は税務署長の登録を受けた適格請求書発行事業者のみ交付可能 | `unregistered` / `applied` は適格請求書を確定発行しない |
| [No.6625 適格請求書等の記載事項](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6625.htm) | 登録番号を含む法定記載事項が必要 | `qualified_invoice` では法定記載事項を必須化する |
| [Q&A 問5（登録の効力）](https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/pdf/qa/05.pdf) | 登録の効力は通知日ではなく登録日から生じ、登録日以降の取引について適格請求書交付義務がある | `registered_at <= source_transaction_date` のときのみ `qualified_invoice` を許可する |
| [Q&A 問36（登録日から通知を受けるまでの間の取扱い）](https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/pdf/qa/36.pdf) | 通知前に不足事項を欠いた請求書を出した場合、後日不足事項を通知し、元書類との対応関係が明確なら合算で要件充足可 | `invoice_supplement` を設け、元請求書との明示的な関連付けを必須にする |
| [登録番号とは](https://www.invoice-kohyo.nta.go.jp/about-toroku/) | 登録番号は `T + 13桁数字` | 保存時に `^T\\d{13}$` を必須チェックする |

注記:

- 一次情報を確認した範囲では、通知前の追完ルールの参照先は `基通1-7-3` だった。`1-7-5` ではなかった。
- `standard_invoice` に「適格請求書ではありません」と明示すること自体は法定必須ではないが、誤認防止のプロダクト要件として採用する。

## 現行実装との差分

現行コードでは、請求書機能はまだ適格請求書制度に対応していない。

- [`server/sql/003_accounting_tables.sql`](/Users/yutoyoshino/Documents/genba-quest/server/sql/003_accounting_tables.sql) の `accounting_invoices` は `invoice_no / issue_date / due_date / billing_name / issuer_registration_no / notes / pdf_storage_path` のみ
- [`server/src/routes/accounting.ts`](/Users/yutoyoshino/Documents/genba-quest/server/src/routes/accounting.ts) の `POST /api/v1/accounting/invoices` は発行者状態や登録日を見ずに採番・保存する
- [`frontend/src/components/InvoiceModal.tsx`](/Users/yutoyoshino/Documents/genba-quest/frontend/src/components/InvoiceModal.tsx) は売上選択と請求先入力のみで、帳票種別も発行可否理由も出していない
- 発行者設定テーブル、帳票スナップショット、追完通知、PDF種別分岐が未実装

## 法的必須とプロダクト判断

### 法的必須

- `qualified_invoice` は登録事業者のみ発行可能
- `qualified_invoice` は登録日以後の取引に限る
- `qualified_invoice` には登録番号を含む法定記載事項が必要
- 通知前に通常請求書を交付した場合、後日不足事項を補完する書面等で追完できる
- 追完書面は元請求書との対応関係が明確である必要がある

### プロダクト判断

- 発行者状態は `unregistered | applied | registered` の 3 状態で管理する
- `applied` 中は `qualified_invoice` を発行させず、`standard_invoice` のみ許可する
- `registered` でも `source_transaction_date < qualified_invoice_registered_at` なら `qualified_invoice` を禁止し、必要なら `standard_invoice` を発行する
- `standard_invoice` と `invoice_supplement` を明示的に別帳票として保存する
- すべての帳票に発行時スナップショットを持たせ、後日の設定変更で過去帳票が変わらないようにする

## DB 仕様

### 1. 新規テーブル `org_invoice_settings`

1組織につき1レコードを持つ。

```sql
create table public.org_invoice_settings (
  org_id uuid primary key,
  issuer_name text not null,
  issuer_address text,
  issuer_contact text,
  bank_account_text text,
  invoice_issuer_status text not null
    check (invoice_issuer_status in ('unregistered', 'applied', 'registered')),
  qualified_invoice_registration_number text,
  qualified_invoice_registered_at date,
  invoice_notes_default text,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_invoice_settings_registered_check check (
    (
      invoice_issuer_status = 'registered'
      and qualified_invoice_registration_number ~ '^T[0-9]{13}$'
      and qualified_invoice_registered_at is not null
    )
    or
    (
      invoice_issuer_status in ('unregistered', 'applied')
      and qualified_invoice_registration_number is null
      and qualified_invoice_registered_at is null
    )
  )
);
```

実装メモ:

- `org_id` は [`authMiddleware.ts`](/Users/yutoyoshino/Documents/genba-quest/server/src/middleware/authMiddleware.ts) の `req.orgId` を使う
- 現行経理RLSと同様に、まずは authenticated 全員 read / 管理者相当のみ update の単純ポリシーでよい

### 2. `accounting_invoices` の拡張

既存テーブルを以下に寄せる。

```sql
alter table public.accounting_invoices
  add column if not exists org_id uuid,
  add column if not exists document_type text,
  add column if not exists source_transaction_date date,
  add column if not exists source_transaction_id uuid references public.accounting_transactions(id),
  add column if not exists issuer_snapshot jsonb,
  add column if not exists registration_number_snapshot text,
  add column if not exists registered_at_snapshot date,
  add column if not exists tax_summary_snapshot jsonb,
  add column if not exists eligibility_snapshot jsonb,
  add column if not exists supplements_invoice_id uuid references public.accounting_invoices(id),
  add column if not exists supplemented_at timestamptz,
  add column if not exists pdf_render_status text,
  add column if not exists pdf_generated_at timestamptz;
```

推奨の制約:

- `document_type in ('standard_invoice', 'qualified_invoice', 'invoice_supplement')`
- `source_transaction_id is not null`
- `source_transaction_date is not null`
- `issuer_snapshot is not null`
- `pdf_render_status in ('pending', 'generated', 'failed', 'locked')`
- `invoice_supplement` のとき `supplements_invoice_id is not null`
- `qualified_invoice` のとき `registration_number_snapshot ~ '^T[0-9]{13}$'`

推奨のユニーク制約:

```sql
create unique index accounting_invoices_primary_doc_unique
  on public.accounting_invoices (source_transaction_id)
  where document_type in ('standard_invoice', 'qualified_invoice');

create unique index accounting_invoices_active_supplement_unique
  on public.accounting_invoices (supplements_invoice_id)
  where document_type = 'invoice_supplement';
```

移行方針:

1. `source_transaction_id` を追加し、既存 `transaction_id` を backfill
2. 既存 `transaction_id unique` 依存を `source_transaction_id` の部分ユニークへ置き換える
3. 既存 `issuer_registration_no` は `registration_number_snapshot` に寄せて将来的に廃止する

### 3. スナップショット JSON 形

`issuer_snapshot`:

```json
{
  "issuer_name": "GENBA QUEST株式会社",
  "issuer_address": "東京都...",
  "issuer_contact": "03-xxxx-xxxx",
  "bank_account_text": "○○銀行...",
  "invoice_notes_default": "..."
}
```

`tax_summary_snapshot`:

```json
{
  "by_rate": [
    { "tax_rate": 0.1, "net_amount": 100000, "tax_amount": 10000, "gross_amount": 110000 }
  ],
  "currency": "JPY"
}
```

`eligibility_snapshot`:

```json
{
  "eligible_for_qualified_invoice": false,
  "resolved_document_type": "standard_invoice",
  "reason_codes": ["ISSUER_NOT_REGISTERED"],
  "evaluated_at": "2026-03-18T12:00:00.000Z"
}
```

## API 仕様

### 1. 発行者設定 API

#### `GET /api/v1/accounting/invoice-settings`

- 組織の現行設定を返す
- 未作成ならデフォルト値を返す

#### `PUT /api/v1/accounting/invoice-settings`

保存対象:

- `issuer_name`
- `issuer_address`
- `issuer_contact`
- `bank_account_text`
- `invoice_issuer_status`
- `qualified_invoice_registration_number`
- `qualified_invoice_registered_at`
- `invoice_notes_default`

保存時バリデーション:

- `registered` のとき `qualified_invoice_registration_number` 必須
- `registered` のとき `qualified_invoice_registered_at` 必須
- 登録番号は `^T\\d{13}$`

### 2. 適格判定 API

#### `GET /api/v1/accounting/invoice-eligibility/:transactionId`

返却例:

```json
{
  "transaction_id": "uuid",
  "source_transaction_date": "2026-03-01",
  "issuer_status": "applied",
  "resolved_document_type": "standard_invoice",
  "eligible_for_qualified_invoice": false,
  "reason_codes": ["ISSUER_NOT_REGISTERED"],
  "reason_messages": ["登録事業者ではないため適格請求書を発行できません"]
}
```

理由コード:

- `ISSUER_NOT_REGISTERED`
- `REGISTRATION_NUMBER_MISSING`
- `REGISTERED_AT_MISSING`
- `TRANSACTION_BEFORE_REGISTRATION_DATE`
- `TAX_BREAKDOWN_MISSING`
- `INVOICE_ALREADY_EXISTS`
- `QUALIFIED_INVOICE_ALREADY_EXISTS`
- `SUPPLEMENT_ALREADY_EXISTS`

### 3. 請求書発行 API

#### `POST /api/v1/accounting/invoices`

Request:

```json
{
  "transaction_id": "uuid",
  "issue_date": "2026-03-18",
  "due_date": "2026-04-30",
  "billing_name": "株式会社○○",
  "billing_address": "東京都...",
  "notes": "振込お願いします",
  "requested_document_type": "auto"
}
```

`requested_document_type`:

- `auto`
- `standard_invoice`
- `qualified_invoice`

サーバー処理:

1. 取引、設定、既存請求書を取得
2. 税率別集計を作成
3. 適格判定を行う
4. `requested_document_type = auto` なら自動分岐
5. スナップショットを保存
6. `accounting_transactions.kind = 'invoice'` 更新
7. PDF生成ジョブを作るか、同期生成する

エラー:

- `qualified_invoice` を明示要求したのに不適格なら `422`
- 既存 primary invoice があるなら `409`

Response:

```json
{
  "id": "uuid",
  "invoice_no": "INV-2026-0001",
  "document_type": "standard_invoice",
  "pdf_render_status": "pending",
  "eligibility": {
    "eligible_for_qualified_invoice": false,
    "reason_codes": ["ISSUER_NOT_REGISTERED"]
  }
}
```

### 4. 追完通知 API

#### `POST /api/v1/accounting/invoices/:id/supplement`

用途:

- `applied` 時点で出した `standard_invoice` に対し、登録後に登録番号等を追完する

前提:

- 元帳票の `document_type = 'standard_invoice'`
- 現在の設定が `registered`
- `qualified_invoice_registered_at <= source_transaction_date`
- 既存 supplement が未発行

保存内容:

- `document_type = 'invoice_supplement'`
- `supplements_invoice_id = :id`
- `source_transaction_id` は元請求書と同じ
- `registration_number_snapshot`
- `registered_at_snapshot`
- `supplemented_at = now()`

UI 上は、元請求書と追完通知をセットで返す。

### 5. 参照 / ダウンロード API

- `GET /api/v1/accounting/invoices/:id`
- `GET /api/v1/accounting/invoices/:id/pdf`
- `GET /api/v1/accounting/invoices/:id/related`

`related` は元請求書と supplement の相互リンク表示用。

## UI 仕様

### 1. メニュー / 設定画面

新規画面:

- `請求書発行設定`

入力項目:

- 発行者名
- 発行者住所
- 連絡先
- 振込先
- 事業者状態 `unregistered | applied | registered`
- 登録番号
- 登録日
- デフォルト備考

UIルール:

- `registered` のときだけ登録番号と登録日を必須表示
- 入力下に帳票プレビューを表示
- `registered` 以外では登録番号欄を disabled にする

### 2. 請求書作成モーダル

[`InvoiceModal.tsx`](/Users/yutoyoshino/Documents/genba-quest/frontend/src/components/InvoiceModal.tsx) に追加する。

- 現在の発行者状態バッジ
- 生成予定帳票種別
- 適格可否
- 不可理由一覧
- 適格請求書プレビュー / 通常請求書プレビュー切替

表示ルール:

- `unregistered` / `applied`: `standard_invoice`
- `registered` かつ適格要件充足: `qualified_invoice`
- `registered` だが取引日が登録日前: `standard_invoice`

文言ルール:

- `standard_invoice`: 見出しは `請求書`
- `qualified_invoice`: 見出しは `適格請求書`
- `applied`: `登録申請中のため、本書は適格請求書ではありません`

### 3. 請求書詳細画面

最低限追加したい要素:

- 帳票種別
- 発行時スナップショット
- 登録番号
- 元請求書 / 追完通知リンク
- PDF生成状態

## PDF / 出力仕様

### 帳票種別

- `standard_invoice`
  - 見出し: `請求書`
  - 登録番号は表示しない
  - `applied` / `unregistered` に応じた注記を表示
- `qualified_invoice`
  - 見出し: `適格請求書`
  - No.6625 の記載事項を満たす
- `invoice_supplement`
  - 見出し: `登録番号等の追完通知`
  - 元請求書番号、元請求書発行日、対象取引日、登録番号、登録日を表示

### 生成ルール

- PDF生成時は設定ではなく snapshot を使う
- `pdf_storage_path` が存在する場合でも、snapshot が変わる再生成は不可
- 再生成は同一 snapshot からのみ許可する

## バリデーション仕様

### 設定保存時

- `registered` のとき登録番号必須
- `registered` のとき登録日必須
- 登録番号形式は `T + 13桁`

### 請求書発行時

- `qualified_invoice` は `registered` のみ
- `source_transaction_date < qualified_invoice_registered_at` なら `qualified_invoice` 不可
- `tax_summary_snapshot.by_rate` が空なら `qualified_invoice` 不可
- primary invoice が既にあるなら重複発行不可
- `qualified_invoice` が既にあるなら supplement ではなく重複扱い

### 追完通知発行時

- 元請求書が `standard_invoice` であること
- 現在は `registered` であること
- 登録日が対象取引日以前であること
- 既存 supplement がないこと

## 実装順序

### P0

1. `org_invoice_settings` migration 作成
2. `accounting_invoices` 拡張 migration 作成
3. `invoice-settings` API 実装
4. `invoice-eligibility` ロジック実装
5. `POST /accounting/invoices` を `standard / qualified` 自動分岐に改修
6. `InvoiceModal` に発行者状態と帳票種別表示を追加

### P1

1. `invoice_supplement` API 実装
2. 請求書詳細 / 関連帳票 UI 実装
3. PDF種別テンプレート実装
4. ダウンロード / 再生成制御実装

### P2

1. Proposal化の再検討
2. 監査ログビューアへの組み込み
3. インボイス制度の帳票テンプレート改善

## 推奨の実装タスク分解

### Task 1: DB migration

- `server/sql/026_org_invoice_settings.sql`
- `server/sql/027_accounting_invoice_document_types.sql`

### Task 2: server types / service

- `server/src/routes/accounting.ts`
- 新規 `server/src/services/InvoiceEligibilityService.ts`

### Task 3: frontend types / API client

- `frontend/src/lib/api.ts`

### Task 4: settings UI

- 新規 `frontend/src/pages/InvoiceSettings.tsx`
- ルーティング追加

### Task 5: invoice creation UI

- `frontend/src/components/InvoiceModal.tsx`

### Task 6: PDF renderer

- 新規 `server/src/services/InvoicePdfService.ts`

### Task 7: tests

- `server/src/__tests__/unit/accountingRoute.test.ts`
- 新規 `server/src/__tests__/unit/InvoiceEligibilityService.test.ts`
- 必要なら integration test を追加

## 非スコープ

今回の最短対応では含めない。

- 電子帳簿保存法の保存要件全体
- 複数組織 / 複数ブランド発行者の高度切替
- 適格簡易請求書の専用分岐
- 国税庁公表サイトへの自動照会

## 判断メモ

- 法令上の必須は `qualified_invoice` の発行条件と記載事項、および通知前追完の成立条件
- `applied` では一旦 `standard_invoice` のみに寄せるのが実装と運用の両面で安全
- 追完通知を別帳票にすることで、元帳票との対応関係を DB 上で保証しやすい
- snapshot 保存は後戻り不能な会計ドキュメントとして必須
