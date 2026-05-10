import { useEffect, useState, type JSX } from "react";
import { BodyHeader, DecisionSummaryGrid, DescriptionBlock } from "./_shared";
import { ACTOR_TYPE_LABELS, getStatusLabel } from "./_shared-utils";
import type { ProposalBodyProps } from "./types";
import {
    coSignPathV33Objection,
    fetchPathV33Objection,
    respondToPathV33Objection,
    type PathV33Objection,
} from "../../lib/api";
import { getErrorMessage } from "../../lib/error";
import styles from "./ObjectionBody.module.css";

const TIER_LABEL: Record<number, string> = {
    1: "補助",
    2: "標準",
    3: "主導",
};

const STATUS_JA: Record<PathV33Objection["status"], string> = {
    open: "議論中",
    accepted: "可決 → tier 書き換え済み",
    rejected: "棄却",
    expired: "期限切れ",
};

function getString(value: unknown): string {
    return typeof value === "string" ? value : "";
}

export function ObjectionBody({ proposal }: ProposalBodyProps): JSX.Element {
    const payload = proposal.payload;
    const objectionId = getString(payload.objection_id);
    const targetMonth = getString(payload.target_month) || "—";

    const [objection, setObjection] = useState<PathV33Objection | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [actionBusy, setActionBusy] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [coSignComment, setCoSignComment] = useState("");
    const [responseComment, setResponseComment] = useState("");

    useEffect(() => {
        if (!objectionId) return;
        let cancelled = false;
        async function run() {
            setLoading(true);
            setError(null);
            try {
                const result = await fetchPathV33Objection(objectionId);
                if (!cancelled) setObjection(result);
            } catch (err) {
                if (!cancelled) setError(getErrorMessage(err));
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        void run();
        return () => {
            cancelled = true;
        };
    }, [objectionId]);

    async function handleCoSign() {
        if (!objection) return;
        setActionBusy(true);
        setActionError(null);
        try {
            const updated = await coSignPathV33Objection(objection.id, coSignComment.trim() || undefined);
            setObjection(updated);
            setCoSignComment("");
        } catch (err) {
            setActionError(getErrorMessage(err));
        } finally {
            setActionBusy(false);
        }
    }

    async function handleTargetRespond(agreed: boolean) {
        if (!objection) return;
        setActionBusy(true);
        setActionError(null);
        try {
            const updated = await respondToPathV33Objection(objection.id, {
                agreed,
                comment: responseComment.trim() || undefined,
            });
            setObjection(updated);
            setResponseComment("");
        } catch (err) {
            setActionError(getErrorMessage(err));
        } finally {
            setActionBusy(false);
        }
    }

    const title = `${targetMonth} レベル申告への異議`;
    const proposedTier = Number(payload.proposed_tier);
    const proposedTierLabel = TIER_LABEL[proposedTier] ?? String(proposedTier);

    return (
        <>
            <BodyHeader
                typeLabel="レベル申告 異議"
                statusLabel={getStatusLabel(proposal.status)}
                statusKey={proposal.status}
                actorTypeLabel={ACTOR_TYPE_LABELS[proposal.created_by.type]}
                actorTypeKey={proposal.created_by.type}
                title={title}
                dateIso={proposal.created_at}
            />

            {loading && <p className={styles.muted}>異議の状況を読み込み中...</p>}
            {error && <p className={styles.error}>取得に失敗: {error}</p>}

            <DecisionSummaryGrid
                items={[
                    { label: "提案 tier", value: `${proposedTier}: ${proposedTierLabel}` },
                    { label: "必要 co-sign", value: objection ? `${objection.co_signs.length} / ${objection.required_co_signs}` : "—" },
                    { label: "状態", value: objection ? STATUS_JA[objection.status] : "—" },
                    { label: "対象", value: objection?.target_member_id ?? getString(payload.target_member_id) },
                ]}
            />

            {getString(payload.reason) && (
                <DescriptionBlock label="異議の理由" text={getString(payload.reason)} />
            )}

            {objection && objection.co_signs.length > 0 && (
                <section className={styles.coSignList}>
                    <h4>Co-sign 一覧</h4>
                    <ul>
                        {objection.co_signs.map((entry) => (
                            <li key={entry.user_id + entry.signed_at}>
                                <strong>{entry.user_name || entry.user_id}</strong>
                                {entry.comment && <span className={styles.comment}> — {entry.comment}</span>}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {objection && objection.target_self_response && (
                <section className={styles.targetResponse}>
                    <h4>本人の弁解</h4>
                    <p>
                        <strong>
                            {objection.target_self_response.agreed ? "同意します" : "同意しません"}
                        </strong>
                        {objection.target_self_response.comment && (
                            <span className={styles.comment}>
                                — {objection.target_self_response.comment}
                            </span>
                        )}
                    </p>
                </section>
            )}

            {actionError && <p className={styles.error}>操作に失敗: {actionError}</p>}

            {objection?.status === "open" && (
                <section className={styles.actions}>
                    <div className={styles.actionGroup}>
                        <label className={styles.actionLabel}>Co-sign コメント (任意)</label>
                        <input
                            type="text"
                            className={styles.actionInput}
                            value={coSignComment}
                            onChange={(event) => setCoSignComment(event.target.value)}
                            placeholder="例: 自分も主導したと思う"
                            disabled={actionBusy}
                        />
                        <button
                            type="button"
                            className={styles.primaryButton}
                            onClick={handleCoSign}
                            disabled={actionBusy}
                        >
                            同意する (Co-sign)
                        </button>
                    </div>

                    <div className={styles.actionGroup}>
                        <label className={styles.actionLabel}>本人の弁解 (対象メンバーのみ)</label>
                        <input
                            type="text"
                            className={styles.actionInput}
                            value={responseComment}
                            onChange={(event) => setResponseComment(event.target.value)}
                            placeholder="例: その日は応援だった"
                            disabled={actionBusy}
                        />
                        <div className={styles.responseButtons}>
                            <button
                                type="button"
                                className={styles.secondaryButton}
                                onClick={() => handleTargetRespond(true)}
                                disabled={actionBusy}
                            >
                                受け入れる
                            </button>
                            <button
                                type="button"
                                className={styles.secondaryButton}
                                onClick={() => handleTargetRespond(false)}
                                disabled={actionBusy}
                            >
                                反対する
                            </button>
                        </div>
                    </div>
                </section>
            )}
        </>
    );
}
