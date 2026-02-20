/**
 * Gmail自動クエスト生成の機能フラグを有効化
 *
 * 使用方法:
 *   npx ts-node src/scripts/enable-gmail-feature.ts
 */

import 'dotenv/config';
import { supabaseAdmin } from '../lib/supabaseAdmin';

async function main() {
  console.log('==================================================');
  console.log('Gmail自動クエスト生成 - 機能フラグ有効化');
  console.log('==================================================\n');

  try {
    // 機能フラグを有効化（UPDATE）
    const { data, error } = await supabaseAdmin
      .from('feature_flags')
      .update({
        enabled: true,
        rollout_percentage: 100,
        updated_at: new Date().toISOString()
      })
      .eq('feature_key', 'gmail_auto_quest')
      .select()
      .single();

    if (error) {
      console.error('❌ エラー:', error.message);
      process.exit(1);
    }

    console.log('✅ 機能フラグを有効化しました\n');
    console.log('設定内容:');
    console.log(`  feature_key: ${data.feature_key}`);
    console.log(`  enabled: ${data.enabled}`);
    console.log(`  rollout_percentage: ${data.rollout_percentage}%`);
    console.log(`  description: ${data.description}\n`);

    console.log('==================================================');
    console.log('✅ 設定完了');
    console.log('==================================================\n');
    console.log('📝 次のステップ:');
    console.log('   1. 監視対象のGmailアドレスに注文書PDFを添付したメールを送信');
    console.log('   2. サーバーログで処理状況を確認');
    console.log('   3. Supabaseの proposals テーブルで integration:gmail 起点の提案を確認\n');

  } catch (error: any) {
    console.error('❌ 予期しないエラー:', error);
    process.exit(1);
  }
}

main();
