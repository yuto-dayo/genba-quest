# ADR: Freeze Current DB Canonical Execution Model

## Status

Accepted

## Context

`docs/DESIGN_PHILOSOPHY.md` は ideal target として「全状態変更は Proposal 経由」を掲げている。一方、2026-04-17 の現DB調査では、現在の canonical execution path は二系統で動いていることが確認された。

観測された事実:

- `ledger_events.actor->>'type'` は `system` のみで、67/67 が system actor
- `expense_recorded` は 16/16 が proposal 経由
- `internal_transfer` は 35/41 が direct event
- `reward_calculated` は 4/5 が direct event
- `reward_adjusted` は 3/5 が direct event
- `proposal_executions` と `governance_events` は current canonical execution path の正系ではない

このため、「全変更が Proposal 経由」という記述を current DB truth として扱うと、設計判断を誤る。

## Decision

2026-04-17 時点の current canonical execution model は次で固定する。

- canonical execution log は `public.ledger_events`
- `ledger_events` への write actor は `system` only
- human / AI initiated change の primary entry は `public.proposals`
- internal / system / integration flow は proposal を介さず direct `ledger_events` を許容する
- `proposal_executions` と `governance_events` は current canonical path の primary anchor にしない

## Current Canonical Map

```text
Human / AI
  -> Proposal create
  -> System executor
  -> public.ledger_events

Integration / System pipeline
  -> direct emit
  -> public.ledger_events
```

補足:

- Proposal は「人間または AI の意思決定入口」の正系
- `ledger_events` は「実行結果の append-only log」の正系
- 現状の `ledger_events` は accounting-only ledger というより domain execution log として振る舞っている

## Consequences

- current production truth と ideal architecture を明示的に分離できる
- 「Proposal 必須か」を actor / flow boundary で議論できる
- `expense_recorded` は proposal-first path の基準実装として扱える
- `internal_transfer` / reward 系イベントは broad bucket のままだと境界が曖昧なため、将来的な event type 分解対象とする

## Internal Transfer Bucket Survey (2026-04-17)

`server/src/services/ProposalService.ts` の fallback path では、次の proposal type が未マッピング時に `internal_transfer` へ落ちる。

### Evidence-backed buckets

| Proposal type | Evidence | Observed payload / side effect | Candidate event type |
| --- | --- | --- | --- |
| `assignment.create` | `server/src/__tests__/integration/executeProposalAtomicAssignment.integration.test.ts` / `ProposalService.applyAssignmentCreate()` | payload は `site_id`, `worker_ids`, `description`。実行で `sites.assigned_users` と `profiles.current_site_id` を更新 | `assignment.scheduled` |
| `leave.request` | `server/src/__tests__/integration/executeProposalAtomicLeaveRequest.integration.test.ts` / `ProposalService.applyLeaveRequest()` | payload は `user_id`, `start_date`, `end_date`, `leave_type`, `reason`。実行で `personal_schedules` に approved 行を作成 | `leave.recorded` |
| `communication.review` | `server/src/routes/webhooks.ts` | integration proposal payload は `conversation_id`, `source_message_id`, `summary`, `priority`, `suggested_tasks` を持つ。`ProposalService` 側の追加 side effect は未実装 | `communication.review_recorded` |
| `communication.task` | `server/src/routes/webhooks.ts` | communication analysis から task proposal を生成。payload は `title`, `category`, `description` と message/thread 参照を持つ | `communication.task_recorded` |
| `task.revision.request` | `server/src/routes/proposals.ts` unit test | payload は `target_proposal_id`, `instruction`, `source_message_id`, `parent_proposal_id`, `target_snapshot` を持つ。追加 side effect は未実装 | `task.revision_requested` |
| `site.create` | `server/src/__tests__/unit/sherpaProposalRoute.test.ts` | 現在確認できる payload 断片は `{ name }`。`ProposalService` 側の side effect は未実装 | `site.created` |
| `assignment.update` | `docs/PHASE_C_ASSIGNMENT_SIMULATOR_ARCHITECTURE.md` + `server/src/__tests__/helpers/fixtures.ts` | payload は `assignment_id`, `user_id`, `site_id`, `date`, `previous_site_id`, `previous_date`, `reason`。既存アサイン移動の semantics が設計資料と route contract に固定された | `assignment.rescheduled` |
| `assignment.cancel` | `docs/PHASE_C_ASSIGNMENT_SIMULATOR_ARCHITECTURE.md` + `server/src/__tests__/helpers/fixtures.ts` | payload は `assignment_id`, `user_id`, `site_id`, `date`, `reason`。remove/cancel semantics が設計資料と route contract に固定された | `assignment.cancelled` |

### Payload-fixed / side-effect-thin buckets

次は型定義や設計ドキュメントには存在し、2026-04-18 時点では repo に concrete payload fixture も置かれたが、execute side effect / DB canonical event までの根拠はまだ薄い。

- `site.complete`
  revenue-reward 系 design docs では downstream の revenue basis / income.create 起点。fixture は `site_id`, `effective_completed_at` を持つが、canonical flow 側では依然 `completion = fact` を優先し proposal を正系に無理に入れていない

Inference:
- `assignment.update` / `assignment.cancel` は route contract と explicit event type 名までは固定できたが、execute side effect は未実装
- `site.complete` は completion fact / RPC path が canonical であり、proposal execute path 側で event type を増やす優先度は低い

## A-1 Boundary Lock (2026-04-18)

2026-04-18 時点で、A-1 の proposal execute boundary は次で固定する。

- `assignment.update` / `assignment.cancel` は explicit event type までは proposal execute path に含める
- ただし A-1 では追加の execute side effect は持たせない
- assignment の materialized state 更新は Phase C の simulator / read model 側で設計する
- `site.complete` は proposal execute path の canonical state change にしない
- `site.complete` の canonical completion boundary は completion fact / RPC path とする
- generic proposal routes (`/api/v1/proposals`, `/create-and-submit`, `/integration`, `/api/v1/sherpa/proposals`) では `site.complete` を受け付けず、canonical RPC を要求する

Rationale:

- Proposal は「意思決定入口」、`ledger_events` は「append-only execution log」として責務を分ける
- assignment reschedule / cancel の canonical state table が未確定な段階で副作用を先行実装すると、Phase C の read model と二重管理になる
- `site.complete` は revenue basis / income / reward downstream と強く結びつくため、generic proposal execute より専用 completion boundary の方が整合を保ちやすい

## Follow-ups

- `internal_transfer` を業務意味ごとの event type に分解する
  残対象は canonical boundary が曖昧な `site.complete` を中心に扱う
- direct system execution path に `idempotency_key` 運用を導入する
- `docs/DESIGN_PHILOSOPHY.md` は ideal target と current production model の差分を前提に読む
