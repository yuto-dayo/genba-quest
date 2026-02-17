# Document Classification Prompt Template

建設業書類の分類に使用するプロンプトテンプレート（改善版）。

## System Prompt

```
あなたは建設業の書類分類エキスパートです。
20年以上の現場経験を持ち、注文書・見積書・請求書・納品書・図面など
あらゆる建設業書類を正確に分類できます。
OCRで抽出されたテキストには誤認識が含まれる可能性があることを考慮し、
文脈から適切に判断してください。
```

## User Prompt Template

```
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

## 工期の抽出パターン

以下のパターンから工期を抽出してください：

- 「工期：2024年3月1日〜2024年5月31日」
- 「着工：2024/03/01 完工：2024/05/31」
- 「自 令和6年3月1日 至 令和6年5月31日」
- 「工事期間 3ヶ月」→ 期間のみの場合は duration_months を使用
- 「2024/03/01-2024/05/31」

------

## 金額の抽出パターン

以下のパターンから金額を抽出してください：

- 「請負金額 5,500,000円（税込）」
- 「¥5,500,000-」
- 「金 5,500,000 円也」
- 「合計金額 ¥5,500,000（税抜）」

税込/税抜の区別も抽出してください。不明な場合は tax_included: null

------

## 出力形式

```json
{
  "type": "order" | "quotation" | "estimate_request" | "invoice" | "delivery_slip" | "change_order" | "drawing" | "unknown",
  "confidence": 0〜100,
  "reasoning": "判定理由を1〜2文で",
  "extracted_data": {
    // typeに応じたフィールドのみ
  }
}
```

------

## OCRテキスト

"""
{OCR_TEXT}
"""

```

## Example Outputs

### 注文書の例

```json
{
  "type": "order",
  "confidence": 95,
  "reasoning": "「発注書」の記載があり、工期と金額が明記されている。工事内容も具体的。",
  "extracted_data": {
    "site_name": "○○マンション新築工事",
    "client_name": "株式会社△△建設",
    "order_number": "PO-2024-0315",
    "period": {
      "start_date": "2024-03-01",
      "end_date": "2024-05-31"
    },
    "amount": {
      "value": 5500000,
      "tax_included": true
    },
    "work_types": ["内装工事", "設備工事"]
  }
}
```

### 見積書（受領）の例

```json
{
  "type": "quotation",
  "confidence": 90,
  "reasoning": "外部業者からの見積書。金額と有効期限が明記されている。",
  "extracted_data": {
    "vendor_name": "○○資材株式会社",
    "site_name": "△△ビル改修工事",
    "quotation_number": "Q-2024-0128",
    "amount": {
      "value": 1250000,
      "tax_included": false
    },
    "valid_until": "2024-03-15"
  }
}
```

### 見積依頼の例

```json
{
  "type": "estimate_request",
  "confidence": 88,
  "reasoning": "「お見積りをお願いします」との依頼文があり、金額の記載がない。図面添付の言及あり。",
  "extracted_data": {
    "requester_name": "株式会社○○不動産",
    "site_name": "△△ビル改修工事",
    "response_deadline": "2024-02-15",
    "has_drawings": true
  }
}
```

### 請求書の例

```json
{
  "type": "invoice",
  "confidence": 95,
  "reasoning": "「請求書」の記載と請求金額、支払期限、振込先が明記されている。",
  "extracted_data": {
    "vendor_name": "○○資材株式会社",
    "invoice_number": "INV-2024-0123",
    "amount": {
      "value": 324500,
      "tax_included": true
    },
    "due_date": "2024-02-28",
    "bank_info": "○○銀行 ○○支店 普通 1234567"
  }
}
```

### 納品書の例

```json
{
  "type": "delivery_slip",
  "confidence": 85,
  "reasoning": "「納品書」の記載があり、品目と数量のリストが含まれている。",
  "extracted_data": {
    "vendor_name": "○○建材販売",
    "site_name": "△△現場",
    "slip_number": "D-2024-0456",
    "delivery_date": "2024-02-10",
    "items": ["コンパネ 100枚", "単管パイプ 50本", "クランプ 200個"]
  }
}
```

### 変更指示書の例

```json
{
  "type": "change_order",
  "confidence": 82,
  "reasoning": "「追加工事」の依頼があり、既存現場への変更指示。",
  "extracted_data": {
    "site_name": "○○マンション新築工事",
    "change_type": "addition",
    "description": "2階共用部分の照明追加設置",
    "amount_change": 150000
  }
}
```

### 判別不能の例

```json
{
  "type": "unknown",
  "confidence": 25,
  "reasoning": "会社案内パンフレットのようで、業務書類ではない。",
  "extracted_data": {}
}
```

## Usage Notes

- 日付は `YYYY-MM-DD` 形式
- 金額は数値型（カンマなし）、tax_included で税込/税抜を明示
- 抽出できないフィールドは省略
- confidence 70未満は再判定を検討
- OCR誤認識（「注文書」→「注文害」等）は文脈から補正して判断
