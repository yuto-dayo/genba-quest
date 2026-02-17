import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Bot, User, X, Sparkles } from "lucide-react";
import { useSherpa } from "../hooks/useSherpa";
import styles from "./SherpaChat.module.css";


interface SherpaChatProps {
    open: boolean;
    onClose: () => void;
}

export function SherpaChat({ open, onClose }: SherpaChatProps) {
    const { messages, loading: sending, sendMessage } = useSherpa();
    const [input, setInput] = useState("");
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const handleSend = async () => {
        if (!input.trim() || sending) return;

        const content = input;
        setInput(""); // Clear input early
        await sendMessage(content);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const suggestions = [
        "今日の現場の進捗を教えて",
        "経費精算のルールは？",
        "来週のシフトを確認",
    ];

    return (
        <AnimatePresence>
            {open && (
                <>
                    {/* Overlay */}
                    <motion.div
                        className={styles.overlay}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                    />

                    {/* Chat Panel */}
                    <motion.div
                        className={styles.panel}
                        initial={{ y: "100%", opacity: 0.5 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: "100%", opacity: 0 }}
                        transition={{
                            type: "spring",
                            damping: 28,
                            stiffness: 300,
                        }}
                    >
                        {/* Header */}
                        <div className={styles.header}>
                            <div className={styles.headerLeft}>
                                <Bot size={20} />
                                <div>
                                    <span className={styles.headerTitle}>シェルパ</span>
                                    <span className={styles.headerStatus}>
                                        <Sparkles size={10} />
                                        オンライン
                                    </span>
                                </div>
                            </div>
                            <button
                                className={styles.closeButton}
                                onClick={onClose}
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Messages */}
                        <div className={styles.messagesArea}>
                            {messages.map((message) => (
                                <div
                                    key={message.id}
                                    className={`${styles.message} ${styles[message.role]}`}
                                >
                                    <div className={styles.messageIcon}>
                                        {message.role === "assistant" ? (
                                            <Bot size={16} />
                                        ) : (
                                            <User size={16} />
                                        )}
                                    </div>
                                    <div className={styles.messageBubble}>
                                        <p>{message.content}</p>
                                        <span className={styles.messageTime}>
                                            {message.timestamp.toLocaleTimeString("ja-JP", {
                                                hour: "2-digit",
                                                minute: "2-digit",
                                            })}
                                        </span>
                                    </div>
                                </div>
                            ))}

                            {sending && (
                                <div className={`${styles.message} ${styles.assistant}`}>
                                    <div className={styles.messageIcon}>
                                        <Bot size={16} />
                                    </div>
                                    <div className={styles.typing}>
                                        <span /><span /><span />
                                    </div>
                                </div>
                            )}

                            <div ref={messagesEndRef} />
                        </div>

                        {/* Suggestions */}
                        {messages.length <= 1 && (
                            <div className={styles.suggestions}>
                                {suggestions.map((s, i) => (
                                    <button
                                        key={i}
                                        className={styles.suggestionButton}
                                        onClick={() => setInput(s)}
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Input */}
                        <div className={styles.inputArea}>
                            <textarea
                                className={styles.input}
                                placeholder="メッセージを入力..."
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                rows={1}
                                disabled={sending}
                            />
                            <button
                                className={styles.sendButton}
                                onClick={handleSend}
                                disabled={!input.trim() || sending}
                            >
                                <Send size={18} />
                            </button>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
