---
name: genba-quest-principles
description: コーディング原則とアーキテクチャ方針。DRY/KISS/YAGNI、レイヤー分離、技術的負債の確認に使用
---

# Code Principles - GENBA QUEST

## Core Principles

### 1. DRY (Don't Repeat Yourself)
- ビジネスロジックは一箇所で定義
- フロントエンド/バックエンド間で型定義を共有
- 設定値はハードコードせず集中管理

### 2. KISS (Keep It Simple, Stupid)
- 過度な抽象化を避ける
- 必要になるまで複雑化しない
- 明確で読みやすいコードを優先

### 3. YAGNI (You Aren't Gonna Need It)
- 現在必要な機能のみ実装
- 将来の要件を推測して事前実装しない
- リファクタリングは必要時に行う

## Architecture Principles

### Layer Separation
```
┌─────────────────────────────────────┐
│  Presentation (Routes/Controllers)  │ ← HTTP handling only
├─────────────────────────────────────┤
│  Business Logic (Services)          │ ← Domain rules
├─────────────────────────────────────┤
│  Data Access (Repositories)         │ ← Database operations
└─────────────────────────────────────┘
```

**Current Issues to Address:**
- Routes contain business logic (e.g., accounting.ts: 598 lines)
- Direct Supabase calls in route handlers
- Risk assessment logic duplicated frontend/backend

### Single Responsibility
- 各ファイルは単一の責務を持つ
- 大きなファイル (>300行) は分割を検討
- モジュール間の依存は明示的に

### Configuration Management
- 環境変数で外部設定
- マジックナンバーは定数として定義
- システムプロンプトは設定ファイルに外出し

## Quality Standards

### Code Quality
- TypeScript strict mode
- ESLint rules遵守
- 意図が明確な命名

### Testing (Target)
- ビジネスロジックのユニットテスト
- API エンドポイントの統合テスト
- 重要フローのE2Eテスト

### Security
- 入力値の検証
- RLSポリシーの適切な設定
- 機密情報の環境変数管理

## File Organization

### Frontend
```
frontend/src/
├── components/     # 再利用可能なUIコンポーネント
├── pages/          # ページコンポーネント
├── lib/            # ユーティリティ、API クライアント
├── hooks/          # カスタムフック
└── stores/         # Zustand stores
```

### Backend
```
server/src/
├── routes/         # Express route handlers
├── services/       # Business logic (TO BE EXPANDED)
├── middleware/     # Express middleware
├── repositories/   # Data access (TO BE CREATED)
└── config/         # Configuration (TO BE CREATED)
```

## Known Technical Debt

1. **Layer Mixing**: Routes handle HTTP + business logic + data access
2. **Duplicated Logic**: Risk assessment in frontend and backend
3. **Hardcoded Config**: Perk definitions, system prompts in code
4. **No Tests**: Zero test coverage
5. **Tight Coupling**: Direct Supabase dependency everywhere
