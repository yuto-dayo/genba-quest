/**
 * system_config の gmail_history_id を修正
 */

import 'dotenv/config';
import { supabaseAdmin } from '../lib/supabaseAdmin';

async function main() {
  console.log('gmail_history_id を修正中...');

  // 現在の値を確認
  const { data: current } = await supabaseAdmin
    .from('system_config')
    .select('*')
    .eq('key', 'gmail_history_id')
    .single();

  console.log('現在の値:', current);

  // 正しいhistoryIdに更新（setupWatch時に保存された1213を使用）
  const { data, error } = await supabaseAdmin
    .from('system_config')
    .update({
      value: '1213',
      updated_at: new Date().toISOString()
    })
    .eq('key', 'gmail_history_id')
    .select()
    .single();

  if (error) {
    console.error('❌ エラー:', error);
    process.exit(1);
  }

  console.log('✅ 更新完了:', data);
}

main();
