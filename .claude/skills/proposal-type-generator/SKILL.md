---
name: proposal-type-generator
description: 新しいProposalタイプのスキャフォールド生成。型定義、バリデーション、ハンドラー、テストのテンプレートを一括生成。
---

# Proposal Type Generator

新しいProposalタイプを追加する際に必要なコードをスキャフォールド生成します。

## 使用タイミング

- 新しい業務機能の追加時
- 新しい承認フローが必要な時
- 既存機能をProposal経由に移行する時

## 生成手順

### Step 1: 要件ヒアリング

以下を確認:
1. Proposal名（例: `expense.create`, `invoice.create`）
2. ペイロード項目（例: amount, vendor_name, site_id）
3. 承認ルール（自動承認条件、承認者数）
4. 実行時の副作用（DB更新、通知、外部API）

### Step 2: 型定義生成

`server/src/types/proposals.ts` に追加:

```typescript
// === ${PROPOSAL_NAME} ===
export interface ${PascalName}Payload {
  ${fields}
}

export interface ${PascalName}Proposal extends BaseProposal {
  type: '${dot_name}';  // e.g. 'expense.create'
  payload: ${PascalName}Payload;
}
```

### Step 3: バリデーション生成

`server/src/validators/proposals/${domain}_${action}.ts`:

```typescript
import { z } from 'zod';

export const ${camelName}PayloadSchema = z.object({
  ${zodFields}
});

export function validate${PascalName}Payload(data: unknown) {
  return ${camelName}PayloadSchema.parse(data);
}
```

### Step 4: ハンドラー生成

`server/src/handlers/proposals/${domain}_${action}.ts`:

```typescript
import { ProposalHandler, ProposalContext } from '../types';
import { validate${PascalName}Payload } from '../../validators/proposals/${snake_name}';

export const ${camelName}Handler: ProposalHandler = {
  type: '${dot_name}',  // e.g. 'expense.create'

  validate(payload: unknown) {
    return validate${PascalName}Payload(payload);
  },

  async getApprovalPolicy(payload, context: ProposalContext) {
    // 承認ルールを返す
    ${approvalPolicyCode}
  },

  async execute(proposal, context: ProposalContext) {
    const { tx } = context;

    // AI自己承認禁止ゲート（必須）
    if (proposal.created_by.type === 'ai') {
      const hasHumanApproval = proposal.approvals.some(
        a => a.actor.type === 'human'
      );
      if (!hasHumanApproval) {
        throw new Error('AI_SELF_APPROVAL_PROHIBITED');
      }
    }

    // 冪等性チェック
    const existing = await findByIdempotencyKey(tx, proposal.idempotency_key);
    if (existing) return existing;

    // 実行ロジック
    ${executeCode}

    // Ledgerイベント生成
    await createLedgerEvent(tx, {
      proposal_id: proposal.id,
      type: '${ledger_event_type}',
      entries: [
        { account: '${debit_account}', debit: payload.amount, credit: 0 },
        { account: '${credit_account}', debit: 0, credit: payload.amount },
      ],
    });

    return { success: true };
  },
};
```

### Step 5: ハンドラー登録

`server/src/handlers/proposals/index.ts` に追加:

```typescript
import { ${camelName}Handler } from './${domain}_${action}';

export const proposalHandlers = {
  // ... existing handlers
  '${dot_name}': ${camelName}Handler,  // e.g. 'expense.create'
};
```

### Step 6: テスト生成

`server/src/__tests__/proposals/${domain}_${action}.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ${camelName}Handler } from '../../handlers/proposals/${domain}_${action}';

describe('${dot_name} proposal', () => {
  it('validates payload correctly', () => {
    const valid = { ${validPayloadExample} };
    expect(() => ${camelName}Handler.validate(valid)).not.toThrow();
  });

  it('rejects AI self-approval', async () => {
    const proposal = createMockProposal({
      type: '${dot_name}',
      created_by: { type: 'ai', id: 'sherpa-1' },
      approvals: [{ actor: { type: 'ai', id: 'sherpa-1' } }],
    });

    await expect(${camelName}Handler.execute(proposal, mockContext))
      .rejects.toThrow('AI_SELF_APPROVAL_PROHIBITED');
  });

  it('creates balanced journal entries', async () => {
    // Ledgerバランステスト
  });

  it('is idempotent', async () => {
    // 同一キーで2回実行しても1件のみ
  });
});
```

## 生成例

**入力:**
```
Proposal名: expense.create
ペイロード: vendor_name, amount, site_id, items[]
承認: ≤5000自動、5001-30000は1名、>30000は2名
```

**出力ファイル:**
- `server/src/types/proposals.ts` (型追加)
- `server/src/validators/proposals/expense_create.ts`
- `server/src/handlers/proposals/expense_create.ts`
- `server/src/__tests__/proposals/expense_create.test.ts`

## チェックリスト

生成後に確認:
- [ ] AI自己承認禁止ゲートが含まれている
- [ ] 冪等性キーによる重複チェックがある
- [ ] Ledger仕訳が借方=貸方になっている
- [ ] トランザクション境界内で全処理が完結
- [ ] テストが4パターン以上ある

## 関連スキル

- `genba-quest-dao-principles` - 原則確認
- `dao-impl-checker` - 生成コードの検証
