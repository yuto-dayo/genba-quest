/**
 * 書類分類サービス (Document Classifier)
 *
 * OCRテキストから建設業書類のタイプを判定し、適切なハンドラーにルーティング。
 * Claude Haiku 3 で低コスト処理、confidence < 70 で Sonnet へエスカレーション。
 *
 * @see .claude/skills/document-classifier/SKILL.md
 */

import Anthropic from "@anthropic-ai/sdk";

// ============================================================
// Types
// ============================================================

export type DocumentType =
  | "order"            // 注文書・発注書
  | "quotation"        // 見積書（受領）
  | "estimate_request" // 見積依頼（作成依頼）
  | "invoice"          // 請求書
  | "delivery_slip"    // 納品書
  | "change_order"     // 変更指示書
  | "drawing"          // 図面
  | "unknown";         // 判別不能

export interface ClassificationResult {
  type: DocumentType;
  confidence: number;  // 0-100
  reasoning: string;
  extracted_data: ExtractedData;
  model_used: "haiku" | "sonnet";
}

// 抽出データの型定義
export interface OrderData {
  site_name?: string;
  client_name?: string;
  contact_person?: string;
  period?: {
    start_date?: string;  // YYYY-MM-DD
    end_date?: string;
    duration_months?: number;
  };
  amount?: {
    value: number;
    tax_included: boolean | null;
  };
  work_types?: string[];
  order_number?: string;
}

export interface QuotationData {
  vendor_name?: string;
  site_name?: string;
  amount?: { value: number; tax_included: boolean | null };
  valid_until?: string;
  quotation_number?: string;
}

export interface EstimateRequestData {
  requester_name?: string;
  site_name?: string;
  response_deadline?: string;
  has_drawings?: boolean;
}

export interface InvoiceData {
  vendor_name?: string;
  amount?: { value: number; tax_included: boolean | null };
  due_date?: string;
  invoice_number?: string;
  bank_info?: string;
}

export interface DeliverySlipData {
  vendor_name?: string;
  site_name?: string;
  delivery_date?: string;
  items?: string[];
  slip_number?: string;
}

export interface ChangeOrderData {
  site_name?: string;
  change_type?: "addition" | "modification" | "cancellation";
  description?: string;
  amount_change?: number;
}

export interface DrawingData {
  drawing_number?: string;
  site_name?: string;
  created_date?: string;
  scale?: string;
}

export type ExtractedData =
  | OrderData
  | QuotationData
  | EstimateRequestData
  | InvoiceData
  | DeliverySlipData
  | ChangeOrderData
  | DrawingData
  | Record<string, never>;

// ============================================================
// OCR誤認識対策
// ============================================================

const OCR_CORRECTIONS: Record<string, string[]> = {
  "注文書": ["注文害", "注丈書", "注文言", "注交書"],
  "発注書": ["発洋書", "発注害", "登注書"],
  "見積書": ["見積害", "見積言", "晃積書"],
  "請求書": ["請求害", "請未書", "請求言"],
  "納品書": ["納品害", "納品言", "鋼品書"],
  "図面": ["図而", "図百", "囲面"],
  "工期": ["工朗", "工斯"],
  "金額": ["金頴", "金穎"],
};

function normalizeOcrText(text: string): string {
  let normalized = text;
  for (const [correct, typos] of Object.entries(OCR_CORRECTIONS)) {
    for (const typo of typos) {
      normalized = normalized.replace(new RegExp(typo, "g"), correct);
    }
  }
  return normalized;
}

// ============================================================
// Pre-filtering（API呼び出し削減）
// ============================================================

const SKIP_KEYWORDS = ["パンフレット", "カタログ", "広告", "DM", "年賀", "挨拶", "ご案内"];
const PROCESS_KEYWORDS = ["注文", "発注", "見積", "請求", "納品", "工事", "図面", "工期", "変更", "追加"];

export function shouldProcessDocument(text: string): boolean {
  const normalized = normalizeOcrText(text);

  // スキップキーワードがあれば処理しない
  if (SKIP_KEYWORDS.some(kw => normalized.includes(kw))) {
    return false;
  }

  // 処理キーワードが1つでもあれば処理する
  return PROCESS_KEYWORDS.some(kw => normalized.includes(kw));
}

// ============================================================
// Classification Prompt
// ============================================================

const SYSTEM_PROMPT = `あなたは建設業の書類分類エキスパートです。
20年以上の現場経験を持ち、注文書・見積書・請求書・納品書・図面など
あらゆる建設業書類を正確に分類できます。
OCRで抽出されたテキストには誤認識が含まれる可能性があることを考慮し、
文脈から適切に判断してください。`;

const buildUserPrompt = (ocrText: string): string => `
以下のOCRテキストを分析し、書類タイプと必要情報をJSON形式で出力してください。

## 分類カテゴリ（8種類）

### 1. order (注文書・発注書)
- **キーワード**: 注文書, 発注書, 発注番号, 工事依頼, ご注文, 工事注文, 御発注
- **必須条件**: 金額または工期の記載がある
- **文脈**: 「発注いたします」「ご注文申し上げます」
- **抽出**: site_name, client_name, period, amount, work_types, order_number

### 2. quotation (見積書 - 受領したもの)
- **キーワード**: 見積書, 御見積書, お見積り, 見積金額
- **必須条件**: 金額の記載がある
- **特徴**: 外部業者が作成、有効期限あり
- **文脈**: 「ご提出いたします」「提案申し上げます」
- **抽出**: vendor_name, site_name, amount, valid_until, quotation_number

### 3. estimate_request (見積依頼 - 作成を依頼されたもの)
- **キーワード**: 見積依頼, 見積もりをお願い, お見積り依頼, 見積書作成依頼
- **必須条件**: 金額の記載がない
- **特徴**: 元請や施主からの依頼、図面添付の言及
- **文脈**: 「ご検討ください」「いくらになりますか」「回答をお願い」
- **抽出**: requester_name, site_name, response_deadline, has_drawings

### 4. invoice (請求書)
- **キーワード**: 請求書, 御請求書, ご請求, 請求金額, お支払い, 振込先
- **必須条件**: 請求金額と振込先
- **抽出**: vendor_name, amount, due_date, invoice_number, bank_info

### 5. delivery_slip (納品書)
- **キーワード**: 納品書, 納品明細, 受領書, 納入書
- **特徴**: 品目リスト、数量記載
- **抽出**: vendor_name, site_name, delivery_date, items, slip_number

### 6. change_order (変更指示書・追加発注)
- **キーワード**: 変更指示, 追加工事, 設計変更, 仕様変更, 追加発注
- **特徴**: 既存工事への変更・追加
- **抽出**: site_name, change_type, description, amount_change

### 7. drawing (図面・設計資料)
- **キーワード**: 図面, 設計図, 平面図, 立面図, 配置図, 断面図, S=1/100
- **特徴**: 縮尺記載(S=), 図面番号, 寸法表記(mm, m)
- **抽出**: drawing_number, site_name, created_date, scale

### 8. unknown (判別不能)
- 上記いずれにも該当しない場合
- 会社案内、カタログ、DM等

------

## 判定ルール（優先順位順）

1. **order優先**: 「注文」「発注」+ 金額or工期 → order
2. **invoice優先**: 「請求」+ 金額 + 支払期限/振込先 → invoice
3. **quotation vs estimate_request**:
   - 金額あり + 「提出」「提案」 → quotation
   - 金額なし + 「依頼」「お願い」 → estimate_request
4. **delivery_slip**: 「納品」+ 品目リスト → delivery_slip
5. **change_order**: 「変更」「追加」+ 既存工事への言及 → change_order
6. **drawing**: 縮尺or図面番号が主要内容 → drawing

------

## 出力形式（厳密に守ること）

\`\`\`json
{
  "type": "order" | "quotation" | "estimate_request" | "invoice" | "delivery_slip" | "change_order" | "drawing" | "unknown",
  "confidence": 0〜100,
  "reasoning": "判定理由を1〜2文で",
  "extracted_data": {
    // typeに応じたフィールドのみ
  }
}
\`\`\`

------

## OCRテキスト

"""
${ocrText}
"""
`;

// ============================================================
// Document Classifier
// ============================================================

export class DocumentClassifier {
  private client: Anthropic;
  private haikuModel = "claude-3-haiku-20240307";
  private sonnetModel = "claude-sonnet-4-20250514";
  private confidenceThreshold = 70;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }
    this.client = new Anthropic({ apiKey });
  }

  /**
   * OCRテキストから書類を分類
   */
  async classify(ocrText: string): Promise<ClassificationResult> {
    // 1. OCR誤認識を正規化
    const normalizedText = normalizeOcrText(ocrText);

    // 2. 事前フィルタリング
    if (!shouldProcessDocument(normalizedText)) {
      return {
        type: "unknown",
        confidence: 100,
        reasoning: "業務書類ではないと判断（スキップキーワード検出 or 処理キーワードなし）",
        extracted_data: {},
        model_used: "haiku",
      };
    }

    // 3. Haiku 3 で分類
    const haikuResult = await this.classifyWithModel(normalizedText, this.haikuModel);

    // 4. confidence が低い場合は Sonnet でエスカレーション
    if (haikuResult.confidence < this.confidenceThreshold) {
      console.log(`[DOC_CLASSIFIER] confidence ${haikuResult.confidence} < ${this.confidenceThreshold}, escalating to Sonnet`);
      const sonnetResult = await this.classifyWithModel(normalizedText, this.sonnetModel);
      return { ...sonnetResult, model_used: "sonnet" };
    }

    return { ...haikuResult, model_used: "haiku" };
  }

  /**
   * 指定モデルで分類を実行
   */
  private async classifyWithModel(
    ocrText: string,
    model: string
  ): Promise<Omit<ClassificationResult, "model_used">> {
    try {
      const response = await this.client.messages.create({
        model,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [
          { role: "user", content: buildUserPrompt(ocrText) }
        ],
      });

      const content = response.content[0];
      if (content.type !== "text") {
        throw new Error("Unexpected response type");
      }

      // JSONブロックを抽出
      let jsonStr = content.text;
      const jsonMatch = content.text.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }

      const parsed = JSON.parse(jsonStr);

      return {
        type: parsed.type || "unknown",
        confidence: parsed.confidence ?? 50,
        reasoning: parsed.reasoning || "理由不明",
        extracted_data: parsed.extracted_data || {},
      };

    } catch (error: any) {
      console.error(`[DOC_CLASSIFIER] Error with model ${model}:`, error.message);

      // エラー時はunknownを返す
      return {
        type: "unknown",
        confidence: 0,
        reasoning: `分類エラー: ${error.message}`,
        extracted_data: {},
      };
    }
  }

  /**
   * 分類結果に基づいてルーティング先を決定
   */
  static getRoutingDestination(result: ClassificationResult): string {
    const routes: Record<DocumentType, string> = {
      order: "quest_proposal",           // クエスト提案
      quotation: "purchase_decision",    // 発注判断キュー
      estimate_request: "estimate_task", // 見積作成タスク
      invoice: "accounting",             // 経理処理
      delivery_slip: "inspection",       // 検収確認
      change_order: "quest_update",      // クエスト更新
      drawing: "document_storage",       // 資料保存
      unknown: "manual_review",          // 手動分類
    };

    return routes[result.type];
  }
}

// ============================================================
// Singleton Export
// ============================================================

let classifierInstance: DocumentClassifier | null = null;

export function getDocumentClassifier(): DocumentClassifier {
  if (!classifierInstance) {
    classifierInstance = new DocumentClassifier();
  }
  return classifierInstance;
}
