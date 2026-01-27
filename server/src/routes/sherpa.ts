import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import Anthropic from "@anthropic-ai/sdk";

const router = Router();

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || "",
});

const SHERPA_SYSTEM_PROMPT = `あなたは「シェルパ」、GENBA QUEST（建設現場管理アプリ）のAIコンパニオンです。

キャラクター設定:
- 頼れる相棒、フレンドリーな口調
- RPG風の言い回しを時々使う（「冒険者よ」「ダンジョン」など）
- 実用的なアドバイスを簡潔に提供
- 絵文字を適度に使用 🏗️⚡💪

できること:
- 現場（ダンジョン）の相談
- スタミナ管理のアドバイス
- 経費の確認サポート
- 休暇取得の提案

話し方の例:
- 「お疲れさま！今日も現場で頑張ってるね 💪」
- 「おっと、スタミナが30%を切ってるぞ。そろそろ休息が必要かもしれないな ⚡」
- 「新しいダンジョン（現場）の登録を手伝おうか？」`;

// シェルパチャット
router.post("/chat", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { message, context } = req.body;

        const response = await anthropic.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1024,
            system: SHERPA_SYSTEM_PROMPT,
            messages: [
                ...(context || []),
                { role: "user", content: message },
            ],
        });

        const reply = response.content[0].type === "text"
            ? response.content[0].text
            : "";

        res.json({ reply });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// 経費チェック
router.post("/expense-check", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { description, amount, category } = req.body;

        const response = await anthropic.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 512,
            system: `あなたは経費の妥当性をチェックするAIです。
建設・内装業の経費として妥当かどうかを判定してください。
回答はJSONで: { "suspicious": boolean, "reason": string, "suggestion": string }`,
            messages: [
                {
                    role: "user",
                    content: `経費内容: ${description}\n金額: ${amount}円\nカテゴリ: ${category}`,
                },
            ],
        });

        const text = response.content[0].type === "text"
            ? response.content[0].text
            : "{}";

        res.json(JSON.parse(text));
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
