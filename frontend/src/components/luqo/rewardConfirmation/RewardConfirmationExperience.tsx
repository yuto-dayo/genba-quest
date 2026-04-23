import { useEffect, useMemo, useState } from "react";
import { Bot, ChevronDown, ChevronUp, MessageSquareText, Sparkles } from "lucide-react";
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

function formatMonthLabel(month: string) {
    const [year, monthPart] = month.split("-");
    return `${year}年${Number(monthPart)}月`;
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
            : "人数が少ないため、相対分布は帯だけ表示しています。";

    const bandLabel: Record<PathRewardSiteBreakdown["detail"]["site_summary"]["self_band"], string> = {
        solo: "単独",
        top: "上位",
        upper: "上位寄り",
        middle: "中位",
        lower: "下位寄り",
    };

    return (
        <div className={styles.drawerBackdrop} onClick={onClose}>
            <aside className={styles.drawer} onClick={(event) => event.stopPropagation()}>
                <div className={styles.drawerHeader}>
                    <div>
                        <p className={styles.eyebrow}>現場ごとの配分</p>
                        <h3>{site.site_name}</h3>
                    </div>
                    <button type="button" className={styles.inlineButton} onClick={onClose}>
                        閉じる
                    </button>
                </div>

                <section className={styles.drawerSection}>
                    <h4>自分の金額と理由</h4>
                    <div className={styles.metricGrid}>
                        <div className={styles.metricCard}>
                            <span>配分額</span>
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
                    <h4>現場全体サマリー</h4>
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
                            <span>自分の位置づけ</span>
                            <strong>{bandLabel[site.detail.site_summary.self_band]}</strong>
                        </div>
                        <div className={styles.metricCard}>
                            <span>配分の比重</span>
                            <strong>{Math.round(site.reflected_ratio * 100)}%</strong>
                        </div>
                    </div>
                    <p className={styles.drawerCopy}>{distributionSummary}</p>
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
                金額の疑問をそのまま聞けます。答えは必ず根拠付きで返します。
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
                <h4>理由</h4>
                <ul className={styles.reasonList}>
                    {answer.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                    ))}
                </ul>
            </section>
            <section className={styles.aiSection}>
                <h4>根拠</h4>
                <div className={styles.evidenceRow}>
                    {answer.evidence_refs.map((ref, index) => renderEvidence(ref, index))}
                </div>
            </section>
            <section className={styles.aiSection}>
                <h4>次に効く行動</h4>
                <p>{answer.next_action ?? "根拠が足りないため、今は提案できる行動がありません。"}</p>
            </section>
        </div>
    );
}

export function RewardConfirmationExperience({
    initialPeriod,
    focusSiteId,
    focusMemberId,
}: {
    initialPeriod?: string | null;
    focusSiteId?: string | null;
    focusMemberId?: string | null;
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
    const [answer, setAnswer] = useState<PathRewardQaResponse | null>(null);
    const [asking, setAsking] = useState(false);
    const [selectedSiteId, setSelectedSiteId] = useState<string | null>(focusSiteId ?? null);
    const [internalOpen, setInternalOpen] = useState(false);

    const month = initialPeriod || currentMonthValue();
    const effectiveMemberId =
        membershipRole === "admin" && focusMemberId ? focusMemberId : currentUserId;
    const selectedSite = useMemo(
        () => summary?.site_breakdown.find((item) => item.site_id === selectedSiteId) ?? null,
        [selectedSiteId, summary],
    );

    useEffect(() => {
        if (activeOrgRole) {
            setMembershipRole(activeOrgRole);
            return;
        }

        void fetchOrgContext()
            .then((context) => setMembershipRole(context.membership.role))
            .catch(() => {});
    }, [activeOrgRole]);

    useEffect(() => {
        void supabase.auth.getSession().then(({ data: { session } }) => {
            setCurrentUserId(session?.user?.id || null);
        });
    }, []);

    useEffect(() => {
        if (!effectiveMemberId) {
            return;
        }

        setLoading(true);
        setError(null);
        void fetchPathRewardConfirmation(month, effectiveMemberId)
            .then((nextSummary) => {
                setSummary(nextSummary);
                if (focusSiteId && nextSummary.site_breakdown.some((item) => item.site_id === focusSiteId)) {
                    setSelectedSiteId(focusSiteId);
                } else if (!selectedSiteId && nextSummary.site_breakdown[0]) {
                    setSelectedSiteId(nextSummary.site_breakdown[0].site_id);
                }
            })
            .catch((requestError) => {
                setError(requestError instanceof Error ? requestError.message : "読み込みに失敗しました");
            })
            .finally(() => setLoading(false));
    }, [effectiveMemberId, focusSiteId, month]);

    const ask = async (nextQuestion: string) => {
        if (!effectiveMemberId || !nextQuestion.trim()) {
            return;
        }

        setAsking(true);
        setQuestion(nextQuestion);
        try {
            const nextAnswer = await askPathRewardConfirmationQuestion({
                month,
                member_id: effectiveMemberId,
                site_id: selectedSiteId,
                question: nextQuestion.trim(),
            });
            setAnswer(nextAnswer);
        } catch (requestError) {
            setAnswer({
                conclusion: requestError instanceof Error ? requestError.message : "回答を取得できませんでした。",
                reasons: ["根拠を読み込めませんでした。"],
                evidence_refs: [],
                next_action: null,
            });
        } finally {
            setAsking(false);
        }
    };

    const starterQuestions = [
        "なんで今月は先月より低いの？",
        "この現場の配分が少ない理由は？",
        "補正って何が入ってる？",
        "来月増やすには何が効く？",
        "ルール上はどこで決まってる？",
    ];

    if (loading) {
        return <div className={styles.stateCard}>報酬確認を読み込み中...</div>;
    }

    if (error || !summary) {
        return <div className={styles.stateCard}>{error ?? "報酬確認を表示できませんでした"}</div>;
    }

    return (
        <div className={styles.shell}>
            <div className={styles.mainColumn}>
                <section className={styles.hero}>
                    <div className={styles.heroHeader}>
                        <div>
                            <p className={styles.eyebrow}>LUQO / PATH</p>
                            <h1>報酬確認</h1>
                            <p className={styles.subtitle}>今月の見込みと、その根拠を確認できます</p>
                        </div>
                        <span className={styles.statusBadge}>{summary.status}</span>
                    </div>
                    <div className={styles.heroGrid}>
                        <div className={styles.heroCard}>
                            <span>今月の見込み報酬</span>
                            <strong>{formatCurrency(summary.estimated_amount)}</strong>
                            <p>{formatMonthLabel(summary.month)}の見込みです。</p>
                        </div>
                        <div className={styles.heroCard}>
                            <span>先月比</span>
                            <strong>{summary.delta_amount === null ? "比較なし" : formatDelta(summary.delta_amount)}</strong>
                            <p>{summary.delta_empty_state ?? "先月との差を表示しています。"}</p>
                        </div>
                        <div className={styles.heroCard}>
                            <span>主な増減理由</span>
                            <strong>{summary.top_reasons.length}件</strong>
                            <ul className={styles.reasonListCompact}>
                                {summary.top_reasons.map((reason) => (
                                    <li key={reason.key}>{reason.label}</li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </section>

                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <div>
                            <h2>今月こうなった理由</h2>
                            <p>まず全体の理由を短く確認できます。</p>
                        </div>
                    </div>
                    {summary.explanation_missing && (
                        <div className={styles.noticeCard}>{summary.explanation_missing_message}</div>
                    )}
                    <div className={styles.cardGrid}>
                        {summary.explanation_cards.map((card) => (
                            <article key={card.id} className={styles.infoCard}>
                                <h3>{card.title}</h3>
                                <p>{card.body}</p>
                                <div className={styles.evidenceRow}>
                                    {card.evidence_refs.map((ref, index) => renderEvidence(ref, index))}
                                </div>
                            </article>
                        ))}
                    </div>
                    <div className={styles.reasonColumns}>
                        <article className={styles.infoCard}>
                            <h3>増えた要因</h3>
                            <ul className={styles.reasonList}>
                                {(summary.increase_reasons.length > 0 ? summary.increase_reasons : summary.top_reasons)
                                    .filter((reason) => reason.direction !== "decrease")
                                    .map((reason) => (
                                        <li key={reason.key}>
                                            <strong>{reason.label}</strong>
                                            <span>{reason.summary}</span>
                                        </li>
                                    ))}
                            </ul>
                        </article>
                        <article className={styles.infoCard}>
                            <h3>減った要因</h3>
                            <ul className={styles.reasonList}>
                                {(summary.decrease_reasons.length > 0 ? summary.decrease_reasons : summary.top_reasons)
                                    .filter((reason) => reason.direction !== "increase")
                                    .map((reason) => (
                                        <li key={reason.key}>
                                            <strong>{reason.label}</strong>
                                            <span>{reason.summary}</span>
                                        </li>
                                    ))}
                            </ul>
                        </article>
                    </div>
                </section>

                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <div>
                            <h2>現場ごとの配分</h2>
                            <p>自分の配分額と、その理由を現場ごとに見られます。</p>
                        </div>
                    </div>
                    <div className={styles.tableCard}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th>現場名</th>
                                    <th>自分の配分額</th>
                                    <th>反映比重</th>
                                    <th>主な理由</th>
                                    <th>補正有無</th>
                                    <th>根拠を見る</th>
                                </tr>
                            </thead>
                            <tbody>
                                {summary.site_breakdown.length > 0 ? (
                                    summary.site_breakdown.map((site) => (
                                        <tr key={site.site_id}>
                                            <td>{site.site_name}</td>
                                            <td>{formatCurrency(site.amount)}</td>
                                            <td>{Math.round(site.reflected_ratio * 100)}%</td>
                                            <td>{site.reason_summary}</td>
                                            <td>{site.correction_state}</td>
                                            <td>
                                                <button
                                                    type="button"
                                                    className={styles.inlineButton}
                                                    onClick={() => setSelectedSiteId(site.site_id)}
                                                >
                                                    根拠を見る
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={6}>現場ごとの配分データはまだありません。</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>

                <section id="reward-corrections" className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <div>
                            <h2>補正 / 調整</h2>
                            <p>補正の理由と履歴をまとめて確認できます。</p>
                        </div>
                    </div>
                    <div className={styles.metricGrid}>
                        <div className={styles.metricCard}>
                            <span>補正総額</span>
                            <strong>{formatCurrency(summary.corrections.total_amount)}</strong>
                        </div>
                        <div className={styles.metricCard}>
                            <span>反映済み</span>
                            <strong>{formatCurrency(summary.corrections.applied_amount)}</strong>
                        </div>
                        <div className={styles.metricCard}>
                            <span>件数</span>
                            <strong>{summary.corrections.count}件</strong>
                        </div>
                    </div>
                    <div className={styles.cardGrid}>
                        {summary.corrections.items.length > 0 ? (
                            summary.corrections.items.map((item) => (
                                <article key={item.proposal_id} className={styles.infoCard}>
                                    <div className={styles.rowBetween}>
                                        <h3>{item.reason}</h3>
                                        <span className={styles.statusSubtle}>{item.status}</span>
                                    </div>
                                    <p>
                                        {formatCurrency(item.amount)} / {item.mode} / {item.correction_month ?? "補正月なし"}
                                    </p>
                                    {item.note && <p>{item.note}</p>}
                                    <div className={styles.evidenceRow}>
                                        {item.evidence_refs.map((ref, index) => renderEvidence(ref, index))}
                                    </div>
                                </article>
                            ))
                        ) : (
                            <div className={styles.noticeCard}>今月の補正はありません。</div>
                        )}
                    </div>
                </section>

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

            <aside className={styles.sideColumn}>
                <section className={styles.aiPanel}>
                    <div className={styles.sectionHeader}>
                        <div>
                            <p className={styles.eyebrow}>根拠付きAI</p>
                            <h2>AIに聞く</h2>
                        </div>
                        <Bot size={18} />
                    </div>
                    <p className={styles.aiIntro}>
                        金額の理由を根拠付きで説明します。自由な推測ではなく、今あるデータだけを使います。
                    </p>
                    <div className={styles.chipRow}>
                        {starterQuestions.map((starter) => (
                            <button
                                key={starter}
                                type="button"
                                className={styles.questionChip}
                                onClick={() => void ask(starter)}
                            >
                                <Sparkles size={14} />
                                {starter}
                            </button>
                        ))}
                    </div>
                    <label className={styles.inputLabel}>
                        <span>質問</span>
                        <textarea
                            className={styles.textarea}
                            value={question}
                            onChange={(event) => setQuestion(event.target.value)}
                            placeholder="なんで今月は先月より低いの？"
                        />
                    </label>
                    <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={() => void ask(question)}
                        disabled={asking}
                    >
                        <MessageSquareText size={16} />
                        {asking ? "回答を作成中..." : "質問する"}
                    </button>
                    <AiAnswer answer={answer} />
                </section>
            </aside>

            {selectedSite && <SiteDrawer site={selectedSite} onClose={() => setSelectedSiteId(null)} />}
        </div>
    );
}
