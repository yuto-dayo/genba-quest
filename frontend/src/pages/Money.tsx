import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSearchParams } from "react-router-dom";
import {
    RefreshCw,
    Receipt,
    TrendingUp,
    AlertTriangle,
    AlertCircle,
    CheckCircle,
    XCircle,
    Calendar,
    FileText,
    X,
    ChevronRight,
    Search,
    SlidersHorizontal,
    FilterX,
} from "lucide-react";
import {
    fetchPL,
    fetchTeamRewardSummary,
    fetchMemberReimbursementsSummary,
    approveProposal,
    executeProposal,
    fetchPendingProposals,
    fetchTransactions,
    fetchPendingApprovals,
    fetchClients,
    fetchMonthlyDeductible,
    fetchClientInvoicesWithReceipts,
    fetchClientCreditSummaries,
    fetchClientCreditMetrics,
    instructProposal,
    rejectProposal,
    searchTransactions,
    batchReviewExpenses,
    fetchNotifications,
    fetchDisputeCorrections,
    type PLReport,
    type AccountingTransaction,
    type ProposalRecord,
    type Client,
    type TeamRewardSummary,
    type MemberReimbursementsSummary,
    type MonthlyDeductibleAmount,
    type NotificationRecord,
    type ClientInvoiceWithReceipts,
    type ClientCreditSummary,
    type ClientCreditMetrics,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import { supabase } from "../lib/supabase";
import { track } from "../lib/telemetry";
import { usePastMonthGuard } from "../hooks/usePastMonthGuard";
import { ExpenseModal } from "../components/ExpenseModal";
import { SalesModal } from "../components/SalesModal";
import { InvoiceModal } from "../components/InvoiceModal";
import { ProposalDetailModal } from "../components/ProposalDetailModal";
import { TransactionDetailModal } from "../components/TransactionDetailModal";
import { ApprovalCard } from "../components/ApprovalCard";
import { FloatingActionButton } from "../components/FloatingActionButton";
import { MoneyTabs, type MoneyTab } from "../components/MoneyTabs";
import { MoneyFilterSheet, type ExpenseCategory } from "../components/MoneyFilterSheet";
import { InlineLoader } from "../components/InlineLoader";
import { MoneyHeroSection } from "../components/money/MoneyHeroSection";
import { MemberCarousel } from "../components/money/MemberCarousel";
import { PayoutHeroCard } from "../components/money/PayoutHeroCard";
import { usePayoutSelection } from "../components/money/usePayoutSelection";
import { CompanySummaryCard } from "../components/money/CompanySummaryCard";
import { ShieldPopover } from "../components/money/ShieldPopover";
import { OwnPayoutModal } from "../components/money/OwnPayoutModal";
import { OtherPayoutModal } from "../components/money/OtherPayoutModal";
import { ExpenseDetailModal } from "../components/money/ExpenseDetailModal";
import { TeamExpenseSummaryModal } from "../components/money/TeamExpenseSummaryModal";
import { MonthCloseModal } from "../components/money/MonthCloseModal";
import { InvoicePayModal } from "../components/money/InvoicePayModal";
import { ClientInvoiceList } from "../components/money/ClientInvoiceList";
import { ClientCreditStatusSection } from "../components/money/ClientCreditStatusSection";
import { ClientCreditDetailModal } from "../components/money/ClientCreditDetailModal";
import { ReadOnlyBanner } from "../components/common/ReadOnlyBanner";
import styles from "./Money.module.css";

// 日付フォーマットヘルパー (YYYY/MM/DD)
const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return "";
    return dateStr.replace(/-/g, "/");
};

// PR #12: day-head 用フォーマット (例: "5月10日 (土)")
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const formatDayHead = (iso: string) => {
    if (!iso) return "—";
    const [, m, d] = iso.split("-").map(Number);
    const dt = new Date(iso);
    const weekday = Number.isNaN(dt.getDay()) ? "" : WEEKDAY_LABELS[dt.getDay()];
    return weekday ? `${m}月${d}日 (${weekday})` : `${m}月${d}日`;
};

const getAccountingImpactSign = (tx: Pick<AccountingTransaction, "kind" | "amount_total">) => {
    const isReversalAmount = tx.amount_total < 0;
    if (tx.kind === "expense") {
        return isReversalAmount ? "+" : "-";
    }
    return isReversalAmount ? "-" : "+";
};

// 検索フィルター型
interface SearchFilters {
    kind: "all" | "expense" | "sale" | "invoice";
    datePreset: "all" | "thisMonth" | "lastMonth" | "custom";
    dateFrom: string;
    dateTo: string;
    query: string;
    clientId: string | null;
    category: ExpenseCategory | null;
}

interface ExpenseCorrectionDraft {
    siteId?: string;
    category?: "material" | "tool" | "travel" | "food" | "fuel" | "utility" | "other";
    taxCategory?: "10_STANDARD" | "08_REDUCED" | "00_EXEMPT" | "00_TAXFREE";
    vendorName?: string;
    recordedDate?: string;
    amountSubtotal?: string;
    taxAmount?: string;
    amountTotal?: string;
    description?: string;
    costCenter?: "HQ" | "SITE";
    expenseItemCode?: string;
    expenseItemOther?: string;
}

interface SalesCorrectionDraft {
    siteId?: string;
    recordedDate?: string;
    description?: string;
    items?: Array<{
        item_name: string;
        quantity: number | null;
        unit_name: string;
        unit_price: number | null;
    }>;
}

interface InvoicePayTarget {
    invoiceId: string;
    notificationId: string | null;
    from: "bell" | "partner_drawer";
}

// 日付プリセットの計算
const getDateRange = (preset: SearchFilters["datePreset"]): { from: string; to: string } => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    switch (preset) {
        case "thisMonth": {
            const firstDay = new Date(year, month, 1);
            const lastDay = new Date(year, month + 1, 0);
            return {
                from: firstDay.toISOString().split("T")[0],
                to: lastDay.toISOString().split("T")[0],
            };
        }
        case "lastMonth": {
            const firstDay = new Date(year, month - 1, 1);
            const lastDay = new Date(year, month, 0);
            return {
                from: firstDay.toISOString().split("T")[0],
                to: lastDay.toISOString().split("T")[0],
            };
        }
        default:
            return { from: "", to: "" };
    }
};

const defaultFilters: SearchFilters = {
    kind: "all",
    datePreset: "all",
    dateFrom: "",
    dateTo: "",
    query: "",
    clientId: null,
    category: null,
};

const getRecentMonths = (endMonth: string, count: number) => {
    const [year, month] = endMonth.split("-").map(Number);
    const cursor = new Date(year, month - 1, 1);
    return Array.from({ length: count }, (_, index) => {
        const dt = new Date(cursor.getFullYear(), cursor.getMonth() - (count - 1 - index), 1);
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    });
};

function isMonthParam(value: string | null): value is string {
    return Boolean(value && /^\d{4}-\d{2}$/.test(value));
}

function isInvoicePayNotification(notification: NotificationRecord, invoiceId: string): boolean {
    return notification.type === "approval_required"
        && notification.data?.kind === "member_invoice_pay"
        && notification.data?.invoice_id === invoiceId;
}

// モバイル判定
const useIsMobile = () => {
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth <= 768 || 'ontouchstart' in window);
        };
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    return isMobile;
};

export function Money() {
    const [searchParams, setSearchParams] = useSearchParams();
    const trackedMonthCloseUrlParamsRef = useRef(new Set<string>());
    const isMobile = useIsMobile();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // 選択中の月 (YYYY-MM形式)
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const period = searchParams.get("period");
        if (isMonthParam(period)) {
            return period;
        }
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    });
    const pastMonthGuard = usePastMonthGuard(selectedMonth);
    const readOnly = pastMonthGuard.readOnly;

    const [pl, setPL] = useState<PLReport | null>(null);
    const [monthlyDeductible, setMonthlyDeductible] = useState<MonthlyDeductibleAmount | null>(null);
    const [teamRewardSummary, setTeamRewardSummary] = useState<TeamRewardSummary | null>(null);
    const [reimbursementsSummary, setReimbursementsSummary] = useState<MemberReimbursementsSummary | null>(null);
    const payoutSelection = usePayoutSelection(teamRewardSummary?.self_member_id ?? null);
    const [moneyHeroLoading, setMoneyHeroLoading] = useState(false);
    const [moneyHeroError, setMoneyHeroError] = useState<string | null>(null);
    const [pendingDisputeMemberIds, setPendingDisputeMemberIds] = useState<string[]>([]);
    const [companyTrend, setCompanyTrend] = useState<number[]>([]);
    const [shieldOpen, setShieldOpen] = useState(false);
    const [transactions, setTransactions] = useState<AccountingTransaction[]>([]);
    const [pendingApprovals, setPendingApprovals] = useState<AccountingTransaction[]>([]);
    const [pendingProposals, setPendingProposals] = useState<ProposalRecord[]>([]);
    const [selectedProposal, setSelectedProposal] = useState<ProposalRecord | null>(null);
    const [proposalActing, setProposalActing] = useState(false);
    const [proposalError, setProposalError] = useState<string | null>(null);
    const [proposalNotice, setProposalNotice] = useState<string | null>(null);

    // フィルター関連（統合型）
    const [filters, setFilters] = useState<SearchFilters>(defaultFilters);
    const [searchInput, setSearchInput] = useState("");
    const [showAllTransactions, setShowAllTransactions] = useState(false);
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchResults, setSearchResults] = useState<AccountingTransaction[] | null>(null);
    const [showDatePicker, setShowDatePicker] = useState(false);

    // タブ (PR #5) — 取引 / 取引先
    const [activeTab, setActiveTab] = useState<MoneyTab>("transactions");
    const [showFilterSheet, setShowFilterSheet] = useState(false);

    // ログイン中ユーザの id (自分カード / チーム報酬モーダル用)
    const [selfUserId, setSelfUserId] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const {
                data: { session },
            } = await supabase.auth.getSession();
            if (!cancelled) {
                setSelfUserId(session?.user?.id ?? null);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // 取引先タブ — 顧客請求書 + 入金記録
    const [clientInvoices, setClientInvoices] = useState<ClientInvoiceWithReceipts[]>([]);
    const [clientInvoicesLoading, setClientInvoicesLoading] = useState(false);
    const [clientInvoicesError, setClientInvoicesError] = useState<string | null>(null);
    const [invoiceRefreshKey, setInvoiceRefreshKey] = useState(0);
    const [clientCreditSummaries, setClientCreditSummaries] = useState<ClientCreditSummary[]>([]);
    const [clientCreditLoading, setClientCreditLoading] = useState(false);
    const [clientCreditError, setClientCreditError] = useState<string | null>(null);
    const [selectedCreditClient, setSelectedCreditClient] = useState<ClientCreditSummary | null>(null);
    const [selectedCreditMetrics, setSelectedCreditMetrics] = useState<ClientCreditMetrics | null>(null);
    const [selectedCreditLoading, setSelectedCreditLoading] = useState(false);
    const [selectedCreditError, setSelectedCreditError] = useState<string | null>(null);

    // 取引先一覧 — フィルタシート (取引先 chips) でマウント時にロード
    const [clients, setClients] = useState<Client[] | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetchClients({ status: "active" })
            .then((data) => {
                if (!cancelled) setClients(data);
            })
            .catch((err: unknown) => {
                console.error("[Money] failed to load clients:", err);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (activeTab !== "vendors") return;
        let cancelled = false;
        setClientInvoicesLoading(true);
        setClientInvoicesError(null);
        fetchClientInvoicesWithReceipts({ bucket: "all", limit: 200 })
            .then((data) => {
                if (!cancelled) setClientInvoices(data);
            })
            .catch((err: unknown) => {
                if (!cancelled) setClientInvoicesError(getErrorMessage(err));
            })
            .finally(() => {
                if (!cancelled) setClientInvoicesLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [activeTab, invoiceRefreshKey]);

    useEffect(() => {
        if (activeTab !== "vendors") return;
        let cancelled = false;
        setClientCreditLoading(true);
        setClientCreditError(null);
        fetchClientCreditSummaries()
            .then((result) => {
                if (!cancelled) setClientCreditSummaries(result.clients ?? []);
            })
            .catch((err: unknown) => {
                if (!cancelled) setClientCreditError(getErrorMessage(err));
            })
            .finally(() => {
                if (!cancelled) setClientCreditLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [activeTab, invoiceRefreshKey]);

    useEffect(() => {
        if (!selectedCreditClient) {
            setSelectedCreditMetrics(null);
            setSelectedCreditError(null);
            return;
        }

        let cancelled = false;
        setSelectedCreditLoading(true);
        setSelectedCreditError(null);
        fetchClientCreditMetrics(selectedCreditClient.client_id)
            .then((metrics) => {
                if (!cancelled) setSelectedCreditMetrics(metrics);
            })
            .catch((err: unknown) => {
                if (!cancelled) setSelectedCreditError(getErrorMessage(err));
            })
            .finally(() => {
                if (!cancelled) setSelectedCreditLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [selectedCreditClient]);

    // 承認モーダル (バッチ操作用、ベルから個別カードと別に開ける)
    const [showApprovalsModal, setShowApprovalsModal] = useState(false);

    // 登録モーダル
    const [showExpenseModal, setShowExpenseModal] = useState(false);
    const [showSalesModal, setShowSalesModal] = useState(false);
    const [showInvoiceModal, setShowInvoiceModal] = useState(false);
    const [invoicePayTarget, setInvoicePayTarget] = useState<InvoicePayTarget | null>(null);
    const [ownPayoutModalOpen, setOwnPayoutModalOpen] = useState(false);
    const [otherRewardMemberId, setOtherRewardMemberId] = useState<string | null>(null);
    const [expenseDetailMemberId, setExpenseDetailMemberId] = useState<string | null>(null);
    const [teamExpenseSummaryOpen, setTeamExpenseSummaryOpen] = useState(false);
    const [monthCloseModalOpen, setMonthCloseModalOpen] = useState(false);
    const [targetMonthClosePeriod, setTargetMonthClosePeriod] = useState<string | null>(null);
    const [selectedTransaction, setSelectedTransaction] = useState<AccountingTransaction | null>(null);
    const [expenseDraft, setExpenseDraft] = useState<ExpenseCorrectionDraft | null>(null);
    const [salesDraft, setSalesDraft] = useState<SalesCorrectionDraft | null>(null);

    const refreshPendingProposals = useCallback(async () => {
        const pendingData = await fetchPendingProposals();
        setPendingProposals(pendingData.slice(0, 8));
    }, []);

    const loadData = useCallback(async (options?: { keepCurrentView?: boolean; suppressPageError?: boolean }) => {
        const keepCurrentView = options?.keepCurrentView ?? false;
        const suppressPageError = options?.suppressPageError ?? false;

        try {
            if (!keepCurrentView) {
                setLoading(true);
            }
            if (!suppressPageError) {
                setError(null);
            }
            const [plData, txData, pendingData, pathPendingData] = await Promise.all([
                fetchPL({ month: selectedMonth }),
                fetchTransactions({ limit: 50 }),
                fetchPendingApprovals(),
                fetchPendingProposals().catch(() => []),
            ]);
            setPL(plData);
            setTransactions(txData);
            setPendingProposals(pathPendingData.slice(0, 8));
            // 決定的ソート順
            const sortedPending = [...pendingData].sort((a, b) => {
                const riskOrder = { HIGH: 0, LOW: 1 };
                const riskA = riskOrder[a.risk_level || "LOW"] ?? 1;
                const riskB = riskOrder[b.risk_level || "LOW"] ?? 1;
                if (riskA !== riskB) return riskA - riskB;
                const dateA = a.recorded_date || "";
                const dateB = b.recorded_date || "";
                if (dateA !== dateB) return dateA.localeCompare(dateB);
                return a.id.localeCompare(b.id);
            });
            setPendingApprovals(sortedPending);
        } catch (err: unknown) {
            if (suppressPageError) {
                console.error("[Money] background refresh failed:", err);
            } else {
                setError(getErrorMessage(err));
            }
        } finally {
            if (!keepCurrentView) {
                setLoading(false);
            }
        }
    }, [selectedMonth]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    useEffect(() => {
        let cancelled = false;

        fetchMonthlyDeductible(selectedMonth)
            .then((result) => {
                if (!cancelled) {
                    setMonthlyDeductible(result);
                }
            })
            .catch((err: unknown) => {
                console.warn("[Money] monthly deductible load failed:", err);
                if (!cancelled) {
                    setMonthlyDeductible(null);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [selectedMonth]);

    useEffect(() => {
        let cancelled = false;
        setMoneyHeroLoading(true);
        setMoneyHeroError(null);

        Promise.all([
            fetchTeamRewardSummary(selectedMonth),
            fetchMemberReimbursementsSummary(selectedMonth),
            fetchDisputeCorrections({ month: selectedMonth, status: "pending", limit: 100 }).catch(() => []),
        ])
            .then(([rewardData, reimbursementData, disputeData]) => {
                if (cancelled) return;
                setTeamRewardSummary(rewardData);
                setReimbursementsSummary(reimbursementData);
                setPendingDisputeMemberIds(Array.from(new Set(
                    disputeData
                        .map((correction) => correction.reward_member_id || correction.target_member_id)
                        .filter((memberId): memberId is string => Boolean(memberId)),
                )));
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                setMoneyHeroError(getErrorMessage(err));
            })
            .finally(() => {
                if (!cancelled) setMoneyHeroLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [selectedMonth]);

    useEffect(() => {
        let cancelled = false;
        const months = getRecentMonths(selectedMonth, 6);

        Promise.all(
            months.map((month) =>
                fetchPL({ month })
                    .then((report) => report.profit)
                    .catch(() => null),
            ),
        ).then((values) => {
            if (cancelled) return;
            const usableValues = values.filter((value): value is number => typeof value === "number");
            setCompanyTrend(usableValues);
        });

        return () => {
            cancelled = true;
        };
    }, [selectedMonth]);

    const clearProposalSearchParam = useCallback(() => {
        if (!searchParams.has("proposal")) {
            return;
        }

        const next = new URLSearchParams(searchParams);
        next.delete("proposal");
        setSearchParams(next, { replace: true });
    }, [searchParams, setSearchParams]);

    useEffect(() => {
        const proposalId = searchParams.get("proposal");
        if (!proposalId) {
            return;
        }

        const matchedProposal = pendingProposals.find((proposal) => proposal.id === proposalId) || null;
        if (matchedProposal) {
            setSelectedProposal(matchedProposal);
        }
    }, [pendingProposals, searchParams]);

    const clearInvoicePaySearchParams = useCallback(() => {
        const next = new URLSearchParams(searchParams);
        next.delete("modal");
        next.delete("invoice_id");
        setSearchParams(next, { replace: true });
    }, [searchParams, setSearchParams]);

    useEffect(() => {
        const modal = searchParams.get("modal");
        const invoiceId = searchParams.get("invoice_id");
        if (modal !== "invoice_pay" || !invoiceId) {
            setInvoicePayTarget(null);
            return;
        }

        let cancelled = false;
        (async () => {
            let notificationId: string | null = null;
            try {
                const notifications = await fetchNotifications({ unread_only: true, limit: 50 });
                notificationId = notifications.find((notification) => (
                    isInvoicePayNotification(notification, invoiceId)
                ))?.id ?? null;
            } catch (err) {
                console.warn("[Money] failed to locate invoice pay notification:", err);
            }
            if (!cancelled) {
                setInvoicePayTarget({ invoiceId, notificationId, from: "bell" });
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [searchParams]);

    // ベル経由で来た「経費承認」リクエストを ApprovalsModal で開く
    useEffect(() => {
        if (searchParams.get("inbox") !== "approvals") {
            return;
        }
        setShowApprovalsModal(true);
        const next = new URLSearchParams(searchParams);
        next.delete("inbox");
        setSearchParams(next, { replace: true });
    }, [searchParams, setSearchParams]);

    useEffect(() => {
        const modal = searchParams.get("modal");
        const period = searchParams.get("period");
        if (modal === "month_close" && period) {
            if (!trackedMonthCloseUrlParamsRef.current.has(period)) {
                trackedMonthCloseUrlParamsRef.current.add(period);
                track({ type: "money.month_close.cta_seen", from: "url_param" });
            }
            setTargetMonthClosePeriod(period);
            setSelectedMonth(period);
            setMonthCloseModalOpen(true);
        }
    }, [searchParams]);

    const clearRewardSearchParams = useCallback(() => {
        if (searchParams.get("modal") !== "reward") {
            return;
        }
        const next = new URLSearchParams(searchParams);
        next.delete("modal");
        next.delete("member");
        next.delete("period");
        next.delete("site");
        setSearchParams(next, { replace: true });
    }, [searchParams, setSearchParams]);

    const closeOwnPayoutModal = useCallback(() => {
        setOwnPayoutModalOpen(false);
        clearRewardSearchParams();
    }, [clearRewardSearchParams]);

    const closeOtherPayoutModal = useCallback(() => {
        setOtherRewardMemberId(null);
        clearRewardSearchParams();
    }, [clearRewardSearchParams]);

    useEffect(() => {
        if (searchParams.get("modal") !== "reward") {
            return;
        }

        const period = searchParams.get("period");
        if (isMonthParam(period)) {
            setSelectedMonth(period);
        }

        const selfMemberId = teamRewardSummary?.self_member_id ?? null;
        const targetMemberId = searchParams.get("member") || selfMemberId;
        if (!targetMemberId) {
            return;
        }

        if (selfMemberId && targetMemberId === selfMemberId) {
            setOtherRewardMemberId(null);
            setOwnPayoutModalOpen(true);
            return;
        }

        setOwnPayoutModalOpen(false);
        setOtherRewardMemberId(targetMemberId);
    }, [searchParams, teamRewardSummary?.self_member_id]);

    const closeMonthCloseModal = useCallback(() => {
        setMonthCloseModalOpen(false);
        setTargetMonthClosePeriod(null);

        if (!searchParams.has("modal") && !searchParams.has("period")) {
            return;
        }
        const next = new URLSearchParams(searchParams);
        next.delete("modal");
        next.delete("period");
        setSearchParams(next, { replace: true });
    }, [searchParams, setSearchParams]);

    const handleProposalMutation = async (
        proposalId: string,
        action: "approve" | "reject" | "instruct" | "execute",
        payload?: string,
    ) => {
        if (readOnly) {
            setProposalError("過去月は閲覧専用です。修正は新しい月の逆仕訳で行います。");
            return;
        }

        try {
            setProposalActing(true);
            setProposalError(null);
            setProposalNotice(null);

            let updatedProposal: ProposalRecord | null = null;
            if (action === "approve") {
                const response = await approveProposal(proposalId, payload);
                updatedProposal = response.proposal;
                if (updatedProposal.status === "approved") {
                    setProposalNotice("承認しました。続けて実行できます。");
                } else if (updatedProposal.status === "executed" || response.auto_executed) {
                    setProposalNotice("承認し、実行まで完了しました。");
                } else {
                    setProposalNotice("承認しました。残りの承認を待っています。");
                }
            } else if (action === "reject") {
                updatedProposal = await rejectProposal(proposalId, payload || "");
                setProposalNotice("却下しました。Ledgerには反映されません。");
            } else if (action === "instruct") {
                const response = await instructProposal(proposalId, payload || "");
                updatedProposal = response.proposal;
                setProposalNotice("修正指示を送りました。新しいProposalを待ちます。");
            } else {
                updatedProposal = await executeProposal(proposalId);
                setProposalNotice("実行しました。EventとLedgerを更新しています。");
            }

            if (action === "approve" && updatedProposal?.status === "approved") {
                setSelectedProposal(updatedProposal);
            } else {
                setSelectedProposal(null);
                clearProposalSearchParam();
            }
            if (action === "approve" || action === "reject" || action === "execute") {
                setPendingProposals((current) => current.filter((proposal) => proposal.id !== proposalId));
            }
            try {
                await refreshPendingProposals();
            } catch (refreshErr) {
                console.error("[Money] proposal queue refresh failed:", refreshErr);
            }
            window.dispatchEvent(new CustomEvent("pending-proposals-updated"));
            void loadData({ keepCurrentView: true, suppressPageError: true });
        } catch (err: unknown) {
            setProposalError(getErrorMessage(err));
            try {
                await refreshPendingProposals();
            } catch (refreshErr) {
                console.error("[Money] proposal queue refresh failed after mutation error:", refreshErr);
            }
            window.dispatchEvent(new CustomEvent("pending-proposals-updated"));
            void loadData({ keepCurrentView: true, suppressPageError: true });
        } finally {
            setProposalActing(false);
        }
    };

    // 月を変更する関数
    const changeMonth = (direction: "prev" | "next") => {
        const [year, month] = selectedMonth.split("-").map(Number);
        const date = new Date(year, month - 1);
        date.setMonth(date.getMonth() + (direction === "prev" ? -1 : 1));
        const newMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        setSelectedMonth(newMonth);
    };

    const handleRewardCardTap = (memberId: string) => {
        if (memberId === teamRewardSummary?.self_member_id) {
            setOwnPayoutModalOpen(true);
            return;
        }
        setOtherRewardMemberId(memberId);
    };

    const handleExpenseCardTap = (memberId: string) => {
        setExpenseDetailMemberId(memberId);
    };

    const handleMoneyHeroRetry = useCallback(() => {
        setMoneyHeroLoading(true);
        setMoneyHeroError(null);
        Promise.all([
            fetchTeamRewardSummary(selectedMonth),
            fetchMemberReimbursementsSummary(selectedMonth),
            fetchDisputeCorrections({ month: selectedMonth, status: "pending", limit: 100 }).catch(() => []),
        ])
            .then(([rewardData, reimbursementData, disputeData]) => {
                setTeamRewardSummary(rewardData);
                setReimbursementsSummary(reimbursementData);
                setPendingDisputeMemberIds(Array.from(new Set(
                    disputeData
                        .map((correction) => correction.reward_member_id || correction.target_member_id)
                        .filter((memberId): memberId is string => Boolean(memberId)),
                )));
            })
            .catch((err: unknown) => setMoneyHeroError(getErrorMessage(err)))
            .finally(() => setMoneyHeroLoading(false));
    }, [selectedMonth]);

    const handleMonthCloseCompleted = useCallback(async () => {
        setProposalNotice("月確定が完了しました");
        setInvoiceRefreshKey((current) => current + 1);
        handleMoneyHeroRetry();
        await loadData({ keepCurrentView: true, suppressPageError: true });
    }, [handleMoneyHeroRetry, loadData]);

    // フィルター検索API呼び出し
    const executeFilterSearch = useCallback(async (searchFilters: SearchFilters, query: string) => {
        // 日付プリセットから実際の日付範囲を取得
        const dateRange = searchFilters.datePreset === "custom"
            ? { from: searchFilters.dateFrom, to: searchFilters.dateTo }
            : getDateRange(searchFilters.datePreset);

        const hasFilters = searchFilters.kind !== "all" || dateRange.from || dateRange.to || query;
        if (!hasFilters) {
            setSearchResults(null);
            return;
        }

        setSearchLoading(true);
        try {
            const results = await searchTransactions({
                q: query || undefined,
                kind: searchFilters.kind !== "all" ? searchFilters.kind : undefined,
                date_from: dateRange.from || undefined,
                date_to: dateRange.to || undefined,
                limit: 100,
            });
            setSearchResults(results);
        } catch (err) {
            console.error("Search error:", err);
            setSearchResults(null);
        } finally {
            setSearchLoading(false);
        }
    }, []);

    // フィルター変更時に検索を実行（デバウンス的に）
    // 注: clientId/category はサーバ未対応なのでクライアントサイドで filteredTransactions に適用
    useEffect(() => {
        const needsServerSearch =
            filters.kind !== "all" || filters.datePreset !== "all" || filters.query;
        if (needsServerSearch) {
            executeFilterSearch(filters, filters.query);
        } else {
            setSearchResults(null);
        }
    }, [filters, executeFilterSearch]);

    // 検索実行（Enter押下時）
    const handleSearch = () => {
        const trimmed = searchInput.trim();
        if (!trimmed) return;

        setFilters(prev => ({ ...prev, query: trimmed }));
        setSearchInput("");
    };

    // 統合入力のキーダウンハンドラー
    const handleInputKeyDown = (e: React.KeyboardEvent) => {
        if (e.nativeEvent.isComposing) return;

        if (e.key === "Enter") {
            e.preventDefault();
            handleSearch();
        }
    };

    // フィルターをクリア
    const clearFilter = (key: keyof SearchFilters) => {
        if (key === "kind") {
            setFilters(prev => ({ ...prev, kind: "all" }));
        } else if (key === "datePreset") {
            setFilters(prev => ({ ...prev, datePreset: "all", dateFrom: "", dateTo: "" }));
        } else if (key === "query") {
            setFilters(prev => ({ ...prev, query: "" }));
        } else if (key === "clientId") {
            setFilters(prev => ({ ...prev, clientId: null }));
        } else if (key === "category") {
            setFilters(prev => ({ ...prev, category: null }));
        }
    };

    const clearAllFilters = () => {
        setFilters(defaultFilters);
        setSearchResults(null);
    };

    // アクティブなフィルターがあるか
    const hasActiveFilters =
        filters.kind !== "all" ||
        filters.datePreset !== "all" ||
        !!filters.query ||
        filters.clientId !== null ||
        filters.category !== null;

    // 表示する取引（検索結果 or 全取引）+ clientId/category はクライアントサイド適用
    const baseTransactions = searchResults !== null ? searchResults : transactions;
    const filteredTransactions = baseTransactions.filter((tx) => {
        if (filters.clientId && tx.client_id !== filters.clientId) return false;
        if (filters.category && tx.category !== filters.category) return false;
        return true;
    });

    // 表示する取引（最新10件 or 全件）
    const displayedTransactions = showAllTransactions
        ? filteredTransactions
        : filteredTransactions.slice(0, 10);

    // PR #12: 日付グルーピング + 日次サマリ + stagger 用 index
    // mock v3.3 の day-head に従い、日付ごとの net (sale/invoice - expense) を計算する。
    const groupedTransactions = (() => {
        const map = new Map<string, { date: string; sum: number; items: AccountingTransaction[] }>();
        for (const tx of displayedTransactions) {
            const date = tx.recorded_date || "";
            const sign = getAccountingImpactSign(tx) === "+" ? 1 : -1;
            const contribution = sign * Math.abs(tx.amount_total);
            const existing = map.get(date);
            if (existing) {
                existing.sum += contribution;
                existing.items.push(tx);
            } else {
                map.set(date, { date, sum: contribution, items: [tx] });
            }
        }
        // recorded_date DESC (新しい日付から)
        return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
    })();

    const handleApprovalComplete = () => {
        window.dispatchEvent(new CustomEvent("pending-approvals-updated"));
        loadData();
    };

    const handleExpenseCreated = () => {
        setShowExpenseModal(false);
        setExpenseDraft(null);
        loadData();
    };

    const handleSalesCreated = () => {
        setShowSalesModal(false);
        setSalesDraft(null);
        loadData();
    };

    const handleInvoiceCreated = () => {
        track({ type: "money.invoice.issued", from: "fab" });
        setInvoiceRefreshKey((prev) => prev + 1);
        loadData();
    };

    const openExpenseModal = (draft: ExpenseCorrectionDraft | null = null) => {
        if (readOnly) {
            return;
        }
        setExpenseDraft(draft);
        setShowExpenseModal(true);
    };

    const openSalesModal = (draft: SalesCorrectionDraft | null = null) => {
        if (readOnly) {
            return;
        }
        setSalesDraft(draft);
        setShowSalesModal(true);
    };

    const openInvoiceModal = () => {
        if (readOnly) {
            return;
        }
        setShowInvoiceModal(true);
    };

    const closeExpenseModal = () => {
        setShowExpenseModal(false);
        setExpenseDraft(null);
    };

    const closeSalesModal = () => {
        setShowSalesModal(false);
        setSalesDraft(null);
    };

    const handleTransactionVoided = async () => {
        setInvoiceRefreshKey((prev) => prev + 1);
        await loadData();
    };

    const handleStartCorrection = (transaction: AccountingTransaction) => {
        if (transaction.kind === "expense") {
            openExpenseModal({
                siteId: transaction.site_id,
                category: transaction.category as ExpenseCorrectionDraft["category"],
                taxCategory: transaction.tax_category,
                vendorName: transaction.vendor_name || "",
                recordedDate: transaction.recorded_date,
                amountSubtotal: String(transaction.amount_subtotal ?? ""),
                taxAmount: String(transaction.tax_amount ?? ""),
                amountTotal: String(transaction.amount_total ?? ""),
                description: transaction.description || "",
                costCenter: transaction.cost_center,
                expenseItemCode: transaction.expense_item_code || "",
                expenseItemOther: transaction.expense_item_other || "",
            });
        } else if (transaction.kind === "sale") {
            openSalesModal({
                siteId: transaction.site_id,
                recordedDate: transaction.recorded_date,
                description: transaction.description || "",
                items: transaction.items?.map((item) => ({
                    item_name: item.item_name,
                    quantity: item.quantity ?? null,
                    unit_name: item.unit_name || "",
                    unit_price: item.unit_price ?? null,
                })),
            });
        }

        setSelectedTransaction(null);
    };

    if (loading) {
        return (
            <div className={styles.loading}>
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                >
                    <RefreshCw size={32} />
                </motion.div>
                <p>経理データを読み込み中...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.error}>
                <AlertCircle size={48} />
                <h3 className={styles.errorTitle}>読み込みに失敗しました</h3>
                <p className={styles.errorDescription}>
                    ネットワーク接続を確認して、再試行してください
                </p>
                <button onClick={() => loadData()} className={styles.retryButton}>
                    再試行
                </button>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            {proposalNotice && (
                <div className={styles.proposalNotice}>
                    <CheckCircle size={16} />
                    <span>{proposalNotice}</span>
                </div>
            )}

            {readOnly && <ReadOnlyBanner />}

            <div className={styles.moneyHeroShell}>
                <div className={styles.moneyHeroMonthBar}>
                    <button
                        type="button"
                        className={styles.heroMonthButton}
                        onClick={() => changeMonth("prev")}
                        aria-label="前の月"
                    >
                        ‹
                    </button>
                    <span className={styles.heroMonthLabel}>
                        {selectedMonth.replace("-", "年")}月
                    </span>
                    <button
                        type="button"
                        className={styles.heroMonthButton}
                        onClick={() => changeMonth("next")}
                        aria-label="次の月"
                    >
                        ›
                    </button>
                </div>

                {moneyHeroError && (
                    <div className={styles.moneyHeroError}>
                        <span>報酬・立替の取得に失敗しました</span>
                        <button type="button" onClick={handleMoneyHeroRetry}>
                            再試行
                        </button>
                    </div>
                )}

                {moneyHeroLoading && !teamRewardSummary && !reimbursementsSummary ? (
                    <div className={styles.moneyHeroLoading}>
                        {Array.from({ length: 4 }).map((_, index) => (
                            <span key={index} className={styles.moneyHeroSkeleton}>
                                <InlineLoader size="sm" tone="muted" />
                            </span>
                        ))}
                    </div>
                ) : (
                    <>
                        <MoneyHeroSection
                            title="① 報酬と立替"
                            shield={
                                <ShieldPopover
                                    open={shieldOpen}
                                    onToggle={() => setShieldOpen((value) => !value)}
                                    onClose={() => setShieldOpen(false)}
                                />
                            }
                        >
                            <PayoutHeroCard
                                rewardMembers={teamRewardSummary?.members ?? []}
                                reimbursementMembers={reimbursementsSummary?.members ?? []}
                                selfMemberId={teamRewardSummary?.self_member_id ?? null}
                                isFinalized={teamRewardSummary?.is_finalized ?? false}
                                selectedMemberId={payoutSelection.selectedMemberId}
                                viewMode={payoutSelection.viewMode}
                                pendingDisputeMemberIds={pendingDisputeMemberIds}
                                onSelectMember={payoutSelection.onSelectMember}
                                onCardTap={handleRewardCardTap}
                            />
                        </MoneyHeroSection>

                        <MoneyHeroSection title="② 立替">
                            <MemberCarousel
                                mode="expense"
                                members={reimbursementsSummary?.members ?? []}
                                selfMemberId={reimbursementsSummary?.self_member_id ?? null}
                                onCardTap={handleExpenseCardTap}
                                onSeeAllTap={() => setTeamExpenseSummaryOpen(true)}
                            />
                        </MoneyHeroSection>

                        {pl && (
                            <MoneyHeroSection title="③ 会社">
                                <CompanySummaryCard
                                    profit={pl.profit}
                                    sales={pl.sales}
                                    expenses={pl.expenses}
                                    completedCogs={pl.completed_cogs}
                                    overhead={pl.overhead}
                                    workInProgress={pl.work_in_progress}
                                    sparkline={companyTrend.length > 0 ? companyTrend : [pl.profit]}
                                    overdueCount={0}
                                    pendingCount={pendingProposals.length}
                                    monthlyDeductible={monthlyDeductible}
                                    onOverdueTap={() => console.log("open overdue-filter")}
                                    onPendingTap={() => console.log("open pending-invoice-filter")}
                                />
                            </MoneyHeroSection>
                        )}
                    </>
                )}
            </div>

            {ownPayoutModalOpen && teamRewardSummary?.self_member_id && (
                <OwnPayoutModal
                    selfMemberId={teamRewardSummary.self_member_id}
                    selfUserId={selfUserId}
                    month={selectedMonth}
                    readOnly={readOnly}
                    onClose={closeOwnPayoutModal}
                    onInvoiceChanged={() => {
                        setInvoiceRefreshKey((current) => current + 1);
                        handleMoneyHeroRetry();
                    }}
                />
            )}

            {otherRewardMemberId && (
                <OtherPayoutModal
                    memberId={otherRewardMemberId}
                    selfUserId={selfUserId}
                    month={selectedMonth}
                    readOnly={readOnly}
                    onClose={closeOtherPayoutModal}
                />
            )}

            {expenseDetailMemberId && (
                <ExpenseDetailModal
                    memberId={expenseDetailMemberId}
                    month={selectedMonth}
                    selfMemberId={reimbursementsSummary?.self_member_id ?? null}
                    readOnly={readOnly}
                    onClose={() => setExpenseDetailMemberId(null)}
                    onExpenseAdded={async () => {
                        await handleMoneyHeroRetry();
                    }}
                />
            )}

            {teamExpenseSummaryOpen && (
                <TeamExpenseSummaryModal
                    month={selectedMonth}
                    readOnly={readOnly}
                    onClose={() => setTeamExpenseSummaryOpen(false)}
                    onExpenseClicked={(memberId) => {
                        setTeamExpenseSummaryOpen(false);
                        setExpenseDetailMemberId(memberId);
                    }}
                />
            )}

            {monthCloseModalOpen && targetMonthClosePeriod && (
                <MonthCloseModal
                    month={targetMonthClosePeriod}
                    readOnly={readOnly}
                    onClose={closeMonthCloseModal}
                    onCompleted={handleMonthCloseCompleted}
                />
            )}

            <div className={styles.workspaceGrid}>
                <div className={styles.primaryColumn}>
                    {/* タブ + フィルタトリガ (PR #5, v3.3 mock 準拠) */}
                    <div className={styles.tabsRow}>
                        <MoneyTabs
                            value={activeTab}
                            onChange={setActiveTab}
                            txCount={activeTab === "transactions" ? filteredTransactions.length : undefined}
                            vendorCount={clients?.length}
                            trailing={
                                activeTab === "transactions" && (
                                    <button
                                        type="button"
                                        className={styles.filterTriggerBtn}
                                        onClick={() => setShowFilterSheet(true)}
                                        aria-label="フィルタを開く"
                                    >
                                        <SlidersHorizontal size={16} />
                                        {hasActiveFilters && <span className={styles.filterDot} aria-hidden />}
                                    </button>
                                )
                            }
                        />
                    </div>

                    {activeTab === "transactions" && (
                    <>
                    {/* 統合検索セクション */}
                    <motion.section
                        className={styles.searchSection}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                    >
                        {/* 入力エリア */}
                        <div className={styles.inputBox}>
                            <Search className={styles.searchLeadingIcon} size={18} />
                            <input
                                type="text"
                                className={styles.mainInput}
                                placeholder={isMobile ? "取引・請求書を検索" : "取引・請求書・現場を検索"}
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                onKeyDown={handleInputKeyDown}
                            />
                            <div className={styles.inputActions}>
                                <button
                                    className={styles.searchBtn}
                                    onClick={handleSearch}
                                    disabled={!searchInput.trim()}
                                >
                                    <Search size={16} />
                                </button>
                            </div>
                        </div>

                        {/* フィルターバー（常時表示） */}
                        <div className={styles.filterBar}>
                            {/* 1行目: 種別セグメント */}
                            <div className={styles.kindSegment}>
                                {(["all", "expense", "sale", "invoice"] as const).map((kind) => (
                                    <button
                                        key={kind}
                                        className={`${styles.segmentBtn} ${filters.kind === kind ? styles.active : ""}`}
                                        onClick={() => setFilters({ ...filters, kind })}
                                    >
                                        {kind === "all" && "全て"}
                                        {kind === "expense" && "経費"}
                                        {kind === "sale" && "売上"}
                                        {kind === "invoice" && "請求"}
                                    </button>
                                ))}
                            </div>

                            {/* 2行目: 日付 + 件数 */}
                            <div className={styles.filterRow2}>
                                {/* 日付プリセット */}
                                <div className={styles.dateFilter}>
                                    <button
                                        className={`${styles.dateBtn} ${filters.datePreset !== "all" ? styles.hasValue : ""} ${showDatePicker ? styles.active : ""}`}
                                        onClick={() => setShowDatePicker(!showDatePicker)}
                                    >
                                        <Calendar size={14} />
                                        <span>
                                            {filters.datePreset === "all" && "期間"}
                                            {filters.datePreset === "thisMonth" && "今月"}
                                            {filters.datePreset === "lastMonth" && "先月"}
                                            {filters.datePreset === "custom" && "指定"}
                                        </span>
                                    </button>

                                    {/* 日付ドロップダウン */}
                                    <AnimatePresence>
                                        {showDatePicker && (
                                            <>
                                                <motion.div
                                                    className={styles.dateDropdownOverlay}
                                                    onClick={() => setShowDatePicker(false)}
                                                    initial={{ opacity: 0 }}
                                                    animate={{ opacity: 1 }}
                                                    exit={{ opacity: 0 }}
                                                />
                                                <motion.div
                                                    className={styles.dateDropdown}
                                                    initial={{ opacity: 0 }}
                                                    animate={{ opacity: 1 }}
                                                    exit={{ opacity: 0 }}
                                                >
                                                    <button
                                                        className={filters.datePreset === "all" ? styles.active : ""}
                                                        onClick={() => {
                                                            setFilters(prev => ({ ...prev, datePreset: "all", dateFrom: "", dateTo: "" }));
                                                            setShowDatePicker(false);
                                                        }}
                                                    >
                                                        全期間
                                                    </button>
                                                    <button
                                                        className={filters.datePreset === "thisMonth" ? styles.active : ""}
                                                        onClick={() => {
                                                            setFilters(prev => ({ ...prev, datePreset: "thisMonth" }));
                                                            setShowDatePicker(false);
                                                        }}
                                                    >
                                                        今月
                                                    </button>
                                                    <button
                                                        className={filters.datePreset === "lastMonth" ? styles.active : ""}
                                                        onClick={() => {
                                                            setFilters(prev => ({ ...prev, datePreset: "lastMonth" }));
                                                            setShowDatePicker(false);
                                                        }}
                                                    >
                                                        先月
                                                    </button>
                                                    <div className={styles.customDateSection}>
                                                        <span className={styles.customLabel}>カスタム期間</span>
                                                        <div className={styles.dateInputs}>
                                                            <div className={styles.dateInputGroup}>
                                                                <label>開始</label>
                                                                <input
                                                                    type="date"
                                                                    value={filters.dateFrom}
                                                                    max={filters.dateTo || undefined}
                                                                    onChange={(e) => setFilters(prev => ({
                                                                        ...prev,
                                                                        datePreset: "custom",
                                                                        dateFrom: e.target.value,
                                                                    }))}
                                                                />
                                                            </div>
                                                            <div className={styles.dateInputGroup}>
                                                                <label>終了</label>
                                                                <input
                                                                    type="date"
                                                                    value={filters.dateTo}
                                                                    min={filters.dateFrom || undefined}
                                                                    onChange={(e) => setFilters(prev => ({
                                                                        ...prev,
                                                                        datePreset: "custom",
                                                                        dateTo: e.target.value,
                                                                    }))}
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </motion.div>
                                            </>
                                        )}
                                    </AnimatePresence>
                                </div>

                                {/* 検索結果件数 */}
                                <span className={styles.resultCount}>
                                    {searchLoading ? "..." : `${filteredTransactions.length}件`}
                                </span>
                            </div>
                        </div>

                        {/* アクティブフィルタータグ */}
                        <AnimatePresence>
                            {hasActiveFilters && (
                                <motion.div
                                    className={styles.activeFilters}
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: "auto" }}
                                    exit={{ opacity: 0, height: 0 }}
                                >
                                    <div className={styles.filterTags}>
                                        {filters.kind !== "all" && (
                                            <span className={styles.filterTag}>
                                                {filters.kind === "expense" && "経費"}
                                                {filters.kind === "sale" && "売上"}
                                                {filters.kind === "invoice" && "請求"}
                                                <button onClick={() => clearFilter("kind")}>
                                                    <X size={12} />
                                                </button>
                                            </span>
                                        )}
                                        {filters.datePreset !== "all" && (
                                            <span className={styles.filterTag}>
                                                <Calendar size={12} />
                                                {filters.datePreset === "thisMonth" && "今月"}
                                                {filters.datePreset === "lastMonth" && "先月"}
                                                {filters.datePreset === "custom" && `${filters.dateFrom || "?"} 〜 ${filters.dateTo || "?"}`}
                                                <button onClick={() => clearFilter("datePreset")}>
                                                    <X size={12} />
                                                </button>
                                            </span>
                                        )}
                                        {filters.query && (
                                            <span className={styles.filterTag}>
                                                "{filters.query}"
                                                <button onClick={() => clearFilter("query")}>
                                                    <X size={12} />
                                                </button>
                                            </span>
                                        )}
                                        {filters.clientId && (
                                            <span className={styles.filterTag}>
                                                {clients?.find((c) => c.id === filters.clientId)?.name ?? "取引先"}
                                                <button onClick={() => clearFilter("clientId")}>
                                                    <X size={12} />
                                                </button>
                                            </span>
                                        )}
                                        {filters.category && (
                                            <span className={styles.filterTag}>
                                                {filters.category === "material" && "仕入れ"}
                                                {filters.category === "tool" && "工具"}
                                                {filters.category === "travel" && "駐車代"}
                                                {filters.category === "fuel" && "ガソリン"}
                                                {filters.category === "food" && "食事"}
                                                {filters.category === "utility" && "光熱通信"}
                                                {filters.category === "other" && "その他"}
                                                <button onClick={() => clearFilter("category")}>
                                                    <X size={12} />
                                                </button>
                                            </span>
                                        )}
                                    </div>
                                    <button
                                        className={styles.clearAllFilters}
                                        onClick={clearAllFilters}
                                    >
                                        クリア
                                    </button>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </motion.section>

                    {/* 取引一覧 */}
                    <motion.section
                        className={styles.transactionsSection}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3 }}
                    >
                        <div className={styles.sectionHeader}>
                            <div>
                                <p className={styles.sectionKicker}>検索と確認</p>
                                <h2 className={styles.sectionTitle}>最近の取引</h2>
                            </div>
                            <span className={styles.txCountBadge}>{filteredTransactions.length}件</span>
                        </div>

                        {filteredTransactions.length === 0 ? (
                            <div className={styles.emptyState}>
                                {hasActiveFilters ? (
                                    <>
                                        <div className={styles.emptyIcon}>
                                            <FilterX size={40} />
                                        </div>
                                        <p className={styles.emptyTitle}>該当する取引がありません</p>
                                        <p className={styles.emptyDescription}>
                                            検索条件を変更してお試しください
                                        </p>
                                        <button
                                            className={styles.emptyAction}
                                            onClick={clearAllFilters}
                                        >
                                            フィルターをクリア
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <div className={styles.emptyIcon}>
                                            <Search size={40} />
                                        </div>
                                        <p className={styles.emptyTitle}>取引がありません</p>
                                        <p className={styles.emptyDescription}>
                                            経費や売上を登録してみましょう
                                        </p>
                                    </>
                                )}
                            </div>
                        ) : (
                            <>
                                <div className={styles.txList}>
                                    {(() => {
                                        let runningIdx = 0;
                                        return groupedTransactions.map((group) => (
                                            <div key={group.date} className={styles.txDayGroup}>
                                                <div className={styles.dayHead}>
                                                    <span className={styles.dayHeadDate}>
                                                        {formatDayHead(group.date)}
                                                    </span>
                                                    <span
                                                        className={`${styles.dayHeadSum} ${group.sum >= 0 ? styles.daySumPos : styles.daySumNeg}`}
                                                    >
                                                        {group.sum >= 0 ? "+" : "−"}¥{Math.abs(group.sum).toLocaleString()}
                                                    </span>
                                                </div>
                                                {group.items.map((tx) => {
                                                    const idx = runningIdx++;
                                                    return (
                                                        <TransactionRow
                                                            key={tx.id}
                                                            tx={tx}
                                                            staggerIndex={idx}
                                                            onOpenDetail={() => setSelectedTransaction(tx)}
                                                        />
                                                    );
                                                })}
                                            </div>
                                        ));
                                    })()}
                                </div>

                                {/* もっと見る / 閉じる */}
                                {filteredTransactions.length > 10 && (
                                    <button
                                        className={styles.showMoreBtn}
                                        onClick={() => setShowAllTransactions(!showAllTransactions)}
                                    >
                                        {showAllTransactions
                                            ? "閉じる"
                                            : `すべて表示 (${filteredTransactions.length}件)`}
                                    </button>
                                )}
                            </>
                        )}
                    </motion.section>
                    </>
                    )}

                    {activeTab === "vendors" && (
                        <motion.section
                            className={styles.vendorsSection}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.05 }}
                        >
                            <div className={styles.sectionHeader}>
                                <div>
                                    <p className={styles.sectionKicker}>期限 / 入金 / 履歴</p>
                                    <h2 className={styles.sectionTitle}>取引先・請求書</h2>
                                </div>
                                <span className={styles.txCountBadge}>
                                    {clientInvoices.length}件
                                </span>
                            </div>

                            <ClientCreditStatusSection
                                clients={clientCreditSummaries}
                                loading={clientCreditLoading}
                                error={clientCreditError}
                                onOpenClient={setSelectedCreditClient}
                            />

                            <ClientInvoiceList
                                invoices={clientInvoices}
                                loading={clientInvoicesLoading}
                                error={clientInvoicesError}
                                onRefresh={() => {
                                    setProposalNotice("入金確認のProposalを起票しました");
                                    setInvoiceRefreshKey((prev) => prev + 1);
                                    void loadData({ keepCurrentView: true, suppressPageError: true });
                                }}
                                onIssueInvoice={() => setShowInvoiceModal(true)}
                            />

                        </motion.section>
                    )}
                </div>

            </div>

            {/* モーダル群 */}
            <AnimatePresence>
                {/* <MoneyActionSheet /> は mobileFabDock 内の Expanding FAB メニューに変更したため削除 */}
                <ExpenseModal
                    open={showExpenseModal}
                    onClose={closeExpenseModal}
                    onSuccess={handleExpenseCreated}
                    initialSiteId={expenseDraft?.siteId}
                    initialCategory={expenseDraft?.category}
                    initialTaxCategory={expenseDraft?.taxCategory}
                    initialVendorName={expenseDraft?.vendorName}
                    initialRecordedDate={expenseDraft?.recordedDate}
                    initialAmountSubtotal={expenseDraft?.amountSubtotal}
                    initialTaxAmount={expenseDraft?.taxAmount}
                    initialAmountTotal={expenseDraft?.amountTotal}
                    initialDescription={expenseDraft?.description}
                    initialCostCenter={expenseDraft?.costCenter}
                    initialExpenseItemCode={expenseDraft?.expenseItemCode}
                    initialExpenseItemOther={expenseDraft?.expenseItemOther}
                    defaultClaimantMemberId={reimbursementsSummary?.self_member_id ?? null}
                    readOnly={readOnly}
                />
                {showSalesModal && (
                    <SalesModal
                        onClose={closeSalesModal}
                        onSuccess={handleSalesCreated}
                        initialSiteId={salesDraft?.siteId}
                        initialRecordedDate={salesDraft?.recordedDate}
                        initialDescription={salesDraft?.description}
                        initialItems={salesDraft?.items}
                        readOnly={readOnly}
                    />
                )}
                {showInvoiceModal && (
                    <InvoiceModal
                        onClose={() => setShowInvoiceModal(false)}
                        onCreated={handleInvoiceCreated}
                        readOnly={readOnly}
                    />
                )}
                {showApprovalsModal && (
                    <ApprovalsModal
                        approvals={pendingApprovals}
                        onClose={() => setShowApprovalsModal(false)}
                        onComplete={handleApprovalComplete}
                    />
                )}
                {invoicePayTarget && (
                    <InvoicePayModal
                        invoiceId={invoicePayTarget.invoiceId}
                        notificationId={invoicePayTarget.notificationId}
                        from={invoicePayTarget.from}
                        onClose={() => {
                            setInvoicePayTarget(null);
                            clearInvoicePaySearchParams();
                        }}
                        onCompleted={() => {
                            setProposalNotice("支払い済みにしました");
                            setInvoiceRefreshKey((prev) => prev + 1);
                            window.dispatchEvent(new CustomEvent("invoice-pay-notification-updated"));
                            void loadData({ keepCurrentView: true, suppressPageError: true });
                        }}
                    />
                )}
                {selectedCreditClient && (
                    <ClientCreditDetailModal
                        client={selectedCreditClient}
                        metrics={selectedCreditMetrics}
                        loading={selectedCreditLoading}
                        error={selectedCreditError}
                        onClose={() => setSelectedCreditClient(null)}
                    />
                )}
                {selectedTransaction && (
                    <TransactionDetailModal
                        transaction={selectedTransaction}
                        onClose={() => setSelectedTransaction(null)}
                        onVoided={handleTransactionVoided}
                        onUpdated={loadData}
                        onStartCorrection={handleStartCorrection}
                        readOnly={readOnly}
                    />
                )}
                {selectedProposal && (
                    <ProposalDetailModal
                        proposal={selectedProposal}
                        onClose={() => {
                            setSelectedProposal(null);
                            setProposalError(null);
                            clearProposalSearchParam();
                        }}
                        onApprove={(proposalId, reason) => handleProposalMutation(proposalId, "approve", reason)}
                        onReject={(proposalId, reason) => handleProposalMutation(proposalId, "reject", reason)}
                        onInstruct={(proposalId, instruction) => handleProposalMutation(proposalId, "instruct", instruction)}
                        onExecute={(proposalId) => handleProposalMutation(proposalId, "execute")}
                        isActing={proposalActing}
                        actionError={proposalError}
                    />
                )}
            </AnimatePresence>

            <MoneyFilterSheet
                open={showFilterSheet}
                onClose={() => setShowFilterSheet(false)}
                filters={filters}
                onFiltersChange={setFilters}
                clients={clients}
                matchedCount={filteredTransactions.length}
            />

            <FloatingActionButton
                behavior="draggable"
                buttonLabel="追加"
                openLabel="お金の登録メニューを開く"
                closeLabel="お金の登録メニューを閉じる"
                onOpen={() => track({ type: "money.fab.clicked", from_tab: activeTab })}
                disabled={readOnly}
                disabledReason="過去月は閲覧専用"
                items={[
                    {
                        id: "expense",
                        label: "経費・立替を記録",
                        icon: <Receipt size={18} />,
                        onClick: () => {
                            track({ type: "money.fab.option_clicked", option: "expense" });
                            openExpenseModal();
                        },
                    },
                    {
                        id: "sale",
                        label: "売上を記録",
                        icon: <TrendingUp size={18} />,
                        onClick: () => {
                            track({ type: "money.fab.option_clicked", option: "sale" });
                            openSalesModal();
                        },
                    },
                    {
                        id: "invoice",
                        label: "請求書を発行",
                        icon: <FileText size={18} />,
                        onClick: () => {
                            track({ type: "money.fab.option_clicked", option: "invoice" });
                            openInvoiceModal();
                        },
                    },
                ]}
            />
        </div>
    );
}


// 取引行コンポーネント
function TransactionRow({
    tx,
    onOpenDetail,
    staggerIndex = 0,
}: {
    tx: AccountingTransaction;
    onOpenDetail: () => void;
    staggerIndex?: number;
}) {
    const getStatusMeta = () => {
        if (tx.voids_transaction_id) {
            return {
                icon: <XCircle size={14} />,
                label: "逆仕訳",
                tone: "statusVoided",
            };
        }
        if (tx.status === "voided") {
            return {
                icon: <XCircle size={14} />,
                label: "取消",
                tone: "statusVoided",
            };
        }
        if (tx.status === "pending_review") {
            return {
                icon: <AlertTriangle size={14} />,
                label: "承認待ち",
                tone: "statusPending",
            };
        }
        if (tx.status === "posted" || tx.status === "approved") {
            return {
                icon: <CheckCircle size={14} />,
                label: "承認済み",
                tone: "statusApproved",
            };
        }
        return {
            icon: <AlertCircle size={14} />,
            label: "下書き",
            tone: "statusNeutral",
        };
    };

    const getRiskReason = (): string | null => {
        if (tx.risk_level !== "HIGH") return null;
        const total = tx.amount_total;
        const category = tx.category || "";
        if ((category === "material" || category === "tool") && total > 30000) {
            return `資材・工具 > ¥30,000`;
        }
        if ((category === "food" || category === "travel") && total > 5000) {
            return `食費・交通 > ¥5,000`;
        }
        return "高額取引";
    };

    const riskReason = getRiskReason();
    const isHighRisk = tx.risk_level === "HIGH";
    const isPending = tx.status === "pending_review";
    const statusMeta = getStatusMeta();
    const amountSign = getAccountingImpactSign(tx);
    const kindToneClass =
        tx.kind === "expense"
            ? styles.expenseRow
            : tx.kind === "sale"
                ? styles.saleRow
                : styles.invoiceRow;

    return (
        <motion.button
            type="button"
            className={`${styles.txRow} ${kindToneClass} ${isHighRisk ? styles.highRiskRow : ""} ${isPending ? styles.pendingRow : ""}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: Math.min(staggerIndex, 12) * 0.06, ease: [0.2, 0.8, 0.2, 1] }}
            onClick={onOpenDetail}
        >
            <div className={styles.colDate}>
                <span className={styles.dateText}>{formatDate(tx.recorded_date)}</span>
            </div>
            <div className={styles.colKind}>
                <span className={`${styles.kindIcon} ${styles[tx.kind]}`}>
                    {tx.kind === "expense" && <Receipt size={14} />}
                    {tx.kind === "sale" && <TrendingUp size={14} />}
                    {tx.kind === "invoice" && <FileText size={14} />}
                </span>
            </div>
            <div className={styles.colVendor}>
                {tx.vendor_name || tx.site?.name || "不明"}
            </div>
            <div className={styles.colDesc}>
                <span className={styles.descText}>{tx.description}</span>
                {riskReason && (
                    <span className={styles.riskTag}>
                        <AlertTriangle size={10} />
                        {riskReason}
                    </span>
                )}
            </div>
            <div className={`${styles.colAmount} ${tx.kind === "expense" ? styles.textExpense : styles.textIncome}`}>
                {amountSign}¥{Math.abs(tx.amount_total).toLocaleString()}
            </div>
            <div className={styles.colStatus}>
                <span className={`${styles.statusBadge} ${styles[statusMeta.tone]}`}>
                    {statusMeta.icon}
                    <span>{statusMeta.label}</span>
                </span>
            </div>
            <div className={styles.colOpen}>
                <ChevronRight size={16} />
            </div>
        </motion.button>
    );
}


// 承認待ちモーダル
function ApprovalsModal({
    approvals,
    onClose,
    onComplete,
}: {
    approvals: AccountingTransaction[];
    onClose: () => void;
    onComplete: () => void;
}) {
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [batchLoading, setBatchLoading] = useState(false);
    const [batchError, setBatchError] = useState<string | null>(null);

    const toggleSelect = (id: string) => {
        setSelectedIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
    };

    const selectAll = () => {
        if (selectedIds.length === approvals.length) {
            setSelectedIds([]);
        } else {
            setSelectedIds(approvals.map((a) => a.id));
        }
    };

    const handleBatchApprove = async () => {
        if (selectedIds.length === 0) return;
        setBatchLoading(true);
        setBatchError(null);
        try {
            const result = await batchReviewExpenses(selectedIds, "approve");
            if (result.failed.length > 0) {
                setBatchError(
                    `${result.success.length}件承認、${result.failed.length}件失敗: ${result.failed.map((f) => f.error).join(", ")}`
                );
            }
            setSelectedIds([]);
            onComplete();
        } catch (err: unknown) {
            setBatchError(getErrorMessage(err));
        } finally {
            setBatchLoading(false);
        }
    };

    const handleBatchReject = async () => {
        if (selectedIds.length === 0) return;
        setBatchLoading(true);
        setBatchError(null);
        try {
            const result = await batchReviewExpenses(selectedIds, "reject", "一括否認");
            if (result.failed.length > 0) {
                setBatchError(
                    `${result.success.length}件否認、${result.failed.length}件失敗: ${result.failed.map((f) => f.error).join(", ")}`
                );
            }
            setSelectedIds([]);
            onComplete();
        } catch (err: unknown) {
            setBatchError(getErrorMessage(err));
        } finally {
            setBatchLoading(false);
        }
    };

    return (
        <motion.div
            className={styles.modalOverlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
        >
            <motion.div
                className={styles.approvalsModal}
                role="dialog"
                aria-modal="true"
                aria-labelledby="approvals-modal-title"
                initial={{ opacity: 0, y: 50 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 50 }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className={styles.modalHeader}>
                    <h2 id="approvals-modal-title">
                        <AlertTriangle size={20} color="#ffc107" />
                        承認待ち ({approvals.length}件)
                    </h2>
                    <button className={styles.closeBtn} onClick={onClose} aria-label="閉じる">
                        <X size={24} />
                    </button>
                </div>

                {/* バッチ操作バー */}
                {approvals.length > 0 && (
                    <div className={styles.batchBar}>
                        <label className={styles.selectAllLabel}>
                            <input
                                type="checkbox"
                                checked={selectedIds.length === approvals.length && approvals.length > 0}
                                onChange={selectAll}
                            />
                            すべて選択
                        </label>
                        {selectedIds.length > 0 && (
                            <div className={styles.batchActions}>
                                <span className={styles.selectedCount}>{selectedIds.length}件選択中</span>
                                <button
                                    className={styles.batchApproveBtn}
                                    onClick={handleBatchApprove}
                                    disabled={batchLoading}
                                >
                                    {batchLoading ? (
                                        <RefreshCw size={14} className={styles.spinning} />
                                    ) : (
                                        <CheckCircle size={14} />
                                    )}
                                    一括承認
                                </button>
                                <button
                                    className={styles.batchRejectBtn}
                                    onClick={handleBatchReject}
                                    disabled={batchLoading}
                                >
                                    <XCircle size={14} />
                                    一括否認
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {batchError && (
                    <div className={styles.batchError}>
                        <AlertCircle size={14} />
                        {batchError}
                    </div>
                )}

                <div className={styles.modalBody}>
                    {approvals.length === 0 ? (
                        <div className={styles.empty}>
                            <CheckCircle size={48} color="#4caf50" />
                            <p>承認待ちの経費はありません</p>
                        </div>
                    ) : (
                        <div className={styles.approvalList}>
                            {approvals.map((tx) => (
                                <div key={tx.id} className={styles.approvalItem}>
                                    <input
                                        type="checkbox"
                                        checked={selectedIds.includes(tx.id)}
                                        onChange={() => toggleSelect(tx.id)}
                                        className={styles.approvalCheckbox}
                                    />
                                    <ApprovalCard transaction={tx} onComplete={onComplete} />
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </motion.div>
        </motion.div>
    );
}
