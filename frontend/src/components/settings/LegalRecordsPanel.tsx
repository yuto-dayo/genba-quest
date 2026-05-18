import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Download, FileArchive, FileText, Loader2, RefreshCw } from "lucide-react";
import {
    compileLegalRecords,
    downloadLegalRecordCsv,
    downloadLegalRecordMemberCopiesZip,
    downloadLegalRecordMemberCopy,
    fetchLegalRecords,
    markLegalRecordSubmitted,
    type LegalRecordSubmission,
} from "../../lib/api";
import { getErrorMessage } from "../../lib/error";
import styles from "./LegalRecordsPanel.module.css";

function previousYear(): number {
    return new Date().getFullYear() - 1;
}

function formatYen(value: number): string {
    return `¥${Math.round(value).toLocaleString("ja-JP")}`;
}

function addressText(record: LegalRecordSubmission): string {
    return [
        record.snapshot_address.postal_code,
        record.snapshot_address.prefecture,
        record.snapshot_address.city,
        record.snapshot_address.address_line1,
        record.snapshot_address.address_line2,
    ].filter(Boolean).join(" ") || "住所未設定";
}

function saveBlob(blob: Blob, filename: string): void {
    const objectUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(objectUrl);
}

export function LegalRecordsPanel() {
    const [year, setYear] = useState(previousYear());
    const [records, setRecords] = useState<LegalRecordSubmission[]>([]);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const [selected, setSelected] = useState<LegalRecordSubmission | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const total = useMemo(
        () => records.reduce((sum, record) => sum + Number(record.payout_total ?? 0), 0),
        [records],
    );
    const withholdingTotal = useMemo(
        () => records.reduce((sum, record) => sum + Number(record.withholding_total ?? 0), 0),
        [records],
    );

    const load = useCallback(async (targetYear = year) => {
        setLoading(true);
        setError(null);
        try {
            const result = await fetchLegalRecords(targetYear);
            setRecords(result.submissions);
            setSelected((current) => {
                if (!current) return null;
                return result.submissions.find((record) => record.id === current.id) ?? null;
            });
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    }, [year]);

    useEffect(() => {
        void load(year);
    }, [load, year]);

    const compile = async () => {
        setBusy("compile");
        setError(null);
        setMessage(null);
        try {
            const result = await compileLegalRecords(year);
            setRecords(result.submissions);
            setSelected(null);
            setMessage(`${year}年分を集計しました。対象者 ${result.submissions.length} 名。`);
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setBusy(null);
        }
    };

    const download = async (kind: "csv" | "zip" | "pdf", record?: LegalRecordSubmission) => {
        setBusy(kind === "pdf" && record ? `pdf:${record.member_id}` : kind);
        setError(null);
        setMessage(null);
        try {
            const file = kind === "csv"
                ? await downloadLegalRecordCsv(year)
                : kind === "zip"
                    ? await downloadLegalRecordMemberCopiesZip(year)
                    : await downloadLegalRecordMemberCopy(year, record!.member_id);
            saveBlob(file.blob, file.filename);
            setMessage(kind === "csv" ? "税務署提出CSVを作成しました。" : "本人交付PDFを作成しました。");
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setBusy(null);
        }
    };

    const markSubmitted = async (record: LegalRecordSubmission) => {
        setBusy(`submitted:${record.member_id}`);
        setError(null);
        setMessage(null);
        try {
            const result = await markLegalRecordSubmitted(year, record.member_id);
            setRecords((current) => current.map((row) => row.id === result.submission.id ? result.submission : row));
            setSelected(result.submission);
            setMessage("提出完了にしました。");
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className={styles.panel}>
            <div className={styles.toolbar}>
                <label className={styles.yearField}>
                    <span>年分</span>
                    <input
                        type="number"
                        min="2020"
                        max="2100"
                        value={year}
                        onChange={(event) => setYear(Number(event.target.value))}
                    />
                </label>
                <button type="button" className={styles.secondaryButton} onClick={() => void load()} disabled={loading}>
                    {loading ? <Loader2 size={16} className={styles.spinner} /> : <RefreshCw size={16} />}
                    更新
                </button>
                <button type="button" className={styles.primaryButton} onClick={() => void compile()} disabled={busy === "compile"}>
                    {busy === "compile" ? <Loader2 size={16} className={styles.spinner} /> : <Check size={16} />}
                    集計
                </button>
            </div>

            {error && <p className={styles.error}>{error}</p>}
            {message && <p className={styles.message}>{message}</p>}

            <div className={styles.summaryGrid}>
                <div>
                    <span>対象者</span>
                    <strong>{records.length}名</strong>
                </div>
                <div>
                    <span>支払合計</span>
                    <strong>{formatYen(total)}</strong>
                </div>
                <div>
                    <span>源泉徴収</span>
                    <strong>{formatYen(withholdingTotal)}</strong>
                </div>
            </div>

            <div className={styles.downloadRow}>
                <button type="button" className={styles.primaryButton} onClick={() => void download("csv")} disabled={records.length === 0 || busy === "csv"}>
                    {busy === "csv" ? <Loader2 size={16} className={styles.spinner} /> : <Download size={16} />}
                    CSV
                </button>
                <button type="button" className={styles.secondaryButton} onClick={() => void download("zip")} disabled={records.length === 0 || busy === "zip"}>
                    {busy === "zip" ? <Loader2 size={16} className={styles.spinner} /> : <FileArchive size={16} />}
                    PDF一括
                </button>
            </div>

            <div className={styles.contentGrid}>
                <div className={styles.recordList}>
                    {loading ? (
                        <div className={styles.empty}>読み込み中...</div>
                    ) : records.length === 0 ? (
                        <div className={styles.empty}>対象者なし。集計を実行してください。</div>
                    ) : records.map((record) => (
                        <button
                            key={record.id}
                            type="button"
                            className={`${styles.recordRow} ${selected?.id === record.id ? styles.recordRowActive : ""}`}
                            onClick={() => setSelected(record)}
                        >
                            <span>
                                <strong>{record.snapshot_trade_name || record.member_id.slice(0, 8)}</strong>
                                <small>{record.snapshot_invoice_registration_no || "T番号なし"} / {record.submitted_at ? "提出済" : "未提出"}</small>
                            </span>
                            <b>{formatYen(record.payout_total)}</b>
                        </button>
                    ))}
                </div>

                <div className={styles.detailPane}>
                    {selected ? (
                        <>
                            <div className={styles.detailHeader}>
                                <div>
                                    <span className={styles.eyebrow}>本人交付</span>
                                    <h3>{selected.snapshot_trade_name || selected.member_id.slice(0, 8)}</h3>
                                </div>
                                <span className={styles.statusChip}>{selected.submitted_at ? "提出済" : "未提出"}</span>
                            </div>
                            <dl className={styles.detailList}>
                                <div><dt>住所</dt><dd>{addressText(selected)}</dd></div>
                                <div><dt>支払額</dt><dd>{formatYen(selected.payout_total)}</dd></div>
                                <div><dt>報酬</dt><dd>{formatYen(selected.reward_total)}</dd></div>
                                <div><dt>補正</dt><dd>{formatYen(selected.correction_total)}</dd></div>
                                <div><dt>源泉徴収</dt><dd>{formatYen(selected.withholding_total)}</dd></div>
                            </dl>
                            <div className={styles.monthList}>
                                {selected.monthly_breakdown.map((month) => (
                                    <div key={month.month}>
                                        <span>{month.month}</span>
                                        <strong>{formatYen(month.reward_total + month.correction_total)}</strong>
                                    </div>
                                ))}
                            </div>
                            <div className={styles.downloadRow}>
                                <button
                                    type="button"
                                    className={styles.secondaryButton}
                                    onClick={() => void download("pdf", selected)}
                                    disabled={busy === `pdf:${selected.member_id}`}
                                >
                                    {busy === `pdf:${selected.member_id}` ? <Loader2 size={16} className={styles.spinner} /> : <FileText size={16} />}
                                    個別PDF
                                </button>
                                <button
                                    type="button"
                                    className={styles.secondaryButton}
                                    onClick={() => void markSubmitted(selected)}
                                    disabled={Boolean(selected.submitted_at) || busy === `submitted:${selected.member_id}`}
                                >
                                    {busy === `submitted:${selected.member_id}` ? <Loader2 size={16} className={styles.spinner} /> : <Check size={16} />}
                                    提出済
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className={styles.empty}>対象者を選ぶと月別内訳を確認できます。</div>
                    )}
                </div>
            </div>
        </div>
    );
}
