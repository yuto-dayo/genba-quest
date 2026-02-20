import { useState, useCallback } from 'react';
import { chatWithSherpa, type ChatMessage } from '../lib/api';

export interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: Date;
}

export const useSherpa = () => {
    const [messages, setMessages] = useState<Message[]>([
        {
            id: "welcome",
            role: "assistant",
            content: "こんにちは！シェルパです。業務の管理や操作について、なんでもお気軽にどうぞ！",
            timestamp: new Date(),
        },
    ]);
    const [loading, setLoading] = useState(false);

    const sendMessage = useCallback(async (content: string) => {
        if (!content.trim() || loading) return;

        const userMessage: Message = {
            id: Date.now().toString(),
            role: "user",
            content: content.trim(),
            timestamp: new Date(),
        };

        setMessages((prev) => [...prev, userMessage]);
        setLoading(true);

        try {
            // コンテキスト（過去のメッセージ）
            const historyContext: ChatMessage[] = messages.slice(-10).map((m) => ({
                role: m.role,
                content: m.content,
            }));

            // ページコンテキストを含める（システムメッセージとして、またはメッセージに付与）
            // ここでは簡易的にAPIに渡すコンテキストに現在のパスを含める（APIが対応していれば）
            // 現状のAPI定義では contextは ChatMessage[] なので、role: system を追加するアプローチなどが考えられるが、
            // API側が不明なため、historyContextのみを送る実装を維持しつつ、拡張性を確保。
            // 将来的には { page: location.pathname } を送るなどが想定される。

            const response = await chatWithSherpa(userMessage.content, historyContext);

            const assistantMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: response.reply,
                timestamp: new Date(),
            };

            setMessages((prev) => [...prev, assistantMessage]);
        } catch (error) {
            console.error("Sherpa Error:", error);
            const errorMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: "すみません、エラーが発生しました。もう一度お試しください。",
                timestamp: new Date(),
            };
            setMessages((prev) => [...prev, errorMessage]);
        } finally {
            setLoading(false);
        }
    }, [messages, loading]);

    return {
        messages,
        loading,
        sendMessage,
    };
};
