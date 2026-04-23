# Runbook: PATH Reward Correction

## Rule

closed month の金額は黙って更新しない。必ず `reward.adjust` proposal と journal reverse / adjustment を使う。

## Standard Flow

1. `GET /api/v1/path/module/month-close-summary?month=YYYY-MM` で対象 reward run を確認
2. `POST /api/v1/path/module/reward-adjustment-proposals`
3. proposal approval
4. executed 後に `finance_payout_postings` と `accounting_journal_entries/lines` を確認

## Constraints

- `correction_month` は `target_month` より後でなければならない
- same-month rewrite は `CLOSED_PERIOD_MUTATION_PROHIBITED`
- reversal は逆仕訳
- adjustment は next period adjustment

## Verification

- `finance_payout_postings.posting_kind`
  - `payout`
  - `adjustment`
  - `reversal`
- payout entry:
  - `Dr 2130 / Cr 1100`
- reversal entry:
  - `Dr 1100 / Cr 2130`
