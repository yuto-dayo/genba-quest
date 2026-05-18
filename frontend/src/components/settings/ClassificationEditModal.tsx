import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Clock, ExternalLink, Loader2, X } from "lucide-react";
import {
    submitClassificationProposal,
    type ClassificationCheckResults,
    type MemberInvoiceRegistrationStatus,
    type Member,
    type MemberContractType,
    type MemberTaxClassification,
} from "../../lib/api";
import { getErrorMessage } from "../../lib/error";
import styles from "./ClassificationPanel.module.css";

const CHECK_ITEMS: Array<{
    key: keyof ClassificationCheckResults;
    label: string;
}> = [
    { key: "q1_substitution", label: "代わりの人を立てられる" },
    { key: "q2_time_freedom", label: "出退勤を強く縛られない" },
    { key: "q3_work_autonomy", label: "作業方法を自分で決められる" },
    { key: "q4_own_tools", label: "主要な用具を本人が持つ" },
    { key: "q5_outcome_liability", label: "成果への責任を負う" },
];

const emptyChecks: ClassificationCheckResults = {
    q1_substitution: false,
    q2_time_freedom: false,
    q3_work_autonomy: false,
    q4_own_tools: false,
    q5_outcome_liability: false,
};

const INVOICE_STATUS_OPTIONS: Array<{ value: MemberInvoiceRegistrationStatus; label: string }> = [
    { value: "registered", label: "登録済み" },
    { value: "exempt", label: "免税" },
    { value: "transitional", label: "経過措置" },
    { value: "unknown", label: "未確認" },
];

function normalizeInvoiceNumber(value: string): string {
    return value.trim().toUpperCase();
}

function isValidInvoiceNumber(value: string): boolean {
    return /^T[0-9]{13}$/.test(normalizeInvoiceNumber(value));
}

function corporateNumberChecksumLooksValid(value: string): boolean | null {
    const normalized = normalizeInvoiceNumber(value);
    if (!/^T[0-9]{13}$/.test(normalized)) {
        return null;
    }

    const digits = normalized.slice(1);
    const checkDigit = Number(digits[0]);
    const baseDigits = digits.slice(1).split("").reverse().map(Number);
    const weightedSum = baseDigits.reduce((sum, digit, index) => sum + digit * (index % 2 === 0 ? 1 : 2), 0);
    return checkDigit === 9 - (weightedSum % 9);
}

function todayIsoDate(): string {
    return new Date().toISOString().slice(0, 10);
}

function suggestContractType(results: ClassificationCheckResults): MemberContractType {
    const yesCount = CHECK_ITEMS.filter((item) => results[item.key]).length;
    if (yesCount >= 4) {
        return "subcontract";
    }
    if (yesCount <= 2) {
        return "employee_like";
    }
    return "undetermined";
}

function contractLabel(type: MemberContractType): string {
    if (type === "subcontract") return "外注";
    if (type === "employee_like") return "給与寄り";
    return "未判定";
}

interface ClassificationEditModalProps {
    member: Member;
    active: MemberTaxClassification | null;
    history: MemberTaxClassification[];
    onClose: () => void;
    onSubmitted: () => void;
}

export function ClassificationEditModal({
    member,
    active,
    history,
    onClose,
    onSubmitted,
}: ClassificationEditModalProps) {
    const [checks, setChecks] = useState<ClassificationCheckResults>(active?.classification_check_results ?? emptyChecks);
    const [notes, setNotes] = useState(active?.classification_notes ?? "");
    const [invoiceStatus, setInvoiceStatus] = useState<MemberInvoiceRegistrationStatus>(active?.invoice_registration_status ?? "unknown");
    const [invoiceNumber, setInvoiceNumber] = useState(active?.invoice_registration_number ?? "");
    const [effectiveFrom, setEffectiveFrom] = useState(todayIsoDate());
    const [tab, setTab] = useState<"edit" | "history">("edit");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        setChecks(active?.classification_check_results ?? emptyChecks);
        setNotes(active?.classification_notes ?? "");
        setInvoiceStatus(active?.invoice_registration_status ?? "unknown");
        setInvoiceNumber(active?.invoice_registration_number ?? "");
        setEffectiveFrom(todayIsoDate());
        setError(null);
        setMessage(null);
    }, [active, member.id]);

    const yesCount = useMemo(() => CHECK_ITEMS.filter((item) => checks[item.key]).length, [checks]);
    const suggestedType = suggestContractType(checks);
    const riskHigh = yesCount <= 2;
    const normalizedInvoiceNumber = normalizeInvoiceNumber(invoiceNumber);
    const invoiceNumberValid = !normalizedInvoiceNumber || isValidInvoiceNumber(normalizedInvoiceNumber);
    const checksumLooksValid = corporateNumberChecksumLooksValid(normalizedInvoiceNumber);

    const handleSubmit = async () => {
        try {
            setBusy(true);
            setError(null);
            setMessage(null);
            if (invoiceStatus === "registered" && !isValidInvoiceNumber(invoiceNumber)) {
                setError("登録済みの場合は T + 13桁で入力してください。");
                return;
            }
            if (normalizedInvoiceNumber && !invoiceNumberValid) {
                setError("T番号は T + 13桁で入力してください。");
                return;
            }
            await submitClassificationProposal({
                member_id: member.id,
                contract_type: suggestedType,
                tax_withholding_category: "none",
                classification_check_results: checks,
                classification_notes: notes,
                invoice_registration_status: invoiceStatus,
                invoice_registration_number: normalizedInvoiceNumber || null,
                effective_from: effectiveFrom,
            });
            setMessage("承認待ちにしました。");
            onSubmitted();
        } catch (submitError: unknown) {
            setError(getErrorMessage(submitError));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className={styles.modalBackdrop} role="presentation">
            <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="classification-title">
                <header className={styles.modalHeader}>
                    <div>
                        <p className={styles.eyebrow}>契約区分</p>
                        <h2 id="classification-title">{member.display_name || member.full_name || member.username || "未設定"}</h2>
                    </div>
                    <button type="button" className={styles.iconButton} onClick={onClose} aria-label="閉じる">
                        <X size={18} />
                    </button>
                </header>

                <div className={styles.tabs} role="tablist" aria-label="契約区分">
                    <button
                        type="button"
                        className={tab === "edit" ? styles.tabActive : styles.tab}
                        onClick={() => setTab("edit")}
                    >
                        判定
                    </button>
                    <button
                        type="button"
                        className={tab === "history" ? styles.tabActive : styles.tab}
                        onClick={() => setTab("history")}
                    >
                        履歴
                    </button>
                </div>

                {tab === "edit" ? (
                    <div className={styles.modalBody}>
                        <div className={riskHigh ? styles.riskBanner : styles.suggestionBanner}>
                            {riskHigh ? <AlertTriangle size={18} /> : <Check size={18} />}
                            <span>
                                {riskHigh
                                    ? `給与扱いリスク / YES ${yesCount}`
                                    : `${contractLabel(suggestedType)}候補 / YES ${yesCount}`}
                            </span>
                        </div>

                        <div className={styles.checkList}>
                            {CHECK_ITEMS.map((item) => {
                                const checked = checks[item.key];
                                return (
                                    <button
                                        key={item.key}
                                        type="button"
                                        className={checked ? styles.checkItemActive : styles.checkItem}
                                        onClick={() => {
                                            setChecks((current) => ({ ...current, [item.key]: !current[item.key] }));
                                            setMessage(null);
                                        }}
                                        aria-pressed={checked}
                                    >
                                        <span>{item.label}</span>
                                        <strong>{checked ? "YES" : "NO"}</strong>
                                    </button>
                                );
                            })}
                        </div>

                        <label className={styles.field}>
                            <span>開始日</span>
                            <input
                                type="date"
                                value={effectiveFrom}
                                onChange={(event) => setEffectiveFrom(event.target.value)}
                            />
                        </label>

                        <div className={styles.sectionBlock}>
                            <div className={styles.sectionHeader}>
                                <span>インボイス登録</span>
                                <a
                                    href="https://www.invoice-kohyo.nta.go.jp/"
                                    target="_blank"
                                    rel="noreferrer"
                                    className={styles.textLink}
                                >
                                    公表サイト
                                    <ExternalLink size={14} />
                                </a>
                            </div>

                            <label className={styles.field}>
                                <span>登録状況</span>
                                <select
                                    value={invoiceStatus}
                                    onChange={(event) => {
                                        setInvoiceStatus(event.target.value as MemberInvoiceRegistrationStatus);
                                        setMessage(null);
                                    }}
                                >
                                    {INVOICE_STATUS_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <label className={styles.field}>
                                <span>T番号</span>
                                <input
                                    value={invoiceNumber}
                                    onChange={(event) => {
                                        setInvoiceNumber(event.target.value);
                                        setMessage(null);
                                    }}
                                    placeholder="T1234567890123"
                                    inputMode="text"
                                    aria-invalid={!invoiceNumberValid}
                                />
                            </label>
                            <p className={invoiceNumberValid ? styles.helperText : styles.error}>
                                {!normalizedInvoiceNumber
                                    ? "登録済みの場合だけ入力します。"
                                    : !invoiceNumberValid
                                        ? "T + 13桁で入力してください。"
                                        : checksumLooksValid
                                            ? "形式と法人番号の検査数字はOKです。"
                                            : "形式OK。個人事業主番号の可能性もあるため、公表サイトで確認してください。"}
                            </p>
                        </div>

                        <label className={styles.field}>
                            <span>メモ</span>
                            <textarea
                                value={notes}
                                onChange={(event) => setNotes(event.target.value)}
                                rows={3}
                                placeholder="契約書や現場運用の根拠"
                            />
                        </label>

                        {error && <p className={styles.error}>{error}</p>}
                        {message && <p className={styles.success}>{message}</p>}

                        <footer className={styles.modalActions}>
                            <button type="button" className={styles.secondaryButton} onClick={onClose}>
                                閉じる
                            </button>
                            <button
                                type="button"
                                className={styles.primaryButton}
                                onClick={() => void handleSubmit()}
                                disabled={busy}
                                aria-busy={busy}
                            >
                                {busy ? <Loader2 size={16} className={styles.spinner} /> : <Clock size={16} />}
                                申請する
                            </button>
                        </footer>
                    </div>
                ) : (
                    <div className={styles.modalBody}>
                        {history.length === 0 ? (
                            <div className={styles.emptyState}>履歴なし</div>
                        ) : (
                            <div className={styles.historyList}>
                                {history.map((row) => (
                                    <div key={row.id} className={styles.historyItem}>
                                        <div>
                                            <strong>{contractLabel(row.contract_type)}</strong>
                                            <span>
                                                {row.effective_from} から {row.effective_until || "現在"}
                                            </span>
                                        </div>
                                        <small>YES {CHECK_ITEMS.filter((item) => row.classification_check_results[item.key]).length}</small>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </section>
        </div>
    );
}
