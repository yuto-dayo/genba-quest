# Runbook: PATH Month Close

## Preconditions

1. `path_monthly_close_inputs` がメンバー分そろっている
2. 必要 evidence が `path_evidence_records` に保存されている
3. Reviewer A/B annotation が `path_ai_review_annotations` にある

## Steps

1. `POST /api/v1/path/module/monthly-close-inputs`
2. `POST /api/v1/path/module/evidence`
3. `POST /api/v1/path/module/ai-annotations/generate` with `reviewer_kind=A`
4. `POST /api/v1/path/module/ai-annotations/generate` with `reviewer_kind=B`
5. human reviewer が `POST /api/v1/path/module/month-close-proposals`
6. proposal を通常の `/api/v1/proposals/:id/approve` で承認
7. executed 後、`GET /api/v1/path/module/month-close-summary?month=YYYY-MM` で close と reward run 準備状態を確認

## Checks

- `path_month_closes.policy_fingerprint` が埋まっている
- `path_month_closes.input_hash` が埋まっている
- `path_credited_units` が close に紐づいている
- `path_opportunity_audits` に `opportunity_not_granted` が残せている

## Failure Modes

- `INVALID_A_SCORE` / `INVALID_R_SCORE` / `INVALID_Q_SCORE`
  - proposal payload を見直す
- `INVALID_MONTH_FORMAT`
  - `YYYY-MM` で渡す
- evidence 不足
  - close はできても `review_required` explanation に倒す
