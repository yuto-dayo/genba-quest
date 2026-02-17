---
name: design-executor
description: 設計書に基づいてステップバイステップで実装を進める専門スキル。設計ドキュメントを読み込み、実装タスクを分解し、進捗管理しながら確実に実装する。
version: 1.0
tags: [implementation, design, project-management]
---

# Design Executor - 設計書実装支援スキル

## 目的

設計書（特に `design-system/` 配下のドキュメント）に基づいて、確実に実装を進める。

## 使用タイミング

- 「設計書通りに実装して」
- 「Phase 1を実装開始」
- 「SEMI_DAO_DESIGN.mdの統合承認ダッシュボードを作って」
- 「次のフェーズに進んで」

## 実行内容

### 1. 設計書の読み込みと理解

```bash
# 設計書を読み込む
- design-system/*.md を確認
- 実装対象のフェーズを特定
- 依存関係を確認
```

### 2. タスク分解と進捗管理

```typescript
// TodoWriteツールで実装タスクを作成
[
  { content: "DBマイグレーション作成", status: "pending" },
  { content: "API実装", status: "pending" },
  { content: "Frontend実装", status: "pending" },
  { content: "テスト・デバッグ", status: "pending" }
]
```

### 3. ステップバイステップ実装

**各タスクで以下を実行:**

1. **設計書の該当箇所を確認**
   - SQLスキーマ
   - API仕様
   - UI/UXモックアップ

2. **既存コードの確認**
   - 関連ファイルを読み込み
   - パターンを把握
   - 命名規則・スタイルを統一

3. **実装**
   - 設計書のコード例を参考に
   - 既存パターンに合わせる
   - エラーハンドリングを追加

4. **検証**
   - 型チェック
   - ビルド確認
   - 動作確認（必要に応じて）

5. **進捗更新**
   - TodoWrite で完了マーク
   - 次のタスクへ

### 4. 品質チェックリスト

各実装後に確認:

- [ ] 設計書の仕様を満たしているか
- [ ] 既存コードとの一貫性があるか
- [ ] TypeScript型エラーがないか
- [ ] RLSポリシーは適切か
- [ ] エラーハンドリングは十分か
- [ ] ログ出力は適切か
- [ ] コメントは必要最小限か

### 5. 完了レポート

フェーズ完了時に報告:

```markdown
## Phase 1 実装完了レポート

### 実装内容
- ✅ approval_queue テーブル作成
- ✅ unified_approval_view ビュー作成
- ✅ /api/v1/approvals/* エンドポイント実装
- ✅ ApprovalDashboard コンポーネント実装

### テスト結果
- ビルド: ✅ 成功
- 型チェック: ✅ エラーなし
- 手動テスト: ✅ 基本動作確認

### 次のステップ
- Phase 2: AI自動提案エンジンの実装準備
- 残課題: [なし]
```

## 実装ガイドライン

### SQL実装

```sql
-- 1. 既存スキーマを確認
\d+ existing_table

-- 2. マイグレーションファイル作成
-- server/sql/009_xxx.sql

-- 3. RLSポリシーを必ず追加

-- 4. インデックス作成を忘れない
```

### API実装

```typescript
// 1. 既存ルーターを参考に
// server/src/routes/existing.ts

// 2. 認証ミドルウェア必須
router.use(requireAuth);

// 3. エラーハンドリング統一
try {
  // 処理
} catch (error: any) {
  return res.status(500).json({ error: error.message });
}

// 4. ログ出力
console.log('[FEATURE] アクション:', data);
```

### Frontend実装

```typescript
// 1. 既存コンポーネントのスタイルを踏襲
// frontend/src/components/Existing.tsx

// 2. CSS Modulesを使用
import styles from './Component.module.css';

// 3. Framer Motionでアニメーション
import { motion, AnimatePresence } from 'framer-motion';

// 4. エラーステートを必ず実装
const [error, setError] = useState<string | null>(null);
```

## 実装順序の推奨

1. **DB → API → Frontend** の順
2. 各層で動作確認してから次へ
3. 並行作業は避ける（混乱防止）

## トラブルシューティング

### 型エラーが出た場合

```typescript
// 1. api.ts に型定義を追加
export interface NewType {
  // ...
}

// 2. 既存パターンを参考に
```

### RLSエラーの場合

```sql
-- 1. RLS無効化してテスト（開発時のみ）
ALTER TABLE table_name DISABLE ROW LEVEL SECURITY;

-- 2. ポリシーを確認
SELECT * FROM pg_policies WHERE tablename = 'table_name';

-- 3. 修正後に再有効化
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;
```

### ビルドエラーの場合

```bash
# 1. キャッシュクリア
rm -rf node_modules/.vite
npm run build

# 2. 依存関係の再インストール
npm ci
```

## 使用例

```
User: Phase 1の統合承認ダッシュボードを実装して