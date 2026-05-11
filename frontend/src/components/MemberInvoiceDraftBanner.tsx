import { useCallback, useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import {
    fetchMemberInvoiceDrafts,
    type MemberInvoiceDraft,
} from "../lib/api";
import { MemberInvoiceIssueModal } from "./MemberInvoiceIssueModal";
import styles from "./MemberInvoiceDraftBanner.module.css";

interface MemberInvoiceDraftBannerProps {
    /** ログイン中ユーザの ID (snapshot 取得に使う) */
    selfUserId: string;
    /** 0 件のときバナー自体を非表示にしたい場合 true */
    hideWhenEmpty?: boolean;
    /** 発行が完了したら親に通知 (集計などの再フェッチ用) */
    onIssued?: () => void;
}

const SOURCE_LABEL: Record<MemberInvoiceDraft["source"], string> = {
    path_reward: "PATH 報酬",
    monthly_distribution: "月次分配",
    manual: "手入力",
};

function formatYen(amount: number): string {
    return `¥${amount.toLocaleString()}`;
}

export function MemberInvoiceDraftBanner({
    selfUserId,
    hideWhenEmpty,
    onIssued,
}: MemberInvoiceDraftBannerProps) {
    const [drafts, setDrafts] = useState<MemberInvoiceDraft[] | null>(null);
    const [activeDraft, setActiveDraft] = useState<MemberInvoiceDraft | null>(null);
    const [error, setError] = useState<string | null>(null);

    const reload = useCallback(async () => {
        try {
            const { drafts } = await fetchMemberInvoiceDrafts();
            setDrafts(drafts);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : "ドラフトの読み込みに失敗しました");
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const { drafts } = await fetchMemberInvoiceDrafts();
                if (!cancelled) {
                    setDrafts(drafts);
                    setError(null);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(
                        err instanceof Error ? err.message : "ドラフトの読み込みに失敗しました",
                    );
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const handleIssued = useCallback(() => {
        reload();
        onIssued?.();
    }, [reload, onIssued]);

    if (drafts === null && !error) {
        return null;
    }

    if (drafts && drafts.length === 0 && hideWhenEmpty) {
        return null;
    }

    return (
        <>
            <section className={styles.banner} aria-label="未請求の確定額">
                <div className={styles.headerRow}>
                    <div className={styles.titleRow}>
                        <Receipt size={20} aria-hidden="true" />
                        <span>
                            未請求の確定額{" "}
                            <span className={styles.titleCount}>{drafts?.length ?? 0}件</span>
                        </span>
                    </div>
                </div>
                <p className={styles.description}>
                    あなたの締めが確定しています。請求書をあなたの名前で発行してください。
                </p>
                {error && <p className={styles.empty}>{error}</p>}
                {drafts && drafts.length === 0 && !hideWhenEmpty && (
                    <p className={styles.empty}>
                        いまは請求待ちの確定額はありません。
                    </p>
                )}
                {drafts && drafts.length > 0 && (
                    <div className={styles.draftList}>
                        {drafts.map((draft) => (
                            <div
                                key={`${draft.source}:${draft.source_ref_id}:${draft.period_month}`}
                                className={styles.draftItem}
                            >
                                <div className={styles.draftLabel}>
                                    <span className={styles.draftPrimary}>{draft.label}</span>
                                    <span className={styles.draftSecondary}>
                                        {SOURCE_LABEL[draft.source]} / {draft.period_month}
                                    </span>
                                </div>
                                <div className={styles.draftAmount}>
                                    {formatYen(draft.amount_total)}
                                </div>
                                <button
                                    type="button"
                                    className={styles.issueButton}
                                    onClick={() => setActiveDraft(draft)}
                                >
                                    請求する
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </section>
            {activeDraft && (
                <MemberInvoiceIssueModal
                    draft={activeDraft}
                    selfUserId={selfUserId}
                    onClose={() => setActiveDraft(null)}
                    onIssued={handleIssued}
                />
            )}
        </>
    );
}
