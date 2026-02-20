# Gmail Webhook -> Pending Queue Manual E2E

## Purpose

`Gmail webhook -> pending queue -> approve/reject` の手動E2Eを実行し、監査可能な証跡を残す。

## Scope

- Webhook受信 (`/api/v1/webhooks/gmail-notification`)
- Integration actor (`integration:gmail`) による Proposal 作成
- Today 画面の pending queue での承認/却下
- 承認後 / 却下後のDB状態確認

## Preconditions

- Server 起動: `http://localhost:4001`
- Frontend 起動: `http://localhost:5173`
- `server/.env` に以下が設定済み
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_REFRESH_TOKEN`
  - `GOOGLE_PUBSUB_TOPIC`
- 機能フラグ有効化:

```bash
cd server
npx ts-node src/scripts/enable-gmail-feature.ts
```

## Automated Baseline (Evidence 0)

手動操作の前に、Webhook下流の統合経路が壊れていないことを確認する。

```bash
cd server
RUN_DB_INTEGRATION_TESTS=1 npx jest --runInBand --runTestsByPath src/__tests__/integration/webhookIntegrationProposalPath.integration.test.ts
```

Expected:

- 3 tests passed
- dedupe / integration actor approval prohibition / human approve+reject が PASS

## Scenario A: Approve Path

1. 監視対象Gmailへ PDF 添付メールを送信する
2. Webhook受信ログを確認する
3. Today の pending queue に対象Proposalが表示されることを確認する
4. 対象Proposalを承認する
5. status が `approved` または `executed` になることを確認する

Expected:

- `created_by.type=integration`, `created_by.id=integration:gmail`
- `payload._integration.source=gmail`
- Today pending queue から承認後に消える

## Scenario B: Reject Path

1. Scenario A と同様に新しいメールで2件目のProposalを発生させる
2. Today の pending queue で対象Proposalを開く
3. 却下理由を入力して却下する
4. status が `rejected` になることを確認する

Expected:

- `rejection_reason` が保存される
- Today pending queue に残らない

## DB Verification (Evidence 1)

手動操作で得た `org_id`, `approve proposal id`, `reject proposal id` を使って検証する。

```bash
cd server
npm run verify:gmail-manual-e2e -- \
  --org-id <org_uuid> \
  --approve-id <approved_or_executed_proposal_uuid> \
  --reject-id <rejected_proposal_uuid>
```

Expected:

- `[PASS] approve_origin`
- `[PASS] reject_origin`
- `[PASS] approve_status`
- `[PASS] reject_status`
- `[PASS] reject_reason`

## Evidence Checklist

- [ ] Webhook受信ログ（`[WEBHOOK] Gmail通知受信`）
- [ ] Proposal作成ログ（proposal id / status / deduplicated）
- [ ] Today pending queue 表示スクリーンショット（承認前）
- [ ] 承認後スクリーンショット（pending queue から消える）
- [ ] 却下後スクリーンショット（pending queue から消える）
- [ ] `verify:gmail-manual-e2e` 実行結果ログ

## Completion Criteria

- Approve path と Reject path を同日中に各1回以上成功
- 収集証跡が `HANDOFF.md` の Completed/Validation に反映されている
