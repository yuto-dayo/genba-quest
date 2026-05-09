---
name: genba-quest-dao-principles
description: GENBA QUESTのDAO×UX設計原則。コードレビュー、新機能追加、設計判断時に参照。docs/DESIGN_PHILOSOPHY.md(約900行)を凝縮。
---

# DAO×UX設計原則（凝縮版）

## MVPアウトカム（迷ったらこれで切る）

1. **請求漏れゼロ** — やった仕事が必ず請求につながる
2. **黒字可視化** — 現場別利益と月次PLが即座に分かる

## バックエンド3本柱

1. **Proposal中心** — 全状態変更はProposal経由（直接UPDATE禁止）
2. **Event志向Ledger** — 追記のみ、修正は逆仕訳、借方=貸方
3. **AIはPolicyに従属** — 自己承認禁止（絶対ゲート）

## UX原則（Calm Cockpit + Cursor Tab系）

1. **Input-zero / Decision-human** — 判断は人間、入力と確認はAIが奪う
2. **Direct + Sherpa split** — 単純操作=Direct UI、複雑な多段=Sherpa Chat（FAB起動、常駐するが沈黙）
3. **Suggestion 5レベル** — Inline / Card / Why / Guard / Sherpa Chat（混ぜない）
4. **育つフォーム** — 最初1〜2フィールド、AIが文脈で展開、整合性は Proposal validation で合流
5. **AIはクリティカルパスではない** — 遅延/失敗で入力フローを止めない

## Proposal ライフサイクル

```
draft → pending → approved → executed
              ↘ rejected
```

## 承認ルール（金額閾値はPolicy管理）

| 金額 | 承認者数 |
|------|----------|
| ≤5,000円 | 自動承認 |
| 5,001-30,000円 | 1名（AI可） |
| >30,000円 | 2名（AI不可） |

## AI自己承認禁止（絶対ゲート）

`proposal.created_by.type === 'ai' && approver.type === 'ai'` のとき承認不可。Policy評価より上位で常に効く。

## トランザクション境界

「承認 + Event発行 + 状態更新」は1tx。実装手段は問わないが、ゾンビ状態（approvedだがEvent無し）を構造的に存在させない。

## Ledger / MonthClose

- 借方合計 = 貸方合計（必須、DB制約で守る）
- 修正は逆仕訳（直接編集禁止）
- 全エントリにproposal_id紐付け
- **MonthClose確定期間は不可変** — 修正は翌期の逆仕訳

## ドメイン（現行 Proposal type）

- **Ledger**: `expense.*` / `income.*`
- **Invoice**: `invoice.create` / `invoice.send` / `invoice.mark_paid`
- **Assignment**: `assignment.*`
- **Site**: `site.create` / `site.close.finalize` / `site.close.reopen`
- **Reward**: `reward.calculate` / `reward.adjust` / `evaluation.finalize` / `skill.*`
- **PATH governance**: 多Proposal集約決定（`path.site_close.finalized` 等のevent）
- **Communication**: `communication.review` / `communication.task`
- **Policy**: `policy.update`

## 達成済み不変条件（回帰NG）

- Proposal経由の状態変更
- Policy評価が承認APIの最終ゲート
- Actor区別（human/ai/integration/system）
- AI自己承認禁止ゲート
- pending含む承認フロー稼働
- Sherpa Chat（FAB起動、Proposal下書き）
- PATH governance V3.1/V3.2
- MonthClose（month_closes テーブル）

## レビュー時チェック

- [ ] 状態変更はProposal経由か？
- [ ] AI自己承認ゲートを通っているか？
- [ ] 承認+Event+状態更新が1tx か？
- [ ] 仕訳バランス・冪等性は保たれているか？
- [ ] closed month に書こうとしていないか？
- [ ] AI出力に Proposal/根拠/影響/承認パスが揃っているか？（Calm Cockpit #5）
- [ ] Direct でできることに Sherpa を出していないか？（逆も）

## 詳細ドキュメント

- [DESIGN_PHILOSOPHY.md](../../../docs/DESIGN_PHILOSOPHY.md) - 完全版
- [PROPOSAL_SYSTEM.md](../../../docs/PROPOSAL_SYSTEM.md) - Proposal詳細
- [LEDGER_SYSTEM.md](../../../docs/LEDGER_SYSTEM.md) - 仕訳パターン
- [SHERPA_ARCHITECTURE.md](../../../docs/SHERPA_ARCHITECTURE.md) - AI Orchestrator
- [design-system/genba-quest/MASTER.md](../../../design-system/genba-quest/MASTER.md) - Calm Cockpit
