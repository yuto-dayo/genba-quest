---
name: document-classifier
description: OCRテキストから書類タイプを自動判定し、適切なハンドラーにルーティング。注文書/見積もり依頼/請求書/図面を判別し、タイプ別にデータ抽出。Claude Haiku 3で低コスト処理。
---

# Document Classifier

OCRテキストから建設業書類のタイプを判定し、必要な情報を抽出するスキル。

## When to Use This Skill

- Gmailから添付PDFを受信したとき
- 手動アップロードされた書類を処理するとき
- 書類を適切なワークフローにルーティングしたいとき

## Document Types (8種類)

| タイプ | 説明 | 優先度 | ルーティング先 |
|-------|------|--------|--------------|
| `order` | 注文書・発注書 | 高 | クエスト提案 |
| `quotation` | 見積書（受領） | 高 | 発注判断キュー |
| `estimate_request` | 見積依頼（作成依頼） | 高 | 見積作成タスク |
| `invoice` | 請求書 | 高 | 経理処理 |
| `delivery_slip` | 納品書 | 中 | 検収確認 |
| `change_order` | 変更指示書・追加発注 | 高 | クエスト更新 |
| `drawing` | 図面・設計資料 | 低 | 資料保存 |
| `unknown` | 判別不能 | - | 手動分類 |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Document Input                        │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│              OCR Service (Google Vision API)            │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│            Document Classifier (This Skill)             │
├─────────────────────────────────────────────────────────┤
│ 1. OCR誤認識の正規化                                     │
│ 2. キーワード事前フィルタ                                │
│ 3. Claude Haiku 3 で分類 + データ抽出                    │
│ 4. confidence < 70 → Sonnet へエスカレーション           │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                    Router Service                        │
└─────────────────────────────────────────────────────────┘
```

## Response Schema

```typescript
interface ClassificationResult {
  type: DocumentType;
  confidence: number;  // 0-100
  reasoning: string;
  extracted_data: ExtractedData;
}

type DocumentType = 
  | 'order'           // 注文書
  | 'quotation'       // 見積書（受領）
  | 'estimate_request'// 見積依頼（作成依頼）
  | 'invoice'         // 請求書
  | 'delivery_slip'   // 納品書
  | 'change_order'    // 変更指示書
  | 'drawing'         // 図面
  | 'unknown';

interface OrderData {
  site_name?: string;
  client_name?: string;
  contact_person?: string;
  period?: {
    start_date?: string;  // YYYY-MM-DD
    end_date?: string;
    duration_months?: number;  // 「3ヶ月」等の場合
  };
  amount?: {
    value: number;
    tax_included: boolean;
  };
  work_types?: string[];
  order_number?: string;
}

interface QuotationData {
  vendor_name?: string;
  site_name?: string;
  amount?: { value: number; tax_included: boolean };
  valid_until?: string;
  quotation_number?: string;
}

interface InvoiceData {
  vendor_name?: string;
  amount?: { value: number; tax_included: boolean };
  due_date?: string;
  invoice_number?: string;
  bank_info?: string;
}

interface DeliverySlipData {
  vendor_name?: string;
  site_name?: string;
  delivery_date?: string;
  items?: string[];
  slip_number?: string;
}

interface ChangeOrderData {
  site_name?: string;
  change_type?: 'addition' | 'modification' | 'cancellation';
  description?: string;
  amount_change?: number;
}
```

## OCR誤認識対策

OCRは誤認識が多いため、前処理で正規化する。

```typescript
const OCR_CORRECTIONS: Record<string, string[]> = {
  '注文書': ['注文害', '注丈書', '注文言', '注交書'],
  '発注書': ['発洋書', '発注害', '登注書'],
  '見積書': ['見積害', '見積言', '晃積書'],
  '請求書': ['請求害', '請未書', '請求言'],
  '納品書': ['納品害', '納品言', '鋼品書'],
  '図面': ['図而', '図百', '囲面'],
};

function normalizeOcrText(text: string): string {
  let normalized = text;
  for (const [correct, typos] of Object.entries(OCR_CORRECTIONS)) {
    for (const typo of typos) {
      normalized = normalized.replace(new RegExp(typo, 'g'), correct);
    }
  }
  return normalized;
}
```

## 工期・金額抽出パターン

### 工期パターン

```typescript
const PERIOD_PATTERNS = [
  // 「工期：2024年3月1日〜2024年5月31日」
  /工期[：:]\s*(\d{4})年(\d{1,2})月(\d{1,2})日[〜~ー－-](\d{4})年(\d{1,2})月(\d{1,2})日/,
  
  // 「着工：2024/03/01 完工：2024/05/31」
  /着工[：:]\s*(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2}).*完工[：:]\s*(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/,
  
  // 「自 令和6年3月1日 至 令和6年5月31日」
  /自\s*(.+?)\s*至\s*(.+)/,
  
  // 「工事期間 3ヶ月」
  /工[事期][期間]*[：:]?\s*(\d+)\s*[ヶケか]?月/,
  
  // 「2024/03/01-2024/05/31」
  /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})[〜~ー－-](\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,
];
```

### 金額パターン

```typescript
const AMOUNT_PATTERNS = [
  // 「請負金額 5,500,000円（税込）」
  /(?:請負|契約|合計|発注|見積)?金額[：:]?\s*[￥¥]?([\d,]+)円?\s*[（(]?(税[込抜])[）)]?/,
  
  // 「¥5,500,000-」
  /[￥¥]\s*([\d,]+)[-ー]?/,
  
  // 「金 5,500,000 円也」
  /金\s*([\d,]+)\s*円[也]?/,
];
```

## 判定フローチャート

```
START
  │
  ├─ 「注文」「発注」+ 金額/工期あり → order
  │
  ├─ 「見積書」+ 金額あり + 自社宛 → quotation (受領)
  │
  ├─ 「見積」+ 金額なし + 「お願い」「依頼」 → estimate_request
  │
  ├─ 「請求書」+ 金額 + 支払期限 → invoice
  │
  ├─ 「納品書」+ 品目リスト → delivery_slip
  │
  ├─ 「変更」「追加」+ 工事関連 → change_order
  │
  ├─ 図面番号/縮尺が主要 → drawing
  │
  └─ 上記該当なし → unknown
```

## 見積書 vs 見積依頼の判定

| 判定キー | 見積書 (quotation) | 見積依頼 (estimate_request) |
|---------|-------------------|---------------------------|
| 金額記載 | ✅ あり | ❌ なし |
| 作成者 | 外部業者 | 自社または元請 |
| 語調 | 「提出」「ご提案」 | 「お願い」「ご検討」 |
| 有効期限 | 記載あり | 回答期限あり |

## コスト最適化

### Pre-filtering

```typescript
const SKIP_KEYWORDS = ['パンフレット', 'カタログ', '広告', 'DM', '年賀', '挨拶'];
const PROCESS_KEYWORDS = ['注文', '発注', '見積', '請求', '納品', '工事', '図面', '工期', '変更'];

function shouldProcess(text: string): boolean {
  const normalized = normalizeOcrText(text);
  if (SKIP_KEYWORDS.some(kw => normalized.includes(kw))) return false;
  return PROCESS_KEYWORDS.some(kw => normalized.includes(kw));
}
```

### Model Selection

| シナリオ | モデル | 理由 |
|---------|--------|------|
| 通常分類 | Haiku 3 | 最安 |
| confidence < 70 | Sonnet 4 | 高精度再判定 |

## Cost Estimation

| 月間処理量 | Haiku 3 | 事前フィルタ適用 |
|-----------|---------|----------------|
| 100件 | ¥18 | ¥10 |
| 500件 | ¥90 | ¥50 |
| 1,000件 | ¥180 | ¥100 |

## Related Skills

- `invoice-organizer` - 請求書整理
- `accounting-sherpa` - 経理操作支援
