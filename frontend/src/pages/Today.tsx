import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
    AlertCircle,
    Building2,
    Check,
    CheckCircle2,
    ClipboardCheck,
    RefreshCw,
    X,
} from "lucide-react";
import {
    fetchPathV31DayLogs,
    approveProposal,
    completeFocusItem,
    createFocusItem,
    executeProposal,
    fetchFocusItems,
    fetchPendingProposals,
    fetchSites,
    instructProposal,
    rejectProposal,
    savePathV31DayLog,
    type FocusItemHorizon,
    type FocusItemRecord,
    type FocusItemScope,
    type PathTradeFamily,
    type PathV31DayLog,
    type PathV31RoleType,
    type ProposalRecord,
    type Site,
    updateFocusItem,
} from "../lib/api";
import { useCalendar } from "../hooks/useCalendar";
import { WeekCalendar } from "../components/calendar/WeekCalendar";
import { ProposalDetailModal } from "../components/ProposalDetailModal";
import { SiteDetailModal } from "../components/SiteDetailModal";
import { TodayAssignments } from "../components/today/TodayAssignments";
import { MonthlySummary } from "../components/today/MonthlySummary";
import { PendingBadge } from "../components/today/PendingBadge";
import { getErrorMessage } from "../lib/error";
import { buildPathProposalHref, getPathProposalContext, isPathModuleProposal } from "../lib/pathProposal";
import { supabase } from "../lib/supabase";
import styles from "./Today.module.css";

const TODAY_FOCUS_EVENT = "today:open-focus-item-composer";

const HORIZON_LABELS: Record<FocusItemHorizon, string> = {
    today: "今日",
    week: "今週",
    later: "あとで",
};

const SCOPE_LABELS: Record<FocusItemScope, string> = {
    personal: "自分",
    org: "組織",
};

const QUICK_RECORD_PRESETS = [
    "安全確認",
    "資材確認",
    "進捗共有",
    "引き継ぎ整理",
    "写真整理",
    "追加作業",
] as const;

const DAY_LOG_TRADE_OPTIONS: Array<{ value: PathTradeFamily; label: string }> = [
    { value: "wall_finish", label: "壁装" },
    { value: "floor_finish", label: "床" },
    { value: "substrate_preparation", label: "下地" },
    { value: "decorative_sheet_or_film", label: "シート / フィルム" },
    { value: "common_site_operations", label: "共通作業" },
] as const;

const DAY_LOG_ROLE_OPTIONS: Array<{ value: PathV31RoleType; label: string }> = [
    { value: "assist", label: "assist" },
    { value: "lead", label: "lead" },
    { value: "solo", label: "solo" },
    { value: "support", label: "support" },
] as const;

const EMPTY_FORM = {
    title: "",
    note: "",
    scope: "personal" as FocusItemScope,
    horizon: "today" as FocusItemHorizon,
    site_id: "",
};

type PathDayLogStatus = "none" | "saved" | "locked";

type DayLogFormState = {
    id?: string;
    date: string;
    site_id: string;
    member_id: string;
    trade_families: PathTradeFamily[];
    role_type: PathV31RoleType;
    credited_unit: number;
    memo: string;
};

const EMPTY_DAY_LOG_FORM: DayLogFormState = {
    date: "",
    site_id: "",
    member_id: "",
    trade_families: ["wall_finish"],
    role_type: "assist",
    credited_unit: 1,
    memo: "",
};

const PENDING_PROPOSAL_LABELS: Record<string, string> = {
    "expense.create": "経費登録",
    "expense.update": "経費更新",
    "income.create": "売上登録",
    "invoice.create": "請求作成",
    "communication.review": "メール要点確認",
    "communication.task": "メール対応タスク",
};

function buildFormFromItem(item: FocusItemRecord) {
    return {
        title: item.title,
        note: item.note || "",
        scope: item.scope,
        horizon: item.horizon,
        site_id: item.site_id || "",
    };
}

function buildTodayKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
        date.getDate()
    ).padStart(2, "0")}`;
}

function buildDayLogForm(log: PathV31DayLog): DayLogFormState {
    return {
        id: log.id,
        date: log.date,
        site_id: log.site_id,
        member_id: log.member_id,
        trade_families: log.trade_families,
        role_type: log.role_type,
        credited_unit: log.credited_unit,
        memo: log.memo || "",
    };
}

function buildTodayDayLogMap(logs: PathV31DayLog[]): Record<string, PathV31DayLog> {
    return logs.reduce<Record<string, PathV31DayLog>>((acc, log) => {
        acc[log.site_id] = log;
        return acc;
    }, {});
}

function getDayLogErrorMessage(error: unknown): string {
    const message = getErrorMessage(error);
    if (message === "DAY_LOG_LOCKED") {
        return "この記録は現場締め後のため編集できません";
    }
    if (message === "DAY_LOG_MEMBER_FORBIDDEN") {
        return "自分の記録だけ保存できます";
    }
    return message;
}

export function Today() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [todayDate] = useState(() => new Date());
    const [focusItems, setFocusItems] = useState<FocusItemRecord[]>([]);
    const [sites, setSites] = useState<Site[]>([]);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [todayDayLogsBySiteId, setTodayDayLogsBySiteId] = useState<Record<string, PathV31DayLog>>({});
    const [pendingCount, setPendingCount] = useState(0);
    const [pendingProposals, setPendingProposals] = useState<ProposalRecord[]>([]);
    const [pendingSheetOpen, setPendingSheetOpen] = useState(false);
    const [selectedProposal, setSelectedProposal] = useState<ProposalRecord | null>(null);
    const [proposalActing, setProposalActing] = useState(false);
    const [activeHorizon, setActiveHorizon] = useState<FocusItemHorizon>("today");
    const [composerOpen, setComposerOpen] = useState(false);
    const [composerMode, setComposerMode] = useState<"general" | "siteQuick">("general");
    const [composerPreset, setComposerPreset] = useState<string | null>(null);
    const [composerSubmitting, setComposerSubmitting] = useState(false);
    const [editingFocusItem, setEditingFocusItem] = useState<FocusItemRecord | null>(null);
    const [composerForm, setComposerForm] = useState(EMPTY_FORM);
    const [dayLogSheetOpen, setDayLogSheetOpen] = useState(false);
    const [dayLogSubmitting, setDayLogSubmitting] = useState(false);
    const [dayLogForm, setDayLogForm] = useState<DayLogFormState>(EMPTY_DAY_LOG_FORM);
    const [selectedSite, setSelectedSite] = useState<Site | null>(null);
    const [actionNotice, setActionNotice] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [completingId, setCompletingId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const { calendarDays, selectDate, selectedDate } = useCalendar();
    const targetProposalId = searchParams.get("proposal");
    const todayKey = useMemo(() => buildTodayKey(todayDate), [todayDate]);
    const todayAssignments = useMemo(
        () => calendarDays.find((day) => day.isToday)?.assignments || [],
        [calendarDays]
    );
    const selectedComposerSite = useMemo(
        () => sites.find((site) => site.id === composerForm.site_id) || null,
        [composerForm.site_id, sites]
    );
    const selectedDayLogSite = useMemo(
        () => sites.find((site) => site.id === dayLogForm.site_id) || null,
        [dayLogForm.site_id, sites]
    );

    const clearProposalSearchParam = useCallback(() => {
        if (!searchParams.has("proposal")) {
            return;
        }

        const next = new URLSearchParams(searchParams);
        next.delete("proposal");
        setSearchParams(next, { replace: true });
    }, [searchParams, setSearchParams]);

    const syncPendingProposals = useCallback(async (keepProposalId?: string | null) => {
        const nextPendingProposals = await fetchPendingProposals().catch(() => []);
        setPendingProposals(nextPendingProposals);
        setPendingCount(nextPendingProposals.length);

        if (keepProposalId) {
            setSelectedProposal(
                nextPendingProposals.find((proposal) => proposal.id === keepProposalId) || null
            );
        }

        if (nextPendingProposals.length === 0) {
            setPendingSheetOpen(false);
        }
        if (keepProposalId && !nextPendingProposals.some((proposal) => proposal.id === keepProposalId)) {
            clearProposalSearchParam();
        }
    }, [clearProposalSearchParam]);

    const syncTodayDayLogs = useCallback(async (memberId: string) => {
        const response = await fetchPathV31DayLogs({
            member_id: memberId,
            from: todayKey,
            to: todayKey,
            limit: 50,
        });
        setTodayDayLogsBySiteId(buildTodayDayLogMap(response.logs));
        return response.logs;
    }, [todayKey]);

    const loadData = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const [
                sessionResult,
                focusItemsData,
                sitesData,
                pendingProposalsData,
            ] = await Promise.all([
                supabase.auth.getSession(),
                fetchFocusItems({ status: "open" }),
                fetchSites(),
                fetchPendingProposals().catch(() => []),
            ]);
            const nextCurrentUserId = sessionResult.data.session?.user?.id || null;
            setCurrentUserId(nextCurrentUserId);
            setFocusItems(focusItemsData);
            setSites(sitesData);
            setPendingProposals(pendingProposalsData);
            setPendingCount(pendingProposalsData.length);
            if (nextCurrentUserId) {
                await syncTodayDayLogs(nextCurrentUserId);
            } else {
                setTodayDayLogsBySiteId({});
            }
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    }, [syncTodayDayLogs]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    useEffect(() => {
        const handleOpenComposer = () => {
            setComposerMode("general");
            setComposerPreset(null);
            setEditingFocusItem(null);
            setComposerForm((current) => ({
                ...EMPTY_FORM,
                scope: current.scope,
                horizon: activeHorizon,
            }));
            setActionError(null);
            setComposerOpen(true);
        };

        window.addEventListener(TODAY_FOCUS_EVENT, handleOpenComposer);
        return () => window.removeEventListener(TODAY_FOCUS_EVENT, handleOpenComposer);
    }, [activeHorizon]);

    const openComposerForEdit = (item: FocusItemRecord) => {
        setComposerMode("general");
        setComposerPreset(null);
        setEditingFocusItem(item);
        setComposerForm(buildFormFromItem(item));
        setActionError(null);
        setComposerOpen(true);
    };

    const openFocusItemQuickComposer = (site: Site) => {
        setComposerMode("siteQuick");
        setComposerPreset(null);
        setEditingFocusItem(null);
        setComposerForm({
            ...EMPTY_FORM,
            title: "",
            note: "",
            scope: "org",
            horizon: "today",
            site_id: site.id,
        });
        setActionError(null);
        setComposerOpen(true);
    };

    const getDayLogStatus = useCallback((siteId: string): PathDayLogStatus => {
        const log = todayDayLogsBySiteId[siteId];
        if (!log) {
            return "none";
        }
        return log.locked_by_site_close_id ? "locked" : "saved";
    }, [todayDayLogsBySiteId]);

    const openDayLogSheet = (site: Site) => {
        if (!currentUserId) {
            setActionError("ログイン情報を確認できませんでした");
            return;
        }

        const existingLog = todayDayLogsBySiteId[site.id];
        if (existingLog?.locked_by_site_close_id) {
            setActionError("この記録は現場締め後のため編集できません");
            return;
        }

        setDayLogForm(
            existingLog
                ? buildDayLogForm(existingLog)
                : {
                      ...EMPTY_DAY_LOG_FORM,
                      date: todayKey,
                      site_id: site.id,
                      member_id: currentUserId,
                  }
        );
        setActionError(null);
        setDayLogSheetOpen(true);
    };

    const closeComposer = () => {
        setComposerOpen(false);
        setComposerMode("general");
        setComposerPreset(null);
        setEditingFocusItem(null);
        setComposerForm(EMPTY_FORM);
    };

    const closeDayLogSheet = () => {
        setDayLogSheetOpen(false);
        setDayLogForm(EMPTY_DAY_LOG_FORM);
    };

    const horizonCounts = useMemo(() => {
        return focusItems.reduce<Record<FocusItemHorizon, number>>(
            (acc, item) => {
                acc[item.horizon] += 1;
                return acc;
            },
            { today: 0, week: 0, later: 0 }
        );
    }, [focusItems]);

    const activeHorizonItems = useMemo(
        () => focusItems.filter((item) => item.horizon === activeHorizon),
        [focusItems, activeHorizon]
    );

    const todayDateLabel = todayDate.toLocaleDateString("ja-JP", {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "long",
    });
    const communicationPendingCount = useMemo(
        () => pendingProposals.filter((proposal) => proposal.type.startsWith("communication.")).length,
        [pendingProposals]
    );
    const pathPendingCount = useMemo(
        () => pendingProposals.filter((proposal) => isPathModuleProposal(proposal)).length,
        [pendingProposals]
    );

    useEffect(() => {
        if (!targetProposalId) {
            return;
        }

        const matchedProposal =
            pendingProposals.find((proposal) => proposal.id === targetProposalId) || null;
        if (!matchedProposal) {
            return;
        }

        setPendingSheetOpen(true);
        setSelectedProposal(matchedProposal);
    }, [pendingProposals, targetProposalId]);

    const openPendingSheet = () => {
        if (pendingCount === 0) {
            return;
        }
        setPendingSheetOpen(true);
    };

    const closePendingSheet = () => {
        setPendingSheetOpen(false);
        setSelectedProposal(null);
        clearProposalSearchParam();
    };

    const applyComposerPreset = (preset: string) => {
        setComposerPreset(preset);
        setComposerForm((current) => ({
            ...current,
            title: current.title.trim().length === 0 || composerPreset === current.title ? preset : current.title,
        }));
    };

    const handleCompleteFocusItem = async (item: FocusItemRecord) => {
        try {
            setCompletingId(item.id);
            setActionError(null);
            await completeFocusItem(item.id);
            setFocusItems((current) => current.filter((focusItem) => focusItem.id !== item.id));
            setActionNotice(`「${item.title}」を完了にしました`);
        } catch (err: unknown) {
            setActionError(getErrorMessage(err));
        } finally {
            setCompletingId(null);
        }
    };

    const handleSubmitComposer = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (!composerForm.title.trim()) {
            setActionError("内容は必須です");
            return;
        }

        try {
            setComposerSubmitting(true);
            setActionError(null);
            setActionNotice(null);

            const payload = {
                title: composerForm.title.trim(),
                note: composerForm.note.trim() || undefined,
                scope: composerForm.scope,
                horizon: composerForm.horizon,
                site_id: composerForm.site_id || undefined,
            };

            const saved = editingFocusItem
                ? await updateFocusItem(editingFocusItem.id, {
                      ...payload,
                      status: editingFocusItem.status,
                  })
                : await createFocusItem(payload);

            setFocusItems((current) => {
                const next = current.filter((item) => item.id !== saved.id);
                return [saved, ...next].sort((a, b) => b.created_at.localeCompare(a.created_at));
            });

            setActionNotice(
                editingFocusItem
                    ? `「${saved.title}」を更新しました`
                    : `「${saved.title}」を追加しました`
            );
            closeComposer();
        } catch (err: unknown) {
            setActionError(getErrorMessage(err));
        } finally {
            setComposerSubmitting(false);
        }
    };

    const handleSubmitDayLog = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (!currentUserId) {
            setActionError("ログイン情報を確認できませんでした");
            return;
        }
        if (!dayLogForm.site_id) {
            setActionError("現場を選んでから記録してください");
            return;
        }

        const wasEditing = Boolean(dayLogForm.id);

        try {
            setDayLogSubmitting(true);
            setActionError(null);
            setActionNotice(null);

            const { log } = await savePathV31DayLog({
                ...dayLogForm,
                member_id: currentUserId,
                memo: dayLogForm.memo.trim() || undefined,
            });

            setTodayDayLogsBySiteId((current) => ({
                ...current,
                [log.site_id]: log,
            }));
            setActionNotice(wasEditing ? "今日の記録を更新しました" : "今日の記録を保存しました");
            closeDayLogSheet();
        } catch (err: unknown) {
            setActionError(getDayLogErrorMessage(err));
            if (currentUserId) {
                void syncTodayDayLogs(currentUserId).catch(() => {});
            }
        } finally {
            setDayLogSubmitting(false);
        }
    };

    const handleProposalMutation = async (
        proposalId: string,
        action: "approve" | "reject" | "instruct" | "execute",
        payload?: string
    ) => {
        try {
            setProposalActing(true);
            setActionError(null);

            if (action === "approve") {
                await approveProposal(proposalId, payload);
                setActionNotice("承認待ち Proposal を承認しました");
            } else if (action === "reject") {
                await rejectProposal(proposalId, payload || "");
                setActionNotice("承認待ち Proposal を却下しました");
            } else if (action === "instruct") {
                await instructProposal(proposalId, payload || "");
                setActionNotice("修正指示を送りました");
            } else {
                await executeProposal(proposalId);
                setActionNotice("Proposal を実行しました");
            }

            await syncPendingProposals(proposalId);
        } catch (err: unknown) {
            setActionError(getErrorMessage(err));
        } finally {
            setProposalActing(false);
        }
    };

    if (loading) {
        return (
            <div className={styles.loading}>
                <div className={styles.spinner} />
                <p>読み込み中...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.errorPage}>
                <AlertCircle size={48} />
                <h3>読み込みに失敗しました</h3>
                <p>ネットワーク接続を確認してください</p>
                <button onClick={() => void loadData()} className={styles.retryButton}>
                    <RefreshCw size={16} />
                    再試行
                </button>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <motion.header
                className={styles.hero}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
            >
                <div>
                    <h1 className={styles.dateTitle}>{todayDateLabel}</h1>
                </div>
                <div className={styles.heroActions}>
                    <PendingBadge count={pendingCount} onClick={openPendingSheet} />
                </div>
            </motion.header>

            {actionError && (
                <div className={styles.errorBanner}>
                    <AlertCircle size={14} />
                    {actionError}
                </div>
            )}

            {actionNotice && (
                <div className={styles.noticeBanner}>
                    <CheckCircle2 size={14} />
                    {actionNotice}
                </div>
            )}

            <motion.section
                className={styles.section}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.04 }}
            >
                <TodayAssignments
                    assignments={todayAssignments}
                    sites={sites}
                    focusItems={focusItems}
                    completingId={completingId}
                    onCompleteFocusItem={(item) => void handleCompleteFocusItem(item)}
                    onOpenSite={setSelectedSite}
                    onRecordDayLog={openDayLogSheet}
                    onAddFocusItem={openFocusItemQuickComposer}
                    getDayLogStatus={getDayLogStatus}
                />
            </motion.section>

            <motion.section
                className={styles.section}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 }}
            >
                <div className={styles.sectionHeader}>
                    <h2 className={styles.sectionTitle}>解決すること</h2>
                    <div className={styles.horizonTabs} role="tablist" aria-label="期間">
                        {(["today", "week", "later"] as FocusItemHorizon[]).map((horizon) => (
                            <button
                                key={horizon}
                                type="button"
                                className={`${styles.horizonTab} ${activeHorizon === horizon ? styles.horizonTabActive : ""}`}
                                onClick={() => setActiveHorizon(horizon)}
                                aria-pressed={activeHorizon === horizon}
                            >
                                {HORIZON_LABELS[horizon]}
                                {horizonCounts[horizon] > 0 && (
                                    <span className={styles.horizonCount}>
                                        {horizonCounts[horizon]}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>

                {activeHorizonItems.length === 0 ? (
                    <div className={styles.emptyState}>
                        <p>{HORIZON_LABELS[activeHorizon]}の解決事項はありません</p>
                        <span>右下の + から追加できます</span>
                    </div>
                ) : (
                    <div className={styles.focusList}>
                        {activeHorizonItems.map((item) => (
                            <article key={item.id} className={styles.focusItem}>
                                <button
                                    type="button"
                                    className={styles.completeCircle}
                                    disabled={completingId === item.id}
                                    onClick={() => void handleCompleteFocusItem(item)}
                                    aria-label="完了にする"
                                >
                                    {completingId === item.id ? (
                                        <div className={styles.miniSpinner} />
                                    ) : (
                                        <Check size={14} className={styles.checkIcon} />
                                    )}
                                </button>
                                <div
                                    className={styles.focusContent}
                                    onClick={() => openComposerForEdit(item)}
                                >
                                    <div className={styles.focusTitleRow}>
                                        <span className={styles.focusTitle}>{item.title}</span>
                                        <span
                                            className={`${styles.scopeTag} ${item.scope === "org" ? styles.scopeTagOrg : ""}`}
                                        >
                                            {SCOPE_LABELS[item.scope]}
                                        </span>
                                    </div>
                                    {item.note && (
                                        <p className={styles.focusNote}>{item.note}</p>
                                    )}
                                    {item.site_name_snapshot && (
                                        <div className={styles.focusMeta}>
                                            <span className={styles.metaItem}>
                                                <Building2 size={12} />
                                                {item.site_name_snapshot}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </article>
                        ))}
                    </div>
                )}
            </motion.section>

            <motion.section
                className={styles.section}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.12 }}
            >
                <div className={styles.sectionHeader}>
                    <h2 className={styles.sectionTitle}>今週の見通し</h2>
                </div>
                <div className={styles.calendarShell}>
                    <WeekCalendar
                        days={calendarDays}
                        onSelectDate={selectDate}
                        selectedDate={selectedDate}
                    />
                </div>
            </motion.section>

            <motion.section
                className={styles.section}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.16 }}
            >
                <div className={styles.sectionHeader}>
                    <h2 className={styles.sectionTitle}>今月の数字</h2>
                </div>
                <MonthlySummary />
            </motion.section>

            {pendingSheetOpen && (
                <div className={styles.sheetOverlay} onClick={closePendingSheet}>
                    <motion.div
                        className={styles.pendingSheet}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className={styles.sheetHeader}>
                            <div className={styles.sheetHeading}>
                                <h3 className={styles.sheetTitle}>承認待ち Proposal</h3>
                                <p className={styles.sheetDescription}>
                                    Today からそのまま詳細を開いて、承認・却下・修正指示まで進められます。
                                </p>
                            </div>
                            <button
                                type="button"
                                className={styles.closeButton}
                                onClick={closePendingSheet}
                                aria-label="閉じる"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {pendingProposals.length === 0 ? (
                            <div className={styles.pendingEmptyState}>
                                <p>承認待ちはありません</p>
                                <span>新しい Proposal が来たらここに並びます</span>
                            </div>
                        ) : (
                            <div className={styles.pendingList}>
                                {pendingProposals.map((proposal) => {
                                    const amount = proposal.payload.amount;
                                    const amountLabel =
                                        typeof amount === "number"
                                            ? `¥${amount.toLocaleString()}`
                                            : typeof amount === "string" && amount.trim()
                                              ? amount
                                              : null;
                                    const pathProposalHref = buildPathProposalHref(proposal);
                                    const pathContext = getPathProposalContext(proposal);

                                    return (
                                        <article key={proposal.id} className={styles.pendingCard}>
                                            <button
                                                type="button"
                                                className={styles.pendingCardBody}
                                                onClick={() => setSelectedProposal(proposal)}
                                            >
                                                <div className={styles.pendingCardTop}>
                                                    <span className={styles.pendingTypeBadge}>
                                                        {PENDING_PROPOSAL_LABELS[proposal.type] || proposal.type}
                                                    </span>
                                                    {amountLabel && (
                                                        <span className={styles.pendingAmount}>{amountLabel}</span>
                                                    )}
                                                </div>
                                                <strong className={styles.pendingTitle}>{proposal.description}</strong>
                                                <p className={styles.pendingMeta}>
                                                    {proposal.created_by.name} ・{" "}
                                                    {new Date(proposal.created_at).toLocaleString("ja-JP", {
                                                        month: "2-digit",
                                                        day: "2-digit",
                                                        hour: "2-digit",
                                                        minute: "2-digit",
                                                    })}
                                                </p>
                                                {pathContext && (
                                                    <p className={styles.pendingMeta}>
                                                        {pathContext.month ? `対象月 ${pathContext.month}` : "PATH proposal"}
                                                        {pathContext.memberId ? ` ・ member ${pathContext.memberId.slice(0, 8)}...` : ""}
                                                    </p>
                                                )}
                                            </button>

                                            {proposal.type.startsWith("communication.") && (
                                                <div className={styles.pendingCardActions}>
                                                    <button
                                                        type="button"
                                                        className={styles.pendingJumpButton}
                                                        onClick={() => navigate("/communications")}
                                                    >
                                                        Communications で開く
                                                    </button>
                                                </div>
                                            )}

                                            {pathProposalHref && (
                                                <div className={styles.pendingCardActions}>
                                                    <button
                                                        type="button"
                                                        className={styles.pendingJumpButton}
                                                        onClick={() => navigate(pathProposalHref)}
                                                    >
                                                        今月の評価で開く
                                                    </button>
                                                </div>
                                            )}
                                        </article>
                                    );
                                })}
                            </div>
                        )}

                        {communicationPendingCount > 0 && (
                            <div className={styles.pendingFootnote}>
                                連絡系 Proposal は Communications に移動すると会話ログもまとめて確認できます。
                            </div>
                        )}

                        {pathPendingCount > 0 && (
                            <div className={styles.pendingFootnote}>
                                PATH proposal は 今月の評価 に移動すると、対象月・メンバー・承認 queue を同じ文脈で確認できます。
                            </div>
                        )}
                    </motion.div>
                </div>
            )}

            {dayLogSheetOpen && (
                <div className={styles.sheetOverlay} onClick={closeDayLogSheet}>
                    <motion.div
                        className={styles.sheet}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className={styles.sheetHeader}>
                            <div className={styles.sheetHeading}>
                                <h3 className={styles.sheetTitle}>今日の記録</h3>
                                <p className={styles.sheetDescription}>
                                    Today から自分の現場記録を保存します。1日・1現場・1人で1件だけ保持します。
                                </p>
                            </div>
                            <button
                                type="button"
                                className={styles.closeButton}
                                onClick={closeDayLogSheet}
                                aria-label="閉じる"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <form className={styles.sheetForm} onSubmit={handleSubmitDayLog}>
                            {selectedDayLogSite && (
                                <div className={styles.sheetSiteCard}>
                                    <span className={styles.sheetSiteEyebrow}>
                                        {dayLogForm.id ? "更新する記録" : "記録する現場"}
                                    </span>
                                    <strong>{selectedDayLogSite.name}</strong>
                                    {selectedDayLogSite.address && (
                                        <span>{selectedDayLogSite.address}</span>
                                    )}
                                </div>
                            )}

                            <div className={styles.segmentGroup}>
                                <span className={styles.fieldCaption}>工種</span>
                                <div className={styles.quickPresetGrid}>
                                    {DAY_LOG_TRADE_OPTIONS.map((option) => (
                                        <button
                                            key={option.value}
                                            type="button"
                                            className={`${styles.quickPresetButton} ${
                                                dayLogForm.trade_families[0] === option.value
                                                    ? styles.quickPresetButtonActive
                                                    : ""
                                            }`}
                                            onClick={() =>
                                                setDayLogForm((current) => ({
                                                    ...current,
                                                    trade_families: [option.value],
                                                }))
                                            }
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <label className={styles.fieldLabel}>
                                役割
                                <select
                                    className={styles.selectInput}
                                    value={dayLogForm.role_type}
                                    onChange={(event) =>
                                        setDayLogForm((current) => ({
                                            ...current,
                                            role_type: event.target.value as PathV31RoleType,
                                        }))
                                    }
                                >
                                    {DAY_LOG_ROLE_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <label className={styles.fieldLabel}>
                                記録ユニット
                                <input
                                    className={styles.textInput}
                                    type="number"
                                    min={0.25}
                                    step={0.25}
                                    value={dayLogForm.credited_unit}
                                    onChange={(event) =>
                                        setDayLogForm((current) => ({
                                            ...current,
                                            credited_unit: Number(event.target.value) || 0,
                                        }))
                                    }
                                />
                            </label>

                            <label className={styles.fieldLabel}>
                                メモ
                                <textarea
                                    className={styles.textArea}
                                    value={dayLogForm.memo}
                                    onChange={(event) =>
                                        setDayLogForm((current) => ({
                                            ...current,
                                            memo: event.target.value,
                                        }))
                                    }
                                    placeholder="進み具合や気づいたことを一言"
                                    rows={3}
                                />
                            </label>

                            <div className={styles.sheetActions}>
                                <button
                                    type="button"
                                    className={styles.secondaryButton}
                                    onClick={closeDayLogSheet}
                                >
                                    キャンセル
                                </button>
                                <button
                                    type="submit"
                                    className={styles.primaryButton}
                                    disabled={dayLogSubmitting}
                                >
                                    <ClipboardCheck size={16} />
                                    {dayLogSubmitting ? "保存中..." : dayLogForm.id ? "更新" : "保存"}
                                </button>
                            </div>
                        </form>
                    </motion.div>
                </div>
            )}

            {composerOpen && (
                <div className={styles.sheetOverlay} onClick={closeComposer}>
                    <motion.div
                        className={styles.sheet}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className={styles.sheetHeader}>
                            <div className={styles.sheetHeading}>
                                <h3 className={styles.sheetTitle}>
                                    {editingFocusItem
                                        ? "解決事項を編集"
                                        : composerMode === "siteQuick"
                                          ? "今日やることを追加"
                                          : "解決事項を追加"}
                                </h3>
                                <p className={styles.sheetDescription}>
                                    {composerMode === "siteQuick"
                                        ? "この現場で今日やることだけ先にメモします。必要なら補足だけ一言入れてください。"
                                        : "今日・今週・あとで解決したいことを記録します。"}
                                </p>
                            </div>
                            <button
                                type="button"
                                className={styles.closeButton}
                                onClick={closeComposer}
                                aria-label="閉じる"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <form className={styles.sheetForm} onSubmit={handleSubmitComposer}>
                            {composerMode === "siteQuick" && selectedComposerSite && (
                                <>
                                    <div className={styles.sheetSiteCard}>
                                        <span className={styles.sheetSiteEyebrow}>対象の現場</span>
                                        <strong>{selectedComposerSite.name}</strong>
                                        {selectedComposerSite.address && (
                                            <span>{selectedComposerSite.address}</span>
                                        )}
                                    </div>

                                    <div className={styles.segmentGroup}>
                                        <span className={styles.fieldCaption}>クイック候補</span>
                                        <div className={styles.quickPresetGrid}>
                                            {QUICK_RECORD_PRESETS.map((preset) => (
                                                <button
                                                    key={preset}
                                                    type="button"
                                                    className={`${styles.quickPresetButton} ${
                                                        composerPreset === preset ? styles.quickPresetButtonActive : ""
                                                    }`}
                                                    onClick={() => applyComposerPreset(preset)}
                                                >
                                                    {preset}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </>
                            )}

                            <label className={styles.fieldLabel}>
                                {composerMode === "siteQuick" ? "今日やること" : "内容"}
                                <input
                                    className={styles.textInput}
                                    value={composerForm.title}
                                    onChange={(event) =>
                                        setComposerForm((current) => ({
                                            ...current,
                                            title: event.target.value,
                                        }))
                                    }
                                    placeholder={
                                        composerMode === "siteQuick"
                                            ? "例: 安全ブリーフィングを11時までに実施する"
                                            : "例: A現場の段取りを再確認する"
                                    }
                                    maxLength={120}
                                    autoFocus
                                />
                            </label>

                            <label className={styles.fieldLabel}>
                                {composerMode === "siteQuick" ? "補足メモ" : "補足"}
                                <textarea
                                    className={styles.textArea}
                                    value={composerForm.note}
                                    onChange={(event) =>
                                        setComposerForm((current) => ({
                                            ...current,
                                            note: event.target.value,
                                        }))
                                    }
                                    placeholder={
                                        composerMode === "siteQuick"
                                            ? "引き継ぎや気をつけたいことがあれば一言"
                                            : "背景や気になっていることをメモできます"
                                    }
                                    rows={3}
                                />
                            </label>

                            <div className={styles.segmentGroup}>
                                <span className={styles.fieldCaption}>範囲</span>
                                <div
                                    className={`${styles.segmentButtons} ${styles.segmentButtonsTwo}`}
                                >
                                    {(["personal", "org"] as FocusItemScope[]).map((scope) => (
                                        <button
                                            key={scope}
                                            type="button"
                                            className={`${styles.segmentButton} ${
                                                composerForm.scope === scope
                                                    ? styles.segmentButtonActive
                                                    : ""
                                            }`}
                                            onClick={() =>
                                                setComposerForm((current) => ({
                                                    ...current,
                                                    scope,
                                                }))
                                            }
                                        >
                                            {SCOPE_LABELS[scope]}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className={styles.segmentGroup}>
                                <span className={styles.fieldCaption}>期間</span>
                                <div className={styles.segmentButtons}>
                                    {(["today", "week", "later"] as FocusItemHorizon[]).map(
                                        (horizon) => (
                                            <button
                                                key={horizon}
                                                type="button"
                                                className={`${styles.segmentButton} ${
                                                    composerForm.horizon === horizon
                                                        ? styles.segmentButtonActive
                                                        : ""
                                                }`}
                                                onClick={() =>
                                                    setComposerForm((current) => ({
                                                        ...current,
                                                        horizon,
                                                    }))
                                                }
                                            >
                                                {HORIZON_LABELS[horizon]}
                                            </button>
                                        )
                                    )}
                                </div>
                            </div>

                            <label className={styles.fieldLabel}>
                                関連する現場
                                <select
                                    className={styles.selectInput}
                                    value={composerForm.site_id}
                                    onChange={(event) =>
                                        setComposerForm((current) => ({
                                            ...current,
                                            site_id: event.target.value,
                                        }))
                                    }
                                >
                                    <option value="">未指定</option>
                                    {sites.map((site) => (
                                        <option key={site.id} value={site.id}>
                                            {site.name}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <div className={styles.sheetActions}>
                                <button
                                    type="button"
                                    className={styles.secondaryButton}
                                    onClick={closeComposer}
                                >
                                    キャンセル
                                </button>
                                <button
                                    type="submit"
                                    className={styles.primaryButton}
                                    disabled={composerSubmitting}
                                >
                                    {editingFocusItem ? "更新" : composerMode === "siteQuick" ? "記録を追加" : "追加"}
                                </button>
                            </div>
                        </form>
                    </motion.div>
                </div>
            )}

            {selectedSite && (
                <SiteDetailModal
                    site={selectedSite}
                    onClose={() => setSelectedSite(null)}
                    onUpdated={() => {
                        setSelectedSite(null);
                        void loadData();
                    }}
                />
            )}

            {selectedProposal && (
                <ProposalDetailModal
                    proposal={selectedProposal}
                    onClose={() => {
                        setSelectedProposal(null);
                        clearProposalSearchParam();
                    }}
                    onApprove={(proposalId, reason) => handleProposalMutation(proposalId, "approve", reason)}
                    onReject={(proposalId, reason) => handleProposalMutation(proposalId, "reject", reason)}
                    onInstruct={(proposalId, instruction) => handleProposalMutation(proposalId, "instruct", instruction)}
                    onExecute={(proposalId) => handleProposalMutation(proposalId, "execute")}
                    isActing={proposalActing}
                />
            )}
        </div>
    );
}
