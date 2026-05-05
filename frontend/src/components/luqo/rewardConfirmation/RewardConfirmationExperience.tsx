import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import {
    BadgeCheck,
    CalendarDays,
    ChevronDown,
    ChevronUp,
    CircleDollarSign,
    MessageSquareText,
    Send,
    TrendingUp,
    UserRound,
    X,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
    askPathRewardConfirmationQuestion,
    fetchOrgContext,
    fetchPathRewardConfirmation,
    type PathRewardConfirmationSummary,
    type PathRewardEvidenceRef,
    type PathRewardQaResponse,
    type PathRewardSiteBreakdown,
} from "../../../lib/api";
import { supabase } from "../../../lib/supabase";
import { useActiveOrgStore } from "../../../stores/activeOrg";
import { PathV31Tab } from "../PathV31Tab";
import styles from "./RewardConfirmationExperience.module.css";

function currentMonthValue() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatCurrency(value: number) {
    return `¥${value.toLocaleString("ja-JP")}`;
}

function formatDelta(value: number) {
    const sign = value > 0 ? "+" : value < 0 ? "-" : "";
    return `${sign}${formatCurrency(Math.abs(value))}`;
}

function formatStatusLabel(value: PathRewardConfirmationSummary["status"]) {
    const labels: Record<string, string> = {
        "試算中": "試算中",
        "確定申請中": "確認中",
        "確定済み": "確認済み",
    };
    return labels[value] ?? String(value);
}

function formatCorrectionStatus(value: string) {
    const labels: Record<string, string> = {
        draft: "下書き",
        pending: "確認待ち",
        approved: "承認済み",
        executed: "反映済み",
        rejected: "却下",
    };
    return labels[value] ?? value;
}

function formatCorrectionImpact(amount: number) {
    if (amount < 0) {
        return `来月の支払から${formatCurrency(Math.abs(amount))}差し引き`;
    }
    if (amount > 0) {
        return `来月の支払に${formatCurrency(amount)}追加`;
    }
    return "来月の支払調整なし";
}

function formatMonthLabel(month: string) {
    const [year, monthPart] = month.split("-");
    return `${year}年${Number(monthPart)}月`;
}

function formatCorrectionReason(item: PathRewardConfirmationSummary["corrections"]["items"][number]) {
    const internalPattern = /(seed|posted|reward\.adjust|adjustment|proposal|uuid|idempotency)/i;
    if (!item.reason || internalPattern.test(item.reason)) {
        return `${item.target_month ? formatMonthLabel(item.target_month) : "今月分"}の精算調整`;
    }
    return item.reason;
}

function renderEvidence(ref: PathRewardEvidenceRef, index: number) {
    if (ref.href) {
        const isInternal = ref.href.startsWith("/");
        if (isInternal) {
            return (
                <Link key={`${ref.kind}-${index}-${ref.label}`} className={styles.evidenceLink} to={ref.href}>
                    {ref.label}
                </Link>
            );
        }
        return (
            <a
                key={`${ref.kind}-${index}-${ref.label}`}
                className={styles.evidenceLink}
                href={ref.href}
                target="_blank"
                rel="noreferrer"
            >
                {ref.label}
            </a>
        );
    }

    if (ref.anchor) {
        return (
            <a key={`${ref.kind}-${index}-${ref.label}`} className={styles.evidenceLink} href={`#${ref.anchor}`}>
                {ref.label}
            </a>
        );
    }

    return (
        <span key={`${ref.kind}-${index}-${ref.label}`} className={styles.evidencePill}>
            {ref.label}
        </span>
    );
}

function SiteDrawer({
    site,
    onClose,
}: {
    site: PathRewardSiteBreakdown;
    onClose: () => void;
}) {
    const distributionSummary =
        site.detail.site_summary.privacy_mode === "exact_distribution"
            ? site.detail.site_summary.anonymous_relative_distribution
                  .map((value, index) => `#${index + 1} ${Math.round(value * 100)}%`)
                  .join(" / ")
            : "少人数のため、個人名と金額は出さず位置づけだけ表示します。";

    const bandLabel: Record<PathRewardSiteBreakdown["detail"]["site_summary"]["self_band"], string> = {
        solo: "単独",
        top: "上位",
        upper: "上位寄り",
        middle: "中位",
        lower: "下位寄り",
    };

    return (
        <div className={styles.drawerBackdrop} onClick={onClose}>
            <aside
                className={styles.drawer}
                role="dialog"
                aria-modal="true"
                aria-labelledby={`site-drawer-${site.site_id}`}
                onClick={(event) => event.stopPropagation()}
            >
                <div className={styles.drawerHeader}>
                    <div>
                        <p className={styles.eyebrow}>現場ごとの配分</p>
                        <h3 id={`site-drawer-${site.site_id}`}>{site.site_name}</h3>
                    </div>
                    <button type="button" className={styles.inlineButton} onClick={onClose} aria-label="現場別内訳を閉じる">
                        閉じる
                    </button>
                </div>

                <section className={styles.drawerSection}>
                    <h4>自分の現場報酬</h4>
                    <div className={styles.metricGrid}>
                        <div className={styles.metricCard}>
                            <span>現場報酬</span>
                            <strong>{formatCurrency(site.detail.self_explanation.amount)}</strong>
                        </div>
                        <div className={styles.metricCard}>
                            <span>最低保証</span>
                            <strong>{formatCurrency(site.detail.self_explanation.floor_amount)}</strong>
                        </div>
                        <div className={styles.metricCard}>
                            <span>成果反映</span>
                            <strong>{formatCurrency(site.detail.self_explanation.result_amount)}</strong>
                        </div>
                        <div className={styles.metricCard}>
                            <span>補正</span>
                            <strong>{formatCurrency(site.detail.self_explanation.correction_amount)}</strong>
                        </div>
                    </div>
                    <ul className={styles.reasonList}>
                        {site.detail.self_explanation.reason_lines.map((line) => (
                            <li key={line}>{line}</li>
                        ))}
                    </ul>
                </section>

                <section className={styles.drawerSection}>
                    <h4>現場全体</h4>
                    <div className={styles.metricGrid}>
                        <div className={styles.metricCard}>
                            <span>分配原資</span>
                            <strong>{formatCurrency(site.detail.site_summary.distributable_profit)}</strong>
                        </div>
                        <div className={styles.metricCard}>
                            <span>配分対象人数</span>
                            <strong>{site.detail.site_summary.participant_count}人</strong>
                        </div>
                        <div className={styles.metricCard}>
                            <span>位置づけ</span>
                            <strong>{bandLabel[site.detail.site_summary.self_band]}</strong>
                        </div>
                        <div className={styles.metricCard}>
                            <span>配分の比重</span>
                            <strong>{Math.round(site.reflected_ratio * 100)}%</strong>
                        </div>
                    </div>
                    <p className={styles.drawerCopy}>4人チーム内の目安: {distributionSummary}</p>
                    <div className={styles.evidenceRow}>
                        {site.evidence_refs.map((ref, index) => renderEvidence(ref, index))}
                    </div>
                </section>
            </aside>
        </div>
    );
}

function AiAnswer({ answer }: { answer: PathRewardQaResponse | null }) {
    if (!answer) {
        return (
            <p className={styles.aiPlaceholder}>
                金額の疑問をそのまま確認できます。今ある精算データだけを使って返します。
            </p>
        );
    }

    return (
        <div className={styles.aiAnswer}>
            <section className={styles.aiSection}>
                <h4>結論</h4>
                <p>{answer.conclusion}</p>
            </section>
            <section className={styles.aiSection}>
                <h4>金額の内訳</h4>
                <div className={styles.amountBreakdownList}>
                    {answer.amount_breakdown.map((item) => (
                        <article key={`${item.label}-${item.amount}`} className={styles.amountBreakdownItem}>
                            <div>
                                <span>{item.label}</span>
                                <strong>{formatCurrency(item.amount)}</strong>
                            </div>
                            <p>{item.detail}</p>
                            {item.evidence_refs.length > 0 && (
                                <div className={styles.evidenceRow}>
                                    {item.evidence_refs.map((ref, index) => renderEvidence(ref, index))}
                                </div>
                            )}
                        </article>
                    ))}
                </div>
            </section>
            <section className={styles.aiSection}>
                <h4>理由</h4>
                <ul className={styles.reasonList}>
                    {answer.why_changed.map((reason) => (
                        <li key={reason}>{reason}</li>
                    ))}
                </ul>
            </section>
            <section className={styles.aiSection}>
                <h4>来月調整</h4>
                {answer.adjustments.length > 0 ? (
                    <div className={styles.adjustmentList}>
                        {answer.adjustments.map((item) => (
                            <article key={`${item.label}-${item.amount ?? "none"}`} className={styles.adjustmentItem}>
                                <div>
                                    <span>{item.label}</span>
                                    <strong>{item.amount === null ? "金額なし" : formatDelta(item.amount)}</strong>
                                </div>
                                <p>{item.detail}</p>
                                {item.evidence_refs.length > 0 && (
                                    <div className={styles.evidenceRow}>
                                        {item.evidence_refs.map((ref, index) => renderEvidence(ref, index))}
                                    </div>
                                )}
                            </article>
                        ))}
                    </div>
                ) : (
                    <p>この月に確認できる来月調整はありません。</p>
                )}
            </section>
            <section className={styles.aiSection}>
                <h4>根拠</h4>
                <div className={styles.evidenceRow}>
                    {answer.evidence_refs.map((ref, index) => renderEvidence(ref, index))}
                </div>
                <p>{answer.next_action ?? "根拠が足りないため、今は提案できる行動がありません。"}</p>
            </section>
        </div>
    );
}

type RewardChatMessage =
    | {
          id: string;
          role: "user";
          content: string;
      }
    | {
          id: string;
          role: "assistant";
          answer: PathRewardQaResponse;
      };

export function RewardConfirmationExperience({
    initialPeriod,
    focusSiteId,
    focusMemberId,
    headerAction,
}: {
    initialPeriod?: string | null;
    focusSiteId?: string | null;
    focusMemberId?: string | null;
    headerAction?: ReactNode;
}) {
    const activeOrgId = useActiveOrgStore((state) => state.activeOrgId);
    const orgOptions = useActiveOrgStore((state) => state.options);
    const activeOrgRole = useMemo(
        () => orgOptions.find((option) => option.org.id === activeOrgId)?.membership.role ?? null,
        [activeOrgId, orgOptions],
    );
    const [membershipRole, setMembershipRole] = useState<"admin" | "member">("member");
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [summary, setSummary] = useState<PathRewardConfirmationSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [question, setQuestion] = useState("");
    const [chatOpen, setChatOpen] = useState(false);
    const [chatMessages, setChatMessages] = useState<RewardChatMessage[]>([]);
    const [asking, setAsking] = useState(false);
    const [selectedSiteId, setSelectedSiteId] = useState<string | null>(focusSiteId ?? null);
    const [internalOpen, setInternalOpen] = useState(false);
    const requestSequenceRef = useRef(0);
    const chatMessageSequenceRef = useRef(0);

    const month = initialPeriod || currentMonthValue();
    const effectiveMemberId = focusMemberId?.trim() || currentUserId;
    const selectedSite = useMemo(
        () => summary?.site_breakdown.find((item) => item.site_id === selectedSiteId) ?? null,
        [selectedSiteId, summary],
    );

    useEffect(() => {
        if (activeOrgRole) {
            setMembershipRole(activeOrgRole);
        }

        void fetchOrgContext()
            .then((context) => {
                if (!activeOrgRole) {
                    setMembershipRole(context.membership.role);
                }
                setCurrentUserId((current) => current || context.membership.user_id);
            })
            .catch(() => {});
    }, [activeOrgRole]);

    useEffect(() => {
        void supabase.auth.getSession().then(({ data: { session } }) => {
            setCurrentUserId((current) => session?.user?.id || current);
        });
    }, []);

    useEffect(() => {
        if (!effectiveMemberId) {
            return;
        }

        const requestId = requestSequenceRef.current + 1;
        requestSequenceRef.current = requestId;
        setLoading(true);
        setError(null);
        void fetchPathRewardConfirmation(month, effectiveMemberId)
            .then((nextSummary) => {
                if (requestSequenceRef.current !== requestId) {
                    return;
                }
                setSummary(nextSummary);
                setSelectedSiteId((current) => {
                    if (focusSiteId && nextSummary.site_breakdown.some((item) => item.site_id === focusSiteId)) {
                        return focusSiteId;
                    }
                    return current;
                });
            })
            .catch((requestError) => {
                if (requestSequenceRef.current !== requestId) {
                    return;
                }
                setError(requestError instanceof Error ? requestError.message : "読み込みに失敗しました");
            })
            .finally(() => {
                if (requestSequenceRef.current === requestId) {
                    setLoading(false);
                }
            });
    }, [effectiveMemberId, focusSiteId, month]);

    const ask = async (nextQuestion: string) => {
        const trimmedQuestion = nextQuestion.trim();
        if (!effectiveMemberId || !trimmedQuestion) {
            return;
        }

        const userMessageId = `path-chat-user-${chatMessageSequenceRef.current}`;
        chatMessageSequenceRef.current += 1;
        setChatOpen(true);
        setChatMessages((current) => [
            ...current,
            {
                id: userMessageId,
                role: "user",
                content: trimmedQuestion,
            },
        ]);
        setAsking(true);
        setQuestion("");
        try {
            const nextAnswer = await askPathRewardConfirmationQuestion({
                month,
                member_id: effectiveMemberId,
                site_id: selectedSiteId,
                question: trimmedQuestion,
            });
            const assistantMessageId = `path-chat-assistant-${chatMessageSequenceRef.current}`;
            chatMessageSequenceRef.current += 1;
            setChatMessages((current) => [
                ...current,
                {
                    id: assistantMessageId,
                    role: "assistant",
                    answer: nextAnswer,
                },
            ]);
        } catch (requestError) {
            const assistantMessageId = `path-chat-assistant-${chatMessageSequenceRef.current}`;
            chatMessageSequenceRef.current += 1;
            setChatMessages((current) => [
                ...current,
                {
                    id: assistantMessageId,
                    role: "assistant",
                    answer: {
                        conclusion: requestError instanceof Error ? requestError.message : "回答を取得できませんでした。",
                        amount_breakdown: [],
                        why_changed: ["根拠を読み込めませんでした。"],
                        adjustments: [],
                        evidence_refs: [],
                        next_action: null,
                        confidence: "low",
                    },
                },
            ]);
        } finally {
            setAsking(false);
        }
    };

    const submitChatQuestion = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void ask(question);
    };

    const submitChatQuestionWithEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.nativeEvent.isComposing) {
            return;
        }
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void ask(question);
        }
    };

    if (loading) {
        return <div className={styles.stateCard}>報酬確認を読み込み中...</div>;
    }

    if (error || !summary) {
        return <div className={styles.stateCard}>{error ?? "報酬確認を表示できませんでした"}</div>;
    }

    const primaryCorrection = summary.corrections.items[0] ?? null;
    const pendingCloseSites = summary.pending_close_sites ?? [];
    const isConfirmed = summary.status === "確定済み";
    const buildCorrectionProposalHref = (proposalId: string) =>
        `/path?tab=reward&period=${encodeURIComponent(summary.month)}&member=${encodeURIComponent(summary.member_id)}&proposal=${encodeURIComponent(proposalId)}`;

    return (
        <div className={styles.shell}>
            <div className={styles.mainColumn}>
                <section className={styles.hero}>
                    <div className={styles.heroHeader}>
                        <div>
                            <p className={styles.eyebrow}>PATH PAYOUT</p>
                            <h1>今月の精算額</h1>
                        </div>
                        {headerAction}
                    </div>
                    <div className={styles.heroMetaRail} aria-label="精算対象">
                        <span>
                            <UserRound size={14} aria-hidden="true" />
                            対象: {summary.member_name}
                        </span>
                        <span>
                            <CalendarDays size={14} aria-hidden="true" />
                            {formatMonthLabel(summary.month)}
                        </span>
                        <span>
                            <BadgeCheck size={14} aria-hidden="true" />
                            {isConfirmed ? "操作なし" : "確認中"}
                        </span>
                    </div>
                    <div className={styles.heroGrid}>
                        <div className={`${styles.heroCard} ${styles.amountCard}`}>
                            <span>
                                <CircleDollarSign size={15} aria-hidden="true" />
                                今月の分配額
                            </span>
                            <strong>{formatCurrency(summary.estimated_amount)}</strong>
                            <p>{formatMonthLabel(summary.month)}の確定対象です。</p>
                        </div>
                        <div className={styles.heroCard}>
                            <span>
                                <BadgeCheck size={15} aria-hidden="true" />
                                {isConfirmed ? "確認状態" : "確認状況"}
                            </span>
                            <strong className={styles.compactStrong}>
                                {isConfirmed ? "確認済みです" : formatStatusLabel(summary.status)}
                            </strong>
                            <p>{isConfirmed ? "この月の操作は不要です。" : "金額の確認中です。"}</p>
                        </div>
                        {summary.delta_amount !== null && (
                            <div className={styles.heroCard}>
                                <span>
                                    <TrendingUp size={15} aria-hidden="true" />
                                    先月比
                                </span>
                                <strong>{formatDelta(summary.delta_amount)}</strong>
                                <p>{summary.delta_empty_state ?? "先月との差です。"}</p>
                            </div>
                        )}
                    </div>
                    {primaryCorrection && (
                        <div className={styles.adjustmentBanner}>
                            <div>
                                <span>来月の調整</span>
                                <strong>{formatDelta(primaryCorrection.amount)}</strong>
                                <p>
                                    {primaryCorrection.correction_month
                                        ? `反映 ${primaryCorrection.correction_month}`
                                        : "反映月を確認してください"} / {summary.corrections.count}件
                                </p>
                            </div>
                            <a className={styles.secondaryLinkButton} href="#reward-corrections">
                                調整を見る
                            </a>
                        </div>
                    )}
                    {pendingCloseSites.length > 0 && (
                        <div className={styles.pendingCloseBanner}>
                            <div>
                                <span>締め待ち現場あり</span>
                                <strong>{pendingCloseSites.length}件</strong>
                                <p>完了済みですが、PATH報酬にはまだ反映されていません。</p>
                            </div>
                            <Link className={styles.secondaryLinkButton} to={pendingCloseSites[0].href}>
                                現場を見る
                            </Link>
                        </div>
                    )}
                </section>

                {summary.site_breakdown.length > 0 && (
                    <section className={styles.section}>
                        <div className={styles.sectionHeader}>
                            <div>
                                <h2>現場別内訳</h2>
                            </div>
                        </div>
                        <div className={styles.siteCardList}>
                            {summary.site_breakdown.map((site) => (
                                <article key={site.site_id} className={styles.siteCard}>
                                    <div className={styles.siteCardHeader}>
                                        <div>
                                            <h3>{site.site_name}</h3>
                                            <span>{site.reason_summary}</span>
                                        </div>
                                        <strong>{formatCurrency(site.amount)}</strong>
                                    </div>
                                    <div className={styles.siteCardFacts}>
                                        <div>
                                            <span>比重</span>
                                            <strong>{Math.round(site.reflected_ratio * 100)}%</strong>
                                        </div>
                                        <div>
                                            <span>補正</span>
                                            <strong>{site.correction_state}</strong>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        className={styles.inlineButton}
                                        onClick={() => setSelectedSiteId(site.site_id)}
                                    >
                                        詳細
                                    </button>
                                </article>
                            ))}
                        </div>
                    </section>
                )}

                {summary.corrections.items.length > 0 && (
                    <section id="reward-corrections" className={styles.section}>
                        <div className={styles.sectionHeader}>
                            <div>
                                <h2>来月の調整</h2>
                            </div>
                        </div>
                        <div className={styles.cardGrid}>
                            {summary.corrections.items.map((item) => (
                                <article key={item.proposal_id} className={styles.infoCard}>
                                    <div className={styles.rowBetween}>
                                        <h3>{formatCorrectionImpact(item.amount)}</h3>
                                        <span className={styles.statusSubtle}>{formatCorrectionStatus(item.status)}</span>
                                    </div>
                                    <p>{item.correction_month ? `反映 ${item.correction_month}` : "反映月を確認してください"}</p>
                                    <p>理由: {formatCorrectionReason(item)}</p>
                                    <Link className={styles.evidenceLink} to={buildCorrectionProposalHref(item.proposal_id)}>
                                        申請を見る
                                    </Link>
                                </article>
                            ))}
                        </div>
                    </section>
                )}

                {membershipRole === "admin" && (
                    <section className={styles.section}>
                        <button
                            type="button"
                            className={styles.internalToggle}
                            onClick={() => setInternalOpen((current) => !current)}
                        >
                            <span>内部向け PATH V3.1 ツール</span>
                            {internalOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                        {internalOpen && (
                            <div className={styles.internalPanel}>
                                <p className={styles.internalCopy}>
                                    管理者だけが試算更新や確定申請を操作できます。職人向けの主導線には出しません。
                                </p>
                                <PathV31Tab />
                            </div>
                        )}
                    </section>
                )}
            </div>

            <div className={styles.chatDock}>
                {chatOpen && (
                    <section className={styles.chatPanel} aria-label="PATH報酬チャット">
                        <div className={styles.chatHeader}>
                            <div>
                                <span>PATHチャット</span>
                                <strong>精算の質問</strong>
                            </div>
                            <button
                                type="button"
                                className={styles.chatIconButton}
                                onClick={() => setChatOpen(false)}
                                aria-label="チャットを閉じる"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className={styles.chatMessages} aria-live="polite">
                            {chatMessages.length === 0 && (
                                <div className={`${styles.chatMessage} ${styles.assistantMessage}`}>
                                    <div className={styles.chatBubble}>
                                        <p>気になる金額をそのまま入力してください。</p>
                                    </div>
                                </div>
                            )}
                            {chatMessages.map((message) =>
                                message.role === "user" ? (
                                    <div key={message.id} className={`${styles.chatMessage} ${styles.userMessage}`}>
                                        <div className={styles.chatBubble}>
                                            <p>{message.content}</p>
                                        </div>
                                    </div>
                                ) : (
                                    <div key={message.id} className={`${styles.chatMessage} ${styles.assistantMessage}`}>
                                        <div className={styles.chatBubble}>
                                            <AiAnswer answer={message.answer} />
                                        </div>
                                    </div>
                                ),
                            )}
                            {asking && (
                                <div className={`${styles.chatMessage} ${styles.assistantMessage}`}>
                                    <div className={styles.chatBubble}>
                                        <p>確認中です...</p>
                                    </div>
                                </div>
                            )}
                        </div>
                        <form className={styles.chatForm} onSubmit={submitChatQuestion}>
                            <textarea
                                className={styles.chatInput}
                                value={question}
                                onChange={(event) => setQuestion(event.target.value)}
                                onKeyDown={submitChatQuestionWithEnter}
                                placeholder="金額の理由を聞く"
                                aria-label="PATH報酬への質問"
                                rows={1}
                            />
                            <button
                                type="submit"
                                className={styles.chatSendButton}
                                disabled={asking || !question.trim()}
                                aria-label="質問を送る"
                            >
                                <Send size={18} />
                            </button>
                        </form>
                    </section>
                )}
                {!chatOpen && (
                    <button
                        type="button"
                        className={styles.chatFab}
                        onClick={() => setChatOpen(true)}
                        aria-label="PATH報酬を質問する"
                    >
                        <MessageSquareText size={16} />
                        質問
                    </button>
                )}
            </div>

            {selectedSite && <SiteDrawer site={selectedSite} onClose={() => setSelectedSiteId(null)} />}
        </div>
    );
}
