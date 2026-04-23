# Runbook: PATH V3.1

> Canonical behavior: [docs/architecture/path-v31.md](../architecture/path-v31.md)
> Change rationale: [docs/adr/2026-04-22-path-v31-cutover.md](../adr/2026-04-22-path-v31-cutover.md)

## Purpose

PATH V3.1 の日次運用をブレずに回すための短い手順書。
制度の完全仕様は architecture doc を参照し、この runbook は実務手順に絞る。

## Before You Start

- post-cutover の mainline write は V3.1 のみ
- v2.2 は read-only history
- close 済み site / month は silent rewrite しない
- 変更が必要なら proposal を作る

## 1. 今日の記録

1. `site_day_logs` に `date / site_id / member_id / trade_families[] / role_type / credited_unit / memo` を入れる
2. `credited_unit` は `1.0 / 0.5 / 0.25` 刻みだけ使う
3. support を result allocation に参加させたいなら、その日から `assist` として記録する
4. 複数 trade を選んだら、経験台帳では unit が等分される前提で入れる
5. lock 済み log は直接更新しない

## 2. 現場締め

1. 対象現場に含める `site_day_logs` を確認する
2. profit inputs を入力する
   - `recognized_revenue`
   - `material_cost`
   - `external_cost`
   - `direct_cost`
   - `overhead_allocated`
   - `known_rework_cost`
   - `approved_adjustments`
3. `share_mode` を選ぶ
   - 通常は `auto_points`
   - 明確な責任割合がある現場だけ `fixed_template`
4. 必要なら per-member outcome を入れる
   - `ok`
   - `rework`
   - `unknown`
5. `site.close.finalize` proposal を作る
6. executed 後、次を確認する
   - `share_snapshot` が保存されている
   - 含まれた `site_day_logs` が lock されている
   - `path_rule_version` / `calculation_snapshot` が保存されている

## 3. reopen が必要なケース

次の変更は reopen proposal なしではやらない。

- close に含めた day log の追加・削除
- close 後の day log 修正
- profit input の修正
- fixed template / auto points の share 修正
- support を result allocation に含める判断変更

手順:

1. `site.close.reopen` proposal を作る
2. executed 後に lock が外れたことを確認する
3. 必要な修正を行う
4. 再度 `site.close.finalize` proposal を作る

## 4. 月次分配

1. 対象月の finalized `site_closes` を確認する
2. 注意:
   - pool membership は day log 月ではなく `closed_at` 月
   - red site は member-negative result weight を作らない
3. `monthly distribution preview` を確認する
4. 次が凍結される前提で内容を確認する
   - `floor_rate`
   - `result_rate`
   - `nonlinear_exponent`
   - member ごとの floor/result 内訳
   - `path_rule_version`
   - `calculation_snapshot`
5. `reward.calculate` proposal を作る
6. executed 後、次を確認する
   - `monthly_distribution_closes`
   - `monthly_distribution_lines`
   - canonical `reward_runs`

## 5. reward.adjust

- close 済み月の payout を黙って更新しない
- correction は `reward.adjust` proposal で追加表現する
- base run を書き換えない

## 6. Experience / Lead Recommendation

### Experience

- `skill_ledgers` は finalized & locked day logs からだけ更新される
- `ok_count / rework_count` は explicit outcome snapshot があるときだけ増減する
- `unknown` は count を動かさない

### Lead Recommendation

- recommendation は advisory
- final decision は human
- override 時は `override_reason_code` を残す
- cold start でも ranking が出るが、`confidence=low` は「履歴不足」の意味であり能力不足ではない

## 7. Cutover Month Notes

- cutover 月以降の v2.2 write path は reject される
- 旧 `/luqo` monthly evaluation flow を運用に使わない
- legacy v2.2 screen / record は comparison と audit 用にだけ参照する

## Checks

- 日次ログは lock 前にだけ編集しているか
- site close ごとに `share_snapshot` が残っているか
- month close ごとに `calculation_snapshot` と rule version が残っているか
- correction を silent overwrite ではなく proposal で扱っているか
