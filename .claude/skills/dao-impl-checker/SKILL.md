---
name: dao-impl-checker
description: DAO設計原則に基づくコード/PR検証スキル。Proposal経由、AI自己承認禁止、トランザクション境界、Ledgerバランスをチェック。
---

# DAO実装チェッカー

PRレビューや実装時にDAO設計原則への準拠を検証します。

## 使用タイミング

- PRレビュー時
- 新機能の実装完了後
- 経理関連コードの変更時

## チェック項目

### 1. Proposal経由チェック

状態変更が直接DBを操作していないか確認。

```typescript
// NG: 直接更新
await db.update('accounting_transactions', { status: 'approved' });

// OK: Proposal経由
await proposalService.create({ type: 'approve_expense', payload });
```

**検索パターン:**
```
Grep: "db.update|db.insert|\.update\(|\.insert\(" path="server/src"
```

違反があれば、ProposalService経由に修正を指示。

### 2. AI自己承認禁止チェック

承認処理にAI自己承認ゲートがあるか確認。

```typescript
// 必須ゲート
if (proposal.created_by.type === 'ai' && approver.type === 'ai') {
  throw new Error('AI_SELF_APPROVAL_PROHIBITED');
}
```

**検索パターン:**
```
Grep: "approve|承認" path="server/src"
→ 該当ファイルにAI_SELF_APPROVAL チェックがあるか確認
```

### 3. トランザクション境界チェック

承認→イベント生成→状態更新が1トランザクションか確認。

```typescript
// OK: 1トランザクション
await db.transaction(async (tx) => {
  await updateApproval(tx, ...);
  await createEvent(tx, ...);
  await applyChange(tx, ...);
});

// NG: 分離している
await updateApproval(proposalId);
await createEvent(proposalId);  // 別トランザクション
```

**検索パターン:**
```
Grep: "\.transaction\(" path="server/src"
→ 承認処理が含まれているか確認
```

### 4. Ledgerバランスチェック

仕訳が借方=貸方になっているか確認。

```typescript
// 仕訳作成時のバリデーション必須
const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);
if (totalDebit !== totalCredit) {
  throw new Error('JOURNAL_IMBALANCED');
}
```

**検索パターン:**
```
Grep: "journal|仕訳|JournalEntry" path="server/src"
→ バランスチェックがあるか確認
```

### 5. 冪等性チェック

同一リクエストの再実行で副作用が発生しないか確認。

```typescript
// OK: 冪等キーで重複チェック
const existing = await findByIdempotencyKey(key);
if (existing) return existing;

// NG: 毎回新規作成
await createProposal(data);  // 重複チェックなし
```

## 出力フォーマット

```markdown
## DAO準拠チェック結果

| 項目 | 結果 | 詳細 |
|------|------|------|
| Proposal経由 | ✅/❌ | 直接DB操作: N件 |
| AI自己承認禁止 | ✅/❌ | ゲート有無 |
| トランザクション境界 | ✅/❌ | 分離箇所: N件 |
| Ledgerバランス | ✅/❌ | チェック有無 |
| 冪等性 | ✅/❌ | 重複処理有無 |

### 要修正箇所
1. `server/src/xxx.ts:42` - 直接DB更新を検出
2. ...
```

## 関連スキル

- `genba-quest-dao-principles` - 原則の確認
- `proposal-type-generator` - 新Proposal型の生成
