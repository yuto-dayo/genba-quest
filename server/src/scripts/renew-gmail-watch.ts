/**
 * Gmail Watch 更新スクリプト
 *
 * 使用方法:
 *   npx ts-node src/scripts/renew-gmail-watch.ts
 *
 * Cron Job設定例（毎週金曜日午前3時）:
 *   0 3 * * 5 cd /path/to/genba-quest/server && npx ts-node src/scripts/renew-gmail-watch.ts >> /var/log/gmail-watch-renew.log 2>&1
 *
 * 注意:
 *   - Gmail Watchは7日間で期限切れになるため、定期的に更新が必要です
 */

import 'dotenv/config';
import { createGmailWatcher } from '../services/GmailWatcher';

async function main() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Gmail Watch 更新を開始...`);

  try {
    const watcher = createGmailWatcher();
    await watcher.renewWatch();
    console.log(`[${new Date().toISOString()}] ✅ Gmail Watch更新完了`);
    process.exit(0);
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] ❌ 更新エラー:`, error.message);
    console.error('詳細:', error);
    process.exit(1);
  }
}

main();
