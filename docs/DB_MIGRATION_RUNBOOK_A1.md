# A-1 DB Migration Runbook (013/014/015/016/017)

最終更新: 2026-02-17
対象: `stg` / `prod`

## 1. 目的

A-1承認フローの原子性と `pending` 用語統一を、全環境で同一挙動に固定する。
加えて `assignment.create` の atomic 実行で副作用（site assignment）が反映される状態にする。

適用対象（順序固定）:

1. `server/sql/013_execute_proposal_atomic.sql`
2. `server/sql/014_approve_proposal_atomic.sql`
3. `server/sql/015_reject_proposal_atomic.sql`
4. `server/sql/016_pending_status_unification.sql`
5. `server/sql/017_execute_atomic_assignment_side_effects.sql`

## 2. 事前条件

- メンテナ担当者を1名に固定（同時適用しない）
- 直前バックアップ（Supabase PITR/スナップショット）を確認
- 影響範囲を共有（approve/reject/execute API を含む）
- GitHub Actions secrets が設定済み:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
- GitHub Actions `server-ci` の `db-integration` は
  `PROPOSAL_RPC_FALLBACK_MODE=disabled` で実行されることを確認
- サーバー環境変数を切り替え可能であること:
  - `PROPOSAL_RPC_FALLBACK_MODE`（既定: `allow` / strict: `disabled`）

## 3. 適用手順（stg）

1. Supabase SQL Editor（stg）で以下を**この順序で**実行
   - `013_execute_proposal_atomic.sql`
   - `014_approve_proposal_atomic.sql`
   - `015_reject_proposal_atomic.sql`
   - `016_pending_status_unification.sql`
   - `017_execute_atomic_assignment_side_effects.sql`
2. 実行ログ（日時/実行者/環境/結果）を記録
3. 以下のSQLで事後検証

```sql
-- status に proposed が残っていないこと
select count(*) as proposed_count
from public.proposals
where status = 'proposed';

-- status 制約が pending を含み proposed を含まないこと
select conname, pg_get_constraintdef(c.oid) as definition
from pg_constraint c
join pg_class t on t.oid = c.conrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
  and t.relname = 'proposals'
  and conname = 'proposals_status_check';

-- 必須RPC関数が存在すること
select proname
from pg_proc
where proname in (
  'execute_proposal_atomic',
  'approve_proposal_atomic',
  'reject_proposal_atomic'
)
order by proname;
```

4. `db-integration` テストを実行
   - GitHub Actions: `.github/workflows/server-ci.yml` の `db-integration`
   - ローカル検証（シークレット設定済み端末のみ）:

```bash
cd server && npm run test:integration
```

   - 追加の自動スモーク（推奨）:

```bash
cd server && npm run verify:a1-migration
```

5. 任意（推奨）: 追加スモーク検証
   - `proposed` が制約で拒否されること
   - `pending` が許可されること
   - `approve/reject/execute` RPC が到達可能であること（`PROPOSAL_NOT_FOUND` 返却）
   - `assignment.create` の execute で `sites.assigned_users` が更新されること
6. `stg` で strict モードを有効化し再検証
   - サーバーに `PROPOSAL_RPC_FALLBACK_MODE=disabled` を設定して再デプロイ
   - 起動ログで `RPC fallback mode=disabled (strict=enabled)` を確認
   - `GET /health` の `proposal_atomic_strict=true` を確認
     - 例: `curl -s https://<stg-server>/health`
   - 可能なら自動検証スクリプトを使用

```bash
cd server && npm run verify:a1-health -- --stg-url https://<stg-server>
```

   - デプロイ後ログで `ATOMIC_RPC_REQUIRED` が急増していないことを確認
   - `approve/reject/execute` API が通常動作し、`ATOMIC_RPC_REQUIRED` が発生しないことを確認

## 4. 適用手順（prod）

1. `stg` で上記検証が全てPASSであることを確認
2. 同一手順・同一順序で `prod` に適用
3. 事後検証SQLを再実行
4. `db-integration` を再実行
5. `prod` でも `PROPOSAL_RPC_FALLBACK_MODE=disabled` を有効化
6. 30分の監視（APIエラー率 / reject・approve失敗率 / `ATOMIC_RPC_REQUIRED` 発生有無）
7. `GET /health` の `proposal_atomic_strict=true` を再確認
   - 可能なら stg/prod をまとめて自動検証

```bash
cd server && npm run verify:a1-health -- --stg-url https://<stg-server> --prod-url https://<prod-server>
```

## 5. 完了判定

- `proposed_count = 0`
- `proposals_status_check` が `draft,pending,approved,rejected,executed` のみ許可
- `server-ci` の `db-integration` がPASS
- `PROPOSAL_RPC_FALLBACK_MODE=disabled` 適用後も approve/reject/execute が正常
- approve/reject/execute API の 5xx 異常増加なし
- `assignment.create` が atomic 経路でも期待どおりに反映される

## 6. ロールバック方針

`016` は `proposed -> pending` のデータ更新を含むため、単純な巻き戻しは行わない。

- 失敗時は即時停止
- 直接手戻しではなく、修正マイグレーション（例: `018_*`）を作成して前進修復する
- 重大障害時のみバックアップ復旧手順を実行

## 7. 実行記録テンプレート

```text
[DB-MIGRATION]
- env: stg|prod
- executor: <name>
- started_at: <timestamp>
- completed_at: <timestamp>
- applied_files: 013,014,015,016,017
- post_checks:
  - proposed_count: <n>
  - status_constraint: PASS|FAIL
  - rpc_exists: PASS|FAIL
  - db_integration: PASS|FAIL
- incident: none|<summary>
```
