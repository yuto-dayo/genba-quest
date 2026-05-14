import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
    AlertCircle,
    Building2,
    Check,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Circle,
    ClipboardCheck,
    FileText,
    Paperclip,
    Plus,
    RefreshCw,
    RotateCcw,
    X,
} from "lucide-react";
import {
    fetchPathV31DayLogs,
    approveProposal,
    createFocusItem,
    executeProposal,
    fetchMembers,
    fetchFocusItems,
    fetchPendingProposals,
    fetchSiteLineItems,
    fetchSites,
    fetchSiteDocuments,
    instructProposal,
    rejectProposal,
    reopenFocusItem,
    resolveFocusItem,
    savePathV31DayLog,
    type FocusItemHorizon,
    type FocusItemResolutionKind,
    type FocusItemRecord,
    type FocusItemScope,
    type Member,
    type PathTradeFamily,
    type PathV31DayLog,
    type PathV31RoleType,
    type ProposalRecord,
    type Site,
    type SiteDocument,
    type SiteLineItem,
    updateFocusItem,
} from "../lib/api";
import { useCalendar } from "../hooks/useCalendar";
import { ProposalDetailModal } from "../components/ProposalDetailModal";
import { SiteDetailModal } from "../components/SiteDetailModal";
import { SiteFormModal } from "../components/SiteFormModal";
import { TodayAssignments } from "../components/today/TodayAssignments";
import type { SiteInputStatus } from "../components/today/TodayAssignments";
import { MonthlySummary } from "../components/today/MonthlySummary";
import { getDevAuthUserOption, isDevAuthSessionActive } from "../lib/devAuth";
import { getErrorMessage } from "../lib/error";
import { buildPathProposalHref, getPathProposalContext, isPathModuleProposal } from "../lib/pathProposal";
import { motion as motionTokens } from "../lib/motion/tokens";
import { supabase } from "../lib/supabase";
import styles from "./Today.module.css";

const TODAY_FOCUS_EVENT = "today:open-focus-item-composer";
const SWIPE_COACHMARK_KEY = "gq_today_swipe_coachmark_v1";

const HORIZON_LABELS: Record<FocusItemHorizon, string> = {
    today: "今日",
    week: "今週",
    later: "あとで",
};

const SCOPE_LABELS: Record<FocusItemScope, string> = {
    personal: "自分",
    org: "組織",
};

const RESOLUTION_LABELS: Record<FocusItemResolutionKind, string> = {
    completed_as_planned: "できた",
    completed_with_change: "変更して完了",
    not_completed: "できなかった",
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

const DAY_LOG_TRADE_SELECT_OPTIONS: Array<{ value: PathTradeFamily | ""; label: string }> = [
    { value: "", label: "未指定" },
    ...DAY_LOG_TRADE_OPTIONS,
];

const EMPTY_FORM = {
    title: "",
    note: "",
    scope: "personal" as FocusItemScope,
    horizon: "today" as FocusItemHorizon,
    site_id: "",
};

type PathDayLogStatus = "none" | "saved" | "locked";
type DayLogSheetMode = "write" | "review";
type SiteMemoTimelineItem =
    | { id: string; kind: "memo"; created_at: string; log: PathV31DayLog }
    | { id: string; kind: "document"; created_at: string; document: SiteDocument };

type DayLogFormState = {
    id?: string;
    date: string;
    site_id: string;
    member_id: string;
    trade_family: PathTradeFamily | "";
    role_type: PathV31RoleType;
    credited_unit: number;
    memo: string;
};

type FocusCycleAction =
    | { type: "resolve"; resolutionKind: FocusItemResolutionKind }
    | { type: "reopen" };

type FocusActionSnapshot = {
    itemId: string;
    previousStatus: "open" | "done";
    previousResolutionKind: FocusItemResolutionKind | null;
    previousResolutionNote: string | null;
};

type FocusNotice = {
    itemId: string;
    message: string;
    showMemoAction: boolean;
    showSendTomorrowAction: boolean;
};

const EMPTY_DAY_LOG_FORM: DayLogFormState = {
    date: "",
    site_id: "",
    member_id: "",
    trade_family: "",
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

function parseDateKey(value: string): Date {
    const [year, month, day] = value.split("-").map((token) => Number(token));
    return new Date(year, month - 1, day);
}

function addDays(value: string, offset: number): string {
    const next = parseDateKey(value);
    next.setDate(next.getDate() + offset);
    return buildTodayKey(next);
}

function buildDayLabel(currentKey: string, todayKey: string): string {
    const current = parseDateKey(currentKey);
    const today = parseDateKey(todayKey);
    const diffDays = Math.round((current.getTime() - today.getTime()) / 86400000);

    const prefix =
        diffDays === 0
            ? "今日 "
            : diffDays === 1
              ? "明日 "
              : diffDays === 2
                ? "明後日 "
                : diffDays === -1
                  ? "昨日 "
                  : diffDays === -2
                    ? "おととい "
                    : "";

    return (
        prefix +
        current.toLocaleDateString("ja-JP", {
            month: "numeric",
            day: "numeric",
            weekday: "short",
        })
    );
}

function buildDayLogForm(log: PathV31DayLog): DayLogFormState {
    const tradeFamily = log.trade_families[0] || "";
    return {
        id: log.id,
        date: log.date,
        site_id: log.site_id,
        member_id: log.member_id,
        trade_family: tradeFamily === "common_site_operations" ? "" : tradeFamily,
        role_type: log.role_type,
        credited_unit: log.credited_unit,
        memo: log.memo || "",
    };
}

function buildDayLogMapForDate(logs: PathV31DayLog[], targetDate: string): Record<string, PathV31DayLog> {
    return logs.reduce<Record<string, PathV31DayLog>>((acc, log) => {
        if (log.date === targetDate) {
            acc[log.site_id] = log;
        }
        return acc;
    }, {});
}

function getTradeLabel(value?: PathTradeFamily | null): string {
    if (!value || value === "common_site_operations") {
        return "工種未指定";
    }
    return DAY_LOG_TRADE_OPTIONS.find((option) => option.value === value)?.label || value;
}

function formatMemoDateTime(value: string): string {
    return new Date(value).toLocaleString("ja-JP", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatMemoDate(value: string): string {
    return new Date(value).toLocaleDateString("ja-JP", {
        month: "2-digit",
        day: "2-digit",
    });
}

function getMemberName(memberId: string, members: Member[]): string {
    const member = members.find((item) => item.id === memberId || item.user_id === memberId);
    return member?.display_name || member?.full_name || member?.username || "メンバー";
}

function getDocumentUrl(document: SiteDocument): string | null {
    return document.signed_url || document.drive_file_url || null;
}

function resolveCurrentUserId(sessionUserId?: string | null): string | null {
    if (sessionUserId) {
        return sessionUserId;
    }
    if (isDevAuthSessionActive()) {
        return getDevAuthUserOption()?.id || null;
    }
    return null;
}

function getFocusDateKey(item: FocusItemRecord): string {
    if (item.focus_date && /^\d{4}-\d{2}-\d{2}$/.test(item.focus_date)) {
        return item.focus_date;
    }
    return buildTodayKey(new Date(item.created_at));
}

function getTodayBounds(baseDate: Date): { todayKey: string; startIso: string; endIso: string } {
    const start = new Date(baseDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    return {
        todayKey: buildTodayKey(start),
        startIso: start.toISOString(),
        endIso: end.toISOString(),
    };
}

function getFocusStateLabel(item: FocusItemRecord): string {
    if (item.status === "open") {
        return "未着手";
    }
    if (!item.resolution_kind) {
        return "完了";
    }
    return RESOLUTION_LABELS[item.resolution_kind];
}

function renderFocusStateIcon(item: FocusItemRecord) {
    if (item.status === "open") {
        return <Circle size={14} strokeWidth={2.4} aria-hidden="true" />;
    }
    switch (item.resolution_kind) {
        case "completed_as_planned":
            return <Check size={14} strokeWidth={2.6} aria-hidden="true" />;
        case "completed_with_change":
            return <RotateCcw size={14} strokeWidth={2.4} aria-hidden="true" />;
        case "not_completed":
            return <X size={14} strokeWidth={2.6} aria-hidden="true" />;
        default:
            return <CheckCircle2 size={14} strokeWidth={2.4} aria-hidden="true" />;
    }
}

function getNextFocusAction(item: FocusItemRecord): FocusCycleAction {
    if (item.status === "open") {
        return { type: "resolve", resolutionKind: "completed_as_planned" };
    }
    switch (item.resolution_kind) {
        case "completed_as_planned":
            return { type: "resolve", resolutionKind: "completed_with_change" };
        case "completed_with_change":
            return { type: "resolve", resolutionKind: "not_completed" };
        case "not_completed":
            return { type: "reopen" };
        default:
            return { type: "resolve", resolutionKind: "completed_with_change" };
    }
}

function getNextFocusActionLabel(item: FocusItemRecord): string {
    const action = getNextFocusAction(item);
    if (action.type === "reopen") {
        return "未着手に戻す";
    }
    return `${RESOLUTION_LABELS[action.resolutionKind]}にする`;
}

function getFocusActionMessage(item: FocusItemRecord): string {
    if (item.status === "open") {
        return `「${item.title}」を未着手に戻しました`;
    }
    const label = item.resolution_kind ? RESOLUTION_LABELS[item.resolution_kind] : "完了";
    return `「${item.title}」を${label}にしました`;
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
    const [showSwipeCoachmark, setShowSwipeCoachmark] = useState(false);
    const [focusItems, setFocusItems] = useState<FocusItemRecord[]>([]);
    const [sites, setSites] = useState<Site[]>([]);
    const [members, setMembers] = useState<Member[]>([]);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [dayLogs, setDayLogs] = useState<PathV31DayLog[]>([]);
    const [siteMemoLogs, setSiteMemoLogs] = useState<PathV31DayLog[]>([]);
    const [siteMemoDocuments, setSiteMemoDocuments] = useState<SiteDocument[]>([]);
    const [siteMemoLoading, setSiteMemoLoading] = useState(false);
    const [siteMemoError, setSiteMemoError] = useState<string | null>(null);
    const [siteLineItemsBySiteId, setSiteLineItemsBySiteId] = useState<Record<string, SiteLineItem[]>>({});
    const [pendingProposals, setPendingProposals] = useState<ProposalRecord[]>([]);
    const [pendingSheetOpen, setPendingSheetOpen] = useState(false);
    const [selectedProposal, setSelectedProposal] = useState<ProposalRecord | null>(null);
    const [proposalActing, setProposalActing] = useState(false);
    const [composerOpen, setComposerOpen] = useState(false);
    const [composerMode, setComposerMode] = useState<"general" | "siteQuick">("general");
    const [composerPreset, setComposerPreset] = useState<string | null>(null);
    const [composerSubmitting, setComposerSubmitting] = useState(false);
    const [editingFocusItem, setEditingFocusItem] = useState<FocusItemRecord | null>(null);
    const [composerForm, setComposerForm] = useState(EMPTY_FORM);
    const [dayLogSheetOpen, setDayLogSheetOpen] = useState(false);
    const [dayLogSheetMode, setDayLogSheetMode] = useState<DayLogSheetMode>("write");
    const [dayLogSubmitting, setDayLogSubmitting] = useState(false);
    const [dayLogForm, setDayLogForm] = useState<DayLogFormState>(EMPTY_DAY_LOG_FORM);
    const [selectedSite, setSelectedSite] = useState<Site | null>(null);
    const [constructionEditSite, setConstructionEditSite] = useState<Site | null>(null);
    const [actionNotice, setActionNotice] = useState<string | null>(null);
    const [focusNotice, setFocusNotice] = useState<FocusNotice | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [completingId, setCompletingId] = useState<string | null>(null);
    const [lastFocusAction, setLastFocusAction] = useState<FocusActionSnapshot | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const { calendarDays } = useCalendar();
    const targetProposalId = searchParams.get("proposal");
    const todayBounds = useMemo(() => getTodayBounds(todayDate), [todayDate]);
    const todayKey = todayBounds.todayKey;
    const [currentDayKey, setCurrentDayKey] = useState(todayKey);
    const currentAssignments = useMemo(
        () => calendarDays.find((day) => day.date === currentDayKey)?.assignments || [],
        [calendarDays, currentDayKey]
    );
    const isPast = currentDayKey < todayKey;
    const isToday = currentDayKey === todayKey;
    const isFuture = currentDayKey > todayKey;
    const readOnly = isPast || isFuture;
    const currentDayLabel = useMemo(
        () => buildDayLabel(currentDayKey, todayKey),
        [currentDayKey, todayKey]
    );
    const currentDayLogsBySiteId = useMemo(
        () => buildDayLogMapForDate(dayLogs, currentDayKey),
        [dayLogs, currentDayKey]
    );
    const currentSiteIds = useMemo(() => {
        const ids = new Set<string>();
        currentAssignments.forEach((assignment) => {
            if (assignment.site_id) {
                ids.add(assignment.site_id);
                return;
            }

            const matchedSite = assignment.site_name
                ? sites.find((site) => site.name === assignment.site_name)
                : null;
            if (matchedSite) {
                ids.add(matchedSite.id);
            }
        });
        return Array.from(ids).sort();
    }, [sites, currentAssignments]);
    const currentSiteIdsKey = currentSiteIds.join("|");
    const currentNumberSites = useMemo(
        () => currentSiteIds.map((siteId) => {
            const site = sites.find((item) => item.id === siteId);
            const assignment = currentAssignments.find((item) => item.site_id === siteId);
            return {
                id: siteId,
                name: site?.name || assignment?.site_name || "現場未設定",
            };
        }),
        [sites, currentAssignments, currentSiteIds]
    );
    const selectedComposerSite = useMemo(
        () => sites.find((site) => site.id === composerForm.site_id) || null,
        [composerForm.site_id, sites]
    );
    const selectedDayLogSite = useMemo(
        () => sites.find((site) => site.id === dayLogForm.site_id) || null,
        [dayLogForm.site_id, sites]
    );
    const siteMemoTimelineItems = useMemo<SiteMemoTimelineItem[]>(
        () =>
            [
                ...siteMemoLogs.map((log) => ({
                    id: log.id,
                    kind: "memo" as const,
                    created_at: log.created_at,
                    log,
                })),
                ...siteMemoDocuments.map((document) => ({
                    id: document.id,
                    kind: "document" as const,
                    created_at: document.created_at,
                    document,
                })),
            ].sort((a, b) => b.created_at.localeCompare(a.created_at)),
        [siteMemoDocuments, siteMemoLogs],
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
            from: addDays(todayKey, -30),
            to: addDays(todayKey, 30),
            limit: 50,
        });
        setDayLogs(response.logs);
        return response.logs;
    }, [todayKey]);

    const syncSiteLineItems = useCallback(async (siteIds: string[], replace = false) => {
        if (siteIds.length === 0) {
            if (replace) {
                setSiteLineItemsBySiteId({});
            }
            return;
        }

        const entries = await Promise.all(
            siteIds.map(async (siteId) => {
                const items = await fetchSiteLineItems(siteId).catch(() => []);
                return [siteId, items] as const;
            })
        );
        const nextBySiteId = Object.fromEntries(entries);
        setSiteLineItemsBySiteId((current) => replace ? nextBySiteId : { ...current, ...nextBySiteId });
    }, []);

    useEffect(() => {
        const siteIds = currentSiteIdsKey ? currentSiteIdsKey.split("|") : [];
        let cancelled = false;

        if (siteIds.length === 0) {
            setSiteLineItemsBySiteId({});
            return;
        }

        Promise.all(
            siteIds.map(async (siteId) => {
                const items = await fetchSiteLineItems(siteId).catch(() => []);
                return [siteId, items] as const;
            })
        ).then((entries) => {
            if (!cancelled) {
                setSiteLineItemsBySiteId(Object.fromEntries(entries));
            }
        });

        return () => {
            cancelled = true;
        };
    }, [currentSiteIdsKey]);

    const loadData = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const [
                sessionResult,
                todayOpenItemsData,
                todayDoneItemsData,
                carryoverItemsData,
                sitesData,
                membersData,
                pendingProposalsData,
            ] = await Promise.all([
                supabase.auth.getSession(),
                fetchFocusItems({
                    status: "open",
                    horizon: "today",
                    focus_date_from: todayBounds.todayKey,
                    focus_date_to: todayBounds.todayKey,
                }),
                fetchFocusItems({
                    status: "done",
                    horizon: "today",
                    resolved_from: todayBounds.startIso,
                    resolved_to: todayBounds.endIso,
                    include_legacy_done: true,
                }),
                fetchFocusItems({
                    status: "open",
                    horizon: "today",
                    focus_date_to: addDays(todayBounds.todayKey, -1),
                }),
                fetchSites(),
                fetchMembers().catch(() => []),
                fetchPendingProposals().catch(() => []),
            ]);
            const nextCurrentUserId = resolveCurrentUserId(sessionResult.data.session?.user?.id);
            setCurrentUserId(nextCurrentUserId);
            const mergedFocusItems = [
                ...todayOpenItemsData,
                ...todayDoneItemsData,
                ...carryoverItemsData,
            ];
            const deduped = Array.from(
                mergedFocusItems.reduce((acc, item) => acc.set(item.id, item), new Map<string, FocusItemRecord>())
                    .values()
            ).sort((a, b) => b.created_at.localeCompare(a.created_at));
            setFocusItems(deduped);
            setSites(sitesData);
            setMembers(membersData);
            setPendingProposals(pendingProposalsData);
            if (nextCurrentUserId) {
                await syncTodayDayLogs(nextCurrentUserId);
            } else {
                setDayLogs([]);
            }
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    }, [syncTodayDayLogs, todayBounds.endIso, todayBounds.startIso, todayBounds.todayKey]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const openTodayFocusComposer = useCallback(() => {
        setComposerMode("general");
        setComposerPreset(null);
        setEditingFocusItem(null);
        setComposerForm((current) => ({
            ...EMPTY_FORM,
            scope: current.scope,
            horizon: "today",
        }));
        setActionError(null);
        setComposerOpen(true);
    }, []);

    useEffect(() => {
        const handleOpenComposer = () => openTodayFocusComposer();
        window.addEventListener(TODAY_FOCUS_EVENT, handleOpenComposer);
        return () => window.removeEventListener(TODAY_FOCUS_EVENT, handleOpenComposer);
    }, [openTodayFocusComposer]);

    useEffect(() => {
        if (window.localStorage.getItem(SWIPE_COACHMARK_KEY)) {
            return;
        }

        setShowSwipeCoachmark(true);
        window.localStorage.setItem(SWIPE_COACHMARK_KEY, "shown");
        const timeoutId = window.setTimeout(() => setShowSwipeCoachmark(false), 2000);
        return () => window.clearTimeout(timeoutId);
    }, []);

    const openComposerForEdit = (item: FocusItemRecord) => {
        setComposerMode("general");
        setComposerPreset(null);
        setEditingFocusItem(item);
        setComposerForm(buildFormFromItem(item));
        setActionError(null);
        setComposerOpen(true);
    };

    const getDayLogStatus = useCallback((siteId: string): PathDayLogStatus => {
        const log = currentDayLogsBySiteId[siteId];
        if (!log) {
            return "none";
        }
        return log.locked_by_site_close_id ? "locked" : "saved";
    }, [currentDayLogsBySiteId]);

    const getSiteInputStatus = useCallback((siteId: string): SiteInputStatus => {
        // V3.1 reward/role tracking was removed. Level drafts now route from bell notifications.
        return currentDayLogsBySiteId[siteId] ? "role_saved" : "role_missing";
    }, [currentDayLogsBySiteId]);

    const loadSiteMemoContext = useCallback(async (siteId: string) => {
        try {
            setSiteMemoLoading(true);
            setSiteMemoError(null);
            const [logsResponse, documentsResponse] = await Promise.all([
                fetchPathV31DayLogs({ site_id: siteId, limit: 50 }),
                fetchSiteDocuments(siteId).catch(() => []),
            ]);
            setSiteMemoLogs(logsResponse.logs);
            setSiteMemoDocuments(documentsResponse);
        } catch (err: unknown) {
            setSiteMemoError(getErrorMessage(err));
        } finally {
            setSiteMemoLoading(false);
        }
    }, []);

    const prepareDayLogSheet = (site: Site, mode: DayLogSheetMode) => {
        const existingLog = currentDayLogsBySiteId[site.id];
        setDayLogForm(
            existingLog
                ? buildDayLogForm(existingLog)
                : {
                      ...EMPTY_DAY_LOG_FORM,
                      date: currentDayKey,
                      site_id: site.id,
                      member_id: currentUserId || "",
                  }
        );
        setDayLogSheetMode(mode);
        setSiteMemoLogs([]);
        setSiteMemoDocuments([]);
        setSiteMemoError(null);
        setActionError(null);
        setDayLogSheetOpen(true);
        void loadSiteMemoContext(site.id);
    };

    const openDayLogReviewSheet = (site: Site) => {
        prepareDayLogSheet(site, "review");
    };

    const switchDayLogSheetMode = (mode: DayLogSheetMode) => {
        if (mode === "write") {
            if (!currentUserId) {
                setActionError("ログイン情報を確認できませんでした");
                return;
            }

            const existingLog = dayLogForm.site_id ? currentDayLogsBySiteId[dayLogForm.site_id] : null;
            if (existingLog?.locked_by_site_close_id) {
                setActionError("この記録は現場締め後のため編集できません");
                return;
            }
        }

        setActionError(null);
        setDayLogSheetMode(mode);
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
        setDayLogSheetMode("write");
        setDayLogForm(EMPTY_DAY_LOG_FORM);
        setSiteMemoLogs([]);
        setSiteMemoDocuments([]);
        setSiteMemoError(null);
    };

    const todayFocusItems = useMemo(
        () =>
            focusItems
                .filter((item) => {
                    if (item.horizon !== "today") {
                        return false;
                    }
                    if (item.status === "open") {
                        return getFocusDateKey(item) === todayBounds.todayKey;
                    }
                    if (item.status !== "done") {
                        return false;
                    }
                    if (!item.resolved_at) {
                        return getFocusDateKey(item) === todayBounds.todayKey;
                    }
                    return item.resolved_at >= todayBounds.startIso && item.resolved_at < todayBounds.endIso;
                })
                .sort((a, b) => b.created_at.localeCompare(a.created_at)),
        [focusItems, todayBounds.endIso, todayBounds.startIso, todayBounds.todayKey]
    );

    const todayOpenFocusCount = todayFocusItems.filter((item) => item.status === "open").length;
    const todayDoneFocusCount = todayFocusItems.length - todayOpenFocusCount;

    const carryoverFocusItems = useMemo(
        () =>
            focusItems
                .filter(
                    (item) =>
                        item.horizon === "today"
                        && item.status === "open"
                        && getFocusDateKey(item) < todayBounds.todayKey
                )
                .sort((a, b) => getFocusDateKey(a).localeCompare(getFocusDateKey(b))),
        [focusItems, todayBounds.todayKey]
    );

    const getFocusItemClassName = (item: FocusItemRecord) =>
        [
            styles.focusItem,
            item.status === "done" ? styles.focusItemDone : "",
            item.resolution_kind === "completed_as_planned" ? styles.focusItemCompleted : "",
            item.resolution_kind === "completed_with_change" ? styles.focusItemChanged : "",
            item.resolution_kind === "not_completed" ? styles.focusItemNotCompleted : "",
        ]
            .filter(Boolean)
            .join(" ");

    const getFocusStatusChipButtonClassName = (item: FocusItemRecord) =>
        [
            styles.focusStatusChipButton,
            item.status === "open" ? styles.focusStatusChipOpen : "",
            item.status === "done" && !item.resolution_kind ? styles.focusStatusChipLegacyDone : "",
            item.resolution_kind === "completed_as_planned" ? styles.focusStatusChipCompleted : "",
            item.resolution_kind === "completed_with_change" ? styles.focusStatusChipChanged : "",
            item.resolution_kind === "not_completed" ? styles.focusStatusChipNotCompleted : "",
        ]
            .filter(Boolean)
            .join(" ");

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
    const goPrevDay = useCallback(() => {
        setCurrentDayKey((current) => addDays(current, -1));
    }, []);
    const goNextDay = useCallback(() => {
        setCurrentDayKey((current) => addDays(current, 1));
    }, []);

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

    const upsertFocusItem = useCallback((saved: FocusItemRecord) => {
        setFocusItems((current) => {
            const next = current.filter((item) => item.id !== saved.id);
            return [saved, ...next].sort((a, b) => b.created_at.localeCompare(a.created_at));
        });
    }, []);

    const handleCycleFocusItem = async (item: FocusItemRecord) => {
        const nextAction = getNextFocusAction(item);
        try {
            setCompletingId(item.id);
            setActionError(null);
            setActionNotice(null);
            setFocusNotice(null);

            setLastFocusAction({
                itemId: item.id,
                previousStatus: item.status,
                previousResolutionKind: item.resolution_kind ?? null,
                previousResolutionNote: item.resolution_note ?? null,
            });

            const saved =
                nextAction.type === "resolve"
                    ? await resolveFocusItem(item.id, {
                          resolution_kind: nextAction.resolutionKind,
                      })
                    : await reopenFocusItem(item.id);

            upsertFocusItem(saved);

            setFocusNotice({
                itemId: saved.id,
                message: getFocusActionMessage(saved),
                showMemoAction:
                    saved.status === "done"
                    && (saved.resolution_kind === "completed_with_change" || saved.resolution_kind === "not_completed"),
                showSendTomorrowAction:
                    saved.status === "done"
                    && saved.resolution_kind === "not_completed",
            });
        } catch (err: unknown) {
            setActionError(getErrorMessage(err));
        } finally {
            setCompletingId(null);
        }
    };

    const handleUndoFocusAction = async () => {
        if (!lastFocusAction) {
            return;
        }
        const target = focusItems.find((item) => item.id === lastFocusAction.itemId);
        if (!target) {
            setActionError("対象のやることが見つかりませんでした");
            return;
        }

        try {
            setCompletingId(lastFocusAction.itemId);
            setActionError(null);
            setActionNotice(null);

            const restored = await (() => {
                if (lastFocusAction.previousStatus === "open") {
                    return reopenFocusItem(lastFocusAction.itemId);
                }

                if (lastFocusAction.previousResolutionKind === null) {
                    return reopenFocusItem(lastFocusAction.itemId).then((reopened) =>
                        updateFocusItem(lastFocusAction.itemId, {
                            title: reopened.title,
                            scope: reopened.scope,
                            horizon: reopened.horizon,
                            status: "done",
                            note: reopened.note || undefined,
                            site_id: reopened.site_id || undefined,
                            focus_date: reopened.focus_date || getFocusDateKey(reopened),
                        })
                    );
                }

                return resolveFocusItem(lastFocusAction.itemId, {
                    resolution_kind: lastFocusAction.previousResolutionKind,
                    resolution_note: lastFocusAction.previousResolutionNote,
                });
            })();

            upsertFocusItem(restored);
            setFocusNotice({
                itemId: restored.id,
                message: `「${restored.title}」を元に戻しました`,
                showMemoAction: false,
                showSendTomorrowAction: false,
            });
            setLastFocusAction(null);
        } catch (err: unknown) {
            setActionError(getErrorMessage(err));
        } finally {
            setCompletingId(null);
        }
    };

    const handleOpenFocusMemo = (itemId: string) => {
        const item = focusItems.find((focusItem) => focusItem.id === itemId);
        if (!item) {
            return;
        }
        setFocusNotice(null);
        openComposerForEdit(item);
    };

    const handleSendFocusItemToTomorrow = async (itemId: string) => {
        const item = focusItems.find((focusItem) => focusItem.id === itemId);
        if (!item) {
            setActionError("対象のやることが見つかりませんでした");
            return;
        }
        try {
            setCompletingId(item.id);
            setActionError(null);
            const tomorrowKey = addDays(todayBounds.todayKey, 1);
            const copied = await createFocusItem({
                title: item.title,
                note: item.note || undefined,
                scope: item.scope,
                horizon: item.horizon,
                site_id: item.site_id || undefined,
                focus_date: tomorrowKey,
            });
            upsertFocusItem(copied);
            setFocusNotice({
                itemId: copied.id,
                message: `「${item.title}」を明日の候補として追加しました`,
                showMemoAction: false,
                showSendTomorrowAction: false,
            });
        } catch (err: unknown) {
            setActionError(getErrorMessage(err));
        } finally {
            setCompletingId(null);
        }
    };

    const handlePromoteCandidateToToday = async (item: FocusItemRecord) => {
        try {
            setCompletingId(item.id);
            setActionError(null);
            const saved = await updateFocusItem(item.id, {
                title: item.title,
                note: item.note || undefined,
                scope: item.scope,
                horizon: item.horizon,
                site_id: item.site_id || undefined,
                status: "open",
                focus_date: todayBounds.todayKey,
            });
            upsertFocusItem(saved);
            setActionNotice(`「${saved.title}」を今日やるに入れました`);
            setFocusNotice(null);
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
            setFocusNotice(null);

            const payload = {
                title: composerForm.title.trim(),
                note: composerForm.note.trim() || undefined,
                scope: composerForm.scope,
                horizon: composerForm.horizon,
                site_id: composerForm.site_id || undefined,
                focus_date:
                    composerForm.horizon === "today"
                        ? (editingFocusItem?.focus_date || todayBounds.todayKey)
                        : undefined,
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
            setFocusNotice(null);

            const { log } = await savePathV31DayLog({
                id: dayLogForm.id,
                date: dayLogForm.date,
                site_id: dayLogForm.site_id,
                member_id: currentUserId,
                trade_families: [dayLogForm.trade_family || "common_site_operations"],
                role_type: dayLogForm.role_type,
                credited_unit: dayLogForm.credited_unit,
                memo: dayLogForm.memo.trim() || undefined,
            });

            setDayLogs((current) => {
                const next = current.filter((item) => item.id !== log.id);
                return [log, ...next].sort((a, b) => b.created_at.localeCompare(a.created_at));
            });
            setSiteMemoLogs((current) => {
                const next = current.filter((item) => item.id !== log.id);
                return [log, ...next].sort((a, b) => b.created_at.localeCompare(a.created_at));
            });
            setActionNotice(wasEditing ? "現場メモを更新しました" : "現場メモを保存しました");
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
            setActionNotice(null);
            setFocusNotice(null);

            let updatedProposal: ProposalRecord | null = null;
            if (action === "approve") {
                const response = await approveProposal(proposalId, payload);
                updatedProposal = response.proposal;
                if (updatedProposal.status === "approved") {
                    setActionNotice("承認しました。続けて実行できます。");
                } else if (updatedProposal.status === "executed" || response.auto_executed) {
                    setActionNotice("承認し、実行まで完了しました。");
                } else {
                    setActionNotice("承認しました。残りの承認を待っています。");
                }
            } else if (action === "reject") {
                updatedProposal = await rejectProposal(proposalId, payload || "");
                setActionNotice("承認待ち Proposal を却下しました");
            } else if (action === "instruct") {
                const response = await instructProposal(proposalId, payload || "");
                updatedProposal = response.proposal;
                setActionNotice("修正指示を送りました");
            } else {
                updatedProposal = await executeProposal(proposalId);
                setActionNotice("実行しました。EventとLedgerを更新しています。");
            }

            if (action === "approve" && updatedProposal?.status === "approved") {
                setSelectedProposal(updatedProposal);
            } else {
                setSelectedProposal(null);
                clearProposalSearchParam();
            }

            await syncPendingProposals();
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
                <div className={styles.heroIntro}>
                    <h1 className={styles.dateTitle}>{todayDateLabel}</h1>
                </div>
            </motion.header>

            {actionError && (
                <div className={styles.errorBanner}>
                    <AlertCircle size={14} />
                    {actionError}
                </div>
            )}

            {focusNotice && (
                <div className={styles.noticeBanner} role="status" aria-live="polite">
                    <CheckCircle2 size={14} />
                    <span className={styles.noticeText}>{focusNotice.message}</span>
                    <div className={styles.noticeActions}>
                        {focusNotice.showMemoAction && (
                            <button
                                type="button"
                                className={styles.noticeActionButton}
                                onClick={() => handleOpenFocusMemo(focusNotice.itemId)}
                            >
                                メモを残す
                            </button>
                        )}
                        {focusNotice.showSendTomorrowAction && (
                            <button
                                type="button"
                                className={styles.noticeActionButton}
                                onClick={() => void handleSendFocusItemToTomorrow(focusNotice.itemId)}
                            >
                                明日に送る
                            </button>
                        )}
                        {lastFocusAction && (
                            <button
                                type="button"
                                className={styles.noticeActionButton}
                                onClick={() => void handleUndoFocusAction()}
                            >
                                Undo
                            </button>
                        )}
                    </div>
                </div>
            )}

            {actionNotice && (
                <div className={styles.noticeBanner} role="status" aria-live="polite">
                    <CheckCircle2 size={14} />
                    {actionNotice}
                </div>
            )}

            <div className={styles.dateStrip} aria-live="polite">
                <button type="button" className={styles.dateArrowButton} aria-label="前の日へ" onClick={goPrevDay}>
                    <ChevronLeft size={20} />
                </button>
                <span className={styles.dateStripLabel}>{currentDayLabel}</span>
                <button type="button" className={styles.dateArrowButton} aria-label="次の日へ" onClick={goNextDay}>
                    <ChevronRight size={20} />
                </button>
                <AnimatePresence>
                    {!isToday && (
                        <motion.button
                            key="return-today"
                            type="button"
                            className={styles.returnTodayPill}
                            onClick={() => setCurrentDayKey(todayKey)}
                            initial={{ opacity: 0, scale: 0.85, x: -6 }}
                            animate={{ opacity: 1, scale: 1, x: 0 }}
                            exit={{ opacity: 0, scale: 0.85, x: -6 }}
                            transition={{ type: "spring", stiffness: 460, damping: 22 }}
                            aria-label="今日に戻る"
                        >
                            <RotateCcw size={14} />
                            <span>今日へ</span>
                        </motion.button>
                    )}
                </AnimatePresence>
            </div>

            <AnimatePresence>
                {showSwipeCoachmark && (
                    <motion.div
                        className={styles.coachmark}
                        onClick={() => setShowSwipeCoachmark(false)}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        <motion.div
                            className={styles.coachmarkFinger}
                            animate={{ x: [-20, 20, -20] }}
                            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                        >
                            👉
                        </motion.div>
                        <p>横にスワイプで他の日</p>
                    </motion.div>
                )}
            </AnimatePresence>

            <motion.div
                className={styles.dayGestureLayer}
                drag="x"
                dragDirectionLock
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.2}
                onDragEnd={(_, info) => {
                    const swipeThresholdPx = 80;
                    const swipeVelocity = 500;
                    if (info.offset.x < -swipeThresholdPx || info.velocity.x < -swipeVelocity) {
                        goNextDay();
                    } else if (info.offset.x > swipeThresholdPx || info.velocity.x > swipeVelocity) {
                        goPrevDay();
                    }
                }}
                transition={motionTokens.spatialDefault}
            >
                <AnimatePresence mode="wait">
                    <motion.div
                        key={currentDayKey}
                        className={styles.dayContent}
                        initial={{ opacity: 0, x: 12 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -12 }}
                        transition={motionTokens.spatialDefault}
                    >
                        <motion.section
                            className={styles.section}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.04 }}
                        >
                            <TodayAssignments
                                assignments={currentAssignments}
                                sites={sites}
                                members={members}
                                siteLineItemsBySiteId={siteLineItemsBySiteId}
                                onViewSiteMemo={openDayLogReviewSheet}
                                onAddConstruction={setConstructionEditSite}
                                getDayLogStatus={getDayLogStatus}
                                getSiteInputStatus={getSiteInputStatus}
                                readOnly={readOnly}
                            />
                        </motion.section>

                        {isToday && (
                            <motion.section
                                className={styles.section}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.08 }}
                            >
                                <div className={styles.sectionHeader}>
                                    <div className={styles.sectionTitleGroup}>
                                        <h2 className={styles.sectionTitle}>やること</h2>
                                        {todayFocusItems.length > 0 && (
                                            <span className={styles.focusSectionSummary}>
                                                未着手 {todayOpenFocusCount} / 結果 {todayDoneFocusCount}
                                            </span>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        className={styles.sectionAddButton}
                                        onClick={openTodayFocusComposer}
                                        aria-label="やることを追加"
                                    >
                                        <Plus size={16} />
                                        追加
                                    </button>
                                </div>

                                {todayFocusItems.length === 0 ? (
                                    <div className={styles.emptyState}>
                                        <p>今日やることはありません</p>
                                        <span>追加から今日の作業を残せます</span>
                                    </div>
                                ) : (
                                    <div className={styles.focusList}>
                                        {todayFocusItems.map((item) => {
                                            const note = item.status === "done"
                                                ? item.resolution_note || item.note
                                                : item.note;

                                            return (
                                                <article key={item.id} className={getFocusItemClassName(item)}>
                                                    <button
                                                        type="button"
                                                        className={getFocusStatusChipButtonClassName(item)}
                                                        disabled={completingId === item.id}
                                                        onClick={() => void handleCycleFocusItem(item)}
                                                        aria-busy={completingId === item.id}
                                                        aria-label={`現在: ${getFocusStateLabel(item)}。タップで${getNextFocusActionLabel(item)}。`}
                                                    >
                                                        <span className={styles.focusStatusChipIcon}>
                                                            {completingId === item.id ? (
                                                                <div className={styles.miniSpinner} />
                                                            ) : (
                                                                renderFocusStateIcon(item)
                                                            )}
                                                        </span>
                                                        <span className={styles.focusStatusChipLabel}>
                                                            {getFocusStateLabel(item)}
                                                        </span>
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
                                                        {note && (
                                                            <p className={styles.focusNote}>{note}</p>
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
                                            );
                                        })}
                                    </div>
                                )}

                                {carryoverFocusItems.length > 0 && (
                                    <div className={styles.candidateSection}>
                                        <div className={styles.candidateHeader}>
                                            <h3>候補</h3>
                                            <span>昨日以前の未着手 {carryoverFocusItems.length}件</span>
                                        </div>
                                        <div className={styles.candidateList}>
                                            {carryoverFocusItems.map((item) => (
                                                <article key={item.id} className={styles.candidateItem}>
                                                    <div className={styles.candidateBody}>
                                                        <strong>{item.title}</strong>
                                                        <span>
                                                            {getFocusDateKey(item)} から持ち越し
                                                        </span>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        className={styles.candidateActionButton}
                                                        disabled={completingId === item.id}
                                                        onClick={() => void handlePromoteCandidateToToday(item)}
                                                        aria-label={`${item.title} を今日やるに移動`}
                                                    >
                                                        今日やる
                                                    </button>
                                                </article>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </motion.section>
                        )}

                        {isToday && (
                            <motion.section
                                className={styles.section}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.12 }}
                            >
                                <div className={styles.sectionHeader}>
                                    <h2 className={styles.sectionTitle}>現場の数字</h2>
                                </div>
                                <MonthlySummary sites={currentNumberSites} />
                            </motion.section>
                        )}
                    </motion.div>
                </AnimatePresence>
            </motion.div>

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
                                                        onClick={() => setSelectedProposal(proposal)}
                                                    >
                                                        内容を確認
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
                                PATH Proposal は詳細で対象月・メンバー・根拠を確認して、そのまま承認できます。
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
                        <div
                            className={styles.sheetHeader}
                        >
                            {selectedDayLogSite && (
                                <div className={styles.sheetHeading}>
                                    <h3 className={styles.sheetSiteTitle}>{selectedDayLogSite.name}</h3>
                                </div>
                            )}
                            <div className={styles.sheetHeaderControls}>
                                <div className={styles.sheetModeSwitch} aria-label="メモ表示切り替え" role="group">
                                    <button
                                        type="button"
                                        className={`${styles.sheetModeButton} ${
                                            dayLogSheetMode === "review" ? styles.sheetModeButtonActive : ""
                                        }`}
                                        onClick={() => switchDayLogSheetMode("review")}
                                    >
                                        一覧
                                    </button>
                                    <button
                                        type="button"
                                        className={`${styles.sheetModeButton} ${
                                            dayLogSheetMode === "write" ? styles.sheetModeButtonActive : ""
                                        }`}
                                        onClick={() => switchDayLogSheetMode("write")}
                                    >
                                        追加
                                    </button>
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
                        </div>

                        <form className={styles.sheetForm} onSubmit={handleSubmitDayLog}>
                            {dayLogSheetMode === "write" && (
                                <>
                                    <label className={styles.fieldLabel}>
                                        工種（必要なら）
                                        <select
                                            className={styles.selectInput}
                                            value={dayLogForm.trade_family}
                                            onChange={(event) =>
                                                setDayLogForm((current) => ({
                                                    ...current,
                                                    trade_family: event.target.value as PathTradeFamily | "",
                                                }))
                                            }
                                        >
                                            {DAY_LOG_TRADE_SELECT_OPTIONS.map((option) => (
                                                <option key={option.value} value={option.value}>
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
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
                                            placeholder="進み具合、注意点、引き継ぎを一言"
                                            rows={4}
                                        />
                                    </label>

                                    {selectedDayLogSite && (
                                        <button
                                            type="button"
                                            className={styles.linkButton}
                                            onClick={() => {
                                                const site = selectedDayLogSite;
                                                closeDayLogSheet();
                                                setSelectedSite(site);
                                            }}
                                        >
                                            <Paperclip size={16} />
                                            画像・書類を添付
                                        </button>
                                    )}
                                </>
                            )}

                            {dayLogSheetMode === "review" && (
                                <div className={styles.memoContextGrid}>
                                    <section className={styles.memoContextSection}>
                                        <div className={styles.memoContextHeader}>
                                            <span>メモ・添付</span>
                                            <span>{siteMemoTimelineItems.length}件</span>
                                        </div>
                                        {siteMemoLoading ? (
                                            <div className={styles.memoContextEmpty}>読み込み中...</div>
                                        ) : siteMemoError ? (
                                            <div className={styles.memoContextError}>{siteMemoError}</div>
                                        ) : siteMemoTimelineItems.length > 0 ? (
                                            <div className={styles.memoList}>
                                                {siteMemoTimelineItems.slice(0, 12).map((item) => {
                                                    if (item.kind === "memo") {
                                                        const log = item.log;
                                                        return (
                                                            <article key={item.id} className={styles.memoListItem}>
                                                                <div className={styles.memoListMeta}>
                                                                    <span>{formatMemoDateTime(log.created_at)}</span>
                                                                    <span>{getMemberName(log.member_id, members)}</span>
                                                                    <span>{getTradeLabel(log.trade_families[0])}</span>
                                                                </div>
                                                                <p>{log.memo || "メモ本文はありません。"}</p>
                                                            </article>
                                                        );
                                                    }

                                                    const url = getDocumentUrl(item.document);
                                                    const content = (
                                                        <>
                                                            <FileText size={16} />
                                                            <span className={styles.documentName}>
                                                                {item.document.original_filename || "書類"}
                                                            </span>
                                                            <span className={styles.documentDate}>
                                                                {formatMemoDate(item.document.created_at)}
                                                            </span>
                                                        </>
                                                    );

                                                    return url ? (
                                                        <a
                                                            key={item.id}
                                                            className={styles.documentListItem}
                                                            href={url}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                        >
                                                            {content}
                                                        </a>
                                                    ) : (
                                                        <div key={item.id} className={styles.documentListItem}>
                                                            {content}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <div className={styles.memoContextEmpty}>まだメモや添付はありません。</div>
                                        )}
                                    </section>
                                </div>
                            )}

                            {dayLogSheetMode === "write" ? (
                                <div className={`${styles.sheetActions} ${styles.sheetActionsSingle}`}>
                                    <button
                                        type="submit"
                                        className={styles.primaryButton}
                                        disabled={dayLogSubmitting}
                                    >
                                        <ClipboardCheck size={16} />
                                        {dayLogSubmitting ? "保存中..." : dayLogForm.id ? "更新" : "保存"}
                                    </button>
                                </div>
                            ) : null}
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
                                        ? "やることを編集"
                                        : composerMode === "siteQuick"
                                          ? "今日やることを追加"
                                          : "やることを追加"}
                                </h3>
                                <p className={styles.sheetDescription}>
                                    {composerMode === "siteQuick"
                                        ? "この現場で今日やることだけ先にメモします。必要なら補足だけ一言入れてください。"
                                        : "今日・今週・あとで残したいことを記録します。"}
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

            {constructionEditSite && (
                <SiteFormModal
                    site={constructionEditSite}
                    initialAction="lineItem"
                    onClose={() => setConstructionEditSite(null)}
                    onSuccess={() => {
                        const siteId = constructionEditSite.id;
                        setConstructionEditSite(null);
                        void loadData();
                        void syncSiteLineItems([siteId]);
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
