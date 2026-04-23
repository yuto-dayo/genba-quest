# GENBA QUEST PATH v2.2 Vertical Slice

> Historical design for the pre-cutover PATH v2.2 write path.
> Post-cutover canonical spec is [docs/architecture/path-v31.md](./path-v31.md).
> Cutover rationale is [docs/adr/2026-04-22-path-v31-cutover.md](../adr/2026-04-22-path-v31-cutover.md).

## Goal

GENBA QUEST を `proposal / event / policy` 主導の guild OS として保ちつつ、PATH を policy-governed module として統合する。

この vertical slice では以下を成立させる。

- 重要な確定操作は proposal 経由
- governance event を append-only に保存
- PATH policy bundle の version / fingerprint / input hash を reward run / month close に凍結
- 管理会計 (`site_item_profit`) と報酬分配 (`work package points`) を分離
- level / trade endorsement / assignment restriction を分離
- reward posting を finance journal の double-entry で残す

## Boundaries

### Governance Event Store

- `proposals`
- `governance_events`
- `policy_bundle_versions`

proposal lifecycle は既存 `ProposalService` を再利用する。作成 / 承認 / 却下 / 実行後に app 層から `governance_events` を idempotent に同期する。

### Finance Journal

- `accounting_journal_entries`
- `accounting_journal_lines`
- `finance_payout_postings`

PATH reward run 自体は proposal payload と explanation snapshot に残す。実際の payout posting は `accounting_journal_entries/lines` に `Dr 2130 / Cr 1100` で起票し、reverse は逆仕訳で表現する。

### Evidence Store

- `path_monthly_close_inputs`
- `path_evidence_records`
- `path_ai_review_annotations`

AI reviewer 出力は evidence ではなく annotation。`supporting_evidence_ids` / `challenged_evidence_ids` を必須にし、`model_version` / `prompt_version` / `schema_version` を保存する。

## PATH Domains

### WorkOps

- `trade_families`
- `path_site_item_profit_snapshots`
- `path_work_packages`
- `path_work_package_assignments`

site item profit は management accounting。reward allocation の主入力にはしない。

### Evaluation / Approval

- `evaluation.finalize` proposal payload に month close context を格納
- `skill.achieve` / `skill.revoke` proposal payload に endorsement context を格納
- `PathGovernedModuleService.syncProjectionFromExecutedProposal()` が executed proposal を read model へ同期

### Finance / Compensation

- `path_reward_runs`
- `path_explanation_snapshots`
- `finance_payout_postings`

reward preview は `PathGovernedModuleService.calculateRewardPreview()` で決定論的に計算する。

## Reward Formula

```text
ClosedProfit
  = RecognizedRevenue
  - DirectCosts
  - OverheadAllocated
  - RuleReserve
  + PriorPeriodAdjustments

PATHPool = max(0, ClosedProfit)
BasePool = PATHPool * 0.85
VariablePool = PATHPool * 0.15
```

```text
PackagePoints
  = StdHours * DifficultyCoeff * FamilyCoeff

MemberPoints
  = PackagePoints
  * ResponsibilityShare
  * RoleCoeff
  * QualityGateCoeff

MonthlyWeight
  = sum(MemberPoints) * MonthlyCoeff
```

```text
BaseWeight
  = CreditedUnits * LevelCoeff

FinalPay
  = max(GuaranteedPay, Base + Variable)
```

## First Vertical Slice Flow

1. 月次入力を `path_monthly_close_inputs` に保存
2. evidence を `path_evidence_records` に保存
3. Reviewer A/B を deterministic adapter で生成し `path_ai_review_annotations` に保存
4. human が `evaluation.finalize` proposal を作成
5. executed 後に `path_month_closes`, `path_credited_units`, `path_opportunity_audits` を同期
6. human が `reward.calculate` proposal を作成
7. executed 後に `path_reward_runs`, `path_explanation_snapshots`, `finance_payout_postings`, `accounting_journal_*` を同期
8. trade endorsement proposal が executed されると `path_trade_endorsements` / `path_assignment_restrictions` を更新

## Assumptions

- org isolation は既存 repo に合わせ、app 層で `org_id` を必須フィルタする
- live LLM は入れず deterministic reviewer adapter を採用
- projection sync は executed proposal 後の app 層 idempotent sync とする
- current role level は既存 `member_skill_profiles.current_level` を reuse する
