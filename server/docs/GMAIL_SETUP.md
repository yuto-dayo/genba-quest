# Gmail自動クエスト生成 - Google Cloud設定手順

## 概要

Gmail API + Pub/Sub を使用して、注文書メールを自動検知し、OCR解析してクエスト提案を生成するシステムのセットアップ手順です。

---

## 前提条件

- Google Cloudアカウント
- Gmailアカウント（組織共通アドレス推奨）
- gcloud CLI インストール済み

---

## 1. Google Cloud Projectの作成

### 1-1. プロジェクト作成

```bash
# プロジェクトID: genba-quest-production (任意に変更可)
gcloud projects create genba-quest-production --name="GENBA QUEST"

# プロジェクトを選択
gcloud config set project genba-quest-production
```

### 1-2. 課金設定

Google Cloud Consoleで課金アカウントを設定してください。
https://console.cloud.google.com/billing

**無料枠内での利用:**
- Gmail API: 無料
- Pub/Sub: 最初の10GBまで無料
- Vision API: 月1,000ページまで無料

---

## 2. APIの有効化

```bash
# Gmail API
gcloud services enable gmail.googleapis.com

# Cloud Pub/Sub API
gcloud services enable pubsub.googleapis.com

# Cloud Vision API (OCR用)
gcloud services enable vision.googleapis.com
```

---

## 3. Pub/Sub Topicの作成

```bash
# Topic作成
gcloud pubsub topics create gmail-notifications

# Topic確認
gcloud pubsub topics list
```

### 3-1. Gmail API Pushの権限付与

```bash
# Gmail API用のサービスアカウントに権限を付与
gcloud pubsub topics add-iam-policy-binding gmail-notifications \
  --member=serviceAccount:gmail-api-push@system.gserviceaccount.com \
  --role=roles/pubsub.publisher
```

---

## 4. Pub/Sub Subscriptionの作成

```bash
# Push Subscriptionを作成（あなたのサーバーのWebhook URLを指定）
gcloud pubsub subscriptions create gmail-notification-sub \
  --topic=gmail-notifications \
  --push-endpoint=https://your-domain.com/api/v1/webhooks/gmail-notification \
  --ack-deadline=10

# 開発環境（ngrokなど）の場合
gcloud pubsub subscriptions create gmail-notification-sub \
  --topic=gmail-notifications \
  --push-endpoint=https://your-ngrok-url.ngrok.io/api/v1/webhooks/gmail-notification \
  --ack-deadline=10
```

---

## 5. OAuth 2.0認証情報の作成

### 5-1. OAuth同意画面の設定

1. https://console.cloud.google.com/apis/credentials/consent にアクセス
2. User Type: **内部** または **外部** を選択
3. アプリ名: `GENBA QUEST Gmail Integration`
4. サポートメール: あなたのメールアドレス
5. スコープ追加:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.metadata`

### 5-2. OAuth 2.0クライアントIDの作成

1. https://console.cloud.google.com/apis/credentials にアクセス
2. **認証情報を作成** → **OAuth 2.0 クライアントID**
3. アプリケーションの種類: **デスクトップアプリ**
4. 名前: `GENBA QUEST Gmail Watcher`
5. 作成後、**Client ID** と **Client Secret** をメモ

---

## 6. Refresh Tokenの取得

### 6-1. OAuth Playgroundを使用

1. https://developers.google.com/oauthplayground/ にアクセス
2. 右上の設定⚙️アイコンをクリック
3. **Use your own OAuth credentials** にチェック
4. 先ほど作成したClient IDとClient Secretを入力
5. Step 1: Select & authorize APIs
   - `https://www.googleapis.com/auth/gmail.readonly` を選択
   - **Authorize APIs** ボタンをクリック
   - Googleアカウントでログイン・許可
6. Step 2: Exchange authorization code for tokens
   - **Exchange authorization code for tokens** ボタンをクリック
   - **Refresh token** が表示される → メモ

---

## 7. 環境変数の設定

`server/.env` ファイルに以下を追加:

```bash
# Google OAuth認証情報
GOOGLE_CLIENT_ID=123456789-abcdefg.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxx
GOOGLE_REFRESH_TOKEN=1//0gxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Pub/Sub Topic
GOOGLE_PUBSUB_TOPIC=projects/genba-quest-production/topics/gmail-notifications

# Project ID
GOOGLE_CLOUD_PROJECT_ID=genba-quest-production
```

---

## 8. Gmail Watchの開始

### 8-1. サーバー起動

```bash
cd server
npm run dev
```

### 8-2. Watch設定API呼び出し

以下のスクリプトを作成して実行:

**`server/src/scripts/setup-gmail-watch.ts`**

```typescript
import { createGmailWatcher } from '../services/GmailWatcher';

async function setupWatch() {
  try {
    const watcher = createGmailWatcher();
    await watcher.setupWatch('me');
    console.log('✅ Gmail監視を開始しました');
  } catch (error) {
    console.error('❌ エラー:', error);
  }
}

setupWatch();
```

実行:

```bash
npx ts-node src/scripts/setup-gmail-watch.ts
```

成功すると:
```
[GMAIL_WATCH] 監視開始: {
  email: 'me',
  historyId: '123456',
  expiration: 2026-02-09T...
}
✅ Gmail監視を開始しました
```

---

## 9. 機能フラグの有効化

Supabaseの `feature_flags` テーブルで機能を有効化:

```sql
UPDATE feature_flags
SET enabled = true, rollout_percentage = 100
WHERE feature_key = 'gmail_auto_quest';
```

または、Supabase Studioから手動で更新してください。

---

## 10. 動作確認

### 10-1. テストメール送信

1. 監視対象のGmailアドレスに注文書PDFを添付したメールを送信
2. 件名に「注文書」または「発注書」を含める

### 10-2. ログ確認

```bash
# サーバーログを監視
cd server
npm run dev

# 期待されるログ:
[WEBHOOK] Gmail通知受信: { emailAddress: 'user@example.com', historyId: '...' }
[WEBHOOK] 新着メッセージ: 1件
[WEBHOOK] 注文書検知: abc123...
[ORDER_PROCESS] 開始: abc123...
[ORDER_PROCESS] PDFダウンロード完了: order.pdf
[ORDER_PROCESS] パース成功: 〇〇ビル改修工事
[ORDER_PROCESS] 提案作成完了: uuid-...
```

### 10-3. Supabase確認

```sql
-- ai_proposalsに自動生成された提案が登録されているか確認
SELECT * FROM ai_proposals
WHERE proposal_type = 'auto_quest'
ORDER BY created_at DESC
LIMIT 5;

-- notificationsに通知が作成されているか確認
SELECT * FROM notifications
WHERE type = 'auto_quest'
ORDER BY created_at DESC;
```

---

## 11. Watchの更新（Cron Job設定）

Gmail Watchは**7日間**で期限切れになるため、定期的に更新する必要があります。

### 11-1. Cron Job設定（Linux/Mac）

```bash
crontab -e
```

以下を追加（毎週金曜日午前3時に実行）:

```
0 3 * * 5 cd /path/to/genba-quest/server && npx ts-node src/scripts/renew-gmail-watch.ts >> /var/log/gmail-watch-renew.log 2>&1
```

### 11-2. 更新スクリプト

**`server/src/scripts/renew-gmail-watch.ts`**

```typescript
import { createGmailWatcher } from '../services/GmailWatcher';

async function renewWatch() {
  try {
    const watcher = createGmailWatcher();
    await watcher.renewWatch();
    console.log(`[${new Date().toISOString()}] ✅ Gmail Watch更新完了`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ 更新エラー:`, error);
    process.exit(1);
  }
}

renewWatch();
```

---

## 12. トラブルシューティング

### 問題: Webhook通知が届かない

**原因1**: Pub/Sub Subscriptionの設定ミス

```bash
# Subscriptionを確認
gcloud pubsub subscriptions describe gmail-notification-sub

# Push Endpointを修正
gcloud pubsub subscriptions update gmail-notification-sub \
  --push-endpoint=https://correct-url.com/api/v1/webhooks/gmail-notification
```

**原因2**: サーバーがHTTPSでない

- Pub/SubはHTTPSエンドポイントのみサポート
- 開発環境ではngrok等を使用してください

```bash
# ngrokでHTTPSトンネル作成
ngrok http 4001
```

### 問題: OCR解析に失敗する

**原因**: Vision APIが有効化されていない

```bash
# Vision API有効化
gcloud services enable vision.googleapis.com
```

### 問題: Watchが7日後に停止する

**対応**: Cron Jobで自動更新を設定してください（セクション11参照）

---

## セキュリティ考慮事項

1. **環境変数の管理**
   - `.env` ファイルは `.gitignore` に追加済み
   - 本番環境では環境変数をSecrets Managerで管理推奨

2. **Webhook認証**
   - 現在は認証なし（Pub/Subからのリクエストのみ想定）
   - 必要に応じてPub/Subのメッセージ署名検証を実装

3. **RLS設定**
   - `system_config`, `feature_flags` は管理者のみアクセス可

---

## コスト見積もり

**無料枠内での運用:**
- 月間注文書メール: 〜100件 → 無料
- OCR処理: 〜100ページ → 無料
- Pub/Sub: データ転送 < 10GB → 無料

**月額コスト**: ¥0（無料枠内）

**超過時の料金:**
- Vision API: $1.50/1,000ページ
- Pub/Sub: $0.40/100万メッセージ

---

## 参考リンク

- [Gmail API Push Notifications](https://developers.google.com/workspace/gmail/api/guides/push)
- [Cloud Pub/Sub Documentation](https://cloud.google.com/pubsub/docs)
- [Cloud Vision API OCR](https://cloud.google.com/vision/docs/ocr)
- [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/)

---

**設定完了日**: 2026-02-02
**次回レビュー**: Phase 0実装完了後
