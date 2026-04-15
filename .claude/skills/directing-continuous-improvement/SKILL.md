---
name: directing-continuous-improvement
description: Use this skill when you need a director-level perspective on GENBA QUEST evolution. Invoke when hardcodes are found bypassing PolicyEngine, when philosophy needs to translate to concrete action, when deciding what to improve next, or when asked "what's the current form?". This skill holds 3 absolute invariants and treats everything else as flexible temporary forms. Core philosophy: never satisfied with the current state, always improving. Triggers: "次何を改善すべき?", "思想の核は?", "ハードコードを直したい", "現在のフェーズで何を優先すべき?", "ディレクター視点で".
---

# Directing Continuous Improvement

GENBA QUESTの進化を導くディレクタースキル。
**最小の不変核**を守りながら、全てを柔軟に改善し続ける。

## 3つの絶対不変核

```
1. AI自己承認禁止
   proposal.created_by.type === 'ai' && approver.type === 'ai' → 必ず拒否

2. Proposal中心
   全状態変更は draft→pending→approved→executed のProposal経由

3. Ledgerバランス
   借方合計 = 貸方合計（必須）
```

**これ以外は全て仮設の形。常に改善できる。**

詳細: [./invariants-and-flexible-patterns.md](./invariants-and-flexible-patterns.md)

---

## ワークフロー（6ステップ）

### STEP 1: ASSESS — 現状を診断する

```bash
# ハードコードの検出
grep -rn "5000\|30000\|50000" server/src/routes/ server/src/services/

# PolicyEngine bypass の検出
grep -rn "if.*amount\|amount.*>" server/src/routes/ --include="*.ts"

# org_id ハードコードの検出
grep -rn "00000000-0000" server/src/ --include="*.ts" | grep -v "env\|process\|test\|spec"
```

発見した問題を分類リストに記録する。

### STEP 2: CLASSIFY — 不変 vs 可変を仕分ける

各問題に対して問う：

> 「これを変えると3つの不変核が壊れるか？」

- **YES** → 不変核。絶対に守る。
- **NO** → 可変形。今のフェーズに合わせて最適化できる。

よくある誤分類の例:
- `5000円の閾値` → **可変** (DBのpoliciesテーブルで管理すべき)
- `required_approvals: 1` → **可変** (PolicyEngineが決める)
- `AI自己承認チェック` → **不変** (コードに必ずゲートが必要)

### STEP 3: DECIDE — 現フェーズの最適形を決める

現在のフェーズを確認して判断する：

| フェーズ | 優先事項 | 許容する妥協 |
|---------|----------|-------------|
| A-0 (現在) | Proposalログ化・PolicyEngine通す | UIは粗くてよい |
| A-1 | 承認フロー完全化 | 自動化は後回し |
| B | Sherpa統合 | ポリシーは単純でよい |
| C | UI刷新 | パフォーマンスは後 |
| D | 高度機能 | 全部整える |

### STEP 4: DIRECT — 適切なスキルに委任する

問題のタイプに応じて委任先を決める：

```
ハードコード修正      → dao-impl-checker で検証後に実装
新Proposal型追加     → proposal-type-generator
設計書の実装         → design-executor
コード品質問題       → ln-624-code-quality-auditor
セキュリティ問題     → ln-621-security-auditor
引き継ぎ更新         → incremental-handoff
```

### STEP 5: VERIFY — 不変核が守られているか確認する

実装後に必ず確認：

```bash
# AI自己承認ゲートの存在確認
grep -n "AI_SELF_APPROVAL_PROHIBITED\|ai.*ai" server/src/services/PolicyEngine.ts

# Proposalを経由しているか
grep -n "proposals.*insert\|createProposal" server/src/routes/*.ts

# Ledgerバランスチェック（テスト）
cd server && npm test -- --testPathPattern="ledger|balance" 2>&1 | tail -5
```

全て通ったら実装完了。

### STEP 6: PROPOSE NEXT — 次の改善サイクルを提案する

以下の観点で次のアクションを1〜3個提示する：

1. **今すぐできる小さな改善** (30分以内)
2. **現フェーズで必要な中程度の改善** (半日)
3. **次フェーズへの準備** (将来のための種まき)

---

## 典型的な呼び出しパターン

### パターン1: ハードコード発見時
```
User: accounting.tsに5000円がハードコードされてる

Director:
  ASSESS → 該当箇所を全列挙
  CLASSIFY → 可変（PolicyEngine経由にすべき）
  DECIDE → A-0フェーズ: policiesテーブルに移す
  DIRECT → dao-impl-checker で設計確認 → 実装
  VERIFY → ゲート健在を確認
  NEXT → ocrService.tsの同様箇所も修正
```

### パターン2: 次の改善を問われた時
```
User: 次何を改善すべき？

Director:
  ASSESS → git statusと既知の技術的負債を確認
  CLASSIFY → どれが不変核に近いか
  DECIDE → 現フェーズA-0の優先順位
  → 提案: PolicyEngineのorg_idをenv変数化(30分)
```

### パターン3: 設計判断が必要な時
```
User: 新しい承認フローを追加したい

Director:
  CLASSIFY → Proposalを経由するか？必須
  DECIDE → 現フェーズで必要な最小形は何か
  DIRECT → proposal-type-generator で型生成
  VERIFY → AI自己承認チェックが含まれるか
```

---

## 設計哲学（50字版）

> DESIGN_PHILOSOPHY.mdは縮んでいくべきドキュメント。
> 原則がコード・ポリシーに落ちるたびに1行消す。
> 最後に残るのは3行の不変核だけ。
