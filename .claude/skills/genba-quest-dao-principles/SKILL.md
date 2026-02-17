---
name: genba-quest-dao-principles
description: GENBA QUESTのDAO設計原則。コードレビュー、新機能追加、設計判断時に参照。800行のドキュメントを50行に凝縮。
---

# DAO設計原則（凝縮版）

## 3本柱

1. **Proposal中心** - 全状態変更はProposal経由
2. **Event志向Ledger** - 追記のみ、逆仕訳で修正
3. **AIはPolicyに従属** - 自己承認禁止

## Proposal ライフサイクル

```
draft → pending → approved → executed
                ↘ rejected
```

## 承認ルール（Policy）

| 金額 | 承認者数 |
|------|----------|
| ≤5,000円 | 自動承認 |
| 5,001-30,000円 | 1名 |
| >30,000円 | 2名 |

## AI自己承認禁止（絶対ゲート）

```typescript
if (proposal.created_by.type === 'ai' && approver.type === 'ai') {
  throw new Error('AI_SELF_APPROVAL_PROHIBITED');
}
```

## トランザクション境界

```typescript
await db.transaction(async (tx) => {
  await updateApproval(tx, proposalId, approval);
  const event = await createLedgerEvent(tx, proposal);
  await applyStateChange(tx, event);
});
```

## Ledger原則

- 借方合計 = 貸方合計（必須）
- 修正は逆仕訳で（直接編集禁止）
- 全エントリにproposal_id紐付け

## 実装フェーズ

| Phase | 内容 |
|-------|------|
| A-0 | Proposal CRUD + ログ記録 |
| A-1 | PolicyEngine + 承認フロー |
| B | Sherpa統合 + AI制約 |
| C | UI刷新 |
| D | 高度機能 |

## レビュー時チェック

- [ ] 状態変更はProposal経由か？
- [ ] AI自己承認ゲートあるか？
- [ ] 承認+イベント+状態更新が1トランザクションか？
- [ ] 仕訳はバランスしているか？
- [ ] 冪等性は確保されているか？

## 詳細ドキュメント

- [DESIGN_PHILOSOPHY.md](docs/DESIGN_PHILOSOPHY.md) - 完全版
- [PROPOSAL_SYSTEM.md](docs/PROPOSAL_SYSTEM.md) - Proposal詳細
- [LEDGER_SYSTEM.md](docs/LEDGER_SYSTEM.md) - 仕訳パターン
