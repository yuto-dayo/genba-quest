# Revenue / Reward DDL Draft And Migration Plan

## Status

Implementation companion for `docs/architecture/revenue-reward-canonical-flow.md`

## Goal

freeze 済みの canonical flow を、既存 schema / service / route にどう差し込むかを定義する。

この文書では次を固定する。

- migration file breakdown
- DDL draft
- backward-compatible rollout order
- route / service diff

## 1. Existing Schema Impact

### 1.1 `proposals`

現状:

- `type` は check constraint で固定
- `status` は `draft | pending/proposed | approved | rejected | executed` 系
- execution history は別 table を持たない

必要差分:

- `income.reverse` を追加
- `income.update` を deprecate 寄りに移行
- `status` に `canceled`, `superseded` を追加
- `revenue_basis_id`, `month_close_id`, `adjusts_reward_run_id`, `reward_rule_version_id`, `calculation_system`, `supersedes_proposal_id`, `idempotency_key` を追加

### 1.2 Accounting

現状:

- `accounting_transactions` が write target
- `accounting_journal_entries.transaction_id` が 1:1 紐付け前提
- `accounting_journal_lines` は `entry_id` 起点のみ

必要差分:

- `posting_groups` を first-class root として追加
- `accounting_journal_entries` に `posting_group_id` を追加
- `accounting_journal_lines` に `revenue_basis_id`, `site_id`, `counterparty_id` を追加
- `accounting_transactions` は projection / compatibility view 寄りに移行

### 1.3 PATH month close / reward

現状:

- `path_month_closes` は `month + member_id` 粒度
- `path_reward_runs` は `proposal_id` / `month` / `close_id` 起点
- `finance_payout_postings` は `proposal_id + member_id + posting_kind` 前提

必要差分:

- canonical `month_closes`, `month_close_lines`, `month_close_line_sources` を追加
- canonical `reward_runs`, `reward_run_lines` を追加
- `reward.calculate` は `month_close_id` 必須
- `reward.adjust` は `month_close_id + revenue_basis_id` anchor
- `path_*` は移行期間の read model / compatibility projection として残す

## 2. Proposed Migration Breakdown

次番号は `048` 以降を想定する。

### 048 `revenue_basis_foundation.sql`

追加:

- `site_completion_events`
- `revenue_basis`
- `proposals` 拡張の一部

目的:

- site completion fact と business lineage root を先に導入する

### 049 `proposal_execution_and_posting_groups.sql`

追加:

- `proposal_executions`
- `posting_groups`
- `accounting_journal_entries.posting_group_id`
- `accounting_journal_lines` 拡張

目的:

- governance root / accounting root を切り分ける

### 050 `month_close_canonical_tables.sql`

追加:

- `month_closes`
- `month_close_lines`
- `month_close_line_sources`
- summary view / materialized view の土台

目的:

- reward input の immutable snapshot を canonical 化する

### 051 `reward_run_canonical_tables.sql`

追加:

- `reward_runs`
- `reward_run_lines`
- partial unique indexes

目的:

- `reward.calculate` / `reward.adjust` の canonical output を定義する

### 052 `site_completion_rpc_and_income_autogen.sql`

追加:

- `complete_site_rpc`
- `reverse_site_completion_rpc`
- supporting SQL helpers

目的:

- `site complete -> event -> revenue_basis -> income.create` を atomic command 化する

### 053 `legacy_reward_write_freeze.sql`

変更:

- legacy reward write route が参照する guard 用 table / function / view
- compatibility trigger or view
- optional check constraint / trigger for `reward.calculate(path_v22 only)`

目的:

- write 正系を `path_v22` に固定する

### 054 `canonical_reward_guards.sql`

変更:

- `reward.calculate` execute guard
- `reward.adjust` anchor guard
- fixed month mutate guard

目的:

- application bug があっても DB 側で hard fail させる

## 3. DDL Draft

以下は migration ごとの叩き台。最終 SQL 文法は migration 実装時に調整する。

### 3.1 048 `site_completion_events`

```sql
create table if not exists public.site_completion_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  site_id uuid not null references public.sites(id) on delete cascade,
  sequence_no integer not null,
  event_type text not null check (event_type in ('recorded', 'reversed')),
  effective_completed_at timestamptz not null,
  reversed_event_id uuid references public.site_completion_events(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (site_id, sequence_no),
  unique (idempotency_key),
  constraint site_completion_events_reversal_check
    check (
      (event_type = 'recorded' and reversed_event_id is null)
      or (event_type = 'reversed' and reversed_event_id is not null)
    )
);

create index if not exists site_completion_events_org_site_idx
  on public.site_completion_events (org_id, site_id, created_at desc);
```

### 3.2 048 `revenue_basis`

```sql
create table if not exists public.revenue_basis (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  site_id uuid not null references public.sites(id) on delete restrict,
  origin_completion_event_id uuid not null references public.site_completion_events(id) on delete restrict,
  status text not null check (status in ('active', 'reversed', 'superseded')),
  recognition_date date not null,
  currency text not null default 'JPY',
  metadata_json jsonb not null default '{}'::jsonb,
  reversed_by_event_id uuid references public.site_completion_events(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists revenue_basis_org_site_idx
  on public.revenue_basis (org_id, site_id, created_at desc);

create unique index if not exists revenue_basis_origin_completion_unique
  on public.revenue_basis (origin_completion_event_id);
```

Note:

- v1 は `unique(origin_completion_event_id)` で 1:1
- split を始める段階でこの unique を外す migration を追加する

### 3.3 048 `proposals` extension

```sql
alter table public.proposals
  add column if not exists revenue_basis_id uuid references public.revenue_basis(id) on delete set null,
  add column if not exists month_close_id uuid,
  add column if not exists adjusts_reward_run_id uuid,
  add column if not exists reward_rule_version_id uuid,
  add column if not exists calculation_system text,
  add column if not exists supersedes_proposal_id uuid references public.proposals(id) on delete set null,
  add column if not exists idempotency_key text;
```

Status/type check の更新:

```sql
alter table public.proposals drop constraint if exists proposals_status_check;
alter table public.proposals add constraint proposals_status_check
  check (status in ('draft', 'pending', 'approved', 'rejected', 'executed', 'canceled', 'superseded'));

alter table public.proposals drop constraint if exists proposals_type_check;
alter table public.proposals add constraint proposals_type_check
  check (type in (
    'expense.create', 'expense.update', 'expense.void',
    'income.create', 'income.reverse',
    'invoice.create', 'invoice.send', 'invoice.mark_paid',
    'reward.calculate', 'reward.adjust',
    'skill.achieve', 'skill.revoke',
    'evaluation.submit', 'evaluation.finalize',
    'assignment.create', 'assignment.update', 'assignment.cancel',
    'leave.request',
    'communication.review', 'communication.task', 'task.revision.request',
    'site.create', 'site.complete',
    'policy.update',
    'luqo.catalog.add', 'luqo.star.achieve', 'luqo.score.update', 'luqo.reward.calculate'
  ));

create unique index if not exists proposals_idempotency_key_unique
  on public.proposals (idempotency_key)
  where idempotency_key is not null;
```

### 3.4 049 `proposal_executions`

```sql
create table if not exists public.proposal_executions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  attempt_no integer not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_code text,
  error_message text,
  result_json jsonb not null default '{}'::jsonb,
  unique (proposal_id, attempt_no)
);

create unique index if not exists proposal_executions_succeeded_once
  on public.proposal_executions (proposal_id)
  where status = 'succeeded';
```

### 3.5 049 `posting_groups`

```sql
create table if not exists public.posting_groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  group_type text not null check (group_type in (
    'income_post', 'income_reverse', 'payout_post', 'payout_reverse'
  )),
  proposal_execution_id uuid not null references public.proposal_executions(id) on delete restrict,
  revenue_basis_id uuid references public.revenue_basis(id) on delete set null,
  reward_run_id uuid,
  reverses_posting_group_id uuid references public.posting_groups(id) on delete restrict,
  accounting_date date not null,
  posted_at timestamptz not null default now(),
  currency text not null default 'JPY',
  description text not null
);

create index if not exists posting_groups_org_type_idx
  on public.posting_groups (org_id, group_type, posted_at desc);
```

Application invariant:

- `income_*` group には `revenue_basis_id required`
- `payout_*` group には `reward_run_id required`

### 3.6 049 journal extension

```sql
alter table public.accounting_journal_entries
  add column if not exists posting_group_id uuid references public.posting_groups(id) on delete restrict;

create index if not exists accounting_journal_entries_posting_group_idx
  on public.accounting_journal_entries (posting_group_id);

alter table public.accounting_journal_lines
  add column if not exists site_id uuid references public.sites(id) on delete set null,
  add column if not exists revenue_basis_id uuid references public.revenue_basis(id) on delete set null,
  add column if not exists counterparty_id uuid;
```

Migration note:

- `transaction_id` はすぐには落とさない
- compatibility window の間は `transaction_id` と `posting_group_id` 併用

### 3.7 050 `month_closes`

```sql
create table if not exists public.month_closes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  period_ym text not null,
  status text not null check (status in ('draft', 'fixed', 'superseded')),
  source_cutoff_at timestamptz not null,
  fixed_at timestamptz,
  fixed_by jsonb,
  supersedes_month_close_id uuid references public.month_closes(id) on delete restrict,
  close_rule_version_id uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists month_closes_org_period_idx
  on public.month_closes (org_id, period_ym, created_at desc);
```

### 3.8 050 `month_close_lines`

```sql
create table if not exists public.month_close_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  month_close_id uuid not null references public.month_closes(id) on delete cascade,
  revenue_basis_id uuid not null references public.revenue_basis(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  recognized_at timestamptz not null,
  sales_amount numeric(15, 2) not null default 0,
  cost_amount numeric(15, 2) not null default 0,
  profit_amount numeric(15, 2) not null default 0,
  dimensions_json jsonb not null default '{}'::jsonb,
  dimension_hash text not null,
  source_income_posting_group_id uuid not null references public.posting_groups(id) on delete restrict,
  source_site_completion_event_id uuid not null references public.site_completion_events(id) on delete restrict,
  unique (month_close_id, revenue_basis_id, dimension_hash)
);
```

### 3.9 050 `month_close_line_sources`

```sql
create table if not exists public.month_close_line_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  month_close_line_id uuid not null references public.month_close_lines(id) on delete cascade,
  source_type text not null check (source_type in (
    'posting_group', 'proposal_execution', 'site_completion_event', 'revenue_basis'
  )),
  source_id uuid not null,
  contribution_sales numeric(15, 2) not null default 0,
  contribution_cost numeric(15, 2) not null default 0,
  unique (month_close_line_id, source_type, source_id)
);
```

### 3.10 051 `reward_runs`

```sql
create table if not exists public.reward_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  run_kind text not null check (run_kind in ('calculation', 'adjustment')),
  month_close_id uuid not null references public.month_closes(id) on delete restrict,
  proposal_execution_id uuid not null references public.proposal_executions(id) on delete restrict,
  reward_rule_version_id uuid not null,
  calculation_system text not null check (calculation_system = 'path_v22'),
  adjusts_reward_run_id uuid references public.reward_runs(id) on delete restrict,
  status text not null check (status in ('fixed', 'superseded')),
  fixed_at timestamptz not null default now(),
  payout_posting_group_id uuid references public.posting_groups(id) on delete set null
);

create unique index if not exists reward_runs_fixed_calculation_once
  on public.reward_runs (month_close_id, reward_rule_version_id)
  where run_kind = 'calculation' and status = 'fixed';
```

### 3.11 051 `reward_run_lines`

```sql
create table if not exists public.reward_run_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  reward_run_id uuid not null references public.reward_runs(id) on delete cascade,
  month_close_line_id uuid references public.month_close_lines(id) on delete set null,
  revenue_basis_id uuid not null references public.revenue_basis(id) on delete restrict,
  recipient_id uuid not null,
  base_amount numeric(15, 2) not null default 0,
  delta_amount numeric(15, 2) not null default 0,
  payout_amount numeric(15, 2) not null default 0,
  formula_snapshot_json jsonb not null default '{}'::jsonb
);
```

## 4. Route / Service Diff

### 4.1 `server/src/routes/sites.ts`

Current:

- `POST /:id/complete` が `sites.status = completed` を direct update

Target:

- route から direct update を剥がす
- `complete_site_rpc` を呼ぶ薄い orchestration route に変える
- return payload に `site_completion_event_id`, `revenue_basis_id`, `income_proposal_id` を含める

New responsibilities:

- auth / org context
- request validation
- RPC result mapping only

### 4.2 `server/src/routes/accounting.ts`

Current:

- `POST /sales` が `accounting_transactions` に direct insert
- その場で journal を作成

Target:

- direct write route を compatibility mode に落とす
- 新規 write は `income.create` proposal create route または proposal execution path に集約
- eventual target は `410 Gone` or `409 Read-only`

### 4.3 `server/src/routes/pathRewards.ts`

Current:

- legacy reward preview / proposal create

Target:

- preview / read only
- write (`POST /proposals`) は reject
- canonical write は `pathModule.ts` 側だけに寄せる

### 4.4 `server/src/routes/pathModule.ts`

Current:

- `reward-run/proposals` は month string 起点で create

Target:

- request body に `month_close_id`, `reward_rule_version_id` を必須化
- `month` は display / convenience のみ
- fixed close が無ければ preview 可、proposal create 不可

### 4.5 `server/src/services/ProposalService.ts`

Current:

- proposal row 自体が governance state と execution result を兼ねる
- path sync は executed proposal 後の app-level sync

Target:

- `proposal_executions` を first-class に導入
- execute 開始時に execution row を `running` で作成
- posting service は execution id を受ける
- `reward.calculate(path_v22 only)` hard guard をここで実装
- `reward.adjust(month_close_id + revenue_basis_id)` hard guard もここで実装

### 4.6 `server/src/services/PathGovernedModuleService.ts`

Current:

- `path_month_closes`, `path_reward_runs` を正本寄りに扱う
- reward preview は live/accounting rollup fallback を持つ

Target:

- canonical `month_closes`, `reward_runs` を正本にする
- `path_*` は compatibility projection / read model に寄せる
- live accounting rollup は preview-only fallback に制限

### 4.7 New services

Add:

- `SiteCompletionService`
- `RevenueBasisService`
- `ProposalExecutionService`
- `PostingGroupService`
- `MonthCloseService`
- `RewardRunService`

Responsibility split:

- `SiteCompletionService`: fact / revenue_basis / auto proposal
- `ProposalExecutionService`: execution history / guard / orchestration
- `PostingGroupService`: accounting fact creation
- `MonthCloseService`: snapshot fix / supersede
- `RewardRunService`: calculation and adjustment run creation

## 5. Rollout Strategy

### Phase 1: Schema-first compatibility

- new tables / columns / indexes only
- no route behavior change
- old and new writes coexist

### Phase 2: Canonical write redirect

- `sites.complete` -> RPC
- `income` write -> proposal path
- legacy reward write -> reject

### Phase 3: Read model migration

- canonical tables から PATH summary を生成
- `path_*` を compatibility view / mirror に寄せる

### Phase 4: Legacy cleanup

- `income.update` を廃止
- `accounting_transactions` direct write を完全停止
- obsolete path write columns / routes を整理

## 6. Backfill Plan

### 6.1 Site completion -> revenue basis

- completed sites から synthetic `site_completion_event(recorded)` を生成
- 1 site につき 1 `revenue_basis` を生成
- `metadata_json.backfilled = true`

### 6.2 Existing income transactions

- sale / invoice transaction から synthetic `income.create` proposal と `proposal_execution` を生成
- synthetic `posting_group(income_post)` を生成
- journal entry を posting_group に接続

### 6.3 Existing PATH closes / reward runs

- `path_month_closes` から canonical `month_closes` / `month_close_lines` を backfill
- `path_reward_runs` から canonical `reward_runs` / `reward_run_lines` を backfill
- source lineage が足りない行は `metadata_json.lineage_gap = true`

## 7. Open Implementation Questions

- `proposals.status` の既存 `pending/proposed` 揺れをこのタイミングで統一するか
- `accounting_transactions` を physical table のまま projection 扱いにするか、view に寄せるか
- `month_close_line.dimension_hash` の canonical encoding をどこで生成するか
- backfill で生成する synthetic proposal / execution にどの actor を使うか
