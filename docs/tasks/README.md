# Tasks Index

`docs/tasks/` は、日付付きの実装仕様・調査結果・証跡・提案の置き場です。
恒久設計ではなく、その時点の判断材料や作業成果を残します。

## 使い方

- 「その日に何を決めたか」「どの証跡があるか」を確認したいときに読む
- 恒久化すべき内容は root の設計書、`docs/architecture/`、`docs/adr/` へ昇格させる
- 完了したタスク文書も、過去判断の根拠として残す

## Documents

| File | Purpose |
| --- | --- |
| `2026-02-18_gmail_webhook_pending_queue_evidence.md` | Gmail webhook から pending queue approve/reject までの E2E 証跡 |
| `2026-03-18_qualified_invoice_implementation_spec.md` | 適格請求書機能の実装仕様 |
| `2026-04-08_path_evaluation_reward_v2_spec.md` | PATH 評価・報酬ロジック v2 の実装仕様 |
| `2026-04-09_path_profile_settings_ux_proposal.md` | LUQO / PATH UIUX 改善提案 |

## 関連

- Overview: `docs/README.md`
- Detailed architecture: `docs/architecture/`
- Decisions: `docs/adr/`
