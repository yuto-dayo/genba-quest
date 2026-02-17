import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { supabaseAdmin } from "../lib/supabaseClient";
import { GoogleGenerativeAI, Part, Content } from "@google/generative-ai";
import Anthropic from "@anthropic-ai/sdk";

const router = Router();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

// AI Provider設定（gemini / anthropic）
const AI_PROVIDER = process.env.AI_PROVIDER || "anthropic";

// ============================================================
// シェルパ システムプロンプト（ドメイン知識を直接埋め込み）
// ============================================================

const SHERPA_SYSTEM_PROMPT = `あなたは「シェルパ」、GENBA QUEST（建設現場管理アプリ）のAIコンパニオンです。

## キャラクター設定
- 頼れる相棒、フレンドリーな口調
- RPG風の言い回しを時々使う（「冒険者よ」「ダンジョン」など）
- 実用的なアドバイスを簡潔に提供
- 絵文字を適度に使用 🏗️⚡💪

## できること
- 現場（ダンジョン）の相談
- スタミナ管理のアドバイス
- **経費・売上・請求書データの検索・集計（ツールを使用）**
- 発注書のチェック
- 休暇取得の提案

## 重要: データアクセス
経理データ（経費、売上、請求書）について質問されたら、必ずツールを使って実際のデータを取得してください。
- 「今月の経費は？」→ aggregate_transactions ツールを使用
- 「〇〇の経費を検索」→ search_transactions ツールを使用
- 「収支を教えて」→ get_monthly_pl ツールを使用

## 話し方の例
- 「お疲れさま！今日も現場で頑張ってるね 💪」
- 「おっと、スタミナが30%を切ってるぞ。そろそろ休息が必要かもしれないな ⚡」
- 「新しいダンジョン（現場）の登録を手伝おうか？」

---

## 経理処理の知識

### 工事原価 vs 販管費
**工事原価になるもの:**
- 現場で直接使用する資材（材料費）
- 現場作業員の人件費（労務費）
- 外注費（下請工事）
- 現場経費（養生材、消耗品等）

**販管費になるもの:**
- 事務所経費、営業活動費、一般管理費

### 資産計上の判断
- 10万円未満: 消耗品費として一括経費
- 10万円以上20万円未満: 一括償却資産（3年）
- 20万円以上: 固定資産（耐用年数で償却）

### 主な勘定科目
| 勘定科目 | 用途例 |
|----------|--------|
| 材料費 | 木材、ボード、金物、接着剤 |
| 労務費 | 職人日当 |
| 外注費 | 電気・設備工事 |
| 消耗品費 | 事務用品、10万円未満の工具 |
| 車両費 | ガソリン、修繕、保険 |
| 旅費交通費 | 電車代、駐車場 |

### 消費税区分
- **課税10%**: 材料、外注費、消耗品、通信費など
- **課税8%**: 食料品（弁当等）
- **非課税**: 土地、住宅賃料、保険料
- **対象外**: 給与、慶弔費、罰金

---

## 発注書チェックの知識

### 必須確認項目
1. 発注番号、発注日
2. 現場名・現場住所
3. 品名・規格・数量・単価
4. 納期・支払条件

### よくあるエラー
- 数量×単価≠小計（計算ミス）
- 発注日>納期（日付エラー）
- 番地・建物名なし（住所不備）

### 単価の目安（警告用）
- クロス張替: 800〜1,500円/m²
- フローリング: 5,000〜15,000円/m²
- 石膏ボード12.5mm: 500〜800円/枚
`;

// ============================================================
// 経費処理専用プロンプト
// ============================================================

const EXPENSE_SYSTEM_PROMPT = `あなたは建設・内装業の経費処理を支援するAIです。

## 判定ロジック
1. 現場経費か？ → Yes: 工事原価 / No: 販管費
2. 10万円以上か？ → 資産計上検討
3. 消費税区分を判定

## 回答形式
必ず以下のJSON形式で回答:
\`\`\`json
{
  "entry": {
    "date": "日付",
    "debit_account": "借方勘定科目",
    "credit_account": "貸方勘定科目",
    "amount": 金額,
    "description": "摘要"
  },
  "tax_category": "課税仕入/非課税/対象外",
  "tax_rate": 10,
  "cost_type": "工事原価/販管費",
  "notes": ["注意事項"]
}
\`\`\`

## 勘定科目一覧
- 材料費: 工事に直接使用する資材
- 労務費: 現場作業員の人件費
- 外注費: 下請業者への支払
- 消耗品費: 事務用品、10万円未満の工具
- 車両費: ガソリン、修繕
- 旅費交通費: 電車、駐車場
- 通信費: 電話、インターネット
- 地代家賃: 事務所、月極駐車場
`;

// ============================================================
// 発注書チェック専用プロンプト
// ============================================================

const PURCHASE_ORDER_SYSTEM_PROMPT = `あなたは建設・内装業の発注書を確認するAIです。

## チェック項目
1. 基本情報: 発注番号、発注日、発注先・元情報
2. 商品詳細: 品名、規格、数量、単価
3. 金額: 小計、消費税、合計の整合性
4. 納期・条件: 納期、納入場所、支払条件

## 単価の目安
- クロス張替: 800〜1,500円/m²
- フローリング: 5,000〜15,000円/m²
- 石膏ボード12.5mm: 500〜800円/枚
- 電気工事: 3,000〜8,000円/m²

## 回答形式
必ず以下のJSON形式で回答:
\`\`\`json
{
  "status": "ok/warning/error",
  "checklist": [
    {"item": "項目名", "status": "pass/warn/fail", "comment": "コメント"}
  ],
  "suggestions": ["改善提案"],
  "summary": "総合評価"
}
\`\`\`
`;

// ============================================================
// エンドポイント
// ============================================================

// Gemini用ツール定義（型の複雑さを回避するため as any を使用）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const geminiTools: any = [
    {
        functionDeclarations: [
            {
                name: "search_transactions",
                description: "経理取引を検索します。経費、売上、請求書を条件で絞り込みます。",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        q: { type: "STRING", description: "検索キーワード" },
                        kind: { type: "STRING", description: "取引種別（expense/sale/invoice）" },
                        date_from: { type: "STRING", description: "開始日（YYYY-MM-DD）" },
                        date_to: { type: "STRING", description: "終了日（YYYY-MM-DD）" },
                        limit: { type: "NUMBER", description: "取得件数上限" },
                    },
                },
            },
            {
                name: "get_monthly_pl",
                description: "月次損益（PL）を取得します。",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        month: { type: "STRING", description: "対象月（YYYY-MM形式）" },
                        site_id: { type: "STRING", description: "現場ID" },
                    },
                },
            },
            {
                name: "aggregate_transactions",
                description: "取引を集計します。合計金額、件数、カテゴリ別内訳などを計算します。",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        kind: { type: "STRING", description: "取引種別" },
                        date_from: { type: "STRING", description: "開始日" },
                        date_to: { type: "STRING", description: "終了日" },
                        group_by: { type: "STRING", description: "グループ化の軸" },
                        filter_category: { type: "STRING", description: "カテゴリフィルタ" },
                        filter_vendor: { type: "STRING", description: "支払先フィルタ" },
                    },
                },
            },
        ],
    },
];

// Anthropic用ツール定義
const anthropicTools: Anthropic.Tool[] = [
    {
        name: "search_transactions",
        description: "経理取引を検索します。経費、売上、請求書を条件で絞り込みます。",
        input_schema: {
            type: "object",
            properties: {
                q: { type: "string", description: "検索キーワード" },
                kind: { type: "string", description: "取引種別（expense/sale/invoice）" },
                date_from: { type: "string", description: "開始日（YYYY-MM-DD）" },
                date_to: { type: "string", description: "終了日（YYYY-MM-DD）" },
                limit: { type: "number", description: "取得件数上限" },
            },
        },
    },
    {
        name: "get_monthly_pl",
        description: "月次損益（PL）を取得します。",
        input_schema: {
            type: "object",
            properties: {
                month: { type: "string", description: "対象月（YYYY-MM形式）" },
                site_id: { type: "string", description: "現場ID" },
            },
        },
    },
    {
        name: "aggregate_transactions",
        description: "取引を集計します。合計金額、件数、カテゴリ別内訳などを計算します。",
        input_schema: {
            type: "object",
            properties: {
                kind: { type: "string", description: "取引種別" },
                date_from: { type: "string", description: "開始日" },
                date_to: { type: "string", description: "終了日" },
                group_by: { type: "string", description: "グループ化の軸" },
                filter_category: { type: "string", description: "カテゴリフィルタ" },
                filter_vendor: { type: "string", description: "支払先フィルタ" },
            },
        },
    },
];

// シェルパチャット（メイン）- Gemini版
router.post("/chat", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { message, context } = req.body;

        // 今日の日付情報を追加（日付解析の補助）
        const today = new Date();
        const dateInfo = `
今日の日付: ${today.toISOString().split("T")[0]}
今月: ${today.toISOString().slice(0, 7)}
先月: ${new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 7)}
`;

        const model = genAI.getGenerativeModel({
            model: "gemini-3-pro-preview",
            systemInstruction: SHERPA_SYSTEM_PROMPT,
            tools: geminiTools,
        });

        // 会話履歴をGemini形式に変換
        const history: Content[] = (context || []).map((msg: { role: string; content: string }) => ({
            role: msg.role === "assistant" ? "model" : "user",
            parts: [{ text: msg.content }],
        }));

        const chat = model.startChat({ history });

        // 初回メッセージ送信
        let result = await chat.sendMessage(`${dateInfo}\n\nユーザーからの質問: ${message}`);
        let response = result.response;

        // ツール使用ループ
        let functionCalls = response.functionCalls();
        while (functionCalls && functionCalls.length > 0) {
            const functionResponses: Part[] = [];

            for (const call of functionCalls) {
                const toolResult = await executeAccountingTool(
                    call.name,
                    call.args as Record<string, unknown>
                );
                functionResponses.push({
                    functionResponse: {
                        name: call.name,
                        response: JSON.parse(toolResult),
                    },
                });
            }

            // ツール結果を送信
            result = await chat.sendMessage(functionResponses);
            response = result.response;
            functionCalls = response.functionCalls();
        }

        const reply = response.text() || "申し訳ありません、応答を生成できませんでした。";

        res.json({ reply });
    } catch (err: any) {
        console.error("Sherpa chat error:", err);
        res.status(500).json({ error: err.message });
    }
});

// 発注書確認 - Gemini版
router.post("/check-purchase-order", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { imageBase64, textContent } = req.body;

        const model = genAI.getGenerativeModel({
            model: "gemini-3-pro-preview",
            systemInstruction: PURCHASE_ORDER_SYSTEM_PROMPT,
        });

        const parts: Part[] = [];

        if (imageBase64) {
            const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
            parts.push({
                inlineData: {
                    mimeType: "image/jpeg",
                    data: base64Data,
                },
            });
        }

        parts.push({
            text: textContent || "この発注書を確認してください。問題点や不備があれば指摘してください。",
        });

        const result = await model.generateContent(parts);
        const reply = result.response.text();

        // JSONパース
        try {
            const jsonMatch = reply.match(/```json\n?([\s\S]*?)\n?```/) || reply.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const jsonStr = jsonMatch[1] || jsonMatch[0];
                res.json(JSON.parse(jsonStr));
                return;
            }
        } catch {
            // パース失敗時はrawで返す
        }
        res.json({ raw: reply });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// 経費処理 - Gemini版
router.post("/process-expense", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { date, amount, payee, description, siteName } = req.body;

        const message = `以下の経費を処理してください:
日付: ${date}
金額: ${amount}円
支払先: ${payee}
内容: ${description}
${siteName ? `現場名: ${siteName}` : ""}`;

        const model = genAI.getGenerativeModel({
            model: "gemini-3-pro-preview",
            systemInstruction: EXPENSE_SYSTEM_PROMPT,
        });

        const result = await model.generateContent(message);
        const reply = result.response.text();

        // JSONパース
        try {
            const jsonMatch = reply.match(/```json\n?([\s\S]*?)\n?```/) || reply.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const jsonStr = jsonMatch[1] || jsonMatch[0];
                res.json(JSON.parse(jsonStr));
                return;
            }
        } catch {
            // パース失敗時はrawで返す
        }
        res.json({ raw: reply });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// 経理Sherpa専用エンドポイント
// ============================================================

const ACCOUNTING_SHERPA_SYSTEM_PROMPT = `あなたは建設業の経理Sherpaです。

## 重要: ツール使用ルール
- **1回のツール呼び出しで回答を完結させること**
- 複数ツールを連続で呼ばない
- 集計には aggregate_transactions、検索には search_transactions を使い分ける
- 「今月の経費は？」→ aggregate_transactions のみ
- 「〇〇の経費を探して」→ search_transactions のみ

## キャラクター
- 頼れる経理の相棒、フレンドリー
- 絵文字を適度に使用 📊💰

## 回答形式
- 金額は3桁カンマ区切り（¥XXX,XXX）
- 簡潔に結果を報告

## カテゴリ
material(材料), tool(工具), food(弁当), travel(交通費), consumable(消耗品)
`;

// 経理Sherpa用ツール定義（Gemini用、共通定義を再利用）
// geminiTools と同じ定義を使用

// ツール実行関数
async function executeAccountingTool(
    toolName: string,
    toolInput: Record<string, unknown>
): Promise<string> {
    try {
        switch (toolName) {
            case "search_transactions": {
                let query = supabaseAdmin
                    .from("accounting_transactions")
                    .select(`
                        *,
                        site:sites(id, name),
                        client:clients(id, name)
                    `)
                    .order("recorded_date", { ascending: false })
                    .limit(Number(toolInput.limit) || 50);

                if (toolInput.kind) {
                    query = query.eq("kind", toolInput.kind);
                }
                if (toolInput.date_from) {
                    query = query.gte("recorded_date", toolInput.date_from as string);
                }
                if (toolInput.date_to) {
                    query = query.lte("recorded_date", toolInput.date_to as string);
                }

                const { data, error } = await query;

                if (error) throw error;

                // テキスト検索（メモリフィルタリング）
                let results = data || [];
                if (toolInput.q && typeof toolInput.q === "string") {
                    const searchTerm = (toolInput.q as string).toLowerCase();
                    results = results.filter((tx) => {
                        const vendorMatch = tx.vendor_name?.toLowerCase().includes(searchTerm);
                        const descMatch = tx.description?.toLowerCase().includes(searchTerm);
                        const siteMatch = tx.site?.name?.toLowerCase().includes(searchTerm);
                        const clientMatch = tx.client?.name?.toLowerCase().includes(searchTerm);
                        return vendorMatch || descMatch || siteMatch || clientMatch;
                    });
                }

                if (results.length === 0) {
                    return JSON.stringify({ message: "該当する取引が見つかりませんでした", count: 0, transactions: [] });
                }

                return JSON.stringify({
                    count: results.length,
                    transactions: results.map((tx) => ({
                        id: tx.id,
                        kind: tx.kind,
                        vendor_name: tx.vendor_name,
                        description: tx.description,
                        recorded_date: tx.recorded_date,
                        amount_total: tx.amount_total,
                        category: tx.category,
                        status: tx.status,
                        site_name: tx.site?.name,
                        client_name: tx.client?.name,
                    })),
                });
            }

            case "get_monthly_pl": {
                const targetMonth = (toolInput.month as string) || new Date().toISOString().slice(0, 7);
                const startDate = `${targetMonth}-01`;
                const endDate = `${targetMonth}-31`;

                let query = supabaseAdmin
                    .from("accounting_transactions")
                    .select("*")
                    .in("status", ["posted", "approved"])
                    .gte("recorded_date", startDate)
                    .lte("recorded_date", endDate);

                if (toolInput.site_id) {
                    query = query.eq("site_id", toolInput.site_id);
                }

                const { data, error } = await query;

                if (error) throw error;

                let sales = 0;
                let expenses = 0;

                for (const tx of data || []) {
                    if (tx.kind === "sale" || tx.kind === "invoice") {
                        sales += tx.amount_total || 0;
                    } else if (tx.kind === "expense") {
                        expenses += tx.amount_total || 0;
                    }
                }

                const profit = sales - expenses;

                return JSON.stringify({
                    month: targetMonth,
                    sales,
                    expenses,
                    profit,
                    profit_rate: sales > 0 ? ((profit / sales) * 100).toFixed(1) + "%" : "N/A",
                    transaction_count: data?.length || 0,
                });
            }

            case "aggregate_transactions": {
                let query = supabaseAdmin
                    .from("accounting_transactions")
                    .select(`
                        *,
                        site:sites(id, name)
                    `)
                    .in("status", ["posted", "approved", "draft", "pending_review"]);

                if (toolInput.kind) {
                    query = query.eq("kind", toolInput.kind);
                }
                if (toolInput.date_from) {
                    query = query.gte("recorded_date", toolInput.date_from as string);
                }
                if (toolInput.date_to) {
                    query = query.lte("recorded_date", toolInput.date_to as string);
                }

                const { data, error } = await query;

                if (error) throw error;

                let results = data || [];

                // カテゴリフィルタ
                if (toolInput.filter_category) {
                    results = results.filter((tx) => tx.category === toolInput.filter_category);
                }

                // 支払先フィルタ
                if (toolInput.filter_vendor) {
                    const vendorTerm = (toolInput.filter_vendor as string).toLowerCase();
                    results = results.filter((tx) =>
                        tx.vendor_name?.toLowerCase().includes(vendorTerm)
                    );
                }

                const total = results.reduce((sum, tx) => sum + (tx.amount_total || 0), 0);
                const count = results.length;

                // グループ化
                const grouped: Record<string, { total: number; count: number }> = {};

                if (toolInput.group_by) {
                    for (const tx of results) {
                        let key = "その他";

                        switch (toolInput.group_by) {
                            case "category":
                                key = tx.category || "未分類";
                                break;
                            case "vendor":
                                key = tx.vendor_name || "不明";
                                break;
                            case "site":
                                key = tx.site?.name || "本社";
                                break;
                            case "month":
                                key = tx.recorded_date?.slice(0, 7) || "不明";
                                break;
                        }

                        if (!grouped[key]) {
                            grouped[key] = { total: 0, count: 0 };
                        }
                        grouped[key].total += tx.amount_total || 0;
                        grouped[key].count += 1;
                    }
                }

                return JSON.stringify({
                    total_amount: total,
                    transaction_count: count,
                    grouped: Object.keys(grouped).length > 0 ? grouped : undefined,
                    period: {
                        from: toolInput.date_from || "指定なし",
                        to: toolInput.date_to || "指定なし",
                    },
                });
            }

            default:
                return JSON.stringify({ error: `Unknown tool: ${toolName}` });
        }
    } catch (err: any) {
        return JSON.stringify({ error: err.message });
    }
}

// 経理Sherpaチャット - マルチプロバイダー対応
router.post("/accounting-chat", async (req: AuthenticatedRequest, res: Response) => {
    const startTime = Date.now();
    try {
        const { message, context, provider } = req.body;

        if (!message) {
            res.status(400).json({ error: "message is required" });
            return;
        }

        // リクエストで指定されたproviderを優先、なければ環境変数
        const useProvider = provider || AI_PROVIDER;

        // 今日の日付情報を追加（日付解析の補助）
        const today = new Date();
        const dateInfo = `今日: ${today.toISOString().split("T")[0]}, 今月: ${today.toISOString().slice(0, 7)}`;

        console.log(`[ACC-SHERPA] Provider: ${useProvider}`);

        if (useProvider === "anthropic") {
            // ===== Anthropic版 =====
            const messages: Anthropic.MessageParam[] = (context || []).map((msg: { role: string; content: string }) => ({
                role: msg.role === "assistant" ? "assistant" : "user",
                content: msg.content,
            }));
            messages.push({ role: "user", content: `${dateInfo}\n\nユーザーからの質問: ${message}` });

            console.log("[ACC-SHERPA] 初回API呼び出し開始...");
            const t1 = Date.now();
            let response = await anthropic.messages.create({
                model: "claude-sonnet-4-5",
                max_tokens: 1024,
                system: ACCOUNTING_SHERPA_SYSTEM_PROMPT,
                tools: anthropicTools,
                messages,
            });
            console.log(`[ACC-SHERPA] 初回API完了: ${Date.now() - t1}ms`);

            // ツール使用ループ
            let loopCount = 0;
            while (response.stop_reason === "tool_use") {
                loopCount++;
                const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
                console.log(`[ACC-SHERPA] ツールループ ${loopCount}: ${toolUseBlocks.map(t => t.name).join(", ")}`);

                const toolResults: Anthropic.ToolResultBlockParam[] = [];
                for (const toolUse of toolUseBlocks) {
                    const t2 = Date.now();
                    const result = await executeAccountingTool(toolUse.name, toolUse.input as Record<string, unknown>);
                    console.log(`[ACC-SHERPA] ツール ${toolUse.name}: ${Date.now() - t2}ms`);
                    toolResults.push({
                        type: "tool_result",
                        tool_use_id: toolUse.id,
                        content: result,
                    });
                }

                console.log(`[ACC-SHERPA] ツール結果API呼び出し ${loopCount}...`);
                const t3 = Date.now();
                response = await anthropic.messages.create({
                    model: "claude-sonnet-4-5",
                    max_tokens: 1024,
                    system: ACCOUNTING_SHERPA_SYSTEM_PROMPT,
                    tools: anthropicTools,
                    messages: [
                        ...messages,
                        { role: "assistant", content: response.content },
                        { role: "user", content: toolResults },
                    ],
                });
                console.log(`[ACC-SHERPA] ツール結果API完了 ${loopCount}: ${Date.now() - t3}ms`);
            }

            const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
            const reply = textBlock?.text || "申し訳ありません、応答を生成できませんでした。";
            console.log(`[ACC-SHERPA] 総処理時間: ${Date.now() - startTime}ms, ループ: ${loopCount}`);

            res.json({ reply });
        } else {
            // ===== Gemini版 =====
            const model = genAI.getGenerativeModel({
                model: "gemini-3-pro-preview",
                systemInstruction: ACCOUNTING_SHERPA_SYSTEM_PROMPT,
                tools: geminiTools,
            });

            const history: Content[] = (context || []).map((msg: { role: string; content: string }) => ({
                role: msg.role === "assistant" ? "model" : "user",
                parts: [{ text: msg.content }],
            }));

            const chat = model.startChat({ history });

            console.log("[ACC-SHERPA] 初回API呼び出し開始...");
            const t1 = Date.now();
            let result = await chat.sendMessage(`${dateInfo}\n\nユーザーからの質問: ${message}`);
            console.log(`[ACC-SHERPA] 初回API完了: ${Date.now() - t1}ms`);
            let response = result.response;

            let functionCalls = response.functionCalls();
            let loopCount = 0;
            while (functionCalls && functionCalls.length > 0) {
                loopCount++;
                console.log(`[ACC-SHERPA] ツールループ ${loopCount}: ${functionCalls.map(c => c.name).join(", ")}`);
                const functionResponses: Part[] = [];

                for (const call of functionCalls) {
                    const t2 = Date.now();
                    const toolResult = await executeAccountingTool(call.name, call.args as Record<string, unknown>);
                    console.log(`[ACC-SHERPA] ツール ${call.name}: ${Date.now() - t2}ms`);
                    functionResponses.push({
                        functionResponse: {
                            name: call.name,
                            response: JSON.parse(toolResult),
                        },
                    });
                }

                console.log(`[ACC-SHERPA] ツール結果API呼び出し ${loopCount}...`);
                const t3 = Date.now();
                result = await chat.sendMessage(functionResponses);
                console.log(`[ACC-SHERPA] ツール結果API完了 ${loopCount}: ${Date.now() - t3}ms`);
                response = result.response;
                functionCalls = response.functionCalls();
            }

            const reply = response.text() || "申し訳ありません、応答を生成できませんでした。";
            console.log(`[ACC-SHERPA] 総処理時間: ${Date.now() - startTime}ms, ループ: ${loopCount}`);

            res.json({ reply });
        }
    } catch (err: any) {
        console.error("Accounting Sherpa error:", err);
        res.status(500).json({ error: err.message });
    }
});

// 経費チェック（簡易版）- Gemini版
router.post("/expense-check", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { description, amount, category } = req.body;

        const model = genAI.getGenerativeModel({
            model: "gemini-3-pro-preview",
            systemInstruction: `経費の妥当性を判定。回答はJSON: { "suspicious": boolean, "reason": string, "suggestion": string }`,
        });

        const result = await model.generateContent(
            `経費内容: ${description}\n金額: ${amount}円\nカテゴリ: ${category}`
        );
        const text = result.response.text();

        // JSONパース
        try {
            const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const jsonStr = jsonMatch[1] || jsonMatch[0];
                res.json(JSON.parse(jsonStr));
                return;
            }
        } catch {
            // パース失敗時
        }
        res.json(JSON.parse(text));
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
