import { getAIProvider, getDefaultProviderName, type AIProviderName } from "./aiClient";
import { normalizePostalCode } from "./clientAddress";

export interface BusinessCardExtractedClient {
    name?: string | null;
    department?: string | null;
    contact_person?: string | null;
    email?: string | null;
    phone?: string | null;
    postal_code?: string | null;
    prefecture?: string | null;
    city?: string | null;
    address_line1?: string | null;
    address_line2?: string | null;
    raw_text?: string | null;
}

const BUSINESS_CARD_PROMPT = `
あなたは日本の名刺情報を抽出するOCRアシスタントです。
入力画像は名刺です。読み取れた情報だけを JSON で返してください。

出力形式:
{
  "name": "会社名",
  "department": "部署名",
  "contact_person": "担当者氏名",
  "email": "mail@example.com",
  "phone": "03-1234-5678",
  "postal_code": "150-0001",
  "prefecture": "東京都",
  "city": "渋谷区",
  "address_line1": "神宮前1-2-3",
  "address_line2": "○○ビル 5F",
  "raw_text": "名刺から読んだ主要テキスト"
}

ルール:
- 不明な項目は null ではなく省略してよい
- 会社名と個人名を混同しない
- 郵便番号は 123-4567 か 1234567 のどちらかで返す
- 住所は日本向けに分解する
- 住所の建物名・階数・部屋番号は address_line2 を優先する
- JSON 以外の説明文は絶対に出さないでください
- 文字列の中に改行を含めないでください。必要な場合は \\n にエスケープしてください
- 最後に余分なカンマ（Trailing comma）を含めないでください
`;

function extractJson(text: string): string {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1 && start <= end) {
        return text.substring(start, end + 1);
    }
    return text;
}

function normalizeExtractedString(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();
    return trimmed || null;
}

export async function extractClientFromBusinessCard(
    imageBase64: string,
    mimeType: string,
    providerName?: AIProviderName
): Promise<BusinessCardExtractedClient> {
    const provider = getAIProvider(providerName);
    const rawResponse = await provider.generateWithImage(
        BUSINESS_CARD_PROMPT,
        imageBase64,
        mimeType,
        {
            maxTokens: 4000,
            temperature: 0,
            systemPrompt: "JSON のみを返してください。改行はエスケープし、カンマの後の閉じ括弧に注意してください。",
        }
    );

    let parsed: Record<string, unknown>;
    try {
        const parsedResult = JSON.parse(extractJson(rawResponse));
        if (!parsedResult || typeof parsedResult !== 'object' || Array.isArray(parsedResult)) {
             throw new Error("Parsed result is not a valid object");
        }
        parsed = parsedResult;
    } catch (error) {
        console.error("[BUSINESS_CARD_OCR] JSON parse failed:", rawResponse);
        throw new Error("BUSINESS_CARD_PARSE_FAILED");
    }

    return {
        name: normalizeExtractedString(parsed.name),
        department: normalizeExtractedString(parsed.department),
        contact_person: normalizeExtractedString(parsed.contact_person),
        email: normalizeExtractedString(parsed.email),
        phone: normalizeExtractedString(parsed.phone),
        postal_code: normalizePostalCode(parsed.postal_code),
        prefecture: normalizeExtractedString(parsed.prefecture),
        city: normalizeExtractedString(parsed.city),
        address_line1: normalizeExtractedString(parsed.address_line1),
        address_line2: normalizeExtractedString(parsed.address_line2),
        raw_text: normalizeExtractedString(parsed.raw_text),
    };
}

export function getBusinessCardDefaultProvider(): AIProviderName {
    return getDefaultProviderName();
}
