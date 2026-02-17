/**
 * Gmail Watch セットアップスクリプト
 *
 * 使用方法:
 *   npx ts-node src/scripts/setup-gmail-watch.ts
 *
 * 前提条件:
 *   - .envファイルにGoogle認証情報が設定されていること
 *   - Google Cloud Pub/Subのトピックが作成されていること
 *   - Gmail APIが有効化されていること
 */

import 'dotenv/config';
import { createGmailWatcher } from '../services/GmailWatcher';

async function main() {
  console.log('==================================================');
  console.log('GENBA QUEST - Gmail Watch セットアップ');
  console.log('==================================================\n');

  // 環境変数チェック
  console.log('[1/3] 環境変数を確認中...');
  const requiredEnvVars = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REFRESH_TOKEN',
    'GOOGLE_PUBSUB_TOPIC'
  ];

  const missingVars = requiredEnvVars.filter(v => !process.env[v]);
  if (missingVars.length > 0) {
    console.error('❌ 以下の環境変数が設定されていません:');
    missingVars.forEach(v => console.error(`   - ${v}`));
    console.error('\n.envファイルを確認してください。');
    console.error('詳細: server/docs/GMAIL_SETUP.md を参照\n');
    process.exit(1);
  }

  console.log('✅ 環境変数OK');
  console.log(`   Topic: ${process.env.GOOGLE_PUBSUB_TOPIC}\n`);

  // GmailWatcher初期化
  console.log('[2/3] GmailWatcherを初期化中...');
  let watcher;
  try {
    watcher = createGmailWatcher();
    console.log('✅ GmailWatcher初期化成功\n');
  } catch (error: any) {
    console.error('❌ GmailWatcher初期化エラー:', error.message);
    process.exit(1);
  }

  // Watch開始
  console.log('[3/3] Gmail監視を開始中...');
  try {
    await watcher.setupWatch('me');
    console.log('✅ Gmail監視を開始しました\n');

    console.log('==================================================');
    console.log('✅ セットアップ完了');
    console.log('==================================================\n');
    console.log('📝 次のステップ:');
    console.log('   1. サーバーを起動: npm run dev');
    console.log('   2. テストメールを送信して動作確認');
    console.log('   3. 7日後にWatchを更新するCron Jobを設定\n');
    console.log('詳細: server/docs/GMAIL_SETUP.md を参照\n');

  } catch (error: any) {
    console.error('❌ Watch開始エラー:', error.message);
    console.error('\n考えられる原因:');
    console.error('   - Refresh Tokenが無効または期限切れ');
    console.error('   - Pub/Sub Topicが存在しないか権限不足');
    console.error('   - Gmail APIが有効化されていない\n');
    console.error('トラブルシューティング: server/docs/GMAIL_SETUP.md セクション12を参照\n');
    process.exit(1);
  }
}

main();
