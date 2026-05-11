import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Save, X } from "lucide-react";
import {
    createBillingRule,
    type BillingCycle,
    type BillingRuleRecord,
    type CreateBillingRuleInput,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import styles from "./BillingRuleEditor.module.css";

interface BillingRuleEditorProps {
    clientId: string;
    currentRule: BillingRuleRecord | null;
    onClose: () => void;
    onSaved: (rule: BillingRuleRecord) => void;
}

type PaymentMode = "days" | "month_offset";

const todayIso = (): string => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
};

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const CLOSING_DAY_OPTIONS: Array<{ value: number; label: string }> = [
    ...Array.from({ length: 28 }, (_, i) => ({ value: i + 1, label: `${i + 1}日` })),
    { value: 99, label: "末日" },
];
const PAYMENT_DAY_OPTIONS = CLOSING_DAY_OPTIONS;

export function BillingRuleEditor({ clientId, currentRule, onClose, onSaved }: BillingRuleEditorProps) {
    const initial = useMemo(() => buildInitialState(currentRule), [currentRule]);
    const [effectiveFrom, setEffectiveFrom] = useState(initial.effective_from);
    const [cycle, setCycle] = useState<BillingCycle>(initial.cycle);
    const [closingDay, setClosingDay] = useState<number>(initial.closing_day);
    const [closingWeekday, setClosingWeekday] = useState<number>(initial.closing_weekday);
    const [biweeklyAnchor, setBiweeklyAnchor] = useState<string>(initial.biweekly_anchor);
    const [paymentMode, setPaymentMode] = useState<PaymentMode>(initial.payment_mode);
    const [paymentDays, setPaymentDays] = useState<number>(initial.payment_days);
    const [paymentMonthOffset, setPaymentMonthOffset] = useState<number>(initial.payment_month_offset);
    const [paymentDay, setPaymentDay] = useState<number>(initial.payment_day);
    const [notes, setNotes] = useState<string>("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        try {
            const payload: CreateBillingRuleInput = {
                effective_from: effectiveFrom,
                billing_cycle: cycle,
                closing_rule:
                    cycle === "monthly"
                        ? { day: closingDay }
                        : cycle === "weekly"
                            ? { weekday: closingWeekday }
                            : { weekday: closingWeekday, anchor_date: biweeklyAnchor },
                payment_rule:
                    paymentMode === "days"
                        ? { days: paymentDays }
                        : { month_offset: paymentMonthOffset, day: paymentDay },
                notes: notes.trim() ? notes.trim() : null,
            };
            const created = await createBillingRule(clientId, payload);
            onSaved(created);
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <AnimatePresence>
            <motion.div
                className={styles.overlay}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
            />
            <motion.div
                className={styles.modal}
                initial={{ opacity: 0, y: 30, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 30, scale: 0.96 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
            >
                <header className={styles.header}>
                    <h3>締め払いルールを変更</h3>
                    <button className={styles.iconButton} onClick={onClose} aria-label="閉じる">
                        <X size={18} />
                    </button>
                </header>

                <div className={styles.body}>
                    <p className={styles.helper}>
                        新しいルールは適用開始日から有効になり、現行ルールはその日で終了します。
                        過去の締め期間は変更されません。
                    </p>

                    <div className={styles.field}>
                        <label className={styles.label}>適用開始日</label>
                        <input
                            type="date"
                            className={styles.input}
                            value={effectiveFrom}
                            onChange={(e) => setEffectiveFrom(e.target.value)}
                        />
                    </div>

                    <div className={styles.field}>
                        <label className={styles.label}>周期</label>
                        <div className={styles.segment}>
                            {(["monthly", "weekly", "biweekly"] as BillingCycle[]).map((c) => (
                                <button
                                    key={c}
                                    type="button"
                                    className={`${styles.segmentBtn} ${cycle === c ? styles.segmentBtnActive : ""}`}
                                    onClick={() => setCycle(c)}
                                >
                                    {c === "monthly" ? "月次" : c === "weekly" ? "毎週" : "隔週"}
                                </button>
                            ))}
                        </div>
                    </div>

                    {cycle === "monthly" && (
                        <div className={styles.field}>
                            <label className={styles.label}>締め日</label>
                            <select
                                className={styles.input}
                                value={closingDay}
                                onChange={(e) => setClosingDay(Number(e.target.value))}
                            >
                                {CLOSING_DAY_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                        毎月{opt.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {(cycle === "weekly" || cycle === "biweekly") && (
                        <div className={styles.field}>
                            <label className={styles.label}>締め曜日</label>
                            <select
                                className={styles.input}
                                value={closingWeekday}
                                onChange={(e) => setClosingWeekday(Number(e.target.value))}
                            >
                                {WEEKDAY_LABELS.map((label, idx) => (
                                    <option key={idx} value={idx}>
                                        毎週{label}曜
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {cycle === "biweekly" && (
                        <div className={styles.field}>
                            <label className={styles.label}>隔週のアンカー日</label>
                            <input
                                type="date"
                                className={styles.input}
                                value={biweeklyAnchor}
                                onChange={(e) => setBiweeklyAnchor(e.target.value)}
                            />
                            <small className={styles.smallHelper}>
                                この日を起点に14日ごとに締めます
                            </small>
                        </div>
                    )}

                    <div className={styles.field}>
                        <label className={styles.label}>入金</label>
                        <div className={styles.segment}>
                            <button
                                type="button"
                                className={`${styles.segmentBtn} ${paymentMode === "days" ? styles.segmentBtnActive : ""}`}
                                onClick={() => setPaymentMode("days")}
                            >
                                N日後
                            </button>
                            <button
                                type="button"
                                className={`${styles.segmentBtn} ${paymentMode === "month_offset" ? styles.segmentBtnActive : ""}`}
                                onClick={() => setPaymentMode("month_offset")}
                            >
                                月跨ぎ
                            </button>
                        </div>
                    </div>

                    {paymentMode === "days" && (
                        <div className={styles.field}>
                            <label className={styles.label}>締め日から何日後に入金</label>
                            <div className={styles.inlineRow}>
                                <input
                                    type="number"
                                    className={styles.input}
                                    value={paymentDays}
                                    min={0}
                                    max={365}
                                    onChange={(e) => setPaymentDays(Number(e.target.value))}
                                />
                                <span>日後</span>
                            </div>
                        </div>
                    )}

                    {paymentMode === "month_offset" && (
                        <div className={styles.fieldRow}>
                            <div className={styles.field}>
                                <label className={styles.label}>月</label>
                                <select
                                    className={styles.input}
                                    value={paymentMonthOffset}
                                    onChange={(e) => setPaymentMonthOffset(Number(e.target.value))}
                                >
                                    <option value={0}>当月</option>
                                    <option value={1}>翌月</option>
                                    <option value={2}>翌々月</option>
                                </select>
                            </div>
                            <div className={styles.field}>
                                <label className={styles.label}>日</label>
                                <select
                                    className={styles.input}
                                    value={paymentDay}
                                    onChange={(e) => setPaymentDay(Number(e.target.value))}
                                >
                                    {PAYMENT_DAY_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    )}

                    <div className={styles.field}>
                        <label className={styles.label}>メモ (任意)</label>
                        <input
                            type="text"
                            className={styles.input}
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="例: 4月から週次に変更（先方依頼）"
                        />
                    </div>

                    {error && <div className={styles.error}>{error}</div>}
                </div>

                <footer className={styles.footer}>
                    <button className={styles.cancelBtn} onClick={onClose} disabled={saving}>
                        キャンセル
                    </button>
                    <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>
                        {saving ? (
                            <>
                                <Loader2 size={16} className={styles.spin} />
                                保存中
                            </>
                        ) : (
                            <>
                                <Save size={16} />
                                ルールを保存
                            </>
                        )}
                    </button>
                </footer>
            </motion.div>
        </AnimatePresence>
    );
}

function buildInitialState(currentRule: BillingRuleRecord | null) {
    const fallback = {
        effective_from: todayIso(),
        cycle: "monthly" as BillingCycle,
        closing_day: 99,
        closing_weekday: 5,
        biweekly_anchor: todayIso(),
        payment_mode: "month_offset" as PaymentMode,
        payment_days: 30,
        payment_month_offset: 1,
        payment_day: 99,
    };
    if (!currentRule) return fallback;

    const cycle = currentRule.billing_cycle === "custom" ? "monthly" : currentRule.billing_cycle;
    const cr = currentRule.closing_rule;
    const pr = currentRule.payment_rule;
    const paymentMode: PaymentMode = typeof pr.days === "number" ? "days" : "month_offset";

    return {
        effective_from: todayIso(),
        cycle,
        closing_day: typeof cr.day === "number" ? cr.day : fallback.closing_day,
        closing_weekday: typeof cr.weekday === "number" ? cr.weekday : fallback.closing_weekday,
        biweekly_anchor: cr.anchor_date ?? fallback.biweekly_anchor,
        payment_mode: paymentMode,
        payment_days: typeof pr.days === "number" ? pr.days : fallback.payment_days,
        payment_month_offset: typeof pr.month_offset === "number" ? pr.month_offset : fallback.payment_month_offset,
        payment_day: typeof pr.day === "number" ? pr.day : fallback.payment_day,
    };
}
