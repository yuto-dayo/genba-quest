# ADR: PATH v2.2 Vertical Slice Uses Existing Proposal Spine

## Status

Accepted

## Context

repo には proposal / policy / ledger の既存 spine がある。PATH v2.2 を全面刷新で入れると既存 A-1 実装と競合する。

## Decision

- proposal lifecycle は既存 `ProposalService` を再利用する
- PATH v2.2 は新しい org-scoped table 群を追加して並走導入する
- executed proposal 後の projection 同期は app 層の idempotent sync で行う
- live LLM ではなく deterministic reviewer adapter を使う

## Consequences

- 既存 proposal approval path を壊さない
- reward run / month close / endorsement の payload に policy fingerprint と input hash を凍結できる
- DB trigger だけに依存しないため、現在の RPC / fallback 両系統に追従できる
