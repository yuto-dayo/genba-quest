# ADR: PATH V3.1 Cutover

- Status: Accepted
- Date: 2026-04-22
- Supersedes in practice:
  - `docs/adr/2026-04-16-path-v22-vertical-slice.md`
  - `docs/adr/2026-04-16-luqo-path-shell-realignment.md`
  - `docs/adr/2026-04-16-management-accounting-vs-reward-allocation.md`
- Canonical spec: `docs/architecture/path-v31.md`
- Operational runbook: `docs/runbooks/path-v31-runbook.md`

## Context

PATH v2.2 は vertical slice としては有効だったが、mainline 制度としては重かった。

主な問題:

- 入口が `daily work log` ではなく、`monthly evaluation + package contribution` に寄っていた
- A/R/Q、Level、AI review、endorsement など、mainline 運用に対して入力点が多すぎた
- `/luqo` が「現場運用の入口」ではなく「月末評価の作業台」になっていた
- 現場の責任シェアを daily role log ではなく v2.2 専用の package points で解釈していた
- cutover 後も v2.2 write path を残すと、制度の正本が二重化して運用がぶれる

## Decision

PATH の post-cutover mainline は V3.1 とする。

### 1. 入力モデルを daily log に戻す

- `1 member × 1 site × 1 day = 1 row`
- 入口は `trade_families[] + role_type + credited_unit`
- 出勤、経験、報酬、主担当推薦を同じログから派生する

### 2. A/R/Q を mainline から外す

- A/R/Q は v2.2 の monthly interpretation layer としては有効だったが、post-cutover の mainline write では使わない
- mainline の skill / experience は自己申告ではなく履歴派生に寄せる
- AI review / endorsement は必要なら別 route に残しても、報酬 mainline には混ぜない

### 3. 現場締めを freeze point にする

- `site close` が責任 share と day log inclusion を凍結する
- `share_snapshot` は `auto_points` / `fixed_template` の両方で必須
- close 後の変更は `site.close.reopen` proposal なしでは認めない

### 4. 月次分配は site close 集計に一本化する

- pool membership は `site_closes.closed_at` の月で決める
- floor/result の 2 層に固定する
- red site は member-negative weight を作らない
- closed month の silent recalculation は禁止する

### 5. reward ledger は既存 canonical sink を継続利用する

- `reward_runs` / `reward_run_lines` / `finance_payout_postings` は作り直さない
- V3.1 は計算正本と freeze snapshot を新設し、payout の immutable sink は既存 canonical を使い続ける
- これにより既存 accounting / posting group / reverse flow を壊さず移行できる

### 6. v2.2 write path は cutover 後 reject する

- `PATH_V31_CUTOVER_DATE` / `PATH_V31_CUTOVER_MONTH` を hard boundary とする
- post-cutover の v2.2 create / update / finalize は server-side で reject する
- legacy v2.2 data は read-only history として残す

### 7. lead recommendation は phase 1 では deterministic にする

- online Thompson learning は後続フェーズへ送る
- first release は candidate exclusion + productivity proxy + growth/fairness bonus の deterministic ranking で十分と判断する
- cold start でも empty ranking を返さず、assist history 由来の low-confidence proxy を返す

## Consequences

期待する効果:

- 日次運用の入力が軽くなる
- 制度説明が「何をしたかを軽く記録し、その記録から配分する」に寄る
- 熟練者の責任シェアを floor/result と非線形 boost で残しつつ、初心者を floor で守れる
- cutover 後の制度正本が 1 本化される
- `/luqo` を現場運用の shell に戻せる

負うコスト:

- v2.2 monthly evaluation UI / type / service が history layer に下がる
- 既存 docs / tests / UI shell の整理が必要
- canonical payout sink と V3.1 calculation snapshot の二層構造になるため、文書化を怠ると理解しづらい

## Non-Decision

この ADR は次をまだ決めない。

- online Thompson update の投入時期
- support を result allocation に乗せる新しい role type
- pre-cutover v2.2 data の skill ledger backfill

これらは別 ADR / architecture update で扱う。
