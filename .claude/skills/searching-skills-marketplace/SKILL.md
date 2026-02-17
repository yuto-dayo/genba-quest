---
name: searching-skills-marketplace
description: Use this skill when searching for Claude Code skills from marketplaces, finding and installing community skills, discovering new agent capabilities, or browsing skill registries. This includes searching skillsmp.com, claudecodemarketplace.net, claudebase.com, and installagentskills.com for skills by keyword, category, or functionality.
---

# Skills Marketplace Search

Claude Code スキルを様々なマーケットプレイスから検索・インストールするためのスキル。

# Available Marketplaces

## 1. SkillsMP (推奨)
- **URL**: https://skillsmp.com
- **特徴**: 117,000+ スキル、セマンティック検索対応
- **標準**: SKILL.md フォーマット準拠

## 2. Claude Code Marketplace
- **URL**: https://claudecodemarketplace.net
- **特徴**: コミュニティキュレーション、毎時更新

## 3. claudeBase
- **URL**: https://claudebase.com
- **特徴**: 2,000+ プラグイン・スキル、4.9/5 評価

## 4. Install Agent Skills
- **URL**: https://installagentskills.com
- **特徴**: セキュリティチェック、リスクスコアリング

# Step-by-Step Instructions

## 1. 要件の確認

ユーザーに以下を確認:
- 探しているスキルの機能・目的
- キーワード（例: "testing", "deployment", "documentation"）
- カテゴリ（例: architecture, security, data-science）
- 個人用（~/.claude/skills/）かプロジェクト用（.claude/skills/）か

## 2. マーケットプレイスの検索

### SkillsMP での検索

```bash
# WebFetch でスキル検索
# URL パターン: https://skillsmp.com/search?q={keyword}
```

**Node.js 検索スクリプト:**

```javascript
#!/usr/bin/env node
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function searchSkillsMP(query) {
  const searchUrl = `https://skillsmp.com/api/search?q=${encodeURIComponent(query)}`;
  console.log(`Searching: ${searchUrl}`);
  // Use WebFetch tool to retrieve results
}

const query = process.argv[2] || 'testing';
searchSkillsMP(query);
```

### Claude Code Marketplace での検索

```bash
# API エンドポイント
# https://claudecodemarketplace.net/api/marketplace/skills
```

## 3. スキルの評価

検索結果から以下を確認:

- **名前**: gerund 形式 (verb + -ing) か
- **説明**: 明確でトリガーキーワードを含むか
- **評価/ダウンロード数**: コミュニティの評価
- **更新日**: 最近メンテナンスされているか
- **依存関係**: 必要な CLI ツールやパッケージ

**評価チェックリスト:**
- [ ] SKILL.md が YAML フロントマターを持つ
- [ ] 説明が具体的で invocation-focused
- [ ] 実行可能な指示を含む
- [ ] 支援ファイルが意図を表す名前を持つ

## 4. スキルのインストール

### 手動インストール（推奨）

```bash
# プロジェクト用スキル
mkdir -p .claude/skills/skill-name
# SKILL.md と支援ファイルをダウンロード

# 個人用スキル
mkdir -p ~/.claude/skills/skill-name
```

### Claude Code Marketplace 経由

```bash
# インストールコマンド
/plugin marketplace add https://claudecodemarketplace.net/api/marketplace/skills/{skill-id}
```

### Git Clone 方式

```bash
# GitHub からスキルセットをクローン
git clone https://github.com/{owner}/{repo} /tmp/skills-repo
cp -r /tmp/skills-repo/skills/{skill-name} ~/.claude/skills/
```

## 5. インストール後の検証

```bash
# スキル構造の確認
ls -la ~/.claude/skills/{skill-name}/

# SKILL.md の検証
head -20 ~/.claude/skills/{skill-name}/SKILL.md

# 名前と説明の確認
grep -A 2 "^---" ~/.claude/skills/{skill-name}/SKILL.md | head -5
```

# Examples

## Example 1: テスト関連スキルの検索

**User Query**: "テストプランナーのスキルを探して"

**Approach**:
1. SkillsMP で "test planning" を検索
2. 結果からテスト関連スキルを評価
3. 適切なスキルを ~/.claude/skills/ にインストール

**Search Keywords**:
- "test planning"
- "testing automation"
- "pytest configuration"
- "regression testing"

## Example 2: セキュリティ監査スキルの検索

**User Query**: "セキュリティ監査のスキルがほしい"

**Approach**:
1. 複数のマーケットプレイスで "security audit" を検索
2. セキュリティチェック・脆弱性検出系のスキルを比較
3. リスクスコアを確認してインストール

**Search Keywords**:
- "security audit"
- "vulnerability scanning"
- "dependency check"
- "secrets detection"

## Example 3: アーキテクチャ分析スキルの検索

**User Query**: "Clean Architecture のスキルある？"

**Approach**:
1. "architecture", "clean architecture", "layer boundary" で検索
2. パターン分析系スキルを評価
3. プロジェクトに合うものを選択

# Popular Skill Categories

| カテゴリ | 検索キーワード |
|---------|---------------|
| テスト | testing, pytest, jest, coverage |
| セキュリティ | security, audit, vulnerability |
| アーキテクチャ | architecture, patterns, layers |
| ドキュメント | documentation, readme, api-docs |
| デプロイメント | deployment, ci-cd, docker |
| コード品質 | quality, lint, complexity |
| データ | data, csv, json, analytics |
| AI/ML | machine-learning, llm, embeddings |

# CLI Tools to Leverage

**Essential:**
- `gh` - GitHub からスキルリポジトリをクローン
- `curl` - マーケットプレイス API への直接リクエスト
- `jq` - JSON レスポンスの解析

**Example API Call:**

```bash
# SkillsMP API 検索（例）
curl -s "https://skillsmp.com/api/skills?category=testing&limit=10" | jq '.skills[] | {name, description, downloads}'
```

# Best Practices

1. **複数マーケットプレイスを比較**: 同じ機能でも品質が異なる
2. **セキュリティスコアを確認**: installagentskills.com のリスク評価を参照
3. **更新頻度を確認**: 放置されたスキルは避ける
4. **SKILL.md を読む**: インストール前に内容を確認
5. **ローカルで検証**: インストール後にテスト実行

# Troubleshooting

## Issue: スキルが見つからない

**Symptoms**: 検索結果が空

**Investigation**:
- キーワードを変えて検索
- 別のマーケットプレイスを試す
- GitHub で直接検索

```bash
# GitHub 検索
gh search repos "claude code skills {keyword}"
```

## Issue: インストール後にスキルが認識されない

**Symptoms**: `/skill` コマンドでリストに出ない

**Investigation**:
```bash
# ディレクトリ構造を確認
ls -la ~/.claude/skills/

# SKILL.md の存在確認
ls ~/.claude/skills/*/SKILL.md
```

**Solution**: SKILL.md がルートディレクトリに存在することを確認

# Related Resources

- **Official Docs**: https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview.md
- **Best Practices**: https://docs.claude.com/en/docs/agents-and-tools/agent-skills/best-practices.md
- **Skill Builder**: `./skill-builder/SKILL.md` でスキル作成方法を参照
