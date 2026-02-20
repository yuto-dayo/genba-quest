# GENBA QUEST - Claude Code Skills

スパゲティコード防止とコード品質維持のためのスキルセット。

## Installed Skills (16)

### Orchestrator
| Skill | Description |
|-------|-------------|
| `ln-620-codebase-auditor` | 9つのワーカーを並列実行する包括的監査 |

### Worker Skills (Architecture)
| Skill | Description |
|-------|-------------|
| `ln-640-pattern-evolution-auditor` | アーキテクチャパターン分析 (4-score model) |
| `ln-642-layer-boundary-auditor` | Clean Architectureレイヤー境界検証 |

### Worker Skills (Code Quality)
| Skill | Description |
|-------|-------------|
| `ln-621-security-auditor` | セキュリティ脆弱性検出 |
| `ln-622-build-auditor` | ビルドエラー・警告検出 |
| `ln-623-code-principles-auditor` | DRY/KISS/YAGNI違反検出 |
| `ln-624-code-quality-auditor` | 循環的複雑度・マジックナンバー検出 |
| `ln-625-dependencies-auditor` | 依存関係・未使用パッケージ分析 |
| `ln-626-dead-code-auditor` | デッドコード・未使用コード検出 |
| `ln-627-observability-auditor` | ログ・メトリクス・トレーシング監査 |
| `ln-628-concurrency-auditor` | 並行処理・レースコンディション検出 |
| `ln-629-lifecycle-auditor` | アプリケーションライフサイクル監査 |

### Standalone Skills
| Skill | Description |
|-------|-------------|
| `ln-501-code-quality-checker` | 軽量な品質チェック（日常使用向け） |
| `ln-502-regression-checker` | リグレッションテスト実行 |
| `ln-510-test-planner` | テスト戦略・計画作成 |

### Data Science / Statistics Skills
| Skill | Description |
|-------|-------------|
| `thompson-sampling-bayesian-bandits` | Multi-Armed Bandit・Thompson Sampling・ベイズバンディットの実装ガイド |

### Utility Skills
| Skill | Description |
|-------|-------------|
| `searching-skills-marketplace` | Claude Code スキルをマーケットプレイスから検索・インストール |
| `directing-handoff-workstreams` | 分割された handoff を横断集計し、次に進めるべき stream を提案 |

---

## Usage Guide

### Daily Development

**コードレビュー前:**
```
/skill ln-501-code-quality-checker
```

**新機能実装前:**
```
/skill ln-642-layer-boundary-auditor
```

### Weekly/Monthly Audits

**包括的コードベース監査:**
```
/skill ln-620-codebase-auditor
```
> 9つのワーカーを並列実行し、統合レポートを生成

**個別監査（必要に応じて）:**
```
/skill ln-621-security-auditor      # セキュリティ
/skill ln-623-code-principles-auditor  # DRY/KISS/YAGNI
/skill ln-625-dependencies-auditor  # 依存関係
/skill ln-626-dead-code-auditor     # デッドコード
```

### Test Planning

**テスト戦略作成:**
```
/skill ln-510-test-planner
```

**リグレッションテスト:**
```
/skill ln-502-regression-checker
```

---

## Recommended Workflow

### 1. Initial Audit (プロジェクト開始時)
```
/skill ln-620-codebase-auditor
```
現状の技術的負債を把握

### 2. Before Each Feature
```
/skill ln-642-layer-boundary-auditor
```
レイヤー違反を事前チェック

### 3. Before PR/Code Review
```
/skill ln-501-code-quality-checker
```
基本的な品質問題を検出

### 4. Before Release
```
/skill ln-621-security-auditor
/skill ln-502-regression-checker
```
セキュリティとリグレッションを確認

---

## Dependencies

These skills expect the following project structure:
```
docs/
├── project/
│   └── tech_stack.md    # Required for stack detection
├── principles.md        # Required for quality standards
└── tasks/
    └── kanban_board.md  # Optional for Linear integration
```

---

## Source
Skills from: [levnikolaevich/claude-code-skills](https://github.com/levnikolaevich/claude-code-skills)

## Also Installed In
- **Project Local**: `.claude/skills/`
- **Antigravity Project Local**: `.agent/skills/` (symlink → `.claude/skills/`)
- **Antigravity Global**: `~/.gemini/antigravity/skills/`
