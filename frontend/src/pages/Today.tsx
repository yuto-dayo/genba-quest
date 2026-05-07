import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
    AlertCircle,
    Building2,
    Check,
    CheckCircle2,
    ClipboardCheck,
    FileText,
    Paperclip,
    RefreshCw,
    X,
} from "lucide-react";
import {
    fetchPathV31DayLogs,
    approveProposal,
    completeFocusItem,
    createFocusItem,
    executeProposal,
    fetchMembers,
    fetchFocusItems,
    fetchPendingProposals,
    fetchPathV31SiteMemberRewardInputs,
    fetchPathV31SiteMemberRolePlans,
    fetchSites,
    fetchSiteDocuments,
    instructProposal,
    rejectProposal,
    savePathV31SiteMemberRewardInput,
    savePathV31SiteMemberRolePlan,
    savePathV31DayLog,
    type FocusItemHorizon,
    type FocusItemRecord,
    type FocusItemScope,
    type Member,
    type PathTradeFamily,
    type PathV31DayLog,
    type PathV31RewardRoleKey,
    type PathV31ResponsibilityLevel,
    type PathV31RoleType,
    type PathV31SiteMemberRewardInput,
    type PathV31SiteMemberRolePlan,
    type ProposalRecord,
    type Site,
    type SiteDocument,
    updateFocusItem,
} from "../lib/api";
import { useCalendar } from "../hooks/useCalendar";
import { ProposalDetailModal } from "../components/ProposalDetailModal";
import { SiteDetailModal } from "../components/SiteDetailModal";
import { TodayAssignments } from "../components/today/TodayAssignments";
import type { SiteInputStatus } from "../components/today/TodayAssignments";
import { MonthlySummary } from "../components/today/MonthlySummary";
import { getDevAuthUserOption, isDevAuthSessionActive } from "../lib/devAuth";
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

const DAY_LOG_TRADE_SELECT_OPTIONS: Array<{ value: PathTradeFamily | ""; label: string }> = [
    { value: "", label: "未指定" },
    ...DAY_LOG_TRADE_OPTIONS,
];

const REWARD_ROLE_LABELS: Record<PathV31RewardRoleKey, string> = {
    planning: "段取り",
    quality: "品質",
    admin: "事務",
    client: "顧客",
};

const RESPONSIBILITY_LEVEL_OPTIONS: Array<{ value: PathV31ResponsibilityLevel; label: string }> = [
    { value: "owner", label: "責任者" },
    { value: "lead", label: "主担当" },
    { value: "member", label: "担当" },
    { value: "support", label: "補助" },
];

const EMPTY_ROLE_SHARES: Record<PathV31RewardRoleKey, number> = {
    planning: 0,
    quality: 0,
    admin: 0,
    client: 0,
};

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

type SiteRolePlanFormState = {
    site_id: string;
    member_id: string;
    role_shares: Record<PathV31RewardRoleKey, number>;
    note: string;
};

type SiteRewardInputFormState = {
    site_id: string;
    member_id: string;
    participation_units: number;
    responsibility_level: PathV31ResponsibilityLevel;
    role_shares: Record<PathV31RewardRoleKey, number>;
    note: string;
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

const EMPTY_ROLE_PLAN_FORM: SiteRolePlanFormState = {
    site_id: "",
    member_id: "",
    role_shares: EMPTY_ROLE_SHARES,
    note: "",
};

const EMPTY_REWARD_INPUT_FORM: SiteRewardInputFormState = {
    site_id: "",
    member_id: "",
    participation_units: 1,
    responsibility_level: "member",
    role_shares: EMPTY_ROLE_SHARES,
    note: "",
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

function buildTodayDayLogMap(logs: PathV31DayLog[]): Record<string, PathV31DayLog> {
    return logs.reduce<Record<string, PathV31DayLog>>((acc, log) => {
        acc[log.site_id] = log;
        return acc;
    }, {});
}

function buildBySiteMap<T extends { site_id: string }>(items: T[]): Record<string, T> {
    return items.reduce<Record<string, T>>((acc, item) => {
        acc[item.site_id] = item;
        return acc;
    }, {});
}

function normalizeRoleShares(
    shares?: Partial<Record<PathV31RewardRoleKey, number>> | null,
): Record<PathV31RewardRoleKey, number> {
    return {
        planning: Number(shares?.planning ?? 0),
        quality: Number(shares?.quality ?? 0),
        admin: Number(shares?.admin ?? 0),
        client: Number(shares?.client ?? 0),
    };
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
    const [members, setMembers] = useState<Member[]>([]);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [todayDayLogsBySiteId, setTodayDayLogsBySiteId] = useState<Record<string, PathV31DayLog>>({});
    const [siteMemoLogs, setSiteMemoLogs] = useState<PathV31DayLog[]>([]);
    const [siteMemoDocuments, setSiteMemoDocuments] = useState<SiteDocument[]>([]);
    const [siteMemoLoading, setSiteMemoLoading] = useState(false);
    const [siteMemoError, setSiteMemoError] = useState<string | null>(null);
    const [siteRolePlansBySiteId, setSiteRolePlansBySiteId] = useState<Record<string, PathV31SiteMemberRolePlan>>({});
    const [siteRewardInputsBySiteId, setSiteRewardInputsBySiteId] = useState<Record<string, PathV31SiteMemberRewardInput>>({});
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
    const [dayLogSheetMode, setDayLogSheetMode] = useState<DayLogSheetMode>("write");
    const [dayLogSubmitting, setDayLogSubmitting] = useState(false);
    const [dayLogForm, setDayLogForm] = useState<DayLogFormState>(EMPTY_DAY_LOG_FORM);
    const [rolePlanSheetOpen, setRolePlanSheetOpen] = useState(false);
    const [rolePlanSubmitting, setRolePlanSubmitting] = useState(false);
    const [rolePlanForm, setRolePlanForm] = useState<SiteRolePlanFormState>(EMPTY_ROLE_PLAN_FORM);
    const [rewardInputSheetOpen, setRewardInputSheetOpen] = useState(false);
    const [rewardInputSubmitting, setRewardInputSubmitting] = useState(false);
    const [rewardInputForm, setRewardInputForm] = useState<SiteRewardInputFormState>(EMPTY_REWARD_INPUT_FORM);
    const [selectedSite, setSelectedSite] = useState<Site | null>(null);
    const [actionNotice, setActionNotice] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [completingId, setCompletingId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const { calendarDays } = useCalendar();
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
    const selectedRolePlanSite = useMemo(
        () => sites.find((site) => site.id === rolePlanForm.site_id) || null,
        [rolePlanForm.site_id, sites]
    );
    const selectedRewardInputSite = useMemo(
        () => sites.find((site) => site.id === rewardInputForm.site_id) || null,
        [rewardInputForm.site_id, sites]
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
                membersData,
                pendingProposalsData,
            ] = await Promise.all([
                supabase.auth.getSession(),
                fetchFocusItems({ status: "open" }),
                fetchSites(),
                fetchMembers().catch(() => []),
                fetchPendingProposals().catch(() => []),
            ]);
            const nextCurrentUserId = resolveCurrentUserId(sessionResult.data.session?.user?.id);
            setCurrentUserId(nextCurrentUserId);
            setFocusItems(focusItemsData);
            setSites(sitesData);
            setMembers(membersData);
            setPendingProposals(pendingProposalsData);
            if (nextCurrentUserId) {
                const [, rolePlansResponse, rewardInputsResponse] = await Promise.all([
                    syncTodayDayLogs(nextCurrentUserId),
                    fetchPathV31SiteMemberRolePlans({ member_id: nextCurrentUserId, limit: 200 }),
                    fetchPathV31SiteMemberRewardInputs({ member_id: nextCurrentUserId, limit: 200 }),
                ]);
                setSiteRolePlansBySiteId(buildBySiteMap(rolePlansResponse.plans));
                setSiteRewardInputsBySiteId(buildBySiteMap(rewardInputsResponse.inputs));
            } else {
                setTodayDayLogsBySiteId({});
                setSiteRolePlansBySiteId({});
                setSiteRewardInputsBySiteId({});
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

    const getSiteInputStatus = useCallback((siteId: string): SiteInputStatus => {
        if (siteRewardInputsBySiteId[siteId]) {
            return "reward_saved";
        }
        if (siteRolePlansBySiteId[siteId]) {
            return todayDayLogsBySiteId[siteId] ? "reward_missing" : "role_saved";
        }
        return "role_missing";
    }, [siteRewardInputsBySiteId, siteRolePlansBySiteId, todayDayLogsBySiteId]);

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
        const existingLog = todayDayLogsBySiteId[site.id];
        setDayLogForm(
            existingLog
                ? buildDayLogForm(existingLog)
                : {
                      ...EMPTY_DAY_LOG_FORM,
                      date: todayKey,
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

            const existingLog = dayLogForm.site_id ? todayDayLogsBySiteId[dayLogForm.site_id] : null;
            if (existingLog?.locked_by_site_close_id) {
                setActionError("この記録は現場締め後のため編集できません");
                return;
            }
        }

        setActionError(null);
        setDayLogSheetMode(mode);
    };

    const openRolePlanSheet = (site: Site) => {
        if (!currentUserId) {
            setActionError("ログイン情報を確認できませんでした");
            return;
        }

        const existingPlan = siteRolePlansBySiteId[site.id];
        setRolePlanForm({
            site_id: site.id,
            member_id: currentUserId,
            role_shares: normalizeRoleShares(existingPlan?.role_shares),
            note: existingPlan?.note || "",
        });
        setActionError(null);
        setRolePlanSheetOpen(true);
    };

    const openRewardInputSheet = (site: Site) => {
        if (!currentUserId) {
            setActionError("ログイン情報を確認できませんでした");
            return;
        }

        const existingInput = siteRewardInputsBySiteId[site.id];
        const rolePlan = siteRolePlansBySiteId[site.id];
        const dayLog = todayDayLogsBySiteId[site.id];
        setRewardInputForm({
            site_id: site.id,
            member_id: currentUserId,
            participation_units: existingInput?.participation_units ?? dayLog?.credited_unit ?? 1,
            responsibility_level: existingInput?.responsibility_level ?? "member",
            role_shares: normalizeRoleShares(existingInput?.role_shares ?? rolePlan?.role_shares),
            note: existingInput?.note || "",
        });
        setActionError(null);
        setRewardInputSheetOpen(true);
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

    const closeRolePlanSheet = () => {
        setRolePlanSheetOpen(false);
        setRolePlanForm(EMPTY_ROLE_PLAN_FORM);
    };

    const closeRewardInputSheet = () => {
        setRewardInputSheetOpen(false);
        setRewardInputForm(EMPTY_REWARD_INPUT_FORM);
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
                id: dayLogForm.id,
                date: dayLogForm.date,
                site_id: dayLogForm.site_id,
                member_id: currentUserId,
                trade_families: [dayLogForm.trade_family || "common_site_operations"],
                role_type: dayLogForm.role_type,
                credited_unit: dayLogForm.credited_unit,
                memo: dayLogForm.memo.trim() || undefined,
            });

            setTodayDayLogsBySiteId((current) => ({
                ...current,
                [log.site_id]: log,
            }));
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

    const handleSubmitRolePlan = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (!currentUserId) {
            setActionError("ログイン情報を確認できませんでした");
            return;
        }
        if (!rolePlanForm.site_id) {
            setActionError("現場を選んでください");
            return;
        }

        try {
            setRolePlanSubmitting(true);
            setActionError(null);
            setActionNotice(null);

            const { plan } = await savePathV31SiteMemberRolePlan({
                ...rolePlanForm,
                member_id: currentUserId,
                note: rolePlanForm.note.trim() || undefined,
            });

            setSiteRolePlansBySiteId((current) => ({
                ...current,
                [plan.site_id]: plan,
            }));
            setActionNotice("役割を保存しました");
            closeRolePlanSheet();
        } catch (err: unknown) {
            setActionError(getErrorMessage(err));
        } finally {
            setRolePlanSubmitting(false);
        }
    };

    const handleSubmitRewardInput = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (!currentUserId) {
            setActionError("ログイン情報を確認できませんでした");
            return;
        }
        if (!rewardInputForm.site_id) {
            setActionError("現場を選んでください");
            return;
        }

        try {
            setRewardInputSubmitting(true);
            setActionError(null);
            setActionNotice(null);

            const { input } = await savePathV31SiteMemberRewardInput({
                ...rewardInputForm,
                member_id: currentUserId,
                participation_units: Number(rewardInputForm.participation_units) || 0,
                note: rewardInputForm.note.trim() || undefined,
            });

            setSiteRewardInputsBySiteId((current) => ({
                ...current,
                [input.site_id]: input,
            }));
            setActionNotice("責任を保存しました");
            closeRewardInputSheet();
        } catch (err: unknown) {
            setActionError(getErrorMessage(err));
        } finally {
            setRewardInputSubmitting(false);
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
                    onViewSiteMemo={openDayLogReviewSheet}
                    onPlanRole={openRolePlanSheet}
                    onRecordRewardInput={openRewardInputSheet}
                    onAddFocusItem={openFocusItemQuickComposer}
                    getDayLogStatus={getDayLogStatus}
                    getSiteInputStatus={getSiteInputStatus}
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

            {rolePlanSheetOpen && (
                <div className={styles.sheetOverlay} onClick={closeRolePlanSheet}>
                    <motion.div
                        className={styles.sheet}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className={styles.sheetHeader}>
                            <div className={styles.sheetHeading}>
                                <h3 className={styles.sheetTitle}>役割</h3>
                            </div>
                            <button
                                type="button"
                                className={styles.closeButton}
                                onClick={closeRolePlanSheet}
                                aria-label="閉じる"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <form className={styles.sheetForm} onSubmit={handleSubmitRolePlan}>
                            {selectedRolePlanSite && (
                                <div className={styles.sheetSiteCard}>
                                    <span className={styles.sheetSiteEyebrow}>入力する現場</span>
                                    <strong>{selectedRolePlanSite.name}</strong>
                                    {selectedRolePlanSite.address && (
                                        <span>{selectedRolePlanSite.address}</span>
                                    )}
                                </div>
                            )}

                            <div className={styles.roleShareGrid}>
                                {(["planning", "quality", "admin", "client"] as PathV31RewardRoleKey[]).map((key) => (
                                    <label key={key} className={styles.fieldLabel}>
                                        {REWARD_ROLE_LABELS[key]}
                                        <input
                                            className={styles.textInput}
                                            type="number"
                                            min={0}
                                            step={0.1}
                                            value={rolePlanForm.role_shares[key]}
                                            onChange={(event) =>
                                                setRolePlanForm((current) => ({
                                                    ...current,
                                                    role_shares: {
                                                        ...current.role_shares,
                                                        [key]: Number(event.target.value) || 0,
                                                    },
                                                }))
                                            }
                                        />
                                    </label>
                                ))}
                            </div>

                            <label className={styles.fieldLabel}>
                                メモ
                                <textarea
                                    className={styles.textArea}
                                    value={rolePlanForm.note}
                                    onChange={(event) =>
                                        setRolePlanForm((current) => ({
                                            ...current,
                                            note: event.target.value,
                                        }))
                                    }
                                    rows={3}
                                />
                            </label>

                            <div className={styles.sheetActions}>
                                <button
                                    type="button"
                                    className={styles.secondaryButton}
                                    onClick={closeRolePlanSheet}
                                >
                                    キャンセル
                                </button>
                                <button
                                    type="submit"
                                    className={styles.primaryButton}
                                    disabled={rolePlanSubmitting}
                                >
                                    <ClipboardCheck size={16} />
                                    {rolePlanSubmitting ? "保存中..." : "保存"}
                                </button>
                            </div>
                        </form>
                    </motion.div>
                </div>
            )}

            {rewardInputSheetOpen && (
                <div className={styles.sheetOverlay} onClick={closeRewardInputSheet}>
                    <motion.div
                        className={styles.sheet}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className={styles.sheetHeader}>
                            <div className={styles.sheetHeading}>
                                <h3 className={styles.sheetTitle}>責任</h3>
                            </div>
                            <button
                                type="button"
                                className={styles.closeButton}
                                onClick={closeRewardInputSheet}
                                aria-label="閉じる"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <form className={styles.sheetForm} onSubmit={handleSubmitRewardInput}>
                            {selectedRewardInputSite && (
                                <div className={styles.sheetSiteCard}>
                                    <span className={styles.sheetSiteEyebrow}>入力する現場</span>
                                    <strong>{selectedRewardInputSite.name}</strong>
                                    {selectedRewardInputSite.address && (
                                        <span>{selectedRewardInputSite.address}</span>
                                    )}
                                </div>
                            )}

                            <label className={styles.fieldLabel}>
                                参加ユニット
                                <input
                                    className={styles.textInput}
                                    type="number"
                                    min={0}
                                    step={0.25}
                                    value={rewardInputForm.participation_units}
                                    onChange={(event) =>
                                        setRewardInputForm((current) => ({
                                            ...current,
                                            participation_units: Number(event.target.value) || 0,
                                        }))
                                    }
                                />
                            </label>

                            <label className={styles.fieldLabel}>
                                責任レベル
                                <select
                                    className={styles.selectInput}
                                    value={rewardInputForm.responsibility_level}
                                    onChange={(event) =>
                                        setRewardInputForm((current) => ({
                                            ...current,
                                            responsibility_level: event.target.value as PathV31ResponsibilityLevel,
                                        }))
                                    }
                                >
                                    {RESPONSIBILITY_LEVEL_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <div className={styles.roleShareGrid}>
                                {(["planning", "quality", "admin", "client"] as PathV31RewardRoleKey[]).map((key) => (
                                    <label key={key} className={styles.fieldLabel}>
                                        {REWARD_ROLE_LABELS[key]}
                                        <input
                                            className={styles.textInput}
                                            type="number"
                                            min={0}
                                            step={0.1}
                                            value={rewardInputForm.role_shares[key]}
                                            onChange={(event) =>
                                                setRewardInputForm((current) => ({
                                                    ...current,
                                                    role_shares: {
                                                        ...current.role_shares,
                                                        [key]: Number(event.target.value) || 0,
                                                    },
                                                }))
                                            }
                                        />
                                    </label>
                                ))}
                            </div>

                            <label className={styles.fieldLabel}>
                                メモ
                                <textarea
                                    className={styles.textArea}
                                    value={rewardInputForm.note}
                                    onChange={(event) =>
                                        setRewardInputForm((current) => ({
                                            ...current,
                                            note: event.target.value,
                                        }))
                                    }
                                    rows={3}
                                />
                            </label>

                            <div className={styles.sheetActions}>
                                <button
                                    type="button"
                                    className={styles.secondaryButton}
                                    onClick={closeRewardInputSheet}
                                >
                                    キャンセル
                                </button>
                                <button
                                    type="submit"
                                    className={styles.primaryButton}
                                    disabled={rewardInputSubmitting}
                                >
                                    <ClipboardCheck size={16} />
                                    {rewardInputSubmitting ? "保存中..." : "保存"}
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
