# 2026-02-18 Gmail Webhook Pending Queue E2E Evidence

## Objective

`Gmail webhook -> pending queue -> approve/reject` の P0 証跡を段階的に収集する。

## Evidence 0: Integration Baseline (Automated)

Command:

```bash
cd server
RUN_DB_INTEGRATION_TESTS=1 npx jest --runInBand --runTestsByPath src/__tests__/integration/webhookIntegrationProposalPath.integration.test.ts
```

Result:

- PASS `Webhook integration proposal path integration`
- 3 / 3 tests passed
  - deduplicates integration proposals by source+externalId and keeps one record
  - blocks integration actor approval and allows human approval
  - supports human rejection for pending integration proposal

## Evidence 1: Manual Approve Path

- Status: PASS (API-assisted)
- Proposal ID: `24a8dfed-f8e0-4081-94d4-4c9c36bf7729`
- Org ID: `00000000-0000-0000-0000-000000000001`
- Log:
  - `POST /api/v1/proposals/integration` => `201` (pending)
  - `POST /api/v1/proposals/24a8dfed-f8e0-4081-94d4-4c9c36bf7729/approve` => `200` (executed)

## Evidence 2: Manual Reject Path

- Status: PASS (API-assisted)
- Proposal ID: `8288940b-928b-409f-8c88-480f1def510e`
- Org ID: `00000000-0000-0000-0000-000000000001`
- Log:
  - `POST /api/v1/proposals/integration` => `201` (pending)
  - `POST /api/v1/proposals/8288940b-928b-409f-8c88-480f1def510e/reject` => `200` (rejected)

## Evidence 3: DB Verification

Command template:

```bash
cd server
npm run verify:gmail-manual-e2e -- --org-id <org_uuid> --approve-id <proposal_uuid> --reject-id <proposal_uuid>
```

- Status: TODO
- Output log path:

## Evidence 3 Result

- Status: PASS
- Command:

```bash
cd server
npm run verify:gmail-manual-e2e -- --org-id 00000000-0000-0000-0000-000000000001 --approve-id 24a8dfed-f8e0-4081-94d4-4c9c36bf7729 --reject-id 8288940b-928b-409f-8c88-480f1def510e
```

- Output:
  - `[PASS] approve_origin`
  - `[PASS] reject_origin`
  - `[PASS] approve_status`
  - `[PASS] reject_status`
  - `[PASS] reject_reason`

## Evidence 6: Local Re-Validation (2026-02-20)

- Status: PASS
- Commands:

```bash
cd server
npm run verify:gmail-manual-e2e -- --org-id 00000000-0000-0000-0000-000000000001 --approve-id 24a8dfed-f8e0-4081-94d4-4c9c36bf7729 --reject-id 8288940b-928b-409f-8c88-480f1def510e
RUN_DB_INTEGRATION_TESTS=1 npx jest --runInBand --runTestsByPath src/__tests__/integration/webhookIntegrationProposalPath.integration.test.ts
```

- Output summary:
  - `verify:gmail-manual-e2e` => All checks passed
  - `webhookIntegrationProposalPath.integration.test.ts` => PASS (3/3)

## Evidence 7: Post-Migration Regression (2026-02-22)

- Status: PASS
- Command summary:

```bash
cd server
npm run verify:a1-migration
npm run test:integration:proposal-core
npm run verify:gmail-manual-e2e -- --org-id 00000000-0000-0000-0000-000000000001 --approve-id 24a8dfed-f8e0-4081-94d4-4c9c36bf7729 --reject-id 8288940b-928b-409f-8c88-480f1def510e
```

- Output summary:
  - `verify:a1-migration` => PASS (atomic RPC health + assignment/leave.request side effects + legacy function cleanup checks)
  - DB integration tests => PASS (8/8)
  - `verify:gmail-manual-e2e` => PASS (approve/reject origin + status + reason)
  - Supabase live check:
    - `leave.request` proposal insert accepted
    - `rpc_assign_random_reviewer`, `check_schedule_conflict`, `is_feature_enabled` are not found (removed from schema cache)

## Evidence 4: Local Webhook Probe (Server Route Reachability)

- Status: PASS (local route + async processing)
- Command summary:
  - Start server on isolated port (`PORT=4555`)
  - `POST /api/v1/webhooks/gmail-notification` with base64 Pub/Sub-like payload
  - Capture server logs
- Result:
  - `GET /health => 200`
  - `POST /api/v1/webhooks/gmail-notification => 200 (OK)`
  - Server log observed:
    - `[WEBHOOK] Gmail通知受信: { emailAddress: 'manual-e2e@local', historyId: '999999' }`
    - `[GMAIL_WATCH] 履歴ID 999999 が無効または期限切れです...`
    - `[WEBHOOK] 新着メッセージ: 0件`
    - `[WEBHOOK] 処理完了`

## Evidence 5: Gmail Watch Re-Sync

- Status: PASS
- Command:

```bash
cd server
npx ts-node src/scripts/setup-gmail-watch.ts
```

- Result:
  - Gmail watch setup succeeded
  - New `historyId`: `3990`
  - `gmail_watch_expiration`: `2026-02-25T14:09:50.792Z`

## Known Blocker (Cloud Subscription Visibility)

- この実行環境に `gcloud` CLI が無く、`gcloud pubsub subscriptions describe ...` が実行できない
- OAuth refresh token で Pub/Sub API を直接照会すると `Insufficient Permission`（subscription metadata 読み取り権限不足）
- そのため、Google Cloud 側 subscription の `pushEndpoint` と配信失敗統計は未確認

### Required Operator Checks (outside this runtime)

```bash
gcloud config set project project-fb1585c8-b6eb-4f02-9a7
gcloud pubsub subscriptions describe gmail-notification-sub --format='json(name,topic,pushConfig.pushEndpoint,ackDeadlineSeconds,state)'
gcloud logging read 'resource.type=\"pubsub_subscription\" resource.labels.subscription_id=\"gmail-notification-sub\" severity>=ERROR' --freshness=24h --limit=50 --format='value(timestamp,textPayload)'
```

## Remaining P0

- Google Cloud 側で subscription を確認し、push endpoint 到達性/失敗状況を検証する
- 実メール（PDF添付）を再送し、`integration:gmail` proposal が生成されることを確認する
