import { useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, FileUp, Loader2, X } from "lucide-react";
import {
    submitDisputeCorrectionProposal,
    uploadDocument,
    type DisputeCorrectionKind,
} from "../../lib/api";
import { getErrorMessage } from "../../lib/error";
import styles from "./DisputeCorrectionModal.module.css";

const KIND_OPTIONS: Array<{ value: DisputeCorrectionKind; label: string; hint: string }> = [
    { value: "reward_amount", label: "報酬額", hint: "金額そのもの" },
    { value: "reimbursement_missing", label: "立替漏れ", hint: "未精算の立替" },
    { value: "level_misjudgment", label: "レベル", hint: "判定違い" },
    { value: "attendance_days", label: "出勤日数", hint: "日数違い" },
    { value: "other", label: "その他", hint: "別の理由" },
];

interface DisputeCorrectionModalProps {
    month: string;
    targetMemberId: string;
    rewardMemberId?: string | null;
    currentRewardAmount: number;
    currentReimbursementAmount?: number;
    currentAttendanceDays?: number | null;
    currentLevel?: string | null;
    onClose: () => void;
    onSubmitted?: () => Promise<void> | void;
}

function formatYen(amount: number): string {
    return new Intl.NumberFormat("ja-JP", {
        style: "currency",
        currency: "JPY",
        maximumFractionDigits: 0,
    }).format(amount);
}

function numberFromInput(value: string): number {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
}

function readFileBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = typeof reader.result === "string" ? reader.result : "";
            resolve(result.includes(",") ? result.split(",")[1] : result);
        };
        reader.onerror = () => reject(reader.error || new Error("FILE_READ_FAILED"));
        reader.readAsDataURL(file);
    });
}

export function DisputeCorrectionModal({
    month,
    targetMemberId,
    rewardMemberId,
    currentRewardAmount,
    currentReimbursementAmount = 0,
    currentAttendanceDays = null,
    currentLevel = null,
    onClose,
    onSubmitted,
}: DisputeCorrectionModalProps) {
    const [kind, setKind] = useState<DisputeCorrectionKind>("reward_amount");
    const [fromAmount, setFromAmount] = useState(String(Math.max(currentRewardAmount, 0)));
    const [toAmount, setToAmount] = useState(String(Math.max(currentRewardAmount, 0)));
    const [reason, setReason] = useState("");
    const [attendanceDays, setAttendanceDays] = useState(currentAttendanceDays ? String(currentAttendanceDays) : "");
    const [level, setLevel] = useState(currentLevel ?? "");
    const [otherDetail, setOtherDetail] = useState("");
    const [files, setFiles] = useState<File[]>([]);
    const [confirming, setConfirming] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const numericFrom = numberFromInput(fromAmount);
    const numericTo = numberFromInput(toAmount);
    const delta = numericTo - numericFrom;

    const selectedKind = useMemo(
        () => KIND_OPTIONS.find((option) => option.value === kind) ?? KIND_OPTIONS[0],
        [kind],
    );

    function applyKind(nextKind: DisputeCorrectionKind) {
        setKind(nextKind);
        setError(null);
        if (nextKind === "reimbursement_missing") {
            setFromAmount("0");
            setToAmount(String(Math.max(currentReimbursementAmount, 0)));
            return;
        }
        setFromAmount(String(Math.max(currentRewardAmount, 0)));
        setToAmount(String(Math.max(currentRewardAmount, 0)));
    }

    function validate(): boolean {
        if (!targetMemberId) {
            setError("ログイン情報を確認できませんでした");
            return false;
        }
        if (!Number.isFinite(numericFrom) || numericFrom < 0 || !Number.isFinite(numericTo) || numericTo < 0) {
            setError("金額を確認してください");
            return false;
        }
        if (numericFrom === numericTo) {
            setError("修正前後の金額が同じです");
            return false;
        }
        if (reason.trim().length < 3) {
            setError("理由を入力してください");
            return false;
        }
        return true;
    }

    async function handleConfirm() {
        if (!validate()) return;
        setConfirming(true);
    }

    async function handleSubmit() {
        if (submitting || !validate()) return;
        setSubmitting(true);
        setError(null);
        try {
            const sourceDocumentIds: string[] = [];
            for (const file of files) {
                const fileBase64 = await readFileBase64(file);
                const document = await uploadDocument({
                    file_base64: fileBase64,
                    mime_type: file.type || "application/octet-stream",
                    original_filename: file.name,
                    doc_type: "other",
                });
                sourceDocumentIds.push(document.id);
            }

            await submitDisputeCorrectionProposal({
                target_member_id: targetMemberId,
                reward_member_id: rewardMemberId ?? undefined,
                month,
                correction_kind: kind,
                from_amount: numericFrom,
                to_amount: numericTo,
                reason: reason.trim(),
                source_document_ids: sourceDocumentIds,
                details: {
                    attendance_days: attendanceDays ? Number(attendanceDays) : null,
                    level: level || null,
                    note: otherDetail || null,
                },
            });
            await onSubmitted?.();
            onClose();
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className={styles.scrim} onClick={onClose}>
            <section
                className={styles.modal}
                role="dialog"
                aria-modal="true"
                aria-labelledby="dispute-correction-title"
                onClick={(event) => event.stopPropagation()}
            >
                <header className={styles.header}>
                    <div>
                        <p className={styles.eyebrow}>{month}</p>
                        <h2 id="dispute-correction-title" className={styles.title}>
                            計算がおかしい？
                        </h2>
                    </div>
                    <button type="button" className={styles.iconButton} onClick={onClose} aria-label="閉じる">
                        <X size={20} aria-hidden="true" />
                    </button>
                </header>

                <div className={styles.body}>
                    {!confirming ? (
                        <>
                            <section className={styles.section} aria-labelledby="dispute-kind">
                                <h3 id="dispute-kind" className={styles.sectionTitle}>修正したいもの</h3>
                                <div className={styles.kindGrid}>
                                    {KIND_OPTIONS.map((option) => (
                                        <label key={option.value} className={styles.kindOption}>
                                            <input
                                                type="radio"
                                                name="correction_kind"
                                                value={option.value}
                                                checked={kind === option.value}
                                                onChange={() => applyKind(option.value)}
                                            />
                                            <span>
                                                <strong>{option.label}</strong>
                                                <small>{option.hint}</small>
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </section>

                            <section className={styles.section} aria-labelledby="dispute-amount">
                                <h3 id="dispute-amount" className={styles.sectionTitle}>差分</h3>
                                <div className={styles.amountGrid}>
                                    <label className={styles.field}>
                                        <span>今の金額</span>
                                        <input
                                            inputMode="numeric"
                                            value={fromAmount}
                                            onChange={(event) => setFromAmount(event.target.value)}
                                        />
                                    </label>
                                    <label className={styles.field}>
                                        <span>正しい金額</span>
                                        <input
                                            inputMode="numeric"
                                            value={toAmount}
                                            onChange={(event) => setToAmount(event.target.value)}
                                        />
                                    </label>
                                </div>
                                <p className={styles.deltaLine}>
                                    差分 <strong>{delta >= 0 ? "+" : "-"}{formatYen(Math.abs(delta))}</strong>
                                </p>
                            </section>

                            {(kind === "level_misjudgment" || kind === "attendance_days" || kind === "other") && (
                                <section className={styles.section} aria-labelledby="dispute-detail">
                                    <h3 id="dispute-detail" className={styles.sectionTitle}>{selectedKind.label}の内容</h3>
                                    {kind === "attendance_days" && (
                                        <label className={styles.field}>
                                            <span>正しい日数</span>
                                            <input
                                                inputMode="numeric"
                                                value={attendanceDays}
                                                onChange={(event) => setAttendanceDays(event.target.value)}
                                            />
                                        </label>
                                    )}
                                    {kind === "level_misjudgment" && (
                                        <label className={styles.field}>
                                            <span>正しいレベル</span>
                                            <input value={level} onChange={(event) => setLevel(event.target.value)} />
                                        </label>
                                    )}
                                    {kind === "other" && (
                                        <label className={styles.field}>
                                            <span>内容</span>
                                            <input value={otherDetail} onChange={(event) => setOtherDetail(event.target.value)} />
                                        </label>
                                    )}
                                </section>
                            )}

                            <section className={styles.section} aria-labelledby="dispute-reason">
                                <h3 id="dispute-reason" className={styles.sectionTitle}>理由</h3>
                                <textarea
                                    className={styles.textarea}
                                    value={reason}
                                    onChange={(event) => setReason(event.target.value)}
                                    placeholder="例: 6/3現場漏れ"
                                />
                            </section>

                            <section className={styles.section} aria-labelledby="dispute-evidence">
                                <h3 id="dispute-evidence" className={styles.sectionTitle}>証拠画像</h3>
                                <label className={styles.fileDrop}>
                                    <FileUp size={18} aria-hidden="true" />
                                    <span>{files.length > 0 ? `${files.length}件選択中` : "画像を選ぶ"}</span>
                                    <input
                                        type="file"
                                        accept="image/*,application/pdf"
                                        multiple
                                        onChange={(event) => setFiles(Array.from(event.target.files ?? []).slice(0, 5))}
                                    />
                                </label>
                            </section>
                        </>
                    ) : (
                        <div className={styles.confirmPanel}>
                            <CheckCircle2 size={22} aria-hidden="true" />
                            <div>
                                <h3 className={styles.confirmTitle}>この内容で提出</h3>
                                <p>{selectedKind.label}: {formatYen(numericFrom)} → {formatYen(numericTo)}</p>
                                <p>{reason.trim()}</p>
                            </div>
                        </div>
                    )}

                    {error && (
                        <p className={styles.errorPanel} role="alert">
                            <AlertCircle size={18} aria-hidden="true" />
                            {error}
                        </p>
                    )}
                </div>

                <footer className={styles.actions}>
                    {confirming && (
                        <button type="button" className={styles.secondaryButton} disabled={submitting} onClick={() => setConfirming(false)}>
                            <ArrowLeft size={16} aria-hidden="true" />
                            戻る
                        </button>
                    )}
                    <button type="button" className={styles.secondaryButton} disabled={submitting} onClick={onClose}>
                        閉じる
                    </button>
                    {!confirming ? (
                        <button type="button" className={styles.primaryButton} onClick={handleConfirm}>
                            確認
                        </button>
                    ) : (
                        <button type="button" className={styles.primaryButton} disabled={submitting} onClick={handleSubmit}>
                            {submitting && <Loader2 size={16} aria-hidden="true" />}
                            提出
                        </button>
                    )}
                </footer>
            </section>
        </div>
    );
}
