import { useEffect, useState } from "react";
import { Loader2, Receipt, X } from "lucide-react";
import {
    fetchExtendedProfile,
    issueMemberInvoice,
    type ExtendedProfile,
    type MemberInvoiceDraft,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import styles from "./MemberInvoiceIssueModal.module.css";

interface MemberInvoiceIssueModalProps {
    draft: MemberInvoiceDraft;
    /** ログイン中ユーザの ID。プロフィール snapshot 取得に使う */
    selfUserId: string;
    onClose: () => void;
    onIssued: () => void;
}

type SnapshotState =
    | { kind: "loading" }
    | { kind: "ready"; profile: ExtendedProfile }
    | { kind: "error"; message: string };

const SOURCE_LABEL: Record<MemberInvoiceDraft["source"], string> = {
    path_reward: "PATH 報酬",
    monthly_distribution: "月次分配",
    manual: "手入力",
};

function formatYen(amount: number): string {
    return `¥${amount.toLocaleString()}`;
}

export function MemberInvoiceIssueModal({
    draft,
    selfUserId,
    onClose,
    onIssued,
}: MemberInvoiceIssueModalProps) {
    const [snapshot, setSnapshot] = useState<SnapshotState>({ kind: "loading" });
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const { profile } = await fetchExtendedProfile(selfUserId);
                if (cancelled) return;
                setSnapshot({ kind: "ready", profile });
            } catch (err) {
                if (cancelled) return;
                setSnapshot({ kind: "error", message: getErrorMessage(err) });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [selfUserId]);

    const bankComplete =
        snapshot.kind === "ready" &&
        Boolean(
            snapshot.profile.bank_name &&
                snapshot.profile.branch_name &&
                snapshot.profile.account_number &&
                snapshot.profile.account_holder_kana,
        );

    async function handleIssue() {
        if (submitting) return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            await issueMemberInvoice({
                source: draft.source,
                source_ref_id: draft.source_ref_id,
                period_month: draft.period_month,
            });
            onIssued();
            onClose();
        } catch (err) {
            setSubmitError(getErrorMessage(err));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div
            className={styles.overlay}
            role="dialog"
            aria-modal="true"
            aria-labelledby="member-invoice-issue-title"
        >
            <div className={styles.modal}>
                <div className={styles.header}>
                    <div className={styles.titleBlock}>
                        <h2 id="member-invoice-issue-title" className={styles.title}>
                            請求書を発行する
                        </h2>
                        <p className={styles.subtitle}>
                            この内容で組織に請求書を出します
                        </p>
                    </div>
                    <button
                        type="button"
                        className={styles.closeButton}
                        onClick={onClose}
                        aria-label="閉じる"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className={styles.body}>
                    <p className={styles.intro}>
                        {SOURCE_LABEL[draft.source]}（{draft.period_month}）の確定額をもとに、
                        あなたの振込先・インボイス番号を載せた請求書をあなたの名前で発行します。
                    </p>

                    <div className={styles.amountBlock}>
                        <span className={styles.amountLabel}>{draft.label}</span>
                        <span className={styles.amountValue}>
                            {formatYen(draft.amount_total)}
                        </span>
                    </div>

                    <section className={styles.section}>
                        <div className={styles.sectionHeader}>
                            <h3 className={styles.sectionTitle}>振込先（プロフィールから自動転記）</h3>
                        </div>
                        {snapshot.kind === "loading" && (
                            <p className={styles.sectionNote}>
                                <Loader2 size={14} /> 読み込み中…
                            </p>
                        )}
                        {snapshot.kind === "error" && (
                            <p className={styles.sectionNote}>{snapshot.message}</p>
                        )}
                        {snapshot.kind === "ready" && (
                            <>
                                <dl className={styles.kvList}>
                                    <dt className={styles.kvKey}>銀行</dt>
                                    <dd className={styles.kvValue}>
                                        {snapshot.profile.bank_name || "(未設定)"}
                                        {snapshot.profile.branch_name
                                            ? ` / ${snapshot.profile.branch_name}`
                                            : ""}
                                    </dd>
                                    <dt className={styles.kvKey}>口座</dt>
                                    <dd className={styles.kvValue}>
                                        {snapshot.profile.account_type || "(未設定)"}{" "}
                                        {snapshot.profile.account_number || ""}
                                    </dd>
                                    <dt className={styles.kvKey}>名義</dt>
                                    <dd className={styles.kvValue}>
                                        {snapshot.profile.account_holder_kana || "(未設定)"}
                                    </dd>
                                    <dt className={styles.kvKey}>T 番号</dt>
                                    <dd className={styles.kvValue}>
                                        {snapshot.profile.invoice_registration_number ||
                                            "（未登録）"}
                                    </dd>
                                    <dt className={styles.kvKey}>屋号</dt>
                                    <dd className={styles.kvValue}>
                                        {snapshot.profile.trade_name || "（未登録）"}
                                    </dd>
                                </dl>
                                {!bankComplete && (
                                    <div className={styles.warning}>
                                        振込先が足りていません。
                                        プロフィール画面で振込先を入力してから請求書を発行してください。
                                    </div>
                                )}
                            </>
                        )}
                    </section>

                    <p className={styles.intro}>
                        発行時の振込先・住所・T 番号はこの請求書に固定保存されます。
                        後でプロフィールを変えても、この請求書には反映されません。
                    </p>

                    {submitError && <div className={styles.warning}>{submitError}</div>}
                </div>

                <div className={styles.footer}>
                    <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={onClose}
                        disabled={submitting}
                    >
                        キャンセル
                    </button>
                    <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={handleIssue}
                        disabled={
                            submitting || snapshot.kind !== "ready" || !bankComplete
                        }
                    >
                        {submitting ? (
                            <Loader2 size={16} />
                        ) : (
                            <Receipt size={16} aria-hidden="true" />
                        )}
                        この内容で請求書を発行する
                    </button>
                </div>
            </div>
        </div>
    );
}
