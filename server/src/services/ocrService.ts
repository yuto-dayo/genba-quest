/**
 * OCR解析サービス
 *
 * ハイブリッド戦略:
 * 1. 画像 → Google Vision API（月1,000枚無料、$1.50/1,000枚）
 * 2. PDF → LLM Vision API（Vision APIはPDF非対応）
 * 3. Vision失敗時 → LLM Visionにフォールバック
 *
 * コスト比較（月1,000枚の場合）:
 * - Vision API: 無料
 * - LLM Vision: $3,000〜15,000
 */

import { getAIProvider, AIProviderName } from "./aiClient";
import { extractTextFromImage, VisionOcrResult, trackUsage } from "./visionOcr";

// ============================================================
// Types
// ============================================================

export interface OcrBlock {
    page: number;
    text: string;
    bbox: { x0: number; y0: number; x1: number; y1: number };
    confidence: number;
}

export interface OcrFieldValue {
    value: string | number;
    confidence: number;
    bbox_refs: number[]; // ocr_blocks のインデックス参照
}

export interface OcrFields {
    total_amount?: OcrFieldValue;
    tax_amount?: OcrFieldValue;
    subtotal?: OcrFieldValue;
    vendor_name?: OcrFieldValue;
    date?: OcrFieldValue;
    items?: Array<{
        name: OcrFieldValue;
        quantity?: OcrFieldValue;
        unit_price?: OcrFieldValue;
        amount?: OcrFieldValue;
    }>;
}

export interface OcrResult {
    ocr_blocks: OcrBlock[];
    ocr_fields: OcrFields;
    raw_text: string;
    provider: AIProviderName;
}

export interface OcrOptions {
    provider?: AIProviderName;
    forceVision?: boolean;  // 強制的にGoogle Vision APIを使用
    forceLlm?: boolean;     // 強制的にLLM Visionを使用
}

const AUTH_ERROR_PATTERN = /(api[_\s-]?key|認証情報|credential|is not set|placeholder)/i;

function normalizeErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    if (typeof error === "string") {
        return error;
    }
    return "Unknown error";
}

function isAuthError(error: unknown): boolean {
    return AUTH_ERROR_PATTERN.test(normalizeErrorMessage(error));
}

// ============================================================
// OCR Prompt
// ============================================================

const OCR_PROMPT = `
あなたはレシート・請求書・発注書のOCR解析AIです。
画像から以下の情報を抽出し、JSON形式で返してください。

## 出力形式（厳密に従うこと）

{
  "ocr_blocks": [
    {
      "page": 1,
      "text": "テキスト内容",
      "bbox": { "x0": 0.1, "y0": 0.2, "x1": 0.3, "y1": 0.25 },
      "confidence": 0.95
    }
  ],
  "ocr_fields": {
    "total_amount": { "value": 1234, "confidence": 0.98, "bbox_refs": [0, 1] },
    "tax_amount": { "value": 123, "confidence": 0.95, "bbox_refs": [2] },
    "subtotal": { "value": 1111, "confidence": 0.90, "bbox_refs": [3] },
    "vendor_name": { "value": "店舗名", "confidence": 0.99, "bbox_refs": [4] },
    "date": { "value": "2026-01-31", "confidence": 0.97, "bbox_refs": [5] },
    "items": [
      {
        "name": { "value": "商品名", "confidence": 0.95, "bbox_refs": [6] },
        "quantity": { "value": 1, "confidence": 0.90, "bbox_refs": [7] },
        "unit_price": { "value": 500, "confidence": 0.90, "bbox_refs": [8] },
        "amount": { "value": 500, "confidence": 0.90, "bbox_refs": [9] }
      }
    ]
  },
  "raw_text": "画像全体の読み取りテキスト"
}

## 重要ルール
- bbox は画像に対する相対座標（0.0〜1.0）で表現
- bbox_refs は ocr_blocks 配列のインデックス
- confidence は 0.0〜1.0
- 金額は数値型（文字列ではない）
- 日付は "YYYY-MM-DD" 形式
- 読み取れない項目はnullではなく省略
- 必ず有効なJSONのみを返す（説明文なし）
`;

// ============================================================
// OCR Analysis
// ============================================================

/**
 * ドキュメント画像を解析してOCR結果を返す
 *
 * 処理フロー:
 * 1. 画像（JPEG/PNG/WebP/GIF）→ Google Vision API（コスト最適）
 * 2. PDF → LLM Vision API（Vision APIはPDF非対応）
 * 3. Vision API失敗時 → LLM Visionにフォールバック
 *
 * @param imageBase64 Base64エンコードされた画像データ
 * @param mimeType 画像のMIMEタイプ
 * @param options オプション（プロバイダー指定など）
 */
export async function analyzeDocument(
    imageBase64: string,
    mimeType: string,
    options?: OcrOptions
): Promise<OcrResult> {
    // PDFの場合は直接LLM Visionを使用（Vision APIはPDF非対応）
    const isPdf = mimeType === 'application/pdf' || mimeType.includes('pdf');

    // 強制オプションまたはPDFの場合はLLM使用
    if (options?.forceLlm || isPdf) {
        console.log(`[OCR] LLM Vision使用 (理由: ${isPdf ? 'PDF' : 'forceLlm'})`);
        return analyzeWithLlm(imageBase64, mimeType, options);
    }

    // Google Vision APIを試行
    try {
        console.log('[OCR] Google Vision API使用中...');
        const visionResult = await extractTextFromImage(imageBase64, mimeType);

        // 使用量トラッキング
        const usage = trackUsage();
        console.log(`[OCR] Vision API使用量: ${usage.current}/月 (無料残り: ${usage.freeRemaining})`);

        // VisionResultをOcrResultに変換
        return convertVisionToOcrResult(visionResult);

    } catch (error: any) {
        console.warn('[OCR] Vision API失敗、LLMにフォールバック:', error.message);
        try {
            return analyzeWithLlm(imageBase64, mimeType, options);
        } catch (llmError: any) {
            if (isAuthError(error) && isAuthError(llmError)) {
                throw new Error(
                    `OCRサービスの認証情報が未設定です (Vision: ${normalizeErrorMessage(error)} / LLM: ${normalizeErrorMessage(llmError)})`
                );
            }
            throw llmError;
        }
    }
}

/**
 * Google Vision結果をOcrResult形式に変換
 */
function convertVisionToOcrResult(visionResult: VisionOcrResult): OcrResult {
    const ocr_blocks: OcrBlock[] = visionResult.blocks.map((block, index) => ({
        page: 1,
        text: block.text,
        bbox: block.bbox,
        confidence: block.confidence
    }));

    // 簡易的なフィールド抽出（金額、日付など）
    const ocr_fields = extractFieldsFromText(visionResult.fullText);

    return {
        ocr_blocks,
        ocr_fields,
        raw_text: visionResult.fullText,
        provider: 'gemini' as AIProviderName // Vision APIはGoogleなので
    };
}

/**
 * テキストから主要フィールドを抽出（簡易版）
 */
function extractFieldsFromText(text: string): OcrFields {
    const fields: OcrFields = {};

    // 金額パターン（¥1,234 or 1,234円）
    const amountMatch = text.match(/[¥￥]?\s*([\d,]+)\s*円?/);
    if (amountMatch) {
        const value = parseInt(amountMatch[1].replace(/,/g, ''), 10);
        if (!isNaN(value) && value > 0) {
            fields.total_amount = {
                value,
                confidence: 0.7,
                bbox_refs: []
            };
        }
    }

    // 日付パターン（YYYY/MM/DD or YYYY-MM-DD or 令和X年Y月Z日）
    const datePatterns = [
        /(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})日?/,
        /令和(\d+)年(\d{1,2})月(\d{1,2})日/
    ];

    for (const pattern of datePatterns) {
        const match = text.match(pattern);
        if (match) {
            let year = parseInt(match[1], 10);
            // 令和の場合は西暦に変換
            if (year < 100) {
                year = 2018 + year; // 令和1年 = 2019年
            }
            const month = match[2].padStart(2, '0');
            const day = match[3].padStart(2, '0');

            fields.date = {
                value: `${year}-${month}-${day}`,
                confidence: 0.8,
                bbox_refs: []
            };
            break;
        }
    }

    // 店舗名（最初の行または「様」「御中」の前）
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length > 0) {
        const firstLine = lines[0].trim();
        if (firstLine.length > 0 && firstLine.length < 50) {
            fields.vendor_name = {
                value: firstLine,
                confidence: 0.5,
                bbox_refs: []
            };
        }
    }

    return fields;
}

/**
 * LLM Vision APIでOCR解析（従来の方式）
 */
async function analyzeWithLlm(
    imageBase64: string,
    mimeType: string,
    options?: OcrOptions
): Promise<OcrResult> {
    const provider = getAIProvider(options?.provider);

    const text = await provider.generateWithImage(
        OCR_PROMPT,
        imageBase64,
        mimeType
    );

    // JSONブロックを抽出（```json ... ``` の場合も対応）
    let jsonStr = text;
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
        jsonStr = jsonMatch[1];
    }

    try {
        const parsed = JSON.parse(jsonStr) as Omit<OcrResult, "provider">;
        return {
            ...parsed,
            provider: provider.name,
        };
    } catch (e) {
        console.error("OCR JSON parse error:", e);
        console.error("Raw response:", text);
        // フォールバック
        return {
            ocr_blocks: [],
            ocr_fields: {},
            raw_text: text,
            provider: provider.name,
        };
    }
}

// ============================================================
// Risk Assessment（建設業向け）
// ============================================================

export type RiskLevel = "LOW" | "HIGH";

export interface RiskAssessment {
    level: RiskLevel;
    reasons: string[];
}

export function assessExpenseRisk(
    fields: OcrFields,
    category: string
): RiskAssessment {
    const reasons: string[] = [];
    const totalAmount =
        typeof fields.total_amount?.value === "number"
            ? fields.total_amount.value
            : 0;

    // 材料・工具で30,000円超
    if (
        (category === "material" || category === "tool") &&
        totalAmount > 30000
    ) {
        reasons.push(`${category}で${totalAmount.toLocaleString()}円（30,000円超）`);
    }

    // 食費・交通費で5,000円超
    if ((category === "food" || category === "travel") && totalAmount > 5000) {
        reasons.push(`${category}で${totalAmount.toLocaleString()}円（5,000円超）`);
    }

    // アルコール含む（キーワード検出）
    const rawText = fields.vendor_name?.value?.toString().toLowerCase() || "";
    const itemNames =
        fields.items?.map((i) => i.name.value.toString().toLowerCase()) || [];
    const allText = [rawText, ...itemNames].join(" ");

    if (
        allText.includes("ビール") ||
        allText.includes("酒") ||
        allText.includes("焼酎") ||
        allText.includes("ワイン") ||
        allText.includes("居酒屋")
    ) {
        reasons.push("アルコール含む可能性");
    }

    // 換金性の高い商品
    if (
        allText.includes("商品券") ||
        allText.includes("ギフト") ||
        allText.includes("金券")
    ) {
        reasons.push("換金性の高い商品");
    }

    // 「上様」表記
    const vendorName = fields.vendor_name?.value?.toString() || "";
    if (vendorName.includes("上様") || vendorName.trim() === "") {
        reasons.push("宛名が「上様」または不明");
    }

    return {
        level: reasons.length > 0 ? "HIGH" : "LOW",
        reasons,
    };
}
