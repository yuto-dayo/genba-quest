import { useEffect, useState, useCallback } from "react";
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
    fetchPartnersSummary,
    instructProposal,
    rejectProposal,
    searchTransactions,
    batchReviewExpenses,
    type PLReport,
    type AccountingTransaction,
    type ProposalRecord,
    type Client,
    type PartnersSummary,
    type TeamRewardSummary,
    type MemberReimbursementsSummary,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import { useActiveOrgStore } from "../stores/activeOrg";
import { supabase } from "../lib/supabase";
import { MemberInvoiceDraftBanner } from "../components/MemberInvoiceDraftBanner";
import { OutstandingInvoicesCard } from "../components/OutstandingInvoicesCard";
import { AdminInvoiceActionableList } from "../components/AdminInvoiceActionableList";
import { MyMemberInvoicesList } from "../components/MyMemberInvoicesList";
import { ExpenseModal } from "../components/ExpenseModal";
import { SalesModal } from "../components/SalesModal";
import { InvoiceModal } from "../components/InvoiceModal";
import { InvoiceListPanel } from "../components/InvoiceListPanel";
import { ProposalDetailModal } from "../components/ProposalDetailModal";
import { TransactionDetailModal } from "../components/TransactionDetailModal";
import { ApprovalCard } from "../components/ApprovalCard";
import { FloatingActionButton } from "../components/FloatingActionButton";
import { MoneyTabs, type MoneyTab } from "../components/MoneyTabs";
import { MoneyFilterSheet, type ExpenseCategory } from "../components/MoneyFilterSheet";
import { PartnerSection } from "../components/PartnerSection";
import { ReceivePartnerCard, PayPartnerCard, DonePartnerCard } from "../components/PartnerCard";
import { InlineLoader } from "../components/InlineLoader";
import { MoneyHeroSection } from "../components/money/MoneyHeroSection";
import { MemberCarousel } from "../components/money/MemberCarousel";
import { CompanySummaryCard } from "../components/money/CompanySummaryCard";
import { ShieldPopover } from "../components/money/ShieldPopover";
import { OwnRewardModal } from "../components/money/OwnRewardModal";
import { OtherRewardModal } from "../components/money/OtherRewardModal";
import { TeamSummaryModal } from "../components/money/TeamSummaryModal";
import { ExpenseDetailModal } from "../components/money/ExpenseDetailModal";
import { TeamExpenseSummaryModal } from "../components/money/TeamExpenseSummaryModal";
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
    const isMobile = useIsMobile();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // 選択中の月 (YYYY-MM形式)
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    });

    const [pl, setPL] = useState<PLReport | null>(null);
    const [teamRewardSummary, setTeamRewardSummary] = useState<TeamRewardSummary | null>(null);
    const [reimbursementsSummary, setReimbursementsSummary] = useState<MemberReimbursementsSummary | null>(null);
    const [moneyHeroLoading, setMoneyHeroLoading] = useState(false);
    const [moneyHeroError, setMoneyHeroError] = useState<string | null>(null);
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

    // Phase 2-2a: ログイン中ユーザの id とロール (本人主導の請求書発行 / 集計表示用)
    const [selfUserId, setSelfUserId] = useState<string | null>(null);
    const activeOrgId = useActiveOrgStore((state) => state.activeOrgId);
    const orgOptions = useActiveOrgStore((state) => state.options);
    const activeMembership = orgOptions.find((option) => option.org.id === activeOrgId)
        ?.membership;
    const isAdmin = activeMembership?.role === "admin";

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

    // 取引先タブ — 3 section サマリ (PR #6)
    const [partnersSummary, setPartnersSummary] = useState<PartnersSummary | null>(null);
    const [partnersLoading, setPartnersLoading] = useState(false);
    const [partnersError, setPartnersError] = useState<string | null>(null);

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

    // 取引先タブを開いた / 月切替時に partners summary をロード
    useEffect(() => {
        if (activeTab !== "vendors") return;
        let cancelled = false;
        setPartnersLoading(true);
        setPartnersError(null);
        fetchPartnersSummary(selectedMonth)
            .then((data) => {
                if (!cancelled) setPartnersSummary(data);
            })
            .catch((err: unknown) => {
                if (!cancelled) setPartnersError(getErrorMessage(err));
            })
            .finally(() => {
                if (!cancelled) setPartnersLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [activeTab, selectedMonth]);

    // 承認モーダル (バッチ操作用、ベルから個別カードと別に開ける)
    const [showApprovalsModal, setShowApprovalsModal] = useState(false);

    // 登録モーダル
    const [showExpenseModal, setShowExpenseModal] = useState(false);
    const [showSalesModal, setShowSalesModal] = useState(false);
    const [showInvoiceModal, setShowInvoiceModal] = useState(false);
    const [invoiceRefreshKey, setInvoiceRefreshKey] = useState(0);
    const [ownRewardModalOpen, setOwnRewardModalOpen] = useState(false);
    const [otherRewardMemberId, setOtherRewardMemberId] = useState<string | null>(null);
    const [teamSummaryModalOpen, setTeamSummaryModalOpen] = useState(false);
    const [expenseDetailMemberId, setExpenseDetailMemberId] = useState<string | null>(null);
    const [teamExpenseSummaryOpen, setTeamExpenseSummaryOpen] = useState(false);
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
        setMoneyHeroLoading(true);
        setMoneyHeroError(null);

        Promise.all([
            fetchTeamRewardSummary(selectedMonth),
            fetchMemberReimbursementsSummary(selectedMonth),
        ])
            .then(([rewardData, reimbursementData]) => {
                if (cancelled) return;
                setTeamRewardSummary(rewardData);
                setReimbursementsSummary(reimbursementData);
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

    const handleProposalMutation = async (
        proposalId: string,
        action: "approve" | "reject" | "instruct" | "execute",
        payload?: string,
    ) => {
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
            setOwnRewardModalOpen(true);
            return;
        }
        setOtherRewardMemberId(memberId);
    };

    const handleExpenseCardTap = (memberId: string) => {
        setExpenseDetailMemberId(memberId);
    };

    const handleMoneyHeroRetry = () => {
        setMoneyHeroLoading(true);
        setMoneyHeroError(null);
        Promise.all([
            fetchTeamRewardSummary(selectedMonth),
            fetchMemberReimbursementsSummary(selectedMonth),
        ])
            .then(([rewardData, reimbursementData]) => {
                setTeamRewardSummary(rewardData);
                setReimbursementsSummary(reimbursementData);
            })
            .catch((err: unknown) => setMoneyHeroError(getErrorMessage(err)))
            .finally(() => setMoneyHeroLoading(false));
    };

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
        setInvoiceRefreshKey((prev) => prev + 1);
        loadData();
    };

    const openExpenseModal = (draft: ExpenseCorrectionDraft | null = null) => {
        setExpenseDraft(draft);
        setShowExpenseModal(true);
    };

    const openSalesModal = (draft: SalesCorrectionDraft | null = null) => {
        setSalesDraft(draft);
        setShowSalesModal(true);
    };

    const openInvoiceModal = () => {
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
                            title="① 報酬"
                            shield={
                                <ShieldPopover
                                    open={shieldOpen}
                                    onToggle={() => setShieldOpen((value) => !value)}
                                    onClose={() => setShieldOpen(false)}
                                />
                            }
                        >
                            <MemberCarousel
                                mode="reward"
                                members={teamRewardSummary?.members ?? []}
                                selfMemberId={teamRewardSummary?.self_member_id ?? null}
                                isFinalized={teamRewardSummary?.is_finalized ?? false}
                                onCardTap={handleRewardCardTap}
                                onSeeAllTap={() => setTeamSummaryModalOpen(true)}
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
                                    sparkline={companyTrend.length > 0 ? companyTrend : [pl.profit]}
                                    overdueCount={0}
                                    pendingCount={pendingProposals.length}
                                    onOverdueTap={() => console.log("open overdue-filter")}
                                    onPendingTap={() => console.log("open pending-invoice-filter")}
                                />
                            </MoneyHeroSection>
                        )}
                    </>
                )}
            </div>

            {ownRewardModalOpen && teamRewardSummary?.self_member_id && (
                <OwnRewardModal
                    selfMemberId={teamRewardSummary.self_member_id}
                    selfUserId={selfUserId}
                    month={selectedMonth}
                    onClose={() => setOwnRewardModalOpen(false)}
                    onInvoiceChanged={() => {
                        setInvoiceRefreshKey((current) => current + 1);
                        handleMoneyHeroRetry();
                    }}
                />
            )}

            {otherRewardMemberId && (
                <OtherRewardModal
                    memberId={otherRewardMemberId}
                    month={selectedMonth}
                    onClose={() => setOtherRewardMemberId(null)}
                />
            )}

            {teamSummaryModalOpen && (
                <TeamSummaryModal
                    month={selectedMonth}
                    selfUserId={selfUserId}
                    onClose={() => setTeamSummaryModalOpen(false)}
                    onInvoiceChanged={() => {
                        setInvoiceRefreshKey((current) => current + 1);
                        handleMoneyHeroRetry();
                    }}
                />
            )}

            {expenseDetailMemberId && (
                <ExpenseDetailModal
                    memberId={expenseDetailMemberId}
                    month={selectedMonth}
                    selfMemberId={reimbursementsSummary?.self_member_id ?? null}
                    onClose={() => setExpenseDetailMemberId(null)}
                    onExpenseAdded={async () => {
                        await handleMoneyHeroRetry();
                    }}
                />
            )}

            {teamExpenseSummaryOpen && (
                <TeamExpenseSummaryModal
                    month={selectedMonth}
                    onClose={() => setTeamExpenseSummaryOpen(false)}
                    onExpenseClicked={(memberId) => {
                        setTeamExpenseSummaryOpen(false);
                        setExpenseDetailMemberId(memberId);
                    }}
                />
            )}

            {/* Phase 2-2a: 本人主導の請求書 — 本人にはドラフト、admin には集計を出す */}
            {selfUserId && (
                <MemberInvoiceDraftBanner
                    selfUserId={selfUserId}
                    hideWhenEmpty={isAdmin}
                    onIssued={() => {
                        setInvoiceRefreshKey((current) => current + 1);
                        handleMoneyHeroRetry();
                    }}
                />
            )}
            {/* Phase 2-2b: 本人は自分の請求書履歴 (取消し可)、admin は支払い対象リスト + 集計 */}
            {selfUserId && !isAdmin && (
                <MyMemberInvoicesList
                    onChanged={() => {
                        setInvoiceRefreshKey((current) => current + 1);
                        handleMoneyHeroRetry();
                    }}
                />
            )}
            {isAdmin && (
                <div className={styles.legacyInvoiceTrim}>
                    <OutstandingInvoicesCard />
                    <AdminInvoiceActionableList />
                </div>
            )}

            {/* クイックアクション */}
            {!isMobile && (
                <section className={styles.quickActions}>
                    <button className={styles.actionBtn} onClick={() => openExpenseModal()}>
                        <Receipt size={20} />
                        <span>経費を記録</span>
                    </button>
                    <button className={styles.actionBtn} onClick={() => openSalesModal()}>
                        <TrendingUp size={20} />
                        <span>売上を記録</span>
                    </button>
                    <button className={styles.actionBtn} onClick={openInvoiceModal}>
                        <FileText size={20} />
                        <span>請求書を作る</span>
                    </button>
                </section>
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
                                    <p className={styles.sectionKicker}>もらう / 払う / 完了</p>
                                    <h2 className={styles.sectionTitle}>取引先</h2>
                                </div>
                                {partnersSummary && (
                                    <span className={styles.txCountBadge}>
                                        {partnersSummary.receive.partners.length +
                                            partnersSummary.pay.partners.length +
                                            partnersSummary.done.partners.length}
                                        件
                                    </span>
                                )}
                            </div>

                            {partnersLoading && (
                                <div className={styles.vendorsLoading}>
                                    <RefreshCw size={16} className={styles.spinIcon} />
                                    <span>取引先サマリを読み込み中</span>
                                </div>
                            )}

                            {partnersError && (
                                <div className={styles.vendorsError}>
                                    取引先サマリの取得に失敗: {partnersError}
                                </div>
                            )}

                            {!partnersLoading && !partnersError && partnersSummary && (
                                <div className={styles.partnerSections}>
                                    <PartnerSection
                                        title="もらう (請求/入金)"
                                        warn
                                        total={partnersSummary.receive.total}
                                        count={partnersSummary.receive.partners.length}
                                        emptyLabel="今月の売上はまだ記録されていません"
                                    >
                                        {partnersSummary.receive.partners.map((p) => (
                                            <ReceivePartnerCard
                                                key={p.client_id}
                                                partner={p}
                                                onClick={() =>
                                                    setFilters((prev) => ({ ...prev, clientId: p.client_id }))
                                                }
                                            />
                                        ))}
                                    </PartnerSection>

                                    <PartnerSection
                                        title="払う (仕入/外注)"
                                        total={partnersSummary.pay.total}
                                        count={partnersSummary.pay.partners.length}
                                        emptyLabel="今月の経費はまだ記録されていません"
                                    >
                                        {partnersSummary.pay.partners.map((p) => (
                                            <PayPartnerCard key={p.vendor_name} partner={p} />
                                        ))}
                                    </PartnerSection>

                                    <PartnerSection
                                        title="完了 (入金済)"
                                        total={partnersSummary.done.total}
                                        count={partnersSummary.done.partners.length}
                                        emptyLabel="今月の入金はまだありません"
                                    >
                                        {partnersSummary.done.partners.map((p, idx) => (
                                            <DonePartnerCard
                                                key={`${p.client_id ?? "anon"}-${p.paid_at}-${idx}`}
                                                partner={p}
                                            />
                                        ))}
                                    </PartnerSection>
                                </div>
                            )}

                        </motion.section>
                    )}
                </div>

                <aside className={styles.secondaryColumn}>
                    <InvoiceListPanel
                        refreshKey={invoiceRefreshKey}
                        onCreateInvoice={openInvoiceModal}
                    />
                </aside>
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
                />
                {showSalesModal && (
                    <SalesModal
                        onClose={closeSalesModal}
                        onSuccess={handleSalesCreated}
                        initialSiteId={salesDraft?.siteId}
                        initialRecordedDate={salesDraft?.recordedDate}
                        initialDescription={salesDraft?.description}
                        initialItems={salesDraft?.items}
                    />
                )}
                {showInvoiceModal && (
                    <InvoiceModal
                        onClose={() => setShowInvoiceModal(false)}
                        onCreated={handleInvoiceCreated}
                    />
                )}
                {showApprovalsModal && (
                    <ApprovalsModal
                        approvals={pendingApprovals}
                        onClose={() => setShowApprovalsModal(false)}
                        onComplete={handleApprovalComplete}
                    />
                )}
                {selectedTransaction && (
                    <TransactionDetailModal
                        transaction={selectedTransaction}
                        onClose={() => setSelectedTransaction(null)}
                        onVoided={handleTransactionVoided}
                        onUpdated={loadData}
                        onStartCorrection={handleStartCorrection}
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

            {isMobile && (
                <FloatingActionButton
                    behavior="draggable"
                    hideOnDesktop
                    openLabel="お金の登録メニューを開く"
                    closeLabel="お金の登録メニューを閉じる"
                    items={[
                        { id: "expense", label: "経費を記録", icon: <Receipt size={18} />, onClick: openExpenseModal },
                        { id: "sale", label: "売上を記録", icon: <TrendingUp size={18} />, onClick: openSalesModal },
                        { id: "invoice", label: "請求書を作る", icon: <FileText size={18} />, onClick: openInvoiceModal },
                    ]}
                />
            )}
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
