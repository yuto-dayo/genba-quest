import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
    X,
    Loader2,
    CheckCircle,
    AlertTriangle,
    FileText,
    Calendar,
    BadgeCheck,
    Sparkles,
    ShieldAlert,
    Building2,
    FolderKanban,
    ReceiptText,
} from "lucide-react";
import {
    createInvoice,
    downloadInvoicePdf,
    fetchClients,
    fetchInvoiceCandidates,
    fetchInvoiceEligibilityForTransactions,
    fetchInvoiceSettings,
    type AccountingInvoice,
    type AccountingTransaction,
    type Client,
    type InvoiceEligibility,
    type InvoiceSettings,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import styles from "./InvoiceModal.module.css";

interface InvoiceModalProps {
    onClose: () => void;
    onCreated: () => void | Promise<void>;
    readOnly?: boolean;
}

const statusMeta = {
    unregistered: {
        label: "未登録",
        helper: "通常請求書のみ発行できます",
    },
    applied: {
        label: "申請中",
        helper: "登録完了までは適格請求書を確定発行できません",
    },
    registered: {
        label: "登録済み",
        helper: "登録日以後の取引で適格請求書を選択できます",
    },
} as const;

const documentTypeMeta = {
    standard_invoice: {
        label: "請求書",
        tone: "neutral",
        description: "通常請求書として発行します",
    },
    qualified_invoice: {
        label: "適格請求書",
        tone: "accent",
        description: "インボイス制度対応の帳票として発行します",
    },
    invoice_supplement: {
        label: "追完通知",
        tone: "warning",
        description: "既存帳票に補足情報を付す帳票として扱います",
    },
} as const;

const today = new Date().toISOString().split("T")[0];

function firstDayOfCurrentMonth(): string {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
}

function addOneMonth(dateString: string): string {
    const nextDate = new Date(dateString);
    nextDate.setMonth(nextDate.getMonth() + 1);
    return nextDate.toISOString().split("T")[0];
}

function formatCurrency(value: number): string {
    return `¥${Math.round(value).toLocaleString()}`;
}

function formatDate(value?: string | null): string {
    return value ? value.replace(/-/g, "/") : "未設定";
}

function getSiteGroupKey(transaction: AccountingTransaction): string {
    return transaction.site?.id || "unassigned";
}

function getSiteGroupLabel(transaction: AccountingTransaction): string {
    return transaction.site?.name || "現場未設定";
}

export function InvoiceModal({ onClose, onCreated, readOnly = false }: InvoiceModalProps) {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [loadingCandidates, setLoadingCandidates] = useState(false);
    const [loadingSettings, setLoadingSettings] = useState(true);
    const [loadingClients, setLoadingClients] = useState(true);
    const [loadingEligibility, setLoadingEligibility] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [downloadError, setDownloadError] = useState<string | null>(null);
    const [createdInvoice, setCreatedInvoice] = useState<AccountingInvoice | null>(null);
    const [invoiceSettings, setInvoiceSettings] = useState<InvoiceSettings | null>(null);
    const [clients, setClients] = useState<Client[]>([]);
    const [candidateTransactions, setCandidateTransactions] = useState<AccountingTransaction[]>([]);
    const [eligibility, setEligibility] = useState<InvoiceEligibility | null>(null);
    const [selectedTransactionIds, setSelectedTransactionIds] = useState<string[]>([]);

    const [formData, setFormData] = useState({
        client_id: "",
        period_start: firstDayOfCurrentMonth(),
        period_end: today,
        issue_date: today,
        due_date: "",
        billing_name: "",
        billing_address: "",
        notes: "",
        requested_document_type: "auto" as "auto" | "standard_invoice" | "qualified_invoice",
    });

    useEffect(() => {
        const loadInitial = async () => {
            try {
                const [settingsData, clientsData] = await Promise.all([
                    fetchInvoiceSettings(),
                    fetchClients(),
                ]);
                setInvoiceSettings(settingsData);
                setClients(clientsData);
            } catch (err) {
                console.error("Failed to load invoice modal context:", err);
                setError(getErrorMessage(err));
            } finally {
                setLoadingSettings(false);
                setLoadingClients(false);
            }
        };

        void loadInitial();
    }, []);

    useEffect(() => {
        if (formData.issue_date && !formData.due_date) {
            setFormData((prev) => ({
                ...prev,
                due_date: addOneMonth(prev.issue_date),
            }));
        }
    }, [formData.issue_date, formData.due_date]);

    useEffect(() => {
        const selectedClient = clients.find((client) => client.id === formData.client_id);
        if (!selectedClient) {
            return;
        }

        setFormData((prev) => ({
            ...prev,
            billing_name: prev.billing_name.trim() || selectedClient.billing_name || selectedClient.name || "",
            billing_address: prev.billing_address.trim() || selectedClient.billing_address || selectedClient.address || "",
            notes: prev.notes.trim() || selectedClient.invoice_notes_default || "",
        }));
    }, [clients, formData.client_id]);

    useEffect(() => {
        if (!formData.client_id) {
            setCandidateTransactions([]);
            setSelectedTransactionIds([]);
            return;
        }

        let cancelled = false;

        const loadCandidates = async () => {
            try {
                setLoadingCandidates(true);
                setError(null);
                const candidates = await fetchInvoiceCandidates({
                    client_id: formData.client_id,
                    date_from: formData.period_start || undefined,
                    date_to: formData.period_end || undefined,
                });

                if (cancelled) {
                    return;
                }

                setCandidateTransactions(candidates);
                setSelectedTransactionIds((prev) => prev.filter((transactionId) => (
                    candidates.some((candidate) => candidate.id === transactionId)
                )));
            } catch (err: unknown) {
                if (!cancelled) {
                    setCandidateTransactions([]);
                    setSelectedTransactionIds([]);
                    setError(getErrorMessage(err));
                }
            } finally {
                if (!cancelled) {
                    setLoadingCandidates(false);
                }
            }
        };

        void loadCandidates();

        return () => {
            cancelled = true;
        };
    }, [formData.client_id, formData.period_start, formData.period_end]);

    useEffect(() => {
        if (selectedTransactionIds.length === 0) {
            setEligibility(null);
            return;
        }

        let cancelled = false;

        const loadEligibility = async () => {
            try {
                setLoadingEligibility(true);
                setError(null);
                const nextEligibility = await fetchInvoiceEligibilityForTransactions(selectedTransactionIds);
                if (!cancelled) {
                    setEligibility(nextEligibility);
                }
            } catch (err: unknown) {
                if (!cancelled) {
                    setEligibility(null);
                    setError(getErrorMessage(err));
                }
            } finally {
                if (!cancelled) {
                    setLoadingEligibility(false);
                }
            }
        };

        void loadEligibility();

        return () => {
            cancelled = true;
        };
    }, [selectedTransactionIds]);

    const selectedClient = clients.find((client) => client.id === formData.client_id) || null;
    const selectedTransactions = candidateTransactions.filter((transaction) => selectedTransactionIds.includes(transaction.id));
    const selectedSummary = selectedTransactions.reduce((summary, transaction) => {
        summary.amountSubtotal += transaction.amount_subtotal || 0;
        summary.taxAmount += transaction.tax_amount || 0;
        summary.amountTotal += transaction.amount_total || 0;
        summary.siteKeys.add(getSiteGroupKey(transaction));
        summary.siteNames.add(getSiteGroupLabel(transaction));
        summary.dates.push(transaction.recorded_date);
        return summary;
    }, {
        amountSubtotal: 0,
        taxAmount: 0,
        amountTotal: 0,
        siteKeys: new Set<string>(),
        siteNames: new Set<string>(),
        dates: [] as string[],
    });
    const selectedPeriodStart = [...selectedSummary.dates].sort()[0] || null;
    const selectedPeriodEnd = [...selectedSummary.dates].sort().slice(-1)[0] || null;
    const siteGroups = candidateTransactions.reduce<Array<{
        key: string;
        label: string;
        transactions: AccountingTransaction[];
        amountTotal: number;
    }>>((groups, transaction) => {
        const key = getSiteGroupKey(transaction);
        const existing = groups.find((group) => group.key === key);
        if (existing) {
            existing.transactions.push(transaction);
            existing.amountTotal += transaction.amount_total || 0;
            return groups;
        }

        groups.push({
            key,
            label: getSiteGroupLabel(transaction),
            transactions: [transaction],
            amountTotal: transaction.amount_total || 0,
        });
        return groups;
    }, []);

    const resolvedDocumentType = eligibility?.resolved_document_type || "standard_invoice";
    const activeDocumentMeta = documentTypeMeta[resolvedDocumentType];
    const issuerStatus = invoiceSettings?.invoice_issuer_status || "unregistered";
    const statusInfo = statusMeta[issuerStatus];
    const requestedQualifiedButBlocked = Boolean(
        formData.requested_document_type === "qualified_invoice"
        && eligibility
        && !eligibility.eligible_for_qualified_invoice
    );
    const submitDisabled =
        readOnly
        || loading
        || downloading
        || loadingCandidates
        || loadingEligibility
        || selectedTransactionIds.length === 0
        || requestedQualifiedButBlocked;

    const handleInputChange = (field: keyof typeof formData, value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const toggleTransaction = (transactionId: string) => {
        setSelectedTransactionIds((prev) => (
            prev.includes(transactionId)
                ? prev.filter((id) => id !== transactionId)
                : [...prev, transactionId]
        ));
    };

    const toggleSiteGroup = (siteTransactionIds: string[]) => {
        const everySelected = siteTransactionIds.every((transactionId) => selectedTransactionIds.includes(transactionId));
        setSelectedTransactionIds((prev) => {
            if (everySelected) {
                return prev.filter((transactionId) => !siteTransactionIds.includes(transactionId));
            }

            return Array.from(new Set([...prev, ...siteTransactionIds]));
        });
    };

    const handleDownload = async (invoice: AccountingInvoice) => {
        setDownloading(true);
        setDownloadError(null);

        try {
            const { blob, filename } = await downloadInvoicePdf(invoice.id);
            const objectUrl = window.URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = objectUrl;
            anchor.download = filename;
            document.body.append(anchor);
            anchor.click();
            anchor.remove();
            window.URL.revokeObjectURL(objectUrl);
        } catch (err: unknown) {
            setDownloadError(getErrorMessage(err, "請求書は作成済みですがPDFダウンロードに失敗しました"));
            throw err;
        } finally {
            setDownloading(false);
        }
    };

    const resetForNextInvoice = async () => {
        setCreatedInvoice(null);
        setError(null);
        setDownloadError(null);
        setEligibility(null);
        setSelectedTransactionIds([]);
        setFormData({
            client_id: "",
            period_start: firstDayOfCurrentMonth(),
            period_end: today,
            issue_date: today,
            due_date: "",
            billing_name: "",
            billing_address: "",
            notes: "",
            requested_document_type: "auto",
        });
        setCandidateTransactions([]);

        try {
            setLoadingSettings(true);
            setLoadingClients(true);
            const [settingsData, clientsData] = await Promise.all([
                fetchInvoiceSettings(),
                fetchClients(),
            ]);
            setInvoiceSettings(settingsData);
            setClients(clientsData);
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setLoadingSettings(false);
            setLoadingClients(false);
        }
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();

        if (readOnly) {
            setError("過去月は閲覧専用です。修正は新しい月の逆仕訳で行います。");
            return;
        }

        if (selectedTransactionIds.length === 0) {
            setError("請求対象の売上を選択してください");
            return;
        }

        if (!formData.billing_name.trim()) {
            setError("請求先名を入力してください");
            return;
        }

        setLoading(true);
        setError(null);

        let invoiceCreated = false;

        try {
            const invoice = await createInvoice({
                transaction_id: selectedTransactionIds[0],
                source_transaction_ids: selectedTransactionIds,
                issue_date: formData.issue_date || undefined,
                due_date: formData.due_date || undefined,
                billing_name: formData.billing_name.trim(),
                billing_address: formData.billing_address.trim() || undefined,
                notes: formData.notes.trim() || undefined,
                requested_document_type: formData.requested_document_type,
            });
            invoiceCreated = true;
            setCreatedInvoice(invoice);
            await Promise.resolve(onCreated());
            await handleDownload(invoice);
            onClose();
        } catch (err: unknown) {
            if (!invoiceCreated) {
                setError(getErrorMessage(err));
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <motion.div
            className={styles.overlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
        >
            <motion.div
                className={styles.modal}
                role="dialog"
                aria-modal="true"
                aria-labelledby="invoice-modal-title"
                initial={{ opacity: 0, y: 32 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 24 }}
                onClick={(event) => event.stopPropagation()}
            >
                <header className={styles.header}>
                    <h2 id="invoice-modal-title" className={styles.title}>
                        <FileText size={20} />
                        請求書作成
                    </h2>
                    <button className={styles.closeButton} onClick={onClose} aria-label="閉じる">
                        <X size={24} />
                    </button>
                </header>

                {error && (
                    <div className={styles.error}>
                        <AlertTriangle size={16} />
                        {error}
                    </div>
                )}

                {createdInvoice ? (
                    <section className={styles.successState}>
                        <div className={styles.successBadge}>
                            <CheckCircle size={18} />
                            請求書を作成しました
                        </div>
                        <div className={styles.successCard}>
                            <div className={styles.successRow}>
                                <span>請求書番号</span>
                                <strong>{createdInvoice.invoice_no}</strong>
                            </div>
                            <div className={styles.successRow}>
                                <span>帳票種別</span>
                                <strong>{documentTypeMeta[createdInvoice.document_type || "standard_invoice"].label}</strong>
                            </div>
                            <div className={styles.successRow}>
                                <span>請求対象</span>
                                <strong>
                                    {createdInvoice.source_summary?.site_count || 1}現場 / {createdInvoice.source_summary?.source_count || 1}件
                                </strong>
                            </div>
                            <div className={styles.successRow}>
                                <span>発行日</span>
                                <strong>{createdInvoice.issue_date}</strong>
                            </div>
                            <div className={styles.successRow}>
                                <span>請求先</span>
                                <strong>{createdInvoice.billing_name || "未設定"}</strong>
                            </div>
                        </div>

                        {downloadError && (
                            <div className={styles.error}>
                                <AlertTriangle size={16} />
                                {downloadError}
                            </div>
                        )}

                        <div className={styles.successActions}>
                            <button
                                type="button"
                                className={styles.cancelButton}
                                onClick={() => void resetForNextInvoice()}
                            >
                                もう1件作成
                            </button>
                            <button
                                type="button"
                                className={styles.submitButton}
                                onClick={() => void handleDownload(createdInvoice)}
                                disabled={downloading}
                            >
                                {downloading ? (
                                    <Loader2 size={20} className={styles.spinner} />
                                ) : (
                                    <FileText size={18} />
                                )}
                                PDFをダウンロード
                            </button>
                        </div>
                    </section>
                ) : (
                    <form className={styles.form} onSubmit={handleSubmit}>
                        <fieldset
                            className={styles.readOnlyFieldset}
                            disabled={readOnly}
                            aria-disabled={readOnly ? "true" : undefined}
                        >
                            <section className={styles.hero}>
                            <div className={styles.heroHeader}>
                                <div>
                                    <p className={styles.eyebrow}>Invoice Flow</p>
                                    <h3 className={styles.heroTitle}>取引先から期間を切って、現場単位でまとめて選ぶ</h3>
                                </div>
                                <span className={`${styles.documentChip} ${styles[activeDocumentMeta.tone]}`}>
                                    {activeDocumentMeta.label}
                                </span>
                            </div>

                            <div className={styles.heroGrid}>
                                <div className={styles.statusCard}>
                                    <span className={styles.cardLabel}>発行者状態</span>
                                    <div className={styles.statusValue}>
                                        <BadgeCheck size={16} />
                                        {statusInfo.label}
                                    </div>
                                    <p>{statusInfo.helper}</p>
                                </div>

                                <div className={styles.statusCard}>
                                    <span className={styles.cardLabel}>選択サマリー</span>
                                    <div className={styles.statusValue}>
                                        <FolderKanban size={16} />
                                        {selectedTransactionIds.length}件 / {selectedSummary.siteKeys.size}現場
                                    </div>
                                    <p>
                                        {selectedTransactionIds.length > 0
                                            ? `${formatCurrency(selectedSummary.amountTotal)} を請求対象にしています`
                                            : "請求対象を選ぶと合計がここに反映されます"}
                                    </p>
                                </div>
                            </div>

                            {eligibility && (
                                <div className={styles.reasonBox}>
                                    <span className={styles.reasonTitle}>帳票判定</span>
                                    <div className={styles.reasonStatus}>
                                        {eligibility.eligible_for_qualified_invoice ? (
                                            <Sparkles size={16} />
                                        ) : (
                                            <ShieldAlert size={16} />
                                        )}
                                        <span>{activeDocumentMeta.description}</span>
                                    </div>
                                    {eligibility.reason_messages.length > 0 && (
                                        <ul className={styles.reasonList}>
                                            {eligibility.reason_messages.map((message) => (
                                                <li key={message}>{message}</li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            )}
                            </section>

                            <section className={styles.selectionPanel}>
                            <div className={styles.sectionHeader}>
                                <div>
                                    <p className={styles.sectionEyebrow}>Step 1</p>
                                    <h4 className={styles.sectionTitle}>請求対象を絞り込む</h4>
                                </div>
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.label}>
                                    <Building2 size={14} />
                                    取引先 *
                                </label>
                                {loadingClients ? (
                                    <div className={styles.loadingBox}>
                                        <Loader2 size={20} className={styles.spinner} />
                                        読み込み中...
                                    </div>
                                ) : (
                                    <select
                                        className={styles.select}
                                        value={formData.client_id}
                                        onChange={(event) => handleInputChange("client_id", event.target.value)}
                                        required
                                    >
                                        <option value="">-- 取引先を選択 --</option>
                                        {clients.map((client) => (
                                            <option key={client.id} value={client.id}>
                                                {client.name}
                                            </option>
                                        ))}
                                    </select>
                                )}
                                {selectedClient?.payment_terms && (
                                    <p className={styles.helperText}>支払条件メモ: {selectedClient.payment_terms}</p>
                                )}
                            </div>

                            <div className={styles.formRow}>
                                <div className={styles.formGroup}>
                                    <label className={styles.label}>
                                        <Calendar size={14} />
                                        請求期間の開始
                                    </label>
                                    <input
                                        type="date"
                                        className={styles.input}
                                        value={formData.period_start}
                                        onChange={(event) => handleInputChange("period_start", event.target.value)}
                                    />
                                </div>
                                <div className={styles.formGroup}>
                                    <label className={styles.label}>
                                        <Calendar size={14} />
                                        請求期間の終了
                                    </label>
                                    <input
                                        type="date"
                                        className={styles.input}
                                        value={formData.period_end}
                                        onChange={(event) => handleInputChange("period_end", event.target.value)}
                                    />
                                </div>
                            </div>
                            </section>

                            <section className={styles.selectionPanel}>
                            <div className={styles.sectionHeader}>
                                <div>
                                    <p className={styles.sectionEyebrow}>Step 2</p>
                                    <h4 className={styles.sectionTitle}>現場ごとにまとめて選択</h4>
                                </div>
                                {selectedTransactionIds.length > 0 && (
                                    <button
                                        type="button"
                                        className={styles.inlineAction}
                                        onClick={() => setSelectedTransactionIds([])}
                                    >
                                        選択をクリア
                                    </button>
                                )}
                            </div>

                            {!formData.client_id ? (
                                <div className={styles.emptyBox}>
                                    請求先を選ぶと未請求の売上候補が表示されます。
                                </div>
                            ) : loadingCandidates ? (
                                <div className={styles.loadingBox}>
                                    <Loader2 size={20} className={styles.spinner} />
                                    売上候補を集計中...
                                </div>
                            ) : siteGroups.length === 0 ? (
                                <div className={styles.emptyBox}>
                                    この期間に請求できる売上はありません。
                                </div>
                            ) : (
                                <div className={styles.groupList}>
                                    {siteGroups.map((group) => {
                                        const groupTransactionIds = group.transactions.map((transaction) => transaction.id);
                                        const everySelected = groupTransactionIds.every((transactionId) => selectedTransactionIds.includes(transactionId));
                                        const someSelected = groupTransactionIds.some((transactionId) => selectedTransactionIds.includes(transactionId));

                                        return (
                                            <article key={group.key} className={`${styles.siteGroup} ${everySelected ? styles.siteGroupActive : ""}`}>
                                                <button
                                                    type="button"
                                                    className={styles.siteGroupHeader}
                                                    onClick={() => toggleSiteGroup(groupTransactionIds)}
                                                >
                                                    <span className={styles.checkboxWrap}>
                                                        <input
                                                            type="checkbox"
                                                            checked={everySelected}
                                                            aria-checked={someSelected && !everySelected ? "mixed" : everySelected}
                                                            readOnly
                                                        />
                                                    </span>
                                                    <div className={styles.siteGroupCopy}>
                                                        <strong>{group.label}</strong>
                                                        <span>{group.transactions.length}件 / {formatCurrency(group.amountTotal)}</span>
                                                    </div>
                                                </button>

                                                <div className={styles.transactionList}>
                                                    {group.transactions.map((transaction) => {
                                                        const checked = selectedTransactionIds.includes(transaction.id);
                                                        return (
                                                            <label key={transaction.id} className={`${styles.transactionOption} ${checked ? styles.transactionOptionActive : ""}`}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={checked}
                                                                    onChange={() => toggleTransaction(transaction.id)}
                                                                />
                                                                <div className={styles.transactionCopy}>
                                                                    <strong>{transaction.description || "売上"}</strong>
                                                                    <span>{formatDate(transaction.recorded_date)}</span>
                                                                </div>
                                                                <span className={styles.transactionAmount}>
                                                                    {formatCurrency(transaction.amount_total)}
                                                                </span>
                                                            </label>
                                                        );
                                                    })}
                                                </div>
                                            </article>
                                        );
                                    })}
                                </div>
                            )}
                            </section>

                            <section className={styles.summaryPanel}>
                            <div className={styles.sectionHeader}>
                                <div>
                                    <p className={styles.sectionEyebrow}>Step 3</p>
                                    <h4 className={styles.sectionTitle}>帳票情報を整える</h4>
                                </div>
                            </div>

                            <div className={styles.summaryGrid}>
                                <article className={styles.summaryCard}>
                                    <span className={styles.summaryLabel}>対象件数</span>
                                    <strong className={styles.summaryValue}>{selectedTransactionIds.length}件</strong>
                                    <p className={styles.summaryNote}>
                                        {selectedSummary.siteKeys.size}現場 / {formatDate(selectedPeriodStart)} - {formatDate(selectedPeriodEnd)}
                                    </p>
                                </article>
                                <article className={styles.summaryCard}>
                                    <span className={styles.summaryLabel}>小計</span>
                                    <strong className={styles.summaryValue}>{formatCurrency(selectedSummary.amountSubtotal)}</strong>
                                    <p className={styles.summaryNote}>税額 {formatCurrency(selectedSummary.taxAmount)}</p>
                                </article>
                                <article className={styles.summaryCard}>
                                    <span className={styles.summaryLabel}>合計</span>
                                    <strong className={styles.summaryValue}>{formatCurrency(selectedSummary.amountTotal)}</strong>
                                    <p className={styles.summaryNote}>
                                        {Array.from(selectedSummary.siteNames).slice(0, 2).join("、") || "請求対象未選択"}
                                    </p>
                                </article>
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.label}>発行したい帳票</label>
                                <select
                                    className={styles.select}
                                    value={formData.requested_document_type}
                                    onChange={(event) => handleInputChange("requested_document_type", event.target.value)}
                                >
                                    <option value="auto">自動判定に任せる</option>
                                    <option value="standard_invoice">通常請求書に固定する</option>
                                    <option value="qualified_invoice">適格請求書を明示要求する</option>
                                </select>
                            </div>

                            <div className={styles.formRow}>
                                <div className={styles.formGroup}>
                                    <label className={styles.label}>
                                        <Calendar size={14} />
                                        発行日
                                    </label>
                                    <input
                                        type="date"
                                        className={styles.input}
                                        value={formData.issue_date}
                                        onChange={(event) => handleInputChange("issue_date", event.target.value)}
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label className={styles.label}>
                                        <Calendar size={14} />
                                        支払期限
                                    </label>
                                    <input
                                        type="date"
                                        className={styles.input}
                                        value={formData.due_date}
                                        onChange={(event) => handleInputChange("due_date", event.target.value)}
                                    />
                                </div>
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.label}>請求先名 *</label>
                                <input
                                    type="text"
                                    className={styles.input}
                                    value={formData.billing_name}
                                    onChange={(event) => handleInputChange("billing_name", event.target.value)}
                                    placeholder="株式会社○○ 御中"
                                    required
                                />
                                <p className={styles.helperText}>
                                    取引先マスタがあれば請求先名・住所・備考を自動反映します。
                                </p>
                                <button
                                    type="button"
                                    className={styles.inlineAction}
                                    onClick={() => {
                                        onClose();
                                        navigate("/settings");
                                    }}
                                >
                                    取引先を設定で編集
                                </button>
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.label}>請求先住所</label>
                                <input
                                    type="text"
                                    className={styles.input}
                                    value={formData.billing_address}
                                    onChange={(event) => handleInputChange("billing_address", event.target.value)}
                                    placeholder="〒000-0000 東京都..."
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.label}>
                                    <ReceiptText size={14} />
                                    備考
                                </label>
                                <textarea
                                    className={styles.textarea}
                                    value={formData.notes}
                                    onChange={(event) => handleInputChange("notes", event.target.value)}
                                    placeholder={invoiceSettings?.invoice_notes_default || "お支払いは銀行振込でお願いいたします。"}
                                    rows={3}
                                />
                            </div>
                            </section>
                        </fieldset>

                        <div className={styles.formActions}>
                            <button type="button" className={styles.cancelButton} onClick={onClose}>
                                キャンセル
                            </button>
                            <button
                                type="submit"
                                className={styles.submitButton}
                                disabled={submitDisabled}
                                aria-disabled={submitDisabled ? "true" : undefined}
                            >
                                {loading || loadingSettings || downloading ? (
                                    <Loader2 size={20} className={styles.spinner} />
                                ) : (
                                    <CheckCircle size={20} />
                                )}
                                請求書を作成
                            </button>
                        </div>
                    </form>
                )}
            </motion.div>
        </motion.div>
    );
}
