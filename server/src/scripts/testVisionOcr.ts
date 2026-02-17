/**
 * Vision OCR テストスクリプト
 *
 * 使用方法:
 *   npx ts-node src/scripts/testVisionOcr.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { extractTextFromImage, trackUsage } from '../services/visionOcr';
import { analyzeDocument } from '../services/ocrService';

// テスト用のシンプルな画像（1x1 白ピクセル PNG）
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

// レシートのサンプルテキスト画像（実際のテストでは本物の画像を使用）
async function testVisionOcrDirect() {
    console.log('\n=== Vision OCR 直接テスト ===\n');

    try {
        const result = await extractTextFromImage(TINY_PNG_BASE64, 'image/png');
        console.log('結果:', {
            fullText: result.fullText || '(空)',
            blockCount: result.blocks.length,
            language: result.language
        });

        const usage = trackUsage();
        console.log('使用量:', usage);

        return true;
    } catch (error: any) {
        console.error('エラー:', error.message);
        return false;
    }
}

async function testHybridOcr() {
    console.log('\n=== ハイブリッドOCR テスト ===\n');

    // 画像の場合 → Vision API使用
    console.log('1. 画像（image/jpeg）の場合:');
    try {
        const result = await analyzeDocument(TINY_PNG_BASE64, 'image/jpeg');
        console.log('   使用プロバイダー:', result.provider);
        console.log('   raw_text:', result.raw_text?.slice(0, 100) || '(空)');
    } catch (error: any) {
        console.error('   エラー:', error.message);
    }

    // PDFの場合 → LLM Vision使用
    console.log('\n2. PDF（application/pdf）の場合:');
    console.log('   → LLM Visionが使用されるはず（スキップ - API呼び出しを節約）');
}

async function main() {
    console.log('========================================');
    console.log('  Google Vision OCR テスト');
    console.log('========================================');

    // 環境変数チェック
    console.log('\n環境変数チェック:');
    console.log('  GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? '✓ 設定済み' : '✗ 未設定');
    console.log('  GOOGLE_CLIENT_SECRET:', process.env.GOOGLE_CLIENT_SECRET ? '✓ 設定済み' : '✗ 未設定');
    console.log('  GOOGLE_REFRESH_TOKEN:', process.env.GOOGLE_REFRESH_TOKEN ? '✓ 設定済み' : '✗ 未設定');

    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REFRESH_TOKEN) {
        console.error('\n❌ Google認証情報が不足しています。.envファイルを確認してください。');
        process.exit(1);
    }

    // テスト実行
    await testVisionOcrDirect();
    await testHybridOcr();

    console.log('\n========================================');
    console.log('  テスト完了');
    console.log('========================================\n');
}

// dotenv読み込み
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

main().catch(console.error);
