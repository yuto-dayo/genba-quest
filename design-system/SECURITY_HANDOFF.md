# セキュリティ改善 - 引き継ぎドキュメント

**作成日**: 2026-02-02
**引き継ぎ元**: Claude Code セキュリティ監査
**引き継ぎ先**: 開発チーム
**優先度**: HIGH
**想定工数**: 3-4時間

---

## 概要

GENBA QUESTのセキュリティ監査を実施した結果、**8.0/10.0** という良好なスコアを獲得しましたが、3つの改善点が発見されました。本ドキュメントは、これらの改善を実装するための引き継ぎ資料です。

**監査レポート全文**: [design-system/SECURITY_AUDIT_REPORT.md](SECURITY_AUDIT_REPORT.md)

---

## 改善項目サマリー

| 優先度 | 項目 | ファイル | 工数 | 影響範囲 |
|-------|-----|---------|-----|---------|
| **HIGH** | 入力検証の追加 | server/src/routes/sites.ts | M (2h) | POST /api/v1/sites |
| **MEDIUM** | 経費入力検証 | server/src/routes/accounting.ts | M (1h) | POST /api/v1/accounting/expenses |
| **MEDIUM** | CORS設定修正 | server/src/index.ts | S (30min) | 全エンドポイント |

**合計工数**: 3.5時間

---

## タスク1: CORS設定の修正 (優先度: HIGH)

### 現状の問題

**ファイル**: [server/src/index.ts:17-22](../server/src/index.ts#L17-L22)

```typescript
app.use(cors({
    origin: true,  // ← 全てのドメインを許可（セキュリティリスク）
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));
```

**リスク**:
- `origin: true` は全てのドメインからのリクエストを受け入れる
- 本番環境でCSRF攻撃のリスク
- 悪意のあるサイトからのクレデンシャル付きリクエストが可能

### 修正内容

#### 1. 環境変数の追加

**ファイル**: `server/.env.example`

```bash
# 既存の内容に以下を追加
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
```

**ファイル**: `server/.env` (実際の環境変数ファイル)

```bash
# 開発環境
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000

# 本番環境では以下のように設定
# ALLOWED_ORIGINS=https://genba-quest.your-domain.com,https://app.genba-quest.com
```

#### 2. CORS設定の修正

**ファイル**: [server/src/index.ts:17-22](../server/src/index.ts#L17-L22)

**変更前**:
```typescript
app.use(cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));
```

**変更後**:
```typescript
// CORS設定
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
    "http://localhost:5173",  // Vite dev server (デフォルト)
    "http://localhost:3000",  // React dev server (代替)
];

app.use(cors({
    origin: (origin, callback) => {
        // originがundefinedの場合は同一オリジン（例: Postman, curl）なので許可
        if (!origin) {
            callback(null, true);
            return;
        }

        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.warn(`⚠️ CORS blocked: ${origin}`);
            callback(new Error(`CORS policy: Origin ${origin} is not allowed`));
        }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));
```

### テスト方法

1. **サーバーを再起動**:
   ```bash
   cd server
   npm run dev
   ```

2. **正常系テスト**: フロントエンドから通常通りAPIを呼び出せることを確認
   ```bash
   cd frontend
   npm run dev
   # ブラウザで http://localhost:5173 を開き、ログイン・データ取得ができることを確認
   ```

3. **異常系テスト**: 許可されていないオリジンからのリクエストがブロックされることを確認
   ```bash
   curl -H "Origin: https://evil.com" \
        -H "Content-Type: application/json" \
        -X GET http://localhost:4001/api/v1/sites

   # 期待される結果: CORS エラー
   ```

### チェックリスト

- [ ] `.env.example` に `ALLOWED_ORIGINS` を追加
- [ ] `.env` に開発環境のオリジンを設定
- [ ] `server/src/index.ts` のCORS設定を修正
- [ ] サーバー再起動後、フロントエンドから正常にAPI呼び出し可能
- [ ] 不正なオリジンからのリクエストがブロックされることを確認
- [ ] 本番デプロイ前に `ALLOWED_ORIGINS` を本番ドメインに更新

---

## タスク2: POST /sites エンドポイントの入力検証 (優先度: HIGH)

### 現状の問題

**ファイル**: [server/src/routes/sites.ts:45-69](../server/src/routes/sites.ts#L45-L69)

```typescript
router.post("/", async (req: AuthenticatedRequest, res: Response) => {
    const { name, address, area_sqm, work_types, estimated_hours, revenue, client_id } = req.body;

    // 検証なしで直接データベースに挿入
    const { data, error } = await supabaseAdmin
        .from("sites")
        .insert({ name, address, ... })
        .select()
        .single();
```

**リスク**:
- `name` が空文字列でも登録可能
- `area_sqm`, `estimated_hours`, `revenue` に負の値を入れられる
- `work_types` が配列でない場合にエラー
- 異常なデータがデータベースに蓄積される

### 修正内容

#### 1. Joi のインストール

```bash
cd server
npm install joi
npm install --save-dev @types/joi
```

#### 2. バリデーションスキーマの作成

**新規ファイル**: `server/src/validators/siteValidator.ts`

```typescript
import Joi from "joi";

export const createSiteSchema = Joi.object({
  name: Joi.string().min(1).max(200).required()
    .messages({
      'string.empty': '現場名は必須です',
      'string.max': '現場名は200文字以内で入力してください',
      'any.required': '現場名は必須です'
    }),

  address: Joi.string().max(500).optional().allow('', null)
    .messages({
      'string.max': '住所は500文字以内で入力してください'
    }),

  area_sqm: Joi.number().min(0).optional().allow(null)
    .messages({
      'number.min': '面積は0以上の値を入力してください'
    }),

  work_types: Joi.array().items(Joi.string()).optional().allow(null),

  estimated_hours: Joi.number().min(0).optional().allow(null)
    .messages({
      'number.min': '予定工数は0以上の値を入力してください'
    }),

  revenue: Joi.number().min(0).optional().allow(null)
    .messages({
      'number.min': '売上は0以上の値を入力してください'
    }),

  client_id: Joi.string().uuid().optional().allow(null)
    .messages({
      'string.guid': 'クライアントIDの形式が不正です'
    })
});

export const updateSiteSchema = Joi.object({
  name: Joi.string().min(1).max(200).optional(),
  address: Joi.string().max(500).optional().allow('', null),
  area_sqm: Joi.number().min(0).optional().allow(null),
  work_types: Joi.array().items(Joi.string()).optional().allow(null),
  estimated_hours: Joi.number().min(0).optional().allow(null),
  actual_hours: Joi.number().min(0).optional().allow(null),
  revenue: Joi.number().min(0).optional().allow(null),
  status: Joi.string().valid('active', 'completed', 'cancelled').optional()
});
```

#### 3. バリデーションミドルウェアの作成

**新規ファイル**: `server/src/middleware/validation.ts`

```typescript
import { Request, Response, NextFunction } from "express";
import Joi from "joi";

export function validate(schema: Joi.Schema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,  // 全てのエラーを返す
      stripUnknown: true  // スキーマにないフィールドを除去
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      return res.status(400).json({
        error: 'Validation failed',
        details: errors
      });
    }

    // バリデーション済みの値で req.body を上書き
    req.body = value;
    next();
  };
}
```

#### 4. ルーターへの適用

**ファイル**: [server/src/routes/sites.ts](../server/src/routes/sites.ts)

**変更箇所**:

```typescript
// ファイル冒頭にインポートを追加
import { validate } from "../middleware/validation";
import { createSiteSchema, updateSiteSchema } from "../validators/siteValidator";

// POST エンドポイントを修正
router.post("/", validate(createSiteSchema), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { name, address, area_sqm, work_types, estimated_hours, revenue, client_id } = req.body;

        const { data, error } = await supabaseAdmin
            .from("sites")
            .insert({
                name,
                address,
                area_sqm,
                work_types,
                estimated_hours,
                revenue,
                client_id,
                status: "active",
            })
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(data);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// PUT エンドポイントも同様に修正
router.put("/:id", validate(updateSiteSchema), async (req: AuthenticatedRequest, res: Response) => {
    // 既存のコード
});
```

### テスト方法

#### 1. 正常系テスト

```bash
curl -X POST http://localhost:4001/api/v1/sites \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "新宿ビル建設",
    "address": "東京都新宿区1-1-1",
    "area_sqm": 1500,
    "work_types": ["construction", "electrical"],
    "estimated_hours": 320,
    "revenue": 5000000
  }'

# 期待される結果: 201 Created + 作成されたデータ
```

#### 2. 異常系テスト

```bash
# ケース1: name が空
curl -X POST http://localhost:4001/api/v1/sites \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"name": ""}'

# 期待される結果:
# {
#   "error": "Validation failed",
#   "details": [
#     {"field": "name", "message": "現場名は必須です"}
#   ]
# }

# ケース2: 負の値
curl -X POST http://localhost:4001/api/v1/sites \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "テスト現場",
    "area_sqm": -100,
    "revenue": -50000
  }'

# 期待される結果:
# {
#   "error": "Validation failed",
#   "details": [
#     {"field": "area_sqm", "message": "面積は0以上の値を入力してください"},
#     {"field": "revenue", "message": "売上は0以上の値を入力してください"}
#   ]
# }
```

### チェックリスト

- [ ] `npm install joi` 実行
- [ ] `server/src/validators/siteValidator.ts` 作成
- [ ] `server/src/middleware/validation.ts` 作成
- [ ] `server/src/routes/sites.ts` にバリデーション適用
- [ ] 正常系テスト: 正しいデータで登録できる
- [ ] 異常系テスト1: 空の name でエラーが返る
- [ ] 異常系テスト2: 負の値でエラーが返る
- [ ] フロントエンドから正常に現場登録できることを確認

---

## タスク3: POST /accounting/expenses の入力検証 (優先度: MEDIUM)

### 現状の問題

**ファイル**: [server/src/routes/accounting.ts:136-179](../server/src/routes/accounting.ts#L136-L179)

リスク判定ロジックはあるが、入力の型検証がないため、文字列が数値フィールドに入る可能性があります。

### 修正内容

#### 1. バリデーションスキーマの作成

**新規ファイル**: `server/src/validators/expenseValidator.ts`

```typescript
import Joi from "joi";

export const createExpenseSchema = Joi.object({
  cost_center: Joi.string().required()
    .messages({
      'any.required': 'コストセンターは必須です'
    }),

  site_id: Joi.string().uuid().optional().allow(null)
    .messages({
      'string.guid': '現場IDの形式が不正です'
    }),

  vendor_name: Joi.string().max(200).required()
    .messages({
      'string.max': '仕入先名は200文字以内で入力してください',
      'any.required': '仕入先名は必須です'
    }),

  description: Joi.string().max(1000).optional().allow('', null)
    .messages({
      'string.max': '説明は1000文字以内で入力してください'
    }),

  recorded_date: Joi.date().required()
    .messages({
      'date.base': '計上日の形式が不正です',
      'any.required': '計上日は必須です'
    }),

  amount_subtotal: Joi.number().min(0).required()
    .messages({
      'number.base': '税抜金額は数値で入力してください',
      'number.min': '税抜金額は0以上の値を入力してください',
      'any.required': '税抜金額は必須です'
    }),

  tax_amount: Joi.number().min(0).optional().allow(null)
    .messages({
      'number.base': '税額は数値で入力してください',
      'number.min': '税額は0以上の値を入力してください'
    }),

  amount_total: Joi.number().min(0).required()
    .messages({
      'number.base': '合計金額は数値で入力してください',
      'number.min': '合計金額は0以上の値を入力してください',
      'any.required': '合計金額は必須です'
    }),

  category: Joi.string().valid('material', 'tool', 'food', 'travel', 'other').required()
    .messages({
      'any.only': 'カテゴリは material, tool, food, travel, other のいずれかを指定してください',
      'any.required': 'カテゴリは必須です'
    }),

  source_document_id: Joi.string().uuid().optional().allow(null)
    .messages({
      'string.guid': '証憑IDの形式が不正です'
    }),

  input_sources: Joi.array().items(Joi.string()).optional().allow(null)
});
```

#### 2. ルーターへの適用

**ファイル**: [server/src/routes/accounting.ts:136](../server/src/routes/accounting.ts#L136)

```typescript
// ファイル冒頭にインポートを追加
import { validate } from "../middleware/validation";
import { createExpenseSchema } from "../validators/expenseValidator";

// POST エンドポイントを修正
router.post("/expenses", validate(createExpenseSchema), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const {
            cost_center,
            site_id,
            vendor_name,
            description,
            recorded_date,
            amount_subtotal,
            tax_amount,
            amount_total,
            category,
            source_document_id,
            input_sources,
        } = req.body;

        // 既存のリスク判定ロジックはそのまま
        // ...
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});
```

### テスト方法

```bash
# 正常系
curl -X POST http://localhost:4001/api/v1/accounting/expenses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "cost_center": "CC001",
    "vendor_name": "山田商店",
    "recorded_date": "2026-02-01",
    "amount_subtotal": 10000,
    "tax_amount": 1000,
    "amount_total": 11000,
    "category": "material"
  }'

# 異常系: 数値に文字列
curl -X POST http://localhost:4001/api/v1/accounting/expenses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "cost_center": "CC001",
    "vendor_name": "山田商店",
    "recorded_date": "2026-02-01",
    "amount_total": "高い",
    "category": "material"
  }'

# 期待される結果: "amount_total は数値で入力してください"
```

### チェックリスト

- [ ] `server/src/validators/expenseValidator.ts` 作成
- [ ] `server/src/routes/accounting.ts` にバリデーション適用
- [ ] 正常系テスト: 正しいデータで登録できる
- [ ] 異常系テスト: 文字列が数値フィールドに入るとエラー
- [ ] フロントエンドから正常に経費登録できることを確認

---

## 追加の推奨事項（オプション）

### helmet によるセキュリティヘッダー追加

**工数**: S (30分)

```bash
cd server
npm install helmet
```

**ファイル**: `server/src/index.ts`

```typescript
import helmet from "helmet";

// CORS設定の後に追加
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
  },
}));
```

### Rate Limiting

**工数**: S (30分)

```bash
cd server
npm install express-rate-limit
```

**ファイル**: `server/src/index.ts`

```typescript
import rateLimit from "express-rate-limit";

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分
  max: 100, // 最大100リクエスト
  message: "リクエストが多すぎます。しばらくしてから再試行してください。"
});

// 全APIエンドポイントに適用
app.use("/api/", limiter);
```

---

## 完了条件

全ての改善が完了したら、以下を確認してください:

- [ ] 全てのチェックリストが完了している
- [ ] フロントエンドから通常通り操作できる
- [ ] セキュリティ監査を再実行してスコアが **8.0 → 9.5** に向上していることを確認

```bash
# セキュリティ監査再実行（次回セッション）
claude skill ln-621-security-auditor
```

---

## 質問・サポート

不明点や問題が発生した場合:

1. **監査レポート全文を参照**: [design-system/SECURITY_AUDIT_REPORT.md](SECURITY_AUDIT_REPORT.md)
2. **関連ドキュメント**:
   - [UNIFIED_SEMI_DAO.md セクション15](UNIFIED_SEMI_DAO.md#15-セキュリティ強化計画) - セキュリティ強化計画
   - [Joi ドキュメント](https://joi.dev/api/)
   - [Express CORS ドキュメント](https://expressjs.com/en/resources/middleware/cors.html)

---

**引き継ぎ完了日**: 2026-02-02
**次回レビュー予定**: Phase 0 実装完了後
**スコア目標**: 8.0 → 9.5 / 10.0
