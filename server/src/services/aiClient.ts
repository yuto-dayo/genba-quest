/**
 * 統一AIクライアント
 * Gemini、OpenAI、Anthropicを共通インターフェースで扱う
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

// ============================================================
// Types & Interfaces
// ============================================================

export type AIProviderName = "gemini" | "openai" | "anthropic";

export interface ChatMessage {
    role: "user" | "assistant" | "system";
    content: string;
}

export interface GenerateOptions {
    maxTokens?: number;
    temperature?: number;
    systemPrompt?: string;
}

export interface AIProvider {
    name: AIProviderName;

    /**
     * テキスト生成
     */
    generateText(prompt: string, options?: GenerateOptions): Promise<string>;

    /**
     * 画像付きテキスト生成（Vision機能）
     */
    generateWithImage(
        prompt: string,
        imageBase64: string,
        mimeType: string,
        options?: GenerateOptions
    ): Promise<string>;

    /**
     * チャット（複数ターンの会話）
     */
    chat(messages: ChatMessage[], options?: GenerateOptions): Promise<string>;
}

// ============================================================
// Gemini Provider
// ============================================================

class GeminiProvider implements AIProvider {
    name: AIProviderName = "gemini";
    private client: GoogleGenerativeAI;

    constructor(apiKey: string) {
        this.client = new GoogleGenerativeAI(apiKey);
    }

    async generateText(prompt: string, options?: GenerateOptions): Promise<string> {
        const model = this.client.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: {
                maxOutputTokens: options?.maxTokens,
                temperature: options?.temperature,
            }
        });

        const parts: any[] = [];
        if (options?.systemPrompt) {
            parts.push({ text: options.systemPrompt });
        }
        parts.push({ text: prompt });

        const result = await model.generateContent(parts);
        return result.response.text();
    }

    async generateWithImage(
        prompt: string,
        imageBase64: string,
        mimeType: string,
        options?: GenerateOptions
    ): Promise<string> {
        const model = this.client.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: {
                maxOutputTokens: options?.maxTokens,
                temperature: options?.temperature,
            }
        });

        const parts: any[] = [];
        if (options?.systemPrompt) {
            parts.push({ text: options.systemPrompt });
        }
        parts.push({ text: prompt });
        parts.push({
            inlineData: {
                mimeType,
                data: imageBase64,
            },
        });

        const result = await model.generateContent(parts);
        return result.response.text();
    }

    async chat(messages: ChatMessage[], options?: GenerateOptions): Promise<string> {
        const model = this.client.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: {
                maxOutputTokens: options?.maxTokens,
                temperature: options?.temperature,
            }
        });

        // Geminiのchat形式に変換
        const history = messages
            .filter(m => m.role !== "system")
            .map(m => ({
                role: m.role === "assistant" ? "model" : "user",
                parts: [{ text: m.content }],
            }));

        const systemMessage = messages.find(m => m.role === "system");
        const lastUserMessage = history.pop();

        const chat = model.startChat({
            history: history as any,
            systemInstruction: systemMessage?.content || options?.systemPrompt,
        });

        const result = await chat.sendMessage(lastUserMessage?.parts[0].text || "");
        return result.response.text();
    }
}

// ============================================================
// OpenAI Provider
// ============================================================

class OpenAIProvider implements AIProvider {
    name: AIProviderName = "openai";
    private client: OpenAI;

    constructor(apiKey: string) {
        this.client = new OpenAI({ apiKey });
    }

    async generateText(prompt: string, options?: GenerateOptions): Promise<string> {
        const messages: OpenAI.ChatCompletionMessageParam[] = [];

        if (options?.systemPrompt) {
            messages.push({ role: "system", content: options.systemPrompt });
        }
        messages.push({ role: "user", content: prompt });

        const response = await this.client.chat.completions.create({
            model: "gpt-4o",
            messages,
            max_tokens: options?.maxTokens,
            temperature: options?.temperature,
        });

        return response.choices[0]?.message?.content || "";
    }

    async generateWithImage(
        prompt: string,
        imageBase64: string,
        mimeType: string,
        options?: GenerateOptions
    ): Promise<string> {
        const messages: OpenAI.ChatCompletionMessageParam[] = [];

        if (options?.systemPrompt) {
            messages.push({ role: "system", content: options.systemPrompt });
        }

        messages.push({
            role: "user",
            content: [
                { type: "text", text: prompt },
                {
                    type: "image_url",
                    image_url: {
                        url: `data:${mimeType};base64,${imageBase64}`,
                    },
                },
            ],
        });

        const response = await this.client.chat.completions.create({
            model: "gpt-4o",
            messages,
            max_tokens: options?.maxTokens || 4096,
            temperature: options?.temperature,
        });

        return response.choices[0]?.message?.content || "";
    }

    async chat(messages: ChatMessage[], options?: GenerateOptions): Promise<string> {
        const openaiMessages: OpenAI.ChatCompletionMessageParam[] = messages.map(m => ({
            role: m.role,
            content: m.content,
        }));

        if (options?.systemPrompt && !messages.some(m => m.role === "system")) {
            openaiMessages.unshift({ role: "system", content: options.systemPrompt });
        }

        const response = await this.client.chat.completions.create({
            model: "gpt-4o",
            messages: openaiMessages,
            max_tokens: options?.maxTokens,
            temperature: options?.temperature,
        });

        return response.choices[0]?.message?.content || "";
    }
}

// ============================================================
// Anthropic Provider
// ============================================================

class AnthropicProvider implements AIProvider {
    name: AIProviderName = "anthropic";
    private client: Anthropic;

    constructor(apiKey: string) {
        this.client = new Anthropic({ apiKey });
    }

    async generateText(prompt: string, options?: GenerateOptions): Promise<string> {
        const response = await this.client.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: options?.maxTokens || 4096,
            system: options?.systemPrompt,
            messages: [{ role: "user", content: prompt }],
        });

        const content = response.content[0];
        return content.type === "text" ? content.text : "";
    }

    async generateWithImage(
        prompt: string,
        imageBase64: string,
        mimeType: string,
        options?: GenerateOptions
    ): Promise<string> {
        // Anthropicのmedia_type形式に変換
        const mediaType = mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp";

        const response = await this.client.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: options?.maxTokens || 4096,
            system: options?.systemPrompt,
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "image",
                            source: {
                                type: "base64",
                                media_type: mediaType,
                                data: imageBase64,
                            },
                        },
                        { type: "text", text: prompt },
                    ],
                },
            ],
        });

        const content = response.content[0];
        return content.type === "text" ? content.text : "";
    }

    async chat(messages: ChatMessage[], options?: GenerateOptions): Promise<string> {
        const systemMessage = messages.find(m => m.role === "system");
        const anthropicMessages = messages
            .filter(m => m.role !== "system")
            .map(m => ({
                role: m.role as "user" | "assistant",
                content: m.content,
            }));

        const response = await this.client.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: options?.maxTokens || 4096,
            system: systemMessage?.content || options?.systemPrompt,
            messages: anthropicMessages,
        });

        const content = response.content[0];
        return content.type === "text" ? content.text : "";
    }
}

// ============================================================
// Factory & Singleton
// ============================================================

const providers: Map<AIProviderName, AIProvider> = new Map();

/**
 * AIプロバイダーを取得（シングルトン）
 * @param name プロバイダー名（省略時は環境変数 AI_PROVIDER のデフォルト値）
 */
export function getAIProvider(name?: AIProviderName): AIProvider {
    const providerName = name || (process.env.AI_PROVIDER as AIProviderName) || "gemini";

    // キャッシュから返す
    if (providers.has(providerName)) {
        return providers.get(providerName)!;
    }

    // 新規作成
    let provider: AIProvider;

    switch (providerName) {
        case "gemini":
            const geminiKey = process.env.GEMINI_API_KEY;
            if (!geminiKey) throw new Error("GEMINI_API_KEY is not set");
            provider = new GeminiProvider(geminiKey);
            break;

        case "openai":
            const openaiKey = process.env.OPENAI_API_KEY;
            if (!openaiKey) throw new Error("OPENAI_API_KEY is not set");
            provider = new OpenAIProvider(openaiKey);
            break;

        case "anthropic":
            const anthropicKey = process.env.ANTHROPIC_API_KEY;
            if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY is not set");
            provider = new AnthropicProvider(anthropicKey);
            break;

        default:
            throw new Error(`Unknown AI provider: ${providerName}`);
    }

    providers.set(providerName, provider);
    return provider;
}

/**
 * デフォルトプロバイダー名を取得
 */
export function getDefaultProviderName(): AIProviderName {
    return (process.env.AI_PROVIDER as AIProviderName) || "gemini";
}

/**
 * 利用可能なプロバイダー一覧を取得
 */
export function getAvailableProviders(): AIProviderName[] {
    const available: AIProviderName[] = [];

    if (process.env.GEMINI_API_KEY) available.push("gemini");
    if (process.env.OPENAI_API_KEY) available.push("openai");
    if (process.env.ANTHROPIC_API_KEY) available.push("anthropic");

    return available;
}
