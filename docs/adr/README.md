# ADR Index

`docs/adr/` は、後から見返す必要がある設計判断の固定点です。
理想設計と current production model がずれるときは、まずここを確認します。

## 使い方

- ある設計が「なぜそうなったか」を知りたいときに読む
- `Accepted` は採用済み判断、`Proposed` は検討中の判断として扱う
- 実装時は root の設計書と矛盾しないかを確認する

## Documents

| File | Status | Purpose |
| --- | --- | --- |
| `2026-04-22-path-v31-cutover.md` | Accepted | PATH V3.1 へ cutover し、v2.2 write path を read-only history へ下げる判断 |
| `2026-04-16-luqo-path-shell-realignment.md` | Accepted | `/luqo` を PATH v2 主導の月次評価シェルへ再編する判断 |
| `2026-04-16-management-accounting-vs-reward-allocation.md` | Accepted | 現場損益と報酬配分を分離する判断 |
| `2026-04-16-path-v22-vertical-slice.md` | Accepted | PATH v2.2 を既存 Proposal spine に乗せる判断 |
| `2026-04-17-current-db-canonical-execution-model.md` | Accepted | current DB canonical execution model の凍結 |
| `2026-04-19-org-membership-auth-boundary-plan.md` | Proposed | org membership と auth boundary の再設計案 |

## 関連

- Overview: `docs/README.md`
- Core architecture: `docs/DESIGN_PHILOSOPHY.md`
- Detailed feature specs: `docs/architecture/`
