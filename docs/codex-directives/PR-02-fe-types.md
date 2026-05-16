# PR-02 — FE: 立替/PATHチーム型定義の追加

## Goal
PR-01 の3エンドポイントに対応する型・API client 関数を `frontend/src/lib/api.ts` に追加し、TypeScript で消費可能にする。

## Acceptance criteria

- [ ] `MemberReimbursementsSummary`, `MemberReimbursementBalance`, `TeamRewardSummary` 型が `lib/api.ts` に export される
- [ ] `fetchMemberReimbursementsSummary(month)`, `fetchMemberReimbursementBalance(memberId, month)`, `fetchTeamRewardSummary(month)` 3関数が追加される
- [ ] 既存 `AccountingTransaction` 型に立替フィールド(`paid_by`, `claimant_member_id`, `settlement_type`, `payment_account`, `reimbursement_status`)を追加
- [ ] 既存 `CreateExpenseRequest` 型に同フィールドを追加(optional)
- [ ] vitest で各 fetcher の型推論を検査(`expectTypeOf` ベース)
- [ ] tsc/lint パス

## Files

- `frontend/src/lib/api.ts` — 型 + 関数追加
- `frontend/src/lib/api.test.ts`(存在すれば) — 型検査追加

## Field shape (must match PR-01 contract exactly)

```ts
export interface MemberReimbursementsSummary {
  month: string;
  members: TeamMemberReimbursement[];
}

export interface TeamMemberReimbursement {
  member_id: string;
  nickname: string;
  total_advanced: number;
  unsettled: number;
  settled: number;
  count_pending: number;
  status: 'pending' | 'in_review' | 'none' | 'settled';
}

export interface MemberReimbursementBalance {
  member_id: string;
  month: string;
  total_advanced: number;
  unsettled: number;
  settled: number;
  by_status: {
    unsubmitted: number;
    submitted: number;
    approved: number;
    reimbursed: number;
  };
  recent_items: Array<{
    id: string;
    occurred_on: string;
    category: string;
    amount: number;
    reimbursement_status: string;
  }>;
}

export interface TeamRewardSummary {
  month: string;
  is_finalized: boolean;
  members: TeamMemberReward[];
}

export interface TeamMemberReward {
  member_id: string;
  nickname: string;
  level: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  attendance_days: number;
  amount: number;
  status: 'finalized' | 'preview' | 'pending';
  has_invoice: boolean;
  has_paid: boolean;
}
```

## Forbidden

- 既存 `AccountingTransaction` 型のフィールド削除/リネーム
- 立替フィールドを required にする(段階移行のため optional)
- API 呼び出しを fetch 直叩きで書く(既存 helper パターンに従う)

## Reference
- PR-01 brief で定義された API contract が真実
