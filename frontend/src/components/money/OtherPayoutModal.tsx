import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2, ShieldCheck, X } from "lucide-react";
import {
    fetchMemberTaxClassification,
    fetchMemberReimbursementBalance,
    fetchPathRewardConfirmation,
    fetchPathV33MonthlyPreview,
    fetchPathV33TeamFeed,
    previewPathV32SimpleMonthlyDistribution,
    submitPathV33Objection,
    type MemberReimbursementBalance,
    type PathRewardConfirmationSummary,
    type PathV32SimpleMonthlyDistributionPreview,
    type PathV33MonthlyPreview,
    type PathV33TeamFeedTimelineEntry,
    type PathV33Tier,
} from "../../lib/api";
import { getErrorMessage } from "../../lib/error";
import { ObjectionSubmitSheet } from "../ObjectionSubmitSheet";
import { DisputeCorrectionModal } from "./DisputeCorrectionModal";
import { ContractClassificationBanner } from "./ContractClassificationBanner";
import { InvoiceRegistrationBadge } from "./InvoiceRegistrationBadge";
import { PayoutBreakdownSection } from "./PayoutBreakdownSection";
import { PayoutCalculationSection } from "./PayoutCalculationSection";
import { PayoutMovingFactorsSection } from "./PayoutMovingFactorsSection";
import { PayoutReimbursementSection } from "./PayoutReimbursementSection";
import { TaxClassificationRationale } from "./TaxClassificationRationale";
import {
    asOfDateFromMonth,
    calculateWithholdingAmount,
    getClassificationCheckStatus,
    getContractType,
    getInvoiceStatus,
    isWithholdingApplicable,
    type PayoutTaxClassification,
} from "./payoutTaxUtils";
import styles from "./OtherPayoutModal.module.css";

interface OtherPayoutModalProps {
    memberId: string;
    selfUserId?: string | null;
    month: string;
    onClose: () => void;
    readOnly?: boolean;
}

interface ModalData {
    summary: PathRewardConfirmationSummary;
    preview: PathV33MonthlyPreview | null;
    calculationPreview: PathV32SimpleMonthlyDistributionPreview | null;
    reimbursementBalance: MemberReimbursementBalance;
    objectionTarget: PathV33TeamFeedTimelineEntry | null;
    classification: PayoutTaxClassification;
}

function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === "AbortError";
}

function formatYen(amount: number): string {
    return new Intl.NumberFormat("ja-JP", {
        style: "currency",
        currency: "JPY",
        maximumFractionDigits: 0,
    }).format(amount);
}

function formatMonthLabel(month: string): string {
    const [, monthPart] = month.split("-");
    const numericMonth = Number(monthPart);
    return Number.isFinite(numericMonth) && numericMonth > 0
        ? `${numericMonth}月分の報酬と立替`
        : `${month}分の報酬と立替`;
}

function isClientObjectionWindow(month: string, now = new Date()): boolean {
    const [year, monthPart] = month.split("-").map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(monthPart)) return false;
    const lastDay = new Date(Date.UTC(year, monthPart, 0)).getUTCDate();
    const monthIndex = monthPart - 1;
    const start = Date.UTC(year, monthIndex, lastDay + 3, -9);
    const endExclusive = Date.UTC(year, monthIndex, lastDay + 8, -9);
    const nowTime = now.getTime();
    return nowTime >= start && nowTime < endExclusive;
}

function pickObjectionTarget(
    memberId: string,
    memberName: string,
    timeline: PathV33TeamFeedTimelineEntry[],
    preview: PathV33MonthlyPreview | null,
): PathV33TeamFeedTimelineEntry | null {
    const fromFeed = timeline
        .filter((entry) => entry.member_id === memberId)
        .sort((left, right) => right.submitted_at.localeCompare(left.submitted_at))[0];
    if (fromFeed) return fromFeed;

    const fromPreview = preview?.drafts
        .filter((draft) => !draft.locked_at)
        .sort((left, right) => right.submitted_at.localeCompare(left.submitted_at))[0]
        ?? preview?.drafts.sort((left, right) => right.submitted_at.localeCompare(left.submitted_at))[0]
        ?? null;
    if (!fromPreview) return null;

    return {
        draft_id: fromPreview.id,
        member_id: memberId,
        member_name: memberName,
        site_id: fromPreview.site_id,
        site_name: "対象現場",
        tier: fromPreview.tier,
        work_days: fromPreview.work_days,
        self_comment: fromPreview.self_comment,
        submitted_at: fromPreview.submitted_at,
    };
}

function settingsHref(memberId: string): string {
    return `/settings?setting=classification&member=${encodeURIComponent(memberId)}`;
}

export function OtherPayoutModal({ memberId, selfUserId, month, onClose }: OtherPayoutModalProps) {
    const [data, setData] = useState<ModalData | null>(null);
    const [loading, setLoading] = useState(true);
    const [empty, setEmpty] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [objectionOpen, setObjectionOpen] = useState(false);
    const [disputeOpen, setDisputeOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    const reload = useCallback(async (signal?: AbortSignal) => {
        setLoading(true);
        setError(null);
        setEmpty(false);
        setActionError(null);

        const requestSignal = signal ?? new AbortController().signal;
        try {
            const [summary, reimbursementBalance, classificationResponse] = await Promise.all([
                fetchPathRewardConfirmation(month, memberId, { signal: requestSignal }),
                fetchMemberReimbursementBalance(memberId, month, { signal: requestSignal }),
                fetchMemberTaxClassification(memberId, asOfDateFromMonth(month), { signal: requestSignal })
                    .catch(() => ({ active: null, history: [] })),
            ]);
            const [preview, calculationPreview, feed] = await Promise.all([
                fetchPathV33MonthlyPreview(memberId, month, { signal: requestSignal }).catch(() => null),
                previewPathV32SimpleMonthlyDistribution(month).catch(() => null),
                fetchPathV33TeamFeed(month).catch(() => null),
            ]);

            setData({
                summary,
                preview,
                calculationPreview,
                reimbursementBalance,
                objectionTarget: pickObjectionTarget(
                    memberId,
                    summary.member_name,
                    feed?.timeline ?? [],
                    preview,
                ),
                classification: classificationResponse.active,
            });
        } catch (err) {
            if (isAbortError(err)) return;
            const message = getErrorMessage(err);
            if (message.includes("404") || message.includes("not found")) {
                setEmpty(true);
                setData(null);
            } else {
                setError(message);
            }
        } finally {
            if (!requestSignal.aborted) {
                setLoading(false);
            }
        }
    }, [memberId, month]);

    useEffect(() => {
        const controller = new AbortController();
        void reload(controller.signal);
        return () => controller.abort();
    }, [reload]);

    const isObjectionWindow = data
        ? data.summary.is_objection_window ?? isClientObjectionWindow(month)
        : false;
    async function handleSubmitObjection(input: { proposed_tier: PathV33Tier; reason: string }) {
        if (!data?.objectionTarget || submitting) return;
        setSubmitting(true);
        setSubmitError(null);
        setActionError(null);
        try {
            await submitPathV33Objection({
                target_draft_id: data.objectionTarget.draft_id,
                proposed_tier: input.proposed_tier,
                reason: input.reason,
                evidence: {
                    source: "money_other_reward_modal",
                    month,
                    member_id: memberId,
                },
            });
            setObjectionOpen(false);
            setNotice("異議を提出しました");
        } catch (err) {
            setSubmitError(getErrorMessage(err));
        } finally {
            setSubmitting(false);
        }
    }

    const payoutAmount = data
        ? data.summary.estimated_amount
            + data.reimbursementBalance.unsettled
            - calculateWithholdingAmount(data.summary.estimated_amount, data.classification)
        : 0;
    const withholdingAmount = data
        ? calculateWithholdingAmount(data.summary.estimated_amount, data.classification)
        : 0;
    const withholdingApplicable = data ? isWithholdingApplicable(data.classification) : false;
    const classificationAsOf = new Date(asOfDateFromMonth(month));
    const title = data
        ? `${data.summary.member_name}さんの${formatMonthLabel(month)}`
        : formatMonthLabel(month);

    return (
        <div className={styles.scrim} onClick={onClose}>
            <section
                className={styles.modal}
                role="dialog"
                aria-modal="true"
                aria-labelledby="other-reward-modal-title"
                onClick={(event) => event.stopPropagation()}
            >
                <header className={styles.header}>
                    <div className={styles.titleGroup}>
                        <h2 id="other-reward-modal-title" className={styles.title}>
                            {title}
                        </h2>
                        {data && (
                            <InvoiceRegistrationBadge
                                status={getInvoiceStatus(data.classification)}
                                registrationNumber={data.classification?.invoice_registration_number}
                                asOf={classificationAsOf}
                                settingsHref={settingsHref(memberId)}
                            />
                        )}
                    </div>
                    <button
                        type="button"
                        className={styles.iconButton}
                        onClick={onClose}
                        aria-label="閉じる"
                    >
                        <X size={20} aria-hidden="true" />
                    </button>
                </header>

                <div className={styles.body}>
                    {loading && (
                        <div className={styles.centerState} role="status">
                            <Loader2 size={20} aria-hidden="true" />
                            読み込み中...
                        </div>
                    )}

                    {!loading && empty && (
                        <div className={styles.centerState}>
                            <AlertCircle size={20} aria-hidden="true" />
                            メンバーが見つかりません
                        </div>
                    )}

                    {!loading && error && (
                        <div className={styles.errorPanel} role="alert">
                            <AlertCircle size={18} aria-hidden="true" />
                            <span>{error}</span>
                            <button type="button" className={styles.inlineButton} onClick={() => reload()}>
                                再読込
                            </button>
                        </div>
                    )}

                    {!loading && data && (
                        <>
                            <div className={styles.rewardMetric}>
                                <span className={styles.rewardMetricLabel}>
                                    {formatMonthLabel(month)}
                                </span>
                                <span className={styles.rewardMetricValue}>
                                    {formatYen(payoutAmount)}
                                </span>
                            </div>

                            <ContractClassificationBanner
                                contractType={getContractType(data.classification)}
                                checkStatus={getClassificationCheckStatus(data.classification)}
                                settingsHref={settingsHref(memberId)}
                            />

                            <PayoutBreakdownSection
                                rewardAmount={data.summary.estimated_amount}
                                reimbursementSettled={data.reimbursementBalance.unsettled}
                                reimbursementCarryOver={data.reimbursementBalance.carry_over_amount ?? 0}
                                withholdingAmount={withholdingAmount}
                                isWithholdingApplicable={withholdingApplicable}
                            />

                            <TaxClassificationRationale classification={data.classification} />

                            <PayoutCalculationSection
                                memberId={memberId}
                                summary={data.summary}
                                preview={data.calculationPreview}
                                isFinalized={data.summary.status === "確定済み"}
                                subjectLabel={`${data.summary.member_name}さん`}
                            />

                            <PayoutMovingFactorsSection
                                summary={data.summary}
                                preview={data.calculationPreview}
                            />

                            <PayoutReimbursementSection balance={data.reimbursementBalance} />

                            <section className={styles.section} aria-labelledby="other-reward-invoice">
                                <h3 id="other-reward-invoice" className={styles.sectionTitle}>
                                    請求書
                                </h3>
                                <p className={styles.privacyNote}>
                                    <ShieldCheck size={18} aria-hidden="true" />
                                    請求書の状態は本人だけに表示されます
                                </p>
                            </section>

                            {notice && <p className={styles.notice}>{notice}</p>}
                            {actionError && <p className={styles.actionError}>{actionError}</p>}
                        </>
                    )}
                </div>

                {!loading && data && (
                    <footer className={styles.actions}>
                        <button
                            type="button"
                            className={styles.secondaryButton}
                            onClick={() => {
                                setNotice(null);
                                setActionError(null);
                                if (!selfUserId) {
                                    setActionError("ログイン情報を確認できませんでした");
                                    return;
                                }
                                setDisputeOpen(true);
                            }}
                        >
                            計算がおかしい？
                        </button>
                        <button type="button" className={styles.secondaryButton} onClick={onClose}>
                            閉じる
                        </button>
                        {isObjectionWindow && (
                            <button
                                type="button"
                                className={styles.primaryButton}
                                onClick={() => {
                                    setNotice(null);
                                    setSubmitError(null);
                                    if (!data.objectionTarget) {
                                        setActionError("異議対象の申告がありません");
                                        return;
                                    }
                                    setObjectionOpen(true);
                                }}
                            >
                                異議を申し立てる
                            </button>
                        )}
                    </footer>
                )}
            </section>

            <ObjectionSubmitSheet
                open={objectionOpen}
                target={data?.objectionTarget ?? null}
                submitting={submitting}
                error={submitError}
                onClose={() => setObjectionOpen(false)}
                onSubmit={handleSubmitObjection}
            />

            {disputeOpen && data && selfUserId && (
                <DisputeCorrectionModal
                    month={month}
                    targetMemberId={selfUserId}
                    rewardMemberId={memberId}
                    currentRewardAmount={data.summary.estimated_amount}
                    currentReimbursementAmount={data.reimbursementBalance.unsettled}
                    currentAttendanceDays={data.preview?.current.total_work_days ?? null}
                    currentLevel={data.preview?.current.level ?? null}
                    onClose={() => setDisputeOpen(false)}
                    onSubmitted={async () => {
                        setNotice("申立を提出しました");
                        await reload();
                    }}
                />
            )}
        </div>
    );
}
