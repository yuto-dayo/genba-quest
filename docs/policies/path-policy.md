# PATH Policy Bundle v2.2

## Purpose

PATH は code 直書きの magic number ではなく、versioned policy bundle として扱う。

## Active Bundle

- `bundle_key`: `path_core_v22`
- `version`: `2.2.0`
- `revision`: `1`

## Core Constants

- `LEVEL_COEFFICIENTS`
  - `L1=0.85`
  - `L2=1.00`
  - `L3=1.15`
  - `L4=1.30`
- `MONTHLY_COEFFICIENT_RULES`
  - `0..1 => 0.9`
  - `2..4 => 1.0`
  - `5..6 => 1.1`
- `BASE_POOL_RATE=0.85`
- `VARIABLE_POOL_RATE=0.15`
- `DIFFICULTY_COEFFICIENTS`
  - `S1=1.00`
  - `S2=1.15`
  - `S3=1.30`
- `ROLE_COEFFICIENTS`
  - `lead=1.00`
  - `support=0.75`
  - `teaching=0.90`
- `QUALITY_GATE_COEFFICIENTS`
  - `pass=1.00`
  - `minor_fix=0.95`
  - `major_fix=0.80`

## Manual Review Rules

- AI reviewer output は annotation であり evidence ではない
- `stable_independent` は auto-approve 不可
- `reward.calculate`, `reward.adjust`, `evaluation.finalize`, `policy.update` は manual review 必須
- closed month の直接 rewrite は禁止
- correction は next period adjustment で表現する

## Evidence Rules

- `origin_event_id` が同一の evidence は独立証拠として水増ししない
- AI summary は独立 evidence に数えない
- promotion / stable endorsement は `quality_evidence` と `human_confirmation` を含むこと

## Opportunity Rules

- `not_observed`
- `opportunity_not_granted`
- `recheck_required`
- `observed`

未観測や機会未付与は 0 点扱いしない。neutral handling で A/R/Q と explanation に反映する。
