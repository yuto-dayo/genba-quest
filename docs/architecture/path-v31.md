# PATH V3.1

> Current canonical spec for PATH after the V3.1 cutover.
> Decision background: [docs/adr/2026-04-22-path-v31-cutover.md](../adr/2026-04-22-path-v31-cutover.md)
> Operational procedure: [docs/runbooks/path-v31-runbook.md](../runbooks/path-v31-runbook.md)

## One-Line Summary

PATH V3.1 は、現場日ごとの `工種 × 役割` ログを唯一の入口にして、出勤、経験、利益分配、主担当選択をつなぐ、留保なし・軽い非線形ブースト付きの責任配分 OS である。

## Intent

V3.1 の目的は次の 5 つに絞る。

1. 現場入力を極限まで軽くする
2. 出勤、経験、報酬を同じログから作る
3. 熟練者が残りやすい分配にする
4. 初心者を「機会不足なのに低評価」にしない
5. 主担当選択を感覚ではなく学習ルールに寄せる

## Core Principles

- 評価は宣言ではなく履歴で見る。`できます / できません` の自己申告ではなく、どの工種をどの役割で何回やったかを記録する。
- 出勤と評価を分けない。日次ログがそのまま出勤・経験・分配の根になる。
- 報酬は分配可能利益からしか払わない。売上ではなく `site close` 後に確定した `distributable_profit` を原資にする。
- 通常の手直しは犯人探しではなく P/L 処理に寄せる。通常 rework は個人の直接減額ではなく `known_rework_cost` または次月調整で扱う。
- 主担当は「利益を大きく壊さない範囲で育成する」。第 1 優先は生産性、第 2 優先は成長性、第 3 優先は公平性。
- closed site / closed month は凍結する。係数変更やルール変更があっても、既に close された share / payout を静かに再解釈しない。

## Input Model

V3.1 の日次入力は `1 member × 1 site × 1 day = 1 row`。

### `site_day_logs`

- `date`
- `site_id`
- `member_id`
- `trade_families[]`
- `role_type`
  - `assist`
  - `lead`
  - `solo`
  - `support`
- `credited_unit`
  - `1.0 = 全日`
  - `0.5 = 半日`
  - 以後 `0.25` 刻み
- `memo`
- `locked_by_site_close_id`

### Trade Family Rule

初期 trade family は次の 5 つを正本とする。

- `wall_finish`
- `floor_finish`
- `substrate_preparation`
- `decorative_sheet_or_film`
- `common_site_operations`

複数工種を選んだ場合、経験台帳では `credited_unit` を等分して各工種へ配る。報酬計算は工種別ではなく、その日の役割と `site close` で確定した `share_snapshot` を使う。

## Site Close

`site close` は V3.1 の最重要 freeze point である。

### Purpose

- 現場ごとの分配可能利益を確定する
- 現場利益の責任シェアを確定する
- 含まれる `site_day_logs` を lock する
- 後続の月次分配に使う immutable snapshot を残す

### `site_closes`

- profit inputs
  - `recognized_revenue`
  - `material_cost`
  - `external_cost`
  - `direct_cost`
  - `overhead_allocated`
  - `known_rework_cost`
  - `approved_adjustments`
- derived
  - `distributable_profit`
- share control
  - `share_mode`
  - `fixed_template_key`
  - `fixed_template_reason_code`
  - `share_snapshot`
- rule freeze
  - `path_rule_version_id`
  - `path_rule_version`
  - `path_rule_fingerprint`
  - `calculation_snapshot`
- close facts
  - `closed_at`
  - `closed_by`
  - `status`

### Profit Formula

```text
DistributableProfit
  = RecognizedRevenue
  - MaterialCost
  - ExternalCost
  - DirectCost
  - OverheadAllocated
  - KnownReworkCost
  + ApprovedAdjustments
```

### Share Modes

#### `auto_points`

役割係数:

- `assist = 1.0`
- `lead = 1.8`
- `solo = 2.4`
- `support = 0.0`

```text
RawPoints(member, site)
  = Σ credited_unit × role_coeff

SiteShare(member, site)
  = RawPoints / Σ RawPoints
```

`support` は floor only。result allocation に参加させたい場合は `assist` として記録するか、`fixed_template` で明示的に `share_snapshot` に含める。

#### `fixed_template`

日数カウントより責任割合の方が明確な現場だけ使う。初期 template は次を持つ。

- `solo = 100`
- `lead + assist = 70 / 30`
- `co-lead = 50 / 50`
- `lead + assist + assist = 60 / 25 / 15`
- `lead + training = 60 / 40`

### Freeze Rule

- finalization 時に `share_snapshot` を永続化する
- `share_snapshot` は `auto_points` / `fixed_template` の両方で必須
- 含まれる `site_day_logs` は `locked_by_site_close_id` で lock する
- profit inputs / included logs / share の変更には `site.close.reopen` proposal が必要
- reopen なしの silent recalculation は許可しない

## Monthly Distribution

月次分配は `site close` の集計結果からだけ計算する。

### Membership Rule

月次 pool への所属は underlying day log の月ではなく、`site_closes.closed_at` の月で決める。

### Pool

```text
Pool(month)
  = max(
      0,
      Σ finalized site_closes.distributable_profit
      + monthly approved adjustments
    )
```

### Structure

- `FloorPool = Pool × 0.35`
- `ResultPool = Pool × 0.65`

#### Floor

```text
FloorUnits(member, month)
  = Σ credited_unit from locked day logs

FloorPay
  = FloorPool × member floor units / total floor units
```

#### Result

```text
SiteWeightBase(site)
  = max(0, distributable_profit)

RawResultWeight(member, month)
  = Σ SiteWeightBase(site) × share_snapshot(member, site)
```

その後、member 集計後に軽い非線形ブーストをかける。

```text
BoostedResultWeight
  = RawResultWeight ^ 1.12
```

speed coeff は保存するが、phase 1 では原則 `normal = 1.00`。

#### Final

```text
TotalPay
  = FloorPay + ResultPay + Correction
```

### Frozen Monthly Records

`monthly_distribution_closes` と `monthly_distribution_lines` に次を固定する。

- rule version
- fingerprint
- calculation snapshot
- member ごとの floor / result input と output

canonical payout ledger は既存の `reward_runs` / `reward_run_lines` / `finance_payout_postings` を継続利用する。V3.1 は payout sink を作り直さず、計算正本だけを V3.1 の frozen snapshot に寄せる。

## Experience Ledger

経験は重い認定制度ではなく、履歴から自動集計する。

### `skill_ledgers`

- `assist_units`
- `lead_units`
- `solo_units`
- `recent_90d_units`
- `ok_count`
- `rework_count`
- `last_performed_at`
- `derived_labels`

### Derivation Rule

- unit 系は finalized & locked な `site_day_logs` からだけ導出する
- multi-trade log は工種数で等分して各 trade family に配る
- `ok_count` / `rework_count` は `site_member_outcome_snapshots` の explicit outcome だけ集計する
- per-member attribution がない現場は `unknown` のままにし、 count を増減させない

### Display Labels

画面表示用 label は次だけ。

- `unverified`
- `assist_history`
- `lead_history`
- `solo_history`
- `stable_candidate`

`unverified` は能力不足を意味しない。単に post-cutover 実績がまだないことを示す。

## Lead Recommendation

V3.1 の主担当推薦は phase 1 では deterministic rule-based ranking とする。Thompson update を mainline には入れない。

### Candidate Exclusion

次は自動で候補外。

- same-trade assist 実績が実質ない
- active restriction がある
- unresolved serious incident がある
- difficulty mismatch が明らか
- 当日の bad condition が明示されている

### Productivity Proxy

十分な post-cutover lead/solo 履歴がある場合:

- recent same-trade lead/solo history
- low rework tendency
- difficulty fit

十分な履歴がない cold start の場合:

```text
productivity_proxy
  = 0.5 * normalized_recent_assist_units
  + 0.3 * normalized_lifetime_assist_units
  + 0.2 * difficulty_fit_score
```

`difficulty_fit_score`:

- same-or-higher difficulty seen = `1.0`
- one band lower = `0.7`
- otherwise = `0.4`

### Safety Filter

- standard: `>= best * 0.90`
- high risk: `>= best * 0.93`

### Recommendation Score

```text
RecommendationScore
  = productivity_proxy
  + growth_bonus
  + fairness_bonus
```

- `growth_bonus <= 0.08`
- `fairness_bonus <= 0.05`

人間が推薦を override した場合は `override_reason_code` を必須化する。

## Cutover Flow

### Boundary

- hard boundary: `PATH_V31_CUTOVER_DATE`
- derived: `PATH_V31_CUTOVER_MONTH`

### After Cutover

- v2.2 create / update / finalize APIs は server-side で reject する
- legacy v2.2 data は read-only で残す
- `/luqo` の mainline は V3.1 の 4 画面に切り替える

### New Primary Flow

1. `site_day_logs` を記録する
2. human が `site.close.finalize` proposal を作成する
3. executed 後に `site_closes` / `site_member_outcome_snapshots` / log lock / `skill_ledgers` を同期する
4. month 単位で preview を計算する
5. human が `reward.calculate` proposal を作成する
6. executed 後に `monthly_distribution_closes` / `monthly_distribution_lines` と canonical payout ledger を同期する
7. lead recommendation は finalized post-cutover data だけを参照して advisory ranking を返す

## What V3.1 Does Not Do

- A/R/Q の月末手入力を mainline に置かない
- heavy AI double review を mainline に置かない
- quality holdback を前提にしない
- closed site / closed month を黙って再計算しない
- 通常ミスを個人請求にしない
- AI だけで最終確定しない

## Canonical Status

- post-cutover PATH write path の正本は本書
- v2.2 は historical compatibility layer として残す
- 実装差分や変更理由は ADR を、日次運用は runbook を参照する
