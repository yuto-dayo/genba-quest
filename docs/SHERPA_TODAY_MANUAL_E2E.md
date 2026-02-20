# Sherpa -> Today Approval Manual E2E

## Purpose

Sherpa提案作成からToday承認キュー表示、承認/却下までのUI導線を手動確認する。

## Preconditions

- Server: `http://localhost:4001` で起動済み
- Frontend: `http://localhost:5173` で起動済み
- ログイン済み（または開発用認証スキップ設定）
- Proposal API / Sherpa API が利用可能

## Scenario A: Approve Path

1. Sherpaチャットを開く
2. 提案作成モードで以下を入力
   - type: `expense.create`
   - payload: `{ "amount": 12000, "category": "material", "description": "manual e2e approve" }`
   - submit: `true`
3. `提案作成` を実行
4. 成功後に `承認待ちを開く` を押下
5. Today画面で対象Proposal詳細モーダルが自動表示されることを確認
6. `承認` を実行

Expected:

- Sherpa作成Proposalが `pending` として作成される
- Today詳細へ `?proposal=<id>` で遷移し、自動フォーカスされる
- 承認後、status が `approved` または `executed` に遷移する
- エラー表示が出ない

## Scenario B: Reject Path

1. Scenario A の 1-5 を再実行し、新しいProposalを作成
2. 却下理由を入力
3. `却下` を実行

Expected:

- status が `rejected` に遷移する
- 却下理由が履歴に残る
- Todayリストに pending として残らない

## Optional DB Verification

`server` ディレクトリで以下を実行:

```bash
RUN_DB_INTEGRATION_TESTS=1 npx jest --runInBand --runTestsByPath src/__tests__/integration/sherpaProposalApprovalPath.integration.test.ts
```

Expected:

- 2 tests passed
- `AI_SELF_APPROVAL_PROHIBITED` と人間承認/却下の挙動が担保される
