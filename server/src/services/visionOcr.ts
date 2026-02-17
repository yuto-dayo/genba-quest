/**
 * Google Cloud Vision OCR サービス
 *
 * コスト最適化戦略:
 * - 月1,000枚まで無料
 * - 1,001〜5,000,000枚: $1.50/1,000枚
 * - LLM Vision（$3-15/1,000枚）より大幅にコスト削減
 *
 * @see https://cloud.google.com/vision/pricing
 */

import { google } from 'googleapis';

// ============================================================
// Types
// ============================================================

export interface VisionOcrBlock {
    text: string;
    confidence: number;
    bbox: {
        x0: number;
        y0: number;
        x1: number;
        y1: number;
    };
}

export interface VisionOcrResult {
    blocks: VisionOcrBlock[];
    fullText: string;
    language: string | null;
    pageCount: number;
}

// ============================================================
// Vision Client
// ============================================================

let visionClient: any = null;

/**
 * Vision APIクライアントを取得（シングルトン）
 *
 * 認証方式（優先順位）:
 * 1. GOOGLE_VISION_API_KEY - APIキー認証（推奨・簡単）
 * 2. OAuth2 - Gmail認証と共有（スコープ追加が必要）
 */
function getVisionClient() {
    if (visionClient) {
        return visionClient;
    }

    // 方式1: APIキー認証（推奨）
    const apiKey = process.env.GOOGLE_VISION_API_KEY || process.env.GOOGLE_API_KEY;
    if (apiKey) {
        console.log('[VISION_OCR] APIキー認証を使用');
        visionClient = google.vision({ version: 'v1', auth: apiKey });
        return visionClient;
    }

    // 方式2: OAuth2認証（Gmail認証と共有）
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

    if (clientId && clientSecret && refreshToken) {
        console.log('[VISION_OCR] OAuth2認証を使用');
        const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
        oauth2Client.setCredentials({ refresh_token: refreshToken });
        visionClient = google.vision({ version: 'v1', auth: oauth2Client });
        return visionClient;
    }

    throw new Error(
        'Vision API認証情報が不足しています。' +
        'GOOGLE_VISION_API_KEY または GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKENを設定してください。'
    );
}

// ============================================================
// OCR Functions
// ============================================================

/**
 * 画像からテキストを抽出（DOCUMENT_TEXT_DETECTION）
 *
 * @param imageBase64 Base64エンコードされた画像
 * @param mimeType 画像のMIMEタイプ（現在は使用しないがインターフェース互換性のため）
 */
export async function extractTextFromImage(
    imageBase64: string,
    _mimeType?: string
): Promise<VisionOcrResult> {
    const vision = getVisionClient();

    try {
        const response = await vision.images.annotate({
            requestBody: {
                requests: [
                    {
                        image: {
                            content: imageBase64
                        },
                        features: [
                            {
                                type: 'DOCUMENT_TEXT_DETECTION',
                                maxResults: 1
                            }
                        ],
                        imageContext: {
                            languageHints: ['ja', 'en']
                        }
                    }
                ]
            }
        });

        const result = response.data.responses?.[0];

        if (!result) {
            return {
                blocks: [],
                fullText: '',
                language: null,
                pageCount: 1
            };
        }

        // エラーチェック
        if (result.error) {
            throw new Error(`Vision API Error: ${result.error.message}`);
        }

        // 全文テキスト
        const fullTextAnnotation = result.fullTextAnnotation;
        const fullText = fullTextAnnotation?.text || '';

        // 言語検出
        const detectedLanguage = fullTextAnnotation?.pages?.[0]?.property?.detectedLanguages?.[0]?.languageCode || null;

        // ブロック抽出（座標付き）
        const blocks: VisionOcrBlock[] = [];
        const pages = fullTextAnnotation?.pages || [];

        for (const page of pages) {
            const pageWidth = page.width || 1;
            const pageHeight = page.height || 1;

            for (const block of page.blocks || []) {
                const blockText = extractBlockText(block);
                const confidence = block.confidence || 0;
                const bbox = normalizeBoundingBox(block.boundingBox, pageWidth, pageHeight);

                if (blockText.trim()) {
                    blocks.push({
                        text: blockText,
                        confidence,
                        bbox
                    });
                }
            }
        }

        console.log(`[VISION_OCR] 抽出完了: ${fullText.length}文字, ${blocks.length}ブロック`);

        return {
            blocks,
            fullText,
            language: detectedLanguage,
            pageCount: pages.length || 1
        };

    } catch (error: any) {
        console.error('[VISION_OCR] エラー:', error.message);
        throw error;
    }
}

/**
 * PDFからテキストを抽出（複数ページ対応）
 *
 * Note: Vision APIは直接PDFをサポートしないため、
 * 呼び出し元でPDFを画像に変換するか、Document AIを使用する必要がある。
 * この関数は画像として渡されたPDFの1ページ目を処理する。
 */
export async function extractTextFromPdf(
    pdfBase64: string
): Promise<VisionOcrResult> {
    // Vision APIはPDFを直接サポートしていないが、
    // 一部のPDFはimageとして処理可能（単一ページの場合）
    // 複数ページPDFの場合はDocument AIを推奨

    console.log('[VISION_OCR] PDF処理を試行中（単一ページとして）');

    try {
        return await extractTextFromImage(pdfBase64);
    } catch (error: any) {
        // PDFが画像として処理できない場合
        if (error.message?.includes('Bad image data')) {
            console.warn('[VISION_OCR] PDFは画像として処理できません。LLM OCRにフォールバック推奨。');
            throw new Error('PDF_NOT_SUPPORTED: Use LLM OCR for PDF files');
        }
        throw error;
    }
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * ブロックからテキストを抽出
 */
function extractBlockText(block: any): string {
    const paragraphs = block.paragraphs || [];
    const texts: string[] = [];

    for (const paragraph of paragraphs) {
        const words = paragraph.words || [];
        const wordTexts: string[] = [];

        for (const word of words) {
            const symbols = word.symbols || [];
            const wordText = symbols.map((s: any) => s.text || '').join('');
            wordTexts.push(wordText);
        }

        texts.push(wordTexts.join(''));
    }

    return texts.join('\n');
}

/**
 * 座標を正規化（0.0〜1.0）
 */
function normalizeBoundingBox(
    boundingBox: any,
    pageWidth: number,
    pageHeight: number
): VisionOcrBlock['bbox'] {
    if (!boundingBox?.vertices || boundingBox.vertices.length < 4) {
        return { x0: 0, y0: 0, x1: 1, y1: 1 };
    }

    const vertices = boundingBox.vertices;
    const x0 = (vertices[0]?.x || 0) / pageWidth;
    const y0 = (vertices[0]?.y || 0) / pageHeight;
    const x1 = (vertices[2]?.x || pageWidth) / pageWidth;
    const y1 = (vertices[2]?.y || pageHeight) / pageHeight;

    return {
        x0: Math.max(0, Math.min(1, x0)),
        y0: Math.max(0, Math.min(1, y0)),
        x1: Math.max(0, Math.min(1, x1)),
        y1: Math.max(0, Math.min(1, y1))
    };
}

// ============================================================
// Cost Tracking (Optional)
// ============================================================

let monthlyUsage = 0;
const FREE_TIER_LIMIT = 1000;

/**
 * 使用量をトラッキング（オプション）
 */
export function trackUsage(): { current: number; freeRemaining: number; estimatedCost: number } {
    monthlyUsage++;

    const freeRemaining = Math.max(0, FREE_TIER_LIMIT - monthlyUsage);
    const billableUnits = Math.max(0, monthlyUsage - FREE_TIER_LIMIT);
    const estimatedCost = (billableUnits / 1000) * 1.5; // $1.50 per 1000 units

    return {
        current: monthlyUsage,
        freeRemaining,
        estimatedCost
    };
}

/**
 * 月次リセット（Cronで毎月1日に呼び出し）
 */
export function resetMonthlyUsage(): void {
    console.log(`[VISION_OCR] 月次使用量リセット: ${monthlyUsage} → 0`);
    monthlyUsage = 0;
}
