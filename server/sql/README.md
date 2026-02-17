# GENBA QUEST - データベーススキーマ

## ファイル構成

| ファイル | 内容 | 行数目安 |
|---------|------|---------|
| `001_core_tables.sql` | コアテーブル（clients, sites, profiles）+ RLS | ~85 |
| `002_badge_system.sql` | バッジシステム + RLS | ~65 |
| `003_accounting_tables.sql` | 経理テーブル + トリガー | ~200 |
| `004_accounting_rls.sql` | 経理RLSポリシー | ~110 |
| `005_accounting_functions.sql` | 請求書採番・承認者割当関数 | ~165 |
| `006_audit_system.sql` | 監査ログ + トリガー | ~90 |
| `007_master_data.sql` | 税区分・勘定科目マスタ + 初期データ | ~90 |

## 実行順序

**必ず番号順に実行してください。** 依存関係があります。

```bash
# Supabase SQL Editor または psql で実行
psql -d your_database -f 001_core_tables.sql
psql -d your_database -f 002_badge_system.sql
psql -d your_database -f 003_accounting_tables.sql
psql -d your_database -f 004_accounting_rls.sql
psql -d your_database -f 005_accounting_functions.sql
psql -d your_database -f 006_audit_system.sql
psql -d your_database -f 007_master_data.sql
```

## 依存関係

```
001_core_tables
    ↓
002_badge_system (auth.users 参照)
    ↓
003_accounting_tables (sites, clients, auth.users 参照)
    ↓
004_accounting_rls (003 のテーブル参照)
    ↓
005_accounting_functions (profiles, accounting_transactions 参照)
    ↓
006_audit_system (accounting_* テーブル参照)
    ↓
007_master_data (accounting_transactions への FK 追加)
```

## 注意事項

- すべてのファイルは冪等性を持つ設計（`IF NOT EXISTS`、`DROP ... IF EXISTS`）
- Supabase 環境では `auth.users` が事前に存在する前提
- 本番環境への適用前にステージング環境でテスト推奨
