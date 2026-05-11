import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarClock, ChevronDown, ChevronUp, Loader2, Pencil } from "lucide-react";
import {
    fetchActiveBillingRule,
    fetchBillingRules,
    type ActiveBillingRulePreview,
    type BillingRuleRecord,
} from "../lib/api";
import { describeRule, formatDateJa } from "../lib/billingRuleFormat";
import { getErrorMessage } from "../lib/error";
import { BillingRuleEditor } from "./BillingRuleEditor";
import styles from "./BillingRuleSection.module.css";

interface BillingRuleSectionProps {
    clientId: string;
}

export function BillingRuleSection({ clientId }: BillingRuleSectionProps) {
    const [active, setActive] = useState<ActiveBillingRulePreview | null>(null);
    const [history, setHistory] = useState<BillingRuleRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showEditor, setShowEditor] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [activeRes, historyRes] = await Promise.all([
                fetchActiveBillingRule(clientId),
                fetchBillingRules(clientId),
            ]);
            setActive(activeRes);
            setHistory(historyRes);
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    }, [clientId]);

    useEffect(() => {
        void load();
    }, [load]);

    return (
        <section className={styles.section}>
            <header className={styles.header}>
                <div className={styles.titleWrap}>
                    <CalendarClock size={16} />
                    <h4 className={styles.title}>締め払いルール</h4>
                </div>
                <button
                    type="button"
                    className={styles.changeBtn}
                    onClick={() => setShowEditor(true)}
                    disabled={loading}
                >
                    <Pencil size={14} />
                    {active?.rule ? "ルール変更" : "ルール設定"}
                </button>
            </header>

            {loading && (
                <div className={styles.loadingRow}>
                    <Loader2 size={14} className={styles.spin} />
                    <span>読み込み中...</span>
                </div>
            )}

            {!loading && error && <div className={styles.error}>{error}</div>}

            {!loading && !error && !active?.rule && (
                <div className={styles.empty}>
                    まだ締め払いルールが未設定です。
                    <br />
                    「ルール設定」から、毎月末締め・毎週金曜締めなど取引先ごとのルールを登録してください。
                </div>
            )}

            {!loading && !error && active?.rule && (
                <>
                    <div className={styles.currentCard}>
                        <span className={styles.eyebrow}>現行ルール</span>
                        <p className={styles.ruleText}>{describeRule(active.rule)}</p>
                        {active.next_period && (
                            <div className={styles.nextRow}>
                                <div className={styles.nextCell}>
                                    <span className={styles.nextLabel}>次の締め</span>
                                    <span className={styles.nextValue}>{formatDateJa(active.next_period.period_end)}</span>
                                </div>
                                <div className={styles.nextCell}>
                                    <span className={styles.nextLabel}>入金予定</span>
                                    <span className={styles.nextValue}>{formatDateJa(active.next_period.payment_due_date)}</span>
                                </div>
                            </div>
                        )}
                    </div>

                    <button
                        type="button"
                        className={styles.historyToggle}
                        onClick={() => setHistoryOpen((v) => !v)}
                    >
                        変更履歴 ({history.length}件)
                        {historyOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>

                    <AnimatePresence>
                        {historyOpen && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
                                className={styles.historyList}
                            >
                                {history.map((rule) => (
                                    <div key={rule.id} className={styles.historyItem}>
                                        <div className={styles.historyMeta}>
                                            <span className={styles.historyRange}>
                                                {formatDateJa(rule.effective_from)} 〜
                                                {rule.effective_until ? formatDateJa(rule.effective_until) : " 現在"}
                                            </span>
                                            {rule.effective_until === null && (
                                                <span className={styles.currentBadge}>現行</span>
                                            )}
                                        </div>
                                        <div className={styles.historyRule}>{describeRule(rule)}</div>
                                        {rule.notes && <div className={styles.historyNotes}>{rule.notes}</div>}
                                    </div>
                                ))}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </>
            )}

            {showEditor && (
                <BillingRuleEditor
                    clientId={clientId}
                    currentRule={active?.rule ?? null}
                    onClose={() => setShowEditor(false)}
                    onSaved={(rule) => {
                        setShowEditor(false);
                        // 即時 UI 反映
                        setActive((prev) => ({
                            rule,
                            next_period: prev?.next_period ?? null,
                        }));
                        // サーバから next_period を再取得（プレビュー反映）
                        void load();
                    }}
                />
            )}
        </section>
    );
}

