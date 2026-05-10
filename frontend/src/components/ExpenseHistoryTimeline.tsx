/**
 * 経費の編集履歴タイムライン (F-2).
 * append-only な expense_field_change_log を時系列で表示する。
 *
 * 設計原則: 番頭レス可視性 — 誰が・いつ・何を変えたかが、画面開いた瞬間に
 * 全部見えるようにする。AI推定 / OCR / 人間の動きが色とラベルで区別される。
 *
 * docs/MONEY_EXPENSE_FLOW.md §5.3
 */

import { useEffect, useState } from "react";
import { fetchExpenseHistory, type ExpenseHistoryEntry } from "../lib/api";
import { getErrorMessage } from "../lib/error";
import { EXPENSE_SCOPE_LABEL, type ExpenseScope } from "../lib/expenseLabels";
import styles from "./ExpenseHistoryTimeline.module.css";

interface Props {
    expenseId: string;
}

const FIELD_LABEL: Record<string, string> = {
    registered: "登録",
    ocr_extracted: "レシート読み取り",
    amount_total: "金額",
    vendor_name: "店",
    recorded_date: "日付",
    expense_scope: "紐付け先",
    site_id: "現場",
    cost_center: "場所区分",
    category: "カテゴリ",
    expense_item_code: "内訳",
    invoice_number: "インボイス番号",
    tax_category: "税区分",
    paid_by: "支払い元",
    requires_review: "要レビュー",
};

const ACTOR_TAG: Record<ExpenseHistoryEntry["changed_by"]["type"], string> = {
    human: "職人",
    ai: "AI判定",
    system: "システム",
    integration: "外部連携",
};

const SOURCE_LABEL: Record<ExpenseHistoryEntry["source"], string> = {
    manual: "手入力",
    ai_inference: "AIの推定",
    system_auto: "自動",
};

function formatDateTime(iso: string): string {
    try {
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return iso;
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        const hh = String(date.getHours()).padStart(2, "0");
        const mm = String(date.getMinutes()).padStart(2, "0");
        return `${y}-${m}-${d} ${hh}:${mm}`;
    } catch {
        return iso;
    }
}

/** 値を職人語の表示形に整える. enum はラベル経由、それ以外はそのまま. */
function renderValue(field: string, value: unknown): string {
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value === "boolean") return value ? "はい" : "いいえ";
    if (field === "expense_scope" && typeof value === "string") {
        return EXPENSE_SCOPE_LABEL[value as ExpenseScope] ?? value;
    }
    if (field === "amount_total" && typeof value === "number") {
        return `¥${value.toLocaleString()}`;
    }
    if (typeof value === "string" || typeof value === "number") {
        return String(value);
    }
    return JSON.stringify(value);
}

function fieldLabel(field: string): string {
    return FIELD_LABEL[field] ?? field;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function describeActor(entry: ExpenseHistoryEntry): { name: string; tag: string } {
    const { changed_by } = entry;
    const name = changed_by.name && changed_by.name.trim().length > 0
        ? changed_by.name
        : changed_by.type === "system"
            ? "システム"
            : changed_by.type === "ai"
                ? "AI"
                : "ユーザー";
    return { name, tag: ACTOR_TAG[changed_by.type] };
}

function entryToneClass(entry: ExpenseHistoryEntry): string {
    if (entry.changed_by.type === "ai" || entry.source === "ai_inference") return styles.ai;
    if (entry.changed_by.type === "system" || entry.source === "system_auto") return styles.system;
    return "";
}

function renderRegisteredPayload(payload: Record<string, unknown>) {
    const keys = [
        "amount_total",
        "vendor_name",
        "expense_scope",
        "site_id",
        "category",
        "invoice_number",
    ].filter((key) => payload[key] !== undefined);
    if (keys.length === 0) {
        return <div>登録しました</div>;
    }
    return (
        <ul className={styles.fieldsList}>
            {keys.map((key) => (
                <li key={key}>
                    <span className={styles.fieldKey}>{fieldLabel(key)}</span>
                    <span className={styles.fieldVal}>{renderValue(key, payload[key])}</span>
                </li>
            ))}
        </ul>
    );
}

function renderEntryDetail(entry: ExpenseHistoryEntry) {
    if (entry.field === "registered" && isJsonObject(entry.new_value)) {
        return renderRegisteredPayload(entry.new_value);
    }
    if (entry.field === "ocr_extracted" && isJsonObject(entry.new_value)) {
        const keys = Object.keys(entry.new_value);
        if (keys.length === 0) return <div>レシートから情報を読み取りました</div>;
        return (
            <div>
                レシートから読み取り:&nbsp;
                {keys.map((key, idx) => (
                    <span key={key}>
                        <span className={styles.keyChip}>{fieldLabel(key)}</span>
                        {idx < keys.length - 1 ? " " : ""}
                    </span>
                ))}
            </div>
        );
    }

    // 一般的な field 編集 (old → new)
    return (
        <div>
            <span className={styles.keyChip}>{fieldLabel(entry.field)}</span>
            {" : "}
            <code>{renderValue(entry.field, entry.old_value)}</code>
            {" → "}
            <code>{renderValue(entry.field, entry.new_value)}</code>
        </div>
    );
}

export function ExpenseHistoryTimeline({ expenseId }: Props) {
    const [entries, setEntries] = useState<ExpenseHistoryEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        fetchExpenseHistory(expenseId)
            .then((res) => {
                if (!cancelled) setEntries(res.entries);
            })
            .catch((err: unknown) => {
                if (!cancelled) setError(getErrorMessage(err));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [expenseId]);

    return (
        <section className={styles.section} aria-label="編集履歴">
            <h4 className={styles.heading}>編集履歴</h4>
            {error ? (
                <div className={styles.error}>履歴を取得できませんでした: {error}</div>
            ) : loading ? (
                <div className={styles.empty}>読み込み中…</div>
            ) : entries.length === 0 ? (
                <div className={styles.empty}>まだ編集はありません</div>
            ) : (
                <div className={styles.list}>
                    {entries.map((entry) => {
                        const actor = describeActor(entry);
                        return (
                            <div key={entry.id} className={`${styles.entry} ${entryToneClass(entry)}`}>
                                <div className={styles.time}>{formatDateTime(entry.changed_at)}</div>
                                <div className={styles.actor}>
                                    {actor.name}
                                    <span className={styles.actorTag}>{actor.tag}</span>
                                    <span className={styles.actorTag}>{SOURCE_LABEL[entry.source]}</span>
                                </div>
                                <div className={styles.detail}>{renderEntryDetail(entry)}</div>
                                {entry.reason && (
                                    <div className={styles.detail} style={{ marginTop: 4, opacity: 0.85 }}>
                                        理由: {entry.reason}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
