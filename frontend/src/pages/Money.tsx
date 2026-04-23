import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
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
    ChevronLeft,
    Search,
    FilterX,
} from "lucide-react";
import {
    fetchPL,
    fetchPathModulePendingProposals,
    fetchTransactions,
    fetchPendingApprovals,
    searchTransactions,
    batchReviewExpenses,
    type PLReport,
    type AccountingTransaction,
    type PathModulePendingProposal,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import { buildPathProposalHref, getPathProposalContext } from "../lib/pathProposal";
import { ExpenseModal } from "../components/ExpenseModal";
import { SalesModal } from "../components/SalesModal";
import { InvoiceModal } from "../components/InvoiceModal";
import { InvoiceListPanel } from "../components/InvoiceListPanel";
import { TransactionDetailModal } from "../components/TransactionDetailModal";
import { ApprovalCard } from "../components/ApprovalCard";
import { FloatingActionButton } from "../components/FloatingActionButton";
import styles from "./Money.module.css";

// 日付フォーマットヘルパー (YYYY/MM/DD)
const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return "";
    return dateStr.replace(/-/g, "/");
};

const PATH_PROPOSAL_LABELS: Record<string, string> = {
    "policy.update": "PATH policy publish",
    "evaluation.finalize": "月締め",
    "reward.calculate": "報酬 run",
    "reward.adjust": "補正 / reversal",
    "skill.achieve": "技能認定",
    "skill.revoke": "技能取消",
};

// 検索フィルター型
interface SearchFilters {
    kind: "all" | "expense" | "sale" | "invoice";
    datePreset: "all" | "thisMonth" | "lastMonth" | "custom";
    dateFrom: string;
    dateTo: string;
    query: string;
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
    const navigate = useNavigate();
    const isMobile = useIsMobile();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // 選択中の月 (YYYY-MM形式)
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    });

    const [pl, setPL] = useState<PLReport | null>(null);
    const [transactions, setTransactions] = useState<AccountingTransaction[]>([]);
    const [pendingApprovals, setPendingApprovals] = useState<AccountingTransaction[]>([]);
    const [pathPendingProposals, setPathPendingProposals] = useState<PathModulePendingProposal[]>([]);

    // フィルター関連（統合型）
    const [filters, setFilters] = useState<SearchFilters>(defaultFilters);
    const [searchInput, setSearchInput] = useState("");
    const [showAllTransactions, setShowAllTransactions] = useState(false);
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchResults, setSearchResults] = useState<AccountingTransaction[] | null>(null);
    const [showDatePicker, setShowDatePicker] = useState(false);

    // 承認モーダル
    const [showApprovalsModal, setShowApprovalsModal] = useState(false);

    // 登録モーダル
    const [showExpenseModal, setShowExpenseModal] = useState(false);
    const [showSalesModal, setShowSalesModal] = useState(false);
    const [showInvoiceModal, setShowInvoiceModal] = useState(false);
    const [invoiceRefreshKey, setInvoiceRefreshKey] = useState(0);
    const [selectedTransaction, setSelectedTransaction] = useState<AccountingTransaction | null>(null);
    const [expenseDraft, setExpenseDraft] = useState<ExpenseCorrectionDraft | null>(null);
    const [salesDraft, setSalesDraft] = useState<SalesCorrectionDraft | null>(null);

    const loadData = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const [plData, txData, pendingData, pathPendingData] = await Promise.all([
                fetchPL({ month: selectedMonth }),
                fetchTransactions({ limit: 50 }),
                fetchPendingApprovals(),
                fetchPathModulePendingProposals(6).catch(() => ({ proposals: [] })),
            ]);
            setPL(plData);
            setTransactions(txData);
            setPathPendingProposals(pathPendingData.proposals);
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
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    }, [selectedMonth]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // 月を変更する関数
    const changeMonth = (direction: "prev" | "next") => {
        const [year, month] = selectedMonth.split("-").map(Number);
        const date = new Date(year, month - 1);
        date.setMonth(date.getMonth() + (direction === "prev" ? -1 : 1));
        const newMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        setSelectedMonth(newMonth);
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
    useEffect(() => {
        const hasActiveFilters = filters.kind !== "all" || filters.datePreset !== "all" || filters.query;
        if (hasActiveFilters) {
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
        }
    };

    const clearAllFilters = () => {
        setFilters(defaultFilters);
        setSearchResults(null);
    };

    // アクティブなフィルターがあるか
    const hasActiveFilters = filters.kind !== "all" || filters.datePreset !== "all" || filters.query;

    // 表示する取引（検索結果 or 全取引）
    const filteredTransactions = searchResults !== null ? searchResults : transactions;

    // 表示する取引（最新10件 or 全件）
    const displayedTransactions = showAllTransactions
        ? filteredTransactions
        : filteredTransactions.slice(0, 10);

    const handleApprovalComplete = () => {
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
                <button onClick={loadData} className={styles.retryButton}>
                    再試行
                </button>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            {/* 承認待ちアラートバナー */}
            <AnimatePresence>
                {pendingApprovals.length > 0 && (
                    <motion.div
                        className={styles.alertBanner}
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        onClick={() => setShowApprovalsModal(true)}
                    >
                        <div className={styles.alertContent}>
                            <AlertTriangle size={18} />
                            <span>承認待ち <strong>{pendingApprovals.length}件</strong></span>
                        </div>
                        <ChevronRight size={18} />
                    </motion.div>
                )}
            </AnimatePresence>

            {pathPendingProposals.length > 0 && (
                <motion.section
                    className={styles.pathQueueSection}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 }}
                >
                    <div className={styles.pathQueueHeader}>
                        <div>
                            <p className={styles.pathQueueEyebrow}>PATH approval queue</p>
                            <h2 className={styles.pathQueueTitle}>評価・支給の承認待ち</h2>
                            <p className={styles.pathQueueDescription}>
                                Money からも PATH の承認待ちへ移動できます。会計と同じ日に確認する前提で並べています。
                            </p>
                        </div>
                    </div>
                    <div className={styles.pathQueueList}>
                        {pathPendingProposals.map((proposal) => {
                            const context = getPathProposalContext(proposal);
                            const proposalHref = buildPathProposalHref(proposal);

                            return (
                                <button
                                    key={proposal.id}
                                    type="button"
                                    className={styles.pathQueueItem}
                                    onClick={() => {
                                        if (proposalHref) {
                                            navigate(proposalHref);
                                        }
                                    }}
                                >
                                    <div className={styles.pathQueueItemTop}>
                                        <span className={styles.pathQueueKind}>
                                            {PATH_PROPOSAL_LABELS[proposal.type] || proposal.type}
                                        </span>
                                        <span className={styles.pathQueueApprovals}>
                                            {proposal.required_approvals} approvals
                                        </span>
                                    </div>
                                    <strong className={styles.pathQueueItemTitle}>{proposal.description}</strong>
                                    <p className={styles.pathQueueMeta}>
                                        {context?.month ? `対象月 ${context.month}` : "対象月未指定"}
                                        {context?.memberId ? ` ・ member ${context.memberId.slice(0, 8)}...` : ""}
                                    </p>
                                </button>
                            );
                        })}
                    </div>
                </motion.section>
            )}

            {/* PLサマリー - 横一列ダッシュボード */}
            {pl && (
                <motion.section
                    className={styles.plSection}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                >
                    <div className={styles.plHeader}>
                        <button
                            className={styles.monthNav}
                            aria-label="前月"
                            onClick={() => changeMonth("prev")}
                            disabled={loading}
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <div className={styles.monthDisplay}>
                            <Calendar size={14} />
                            <span className={styles.monthText}>
                                {selectedMonth.replace("-", "年")}月
                            </span>
                        </div>
                        <button
                            className={styles.monthNav}
                            aria-label="翌月"
                            onClick={() => changeMonth("next")}
                            disabled={loading}
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                    <div className={styles.plSummary}>
                        <PLMetric
                            label="売上"
                            value={pl.sales}
                            color="income"
                        />
                        <div className={styles.plDivider} />
                        <PLMetric
                            label="経費"
                            value={pl.expenses}
                            color="expense"
                            negative
                        />
                        <div className={styles.plDivider} />
                        <PLMetric
                            label="利益"
                            value={pl.profit}
                            color="profit"
                            badge={pl.sales > 0 ? `${((pl.profit / pl.sales) * 100).toFixed(1)}%` : "0%"}
                            highlight
                        />
                        <div className={styles.plDivider} />
                        <PLMetric
                            label="分配可能"
                            value={pl.distributable}
                            color="distribute"
                            badge="70%"
                        />
                    </div>
                </motion.section>
            )}

            {/* クイックアクション */}
            {!isMobile && (
                <section className={styles.quickActions}>
                    <button className={styles.actionBtn} onClick={() => openExpenseModal()}>
                        <Receipt size={20} />
                        <span>経費登録</span>
                    </button>
                    <button className={styles.actionBtn} onClick={() => openSalesModal()}>
                        <TrendingUp size={20} />
                        <span>売上登録</span>
                    </button>
                    <button className={styles.actionBtn} onClick={openInvoiceModal}>
                        <FileText size={20} />
                        <span>請求書作成</span>
                    </button>
                </section>
            )}

            <div className={styles.workspaceGrid}>
                <div className={styles.primaryColumn}>
                    {/* 統合検索セクション */}
                    <motion.section
                        className={styles.searchSection}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                    >
                        {/* 入力エリア */}
                        <div className={styles.inputBox}>
                            <input
                                type="text"
                                className={styles.mainInput}
                                placeholder={isMobile ? "検索..." : "検索... (Enter: 確定)"}
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
                            <h2 className={styles.sectionTitle}>取引一覧</h2>
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
                                    {displayedTransactions.map((tx) => (
                                        <TransactionRow
                                            key={tx.id}
                                            tx={tx}
                                            onOpenDetail={() => setSelectedTransaction(tx)}
                                        />
                                    ))}
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
                {showExpenseModal && (
                    <ExpenseModal
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
                )}
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
            </AnimatePresence>

            {isMobile && (
                <FloatingActionButton
                    behavior="draggable"
                    hideOnDesktop
                    openLabel="お金の登録メニューを開く"
                    closeLabel="お金の登録メニューを閉じる"
                    items={[
                        { id: "expense", label: "経費登録", icon: <Receipt size={18} />, onClick: openExpenseModal },
                        { id: "sale", label: "売上登録", icon: <TrendingUp size={18} />, onClick: openSalesModal },
                        { id: "invoice", label: "請求書作成", icon: <FileText size={18} />, onClick: openInvoiceModal },
                    ]}
                />
            )}
        </div>
    );
}

// PLメトリックコンポーネント（横一列用）
function PLMetric({
    label,
    value,
    color,
    badge,
    negative,
    highlight,
}: {
    label: string;
    value: number;
    color: "income" | "expense" | "profit" | "distribute";
    badge?: string;
    negative?: boolean;
    highlight?: boolean;
}) {
    return (
        <div className={`${styles.plMetric} ${highlight ? styles.highlight : ""}`}>
            <span className={styles.metricLabel}>{label}</span>
            <span className={`${styles.metricValue} ${styles[color]}`}>
                {negative && value > 0 && "-"}¥{Math.abs(value).toLocaleString()}
            </span>
            {badge && (
                <span className={`${styles.metricBadge} ${styles[color]}`}>
                    {badge}
                </span>
            )}
        </div>
    );
}

// 取引行コンポーネント
function TransactionRow({
    tx,
    onOpenDetail,
}: {
    tx: AccountingTransaction;
    onOpenDetail: () => void;
}) {
    const getStatusMeta = () => {
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

    return (
        <motion.button
            type="button"
            className={`${styles.txRow} ${isHighRisk ? styles.highRiskRow : ""} ${isPending ? styles.pendingRow : ""}`}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={onOpenDetail}
        >
            <div className={styles.colDate}>{formatDate(tx.recorded_date)}</div>
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
                {tx.kind === "expense" ? "-" : "+"}¥{Math.abs(tx.amount_total).toLocaleString()}
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
