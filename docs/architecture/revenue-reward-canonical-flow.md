# Revenue / Reward Canonical Flow Spec

## Status

Design freeze candidate

## Goal

現場完了から売上計上、月締め、報酬計算、payout 計上までの正系を 1 本に固定する。

この文書は次の作業の正本とする。

- DB DDL / migration
- route / service 再編
- legacy write path の停止
- correction / reversal 実装

Companion:

- `docs/architecture/revenue-reward-ddl-migration-plan.md` - migration breakdown / DDL draft / route-service diff

## Scope

対象:

- `site complete` の fact 記録
- `income.create` / `income.reverse`
- `month close` 固定
- `reward.calculate` / `reward.adjust`
- payout posting

対象外:

- UI の詳細導線
- 既存 legacy read model の表示改善
- admin month reopen 運用の詳細権限設計

## Canonical Chain

```text
site completion fact
-> income.create proposal
-> income posted
-> month close fixed
-> reward.calculate proposal (path_v22 only)
-> reward run fixed
-> payout posted
```

## 0. System Invariants

### Invariants

- I1. executable な `reward.calculate` は `path_v22` only
- I2. 金額影響は `Proposal execution -> posting service` 経由のみ
- I3. `reward.calculate` の入力主キーは `month_close_id`
- I4. closed month は通常フローで mutate しない
- I5. business lineage の primary anchor は `revenue_basis_id`

### Rules

- R1. `site complete -> auto income proposal` は同一 DB transaction / RPC で原子的に行う
- R2. 会計事実の first-class root は `posting_group_id` とする

### Checkable Conditions

- C1. `reward.calculate` execute は `calculation_system = 'path_v22'` 以外 reject
- C2. `reward.calculate` execute は `month_close.status = 'fixed'` 以外 reject
- C3. `accounting_journal_line` は必ず `journal_entry -> posting_group -> proposal_execution` に辿れる
- C4. fixed な `month_close` / `month_close_line` / `reward_run` / journal は update しない
- C5. `reward_run_line` は必ず `revenue_basis_id` を持つ

## 1. Aggregate Roots

4 本の root を混ぜない。

- business root = `revenue_basis_id`
- period root = `month_close_id`
- accounting root = `posting_group_id`
- governance root = `proposal_execution_id`

## 2. Relationship Model

```text
sites
  1 -> * site_completion_events

site_completion_events
  1 -> * revenue_basis

revenue_basis
  1 -> * proposals
  1 -> * month_close_lines
  1 -> * reward_run_lines

proposals
  1 -> * proposal_executions

proposal_executions
  1 -> * posting_groups
  1 -> 0..1 reward_runs

posting_groups
  1 -> * accounting_journal_entries

accounting_journal_entries
  1 -> * accounting_journal_lines

month_closes
  1 -> * month_close_lines

month_close_lines
  1 -> * month_close_line_sources
  1 -> * reward_run_lines

reward_runs
  1 -> * reward_run_lines
  1 -> 0..1 posting_groups
```

`payout_posting_groups` は物理テーブルを分けず、`posting_groups.group_type` で表現する。

## 3. Core Tables

### 3.1 `site_completion_events`

完了 / 取消の immutable fact。

Required columns:

- `id`
- `site_id`
- `sequence_no`
- `event_type` = `recorded | reversed`
- `effective_completed_at`
- `reversed_event_id` nullable
- `actor_user_id`
- `idempotency_key`
- `created_at`

Constraints:

- `unique(site_id, sequence_no)`
- `unique(idempotency_key)`
- `event_type = 'reversed'` のとき `reversed_event_id is not null`

Notes:

- `completed_at` を revision 代わりに使わない
- revision の根は `event_id / sequence_no`

### 3.2 `revenue_basis`

business lineage の primary anchor。売上の発生根拠。

Required columns:

- `id`
- `site_id`
- `origin_completion_event_id`
- `status` = `active | reversed | superseded`
- `recognition_date`
- `currency`
- `metadata_json`
- `reversed_by_event_id` nullable
- `created_at`

Notes:

- v1 は `site completion 1 件 = revenue_basis 1 件` でよい
- 将来 split を許すため、意味論は 1:N に耐える形で置く

### 3.3 `proposals`

意図のレイヤー。

Required columns:

- `id`
- `proposal_type` = `income.create | income.reverse | reward.calculate | reward.adjust`
- `status` = `draft | approved | executed | rejected | canceled | superseded`
- `revenue_basis_id` nullable
- `month_close_id` nullable
- `adjusts_reward_run_id` nullable
- `reward_rule_version_id` nullable
- `calculation_system` nullable
- `payload_json`
- `supersedes_proposal_id` nullable
- `idempotency_key`
- `created_by`
- `approved_by` nullable
- `created_at`
- `approved_at` nullable

Type-specific constraints:

- `income.create` -> `revenue_basis_id required`, `month_close_id null`
- `income.reverse` -> `revenue_basis_id required`, `month_close_id null`
- `reward.calculate` -> `month_close_id required`, `calculation_system = 'path_v22' required`
- `reward.adjust` -> `month_close_id required`, `revenue_basis_id required`, `adjusts_reward_run_id nullable`

Notes:

- `reward.adjust` は base reward run を必須にしない
- close fixed 後の gap は `month_close_id + revenue_basis_id` anchor で吸収する

### 3.4 `proposal_executions`

governance の実行記録。

Required columns:

- `id`
- `proposal_id`
- `status` = `running | succeeded | failed`
- `attempt_no`
- `started_at`
- `finished_at` nullable
- `error_code` nullable
- `error_message` nullable
- `result_json`

Constraints:

- `unique(proposal_id, attempt_no)`
- `status = 'succeeded'` は proposal ごとに高々 1 件

Notes:

- proposal state と execution history は分ける
- retry は同じ row を update せず、新しい execution row を作る

### 3.5 `posting_groups`

会計事実の root。

Required columns:

- `id`
- `group_type` = `income_post | income_reverse | payout_post | payout_reverse`
- `proposal_execution_id`
- `revenue_basis_id` nullable
- `reward_run_id` nullable
- `reverses_posting_group_id` nullable
- `accounting_date`
- `posted_at`
- `currency`
- `description`

Constraints:

- `proposal_execution_id not null`
- `income_*` は `revenue_basis_id required`
- `payout_*` は `reward_run_id required`

Notes:

- trace は必ず `journal_line -> journal_entry -> posting_group -> proposal_execution`

### 3.6 `accounting_journal_entries`

Required columns:

- `id`
- `posting_group_id`
- `entry_no`
- `accounting_date`
- `description`
- `created_at`

### 3.7 `accounting_journal_lines`

Required columns:

- `id`
- `journal_entry_id`
- `line_no`
- `account_code`
- `debit_amount`
- `credit_amount`
- `site_id` nullable
- `revenue_basis_id` nullable
- `counterparty_id` nullable

Notes:

- `accounting_transactions` を残すなら write target ではなく projection / compatibility view として扱う

### 3.8 `month_closes`

期間統制の root。

Required columns:

- `id`
- `period_ym`
- `status` = `draft | fixed | superseded`
- `source_cutoff_at`
- `fixed_at` nullable
- `fixed_by` nullable
- `supersedes_month_close_id` nullable
- `close_rule_version_id`
- `created_at`

Rules:

- 識別は `month_close_id`
- `period_ym` は検索 / 表示用
- reopen は同一 row mutate ではなく `fixed -> superseded + new close`

### 3.9 `month_close_lines`

reward 計算の正本入力。

Required columns:

- `id`
- `month_close_id`
- `revenue_basis_id`
- `site_id`
- `recognized_at`
- `sales_amount`
- `cost_amount`
- `profit_amount`
- `dimensions_json`
- `dimension_hash`
- `source_income_posting_group_id`
- `source_site_completion_event_id`

Constraints:

- `unique(month_close_id, revenue_basis_id, dimension_hash)`

Notes:

- `month_close_lines` はルール非依存の入力正本
- `reward_rule_version_id` は `reward_runs` 側で固定する

### 3.10 `month_close_line_sources`

fan-in lineage 用の正規化テーブル。

Required columns:

- `id`
- `month_close_line_id`
- `source_type` = `posting_group | proposal_execution | site_completion_event | revenue_basis`
- `source_id`
- `contribution_sales`
- `contribution_cost`

Constraints:

- `unique(month_close_line_id, source_type, source_id)`

Notes:

- source ids を JSON 配列だけに埋めない
- fan-in は別 table で正規化する

### 3.11 `reward_runs`

報酬確定の immutable 出力。

Required columns:

- `id`
- `run_kind` = `calculation | adjustment`
- `month_close_id`
- `proposal_execution_id`
- `reward_rule_version_id`
- `calculation_system` = `path_v22`
- `adjusts_reward_run_id` nullable
- `status` = `fixed | superseded`
- `fixed_at`
- `payout_posting_group_id` nullable

Constraints:

- `run_kind = 'calculation'` の current fixed は `month_close_id + reward_rule_version_id` で高々 1 件
- `run_kind = 'adjustment'` は複数可

### 3.12 `reward_run_lines`

Required columns:

- `id`
- `reward_run_id`
- `month_close_line_id` nullable
- `revenue_basis_id`
- `recipient_id`
- `base_amount`
- `delta_amount`
- `payout_amount`
- `formula_snapshot_json`

Notes:

- `calculation` では通常 `month_close_line_id not null`
- `adjustment` では line 直結できない場合があるため nullable を許す
- `revenue_basis_id` は常に required

## 4. State Machines

### 4.1 Site operational state

```text
open
  -> completed                // site.completion.recorded
completed
  -> completion_reversed      // site.completion.reversed
completion_reversed
  -> completed                // new recorded event
```

`sites` row は current state のみを持ち、履歴の正本は `site_completion_events` に置く。

### 4.2 Proposal state

```text
draft
  -> approved
  -> rejected
  -> canceled

approved
  -> executed
  -> canceled
  -> superseded
```

Notes:

- system auto-generated proposal は `draft` を飛ばして `approved` で作成してよい
- `executed` 後は proposal を mutate しない
- 訂正は新しい proposal で表現する

### 4.3 Proposal execution state

```text
running
  -> succeeded
  -> failed
```

Retry は新しい `proposal_execution` row で表現する。

### 4.4 Posting group state

```text
(non-existent)
  -> posted
```

取消時は元 group を update せず、新しい reversal group を作る。

### 4.5 Month close state

```text
draft
  -> fixed
fixed
  -> superseded
```

通常フローでは fixed 後の line update はない。reopen は admin 例外。

### 4.6 Reward run state

```text
(calculation or adjustment)
  -> fixed
fixed
  -> superseded
```

通常訂正では既存 run を更新せず、`reward.adjust` で adjustment run を追加する。

## 5. Correction Truth Table

| ケース | 許可 | 原月 mutate | システム出力 |
| --- | --- | --- | --- |
| 完了取消 / income 未実行 | Yes | No | `site.completion.reversed` を記録。未実行の `income.create` は `canceled` または `superseded`。仕訳なし |
| 完了取消 / income 計上済み・month close 未fixed | Yes | No | `site.completion.reversed`。`income.reverse` proposal を auto-create。execute 時に reversing posting_group を current open period に作成 |
| 完了取消 / month close fixed・reward run 未fixed | Yes | No | `site.completion.reversed`。`income.reverse` は次の open period に計上。さらに `reward.adjust(month_close_id, revenue_basis_id)` を auto-create |
| 完了取消 / reward run fixed・payout 未posted | Yes | No | 上と同じ。base run はそのまま、`reward.adjust` で差分 run を追加。payout は base と adjustment を別 posting として処理可 |
| 完了取消 / payout posted 済み | Yes | No | 上と同じに加えて、adjustment run に対する `payout_post` または `payout_reverse` を次の open period に作成。元 payout group は更新しない |
| 売上金額訂正 / month close 未fixed | Yes | No | 未計上なら `income.create` を supersede。計上済みなら `income.reverse(old) + income.create(new)`。`income.update` は使わない |
| 売上金額訂正 / month close fixed 後 | Yes | No | `income.reverse(old) + income.create(new)` を次の open period に作成し、元月の `month_close_id` に対して `reward.adjust` を作成 |
| 報酬ルール / 配分ミス / reward run fixed 後 | Yes | No | `reward.adjust` のみ。income 側は触らない。payout 済みなら adjustment に対して差額 posting を追加 |

Correction rules:

- operational fact correction -> `site_completion_event`
- financial amount correction -> `income.reverse + superseding income.create`
- reward correction -> `reward.adjust`

## 6. Atomic Command Specs

### 6.1 `complete_site_rpc(...)`

Route から逐次に呼ばず、DB transaction / RPC 一発で実行する。

```text
BEGIN

1. SELECT site FOR UPDATE
2. site status を completed に更新
3. site_completion_events(recorded) を insert
4. revenue_basis を insert
5. income.create proposal を upsert
   - proposal_type    = 'income.create'
   - revenue_basis_id = <new revenue_basis_id>
   - idempotency_key  = 'income:auto:site_completion_event:<event_id>'
   - status           = 'approved' or 'draft' (policy 次第)

COMMIT
```

Return values:

- `site_completion_event_id`
- `revenue_basis_id`
- `income_proposal_id`

### 6.2 `reverse_site_completion_rpc(...)`

```text
BEGIN

1. SELECT site / original completion event / revenue_basis FOR UPDATE
2. site status を completion_reversed に更新
3. site_completion_events(reversed) を insert
4. revenue_basis.status = 'reversed'
5. downstream stage を判定
   - income 未実行   -> pending income.create を cancel / supersede
   - income 計上済み -> income.reverse proposal を upsert
6. month_close fixed 済みなら
   reward.adjust proposal(month_close_id, revenue_basis_id) を upsert

COMMIT
```

Idempotency は event id ベースに統一する。

## 7. Idempotency Keys

- `income:auto:site_completion_event:<event_id>`
- `income:reverse:site_completion_reversal:<event_id>`
- `reward:calc:path_v22:close:<month_close_id>:rule:<reward_rule_version_id>`
- `payout:post:reward_run:<reward_run_id>`

Timestamp ベースの key は使わない。

## 8. Hard Guards

### `reward.calculate` execute

- `calculation_system != 'path_v22'` -> reject
- `month_close_id is null` -> reject
- `month_close.status != 'fixed'` -> reject

### Legacy reward write route

- create / execute -> reject
- preview / read -> allow

### Accounting write

- UI / route から journal direct insert -> reject
- posting service 経由のみ allow

HTTP status は legacy write に対して `410 Gone` または `409 Read-only` を返す。

## 9. DDL / Constraint Draft

必須制約の最小セット:

- `unique(idempotency_key)` on `proposals`
- `unique(site_id, sequence_no)` on `site_completion_events`
- `unique(proposal_id, attempt_no)` on `proposal_executions`
- `unique(month_close_id, revenue_basis_id, dimension_hash)` on `month_close_lines`
- partial unique on `reward_runs(month_close_id, reward_rule_version_id)` where `run_kind = 'calculation'` and `status = 'fixed'`

Derived guard examples:

- `reward.calculate` payload には `month_close_id`, `reward_rule_version_id`, `calculation_system = 'path_v22'` を必須化
- `reward.adjust` payload には `month_close_id`, `revenue_basis_id` を必須化

## 10. Service Boundaries

### RPC / Command layer

- `complete_site_rpc`
- `reverse_site_completion_rpc`
- future: `fix_month_close_rpc`

責務:

- aggregate root の lock
- fact row 作成
- idempotent proposal upsert
- current state row 更新

### Proposal execution layer

- `ProposalService`
- `posting service`
- `reward run sync service`

責務:

- proposal approval / execution
- `proposal_executions` 作成
- posting group 作成
- immutable projection sync

### Read model layer

- `month_close_summaries`
- legacy compatibility views
- PATH UI summary endpoints

責務:

- UI / reporting 最適化
- canonical write model を直接 mutate しない

## 11. Migration Order

1. legacy reward write を停止し、`reward.calculate` の executable meaning を `path_v22` に固定
2. `site_completion_events` と `revenue_basis` を追加
3. `complete_site_rpc` / `reverse_site_completion_rpc` を追加
4. `proposal_executions` と `posting_groups` を導入し、会計書き込みを posting service に集約
5. `month_closes` / `month_close_lines` / `month_close_line_sources` を導入
6. `reward.calculate` に `month_close_id` / `reward_rule_version_id` を必須化
7. closed-period correction を `income.reverse` / `reward.adjust` に統一

## 12. Implementation Notes

- `reward.adjust` を `month_close_id + revenue_basis_id` anchor にしたことで、close fixed 後の base run 不在 gap を壊さず表現できる
- `revenue_basis` は v1 では 1:1 で始めてよいが、意味論としては 1:N に耐える形で設計する
- `site.complete` proposal type は定義済みでも、現段階では正系に無理に入れない
- priority は `completion = fact`, `money impact = proposal`

## 13. Open Decisions

この文書で freeze しきれていない項目のみ列挙する。

- `income.create` auto-generated proposal を `approved` で作るか `draft` で作るか
- next open period の accounting date 算定ルール
- admin-only month reopen の権限境界
- legacy endpoint を `410` と `409` のどちらで閉じるか
