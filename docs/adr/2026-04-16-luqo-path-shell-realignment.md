# ADR: `/luqo` を PATH v2 主導の月次評価シェルへ再編する

- Status: Accepted
- Date: 2026-04-16
- Related:
  - `docs/tasks/2026-04-08_path_evaluation_reward_v2_spec.md`
  - `docs/tasks/2026-04-09_path_profile_settings_ux_proposal.md`
  - `frontend/src/pages/LUQO.tsx`
  - `frontend/src/components/luqo/PathTab.tsx`

## Context

`/luqo` は移行途中のハイブリッド画面として、旧 LUQO の報酬プレビュー / `luqo.reward.calculate` と、PATH v2 の月次評価 UI を同じ主導線に載せていた。

この状態には次の問題があった。

- `/settings` の「今月の評価」導線と `/luqo` の初期表示が一致しない
- PATH v2 を主導線にしたいのに、旧 LUQO write path が画面の先頭に残る
- `member_id` と表示名が分離されず、legacy breakdown を不完全なまま submit できる
- `/luqo` の主系で触る route 群が `DEFAULT_ORG_ID` fallback を持ち、org 境界が弱い

## Decision

`/luqo` を PATH v2 の月次評価ワークフローを進める主画面として扱う。

- 初期タブは `今月の評価` とする
- 旧 LUQO は `旧LUQO参考` タブに隔離し、比較と履歴参照だけを許可する
- `luqo.reward.calculate` は UI 主導線から外し、client/server ともに legacy/debug 扱いに寄せる
- `PathTab` は orchestration を親に残しつつ、workflow / reward operations / legacy comparison / certification へ責務分割する
- `/luqo` 主系で利用する PATH / LUQO route は `req.orgId` 必須にし、silent fallback をやめる

## Consequences

期待する効果:

- PATH v2 の「入力 → AI下書き → 評価確定 → PATH支給 proposal」の流れが `/luqo` で一貫する
- 旧 LUQO は read-only compatibility layer として残せる
- legacy 書き込み API は残しても、主導線から外れるため誤用リスクを下げられる
- `member_id` / `org_id` の検証を client/server の両側で持てる

残す legacy:

- LUQO のスコア参照
- legacy reward calculation の履歴参照
- `luqo.reward.calculate` API 自体は完全削除しないが、UI 主導線には置かない

## Follow-up

- legacy LUQO write path を admin/debug 用 route に完全分離する
- `PathTab` の approval queue と profile/review notes もさらに小さい section へ切る
- auth middleware 全体の `DEFAULT_ORG_ID` fallback 廃止は別フェーズで横断対応する
