import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    X,
    AlertTriangle,
    MapPin,
    Building2,
    Camera,
    FileText,
    Pencil,
    CheckCircle2,
    Loader2,
    Users,
    Calendar,
    Trash2,
    TrendingUp,
    CircleDollarSign,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import {
    fetchSiteDocuments,
    uploadSiteDocument,
    deleteSite,
    fetchMembers,
    fetchSiteLineItems,
    type CompleteSiteWithCloseResult,
    type Site,
    type SiteDocument,
    type SiteLineItem,
    type Member,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import { buildMoneyRewardHref } from "../lib/legacyRouteRedirect";
import { formatSiteDateRange, formatSiteSchedulePattern } from "../lib/siteSchedule";
import { SiteFormModal } from "./SiteFormModal";
import { SalesModal } from "./SalesModal";
import { SiteCompleteWithCloseModal } from "./SiteCompleteWithCloseModal";
import styles from "./SiteDetailModal.module.css";

interface SiteDetailModalProps {
    site: Site;
    onClose: () => void;
    onUpdated: (result?: { site?: Site; message?: string }) => void;
}

const formatYen = (amount: number) =>
    new Intl.NumberFormat("ja-JP", {
        style: "currency",
        currency: "JPY",
        maximumFractionDigits: 0,
    }).format(amount);

export function SiteDetailModal({ site, onClose, onUpdated }: SiteDetailModalProps) {
    const [searchParams] = useSearchParams();
    const [documents, setDocuments] = useState<SiteDocument[]>([]);
    const [lineItems, setLineItems] = useState<SiteLineItem[]>([]);
    const [members, setMembers] = useState<Member[]>([]);
    const [loadingDocs, setLoadingDocs] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleteReason, setDeleteReason] = useState("");
    const [showEditModal, setShowEditModal] = useState(false);
    const [showCompleteChoice, setShowCompleteChoice] = useState(false);
    const [showSalesModal, setShowSalesModal] = useState(false);
    const [showCloseModal, setShowCloseModal] = useState(false);
    const [closeDraftRevenue, setCloseDraftRevenue] = useState<number | null>(site.revenue ?? null);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const isCompleted = site.status === "completed";
    const isTentative = site.status === "tentative";
    const closePhase = site.close_phase || (isCompleted ? "completed_unclosed" : "active");
    const rewardReturnHref = useMemo(
        () => buildRewardReturnHref(site, searchParams),
        [searchParams, site],
    );
    const assignedMembers = members.filter(
        (m) => site.assigned_users?.includes(m.id)
    );
    const schedulePattern = formatSiteSchedulePattern(site);

    const loadDocuments = useCallback(async () => {
        try {
            setLoadingDocs(true);
            const docs = await fetchSiteDocuments(site.id);
            setDocuments(docs);
        } catch {
            // Documents loading is non-critical
        } finally {
            setLoadingDocs(false);
        }
    }, [site.id]);

    useEffect(() => {
        loadDocuments();
        fetchSiteLineItems(site.id).then(setLineItems).catch(() => {});
        if (site.assigned_users?.length) {
            fetchMembers().then(setMembers).catch(() => {});
        }
    }, [loadDocuments, site.assigned_users?.length, site.id]);

    const handleFileUpload = async (file: File) => {
        try {
            setUploading(true);
            setError(null);

            const reader = new FileReader();
            reader.onload = async () => {
                const base64 = (reader.result as string).split(",")[1];
                await uploadSiteDocument(site.id, {
                    file_base64: base64,
                    mime_type: file.type,
                    original_filename: file.name,
                });
                await loadDocuments();
                setUploading(false);
            };
            reader.onerror = () => {
                setError("ファイルの読み込みに失敗しました");
                setUploading(false);
            };
            reader.readAsDataURL(file);
        } catch (err: unknown) {
            setError(getErrorMessage(err));
            setUploading(false);
        }
    };

    const handleCompleteClick = () => {
        setCloseDraftRevenue(site.revenue ?? null);
        if (lineItems.length > 0) {
            setShowCompleteChoice(true);
        } else {
            openCloseModal();
        }
    };

    const openCloseModal = () => {
        setError(null);
        setShowCompleteChoice(false);
        setShowCloseModal(true);
    };

    const handleCompleteWithSales = () => {
        setShowCompleteChoice(false);
        setShowSalesModal(true);
    };

    const handleSalesSuccess = (recognizedRevenue?: number) => {
        setShowSalesModal(false);
        setCloseDraftRevenue(recognizedRevenue ?? site.revenue ?? null);
        openCloseModal();
    };

    const handleCompleteWithCloseSuccess = (result: CompleteSiteWithCloseResult) => {
        setShowCloseModal(false);
        onUpdated({
            site: result.site,
            message: buildCompleteWithCloseMessage(site.name, result),
        });
    };

    const handleDelete = async () => {
        if (!deleteReason.trim()) return;
        try {
            setDeleting(true);
            await deleteSite(site.id, deleteReason.trim());
            onUpdated();
        } catch (err: unknown) {
            setError(getErrorMessage(err));
            setDeleting(false);
            setShowDeleteConfirm(false);
        }
    };

    const handleEditSuccess = () => {
        setShowEditModal(false);
        onUpdated();
    };

    const getDocumentUrl = (doc: SiteDocument) => {
        return doc.signed_url || doc.drive_file_url || null;
    };

    const isImageDoc = (doc: SiteDocument) => {
        return doc.mime_type?.startsWith("image/");
    };

    return (
        <>
            <div className={styles.overlay} onClick={onClose}>
                <motion.div
                    className={styles.modal}
                    onClick={(e) => e.stopPropagation()}
                    initial={{ y: "100%" }}
                    animate={{ y: 0 }}
                    exit={{ y: "100%" }}
                    transition={{ type: "spring", damping: 28, stiffness: 300 }}
                    role="dialog"
                    aria-modal="true"
                >
                    {/* ドラッグハンドル */}
                    <div className={styles.dragHandle}>
                        <div className={styles.dragBar} />
                    </div>

                    {/* ヘッダー */}
                    <div className={styles.header}>
                        <div className={styles.headerInfo}>
                            <h2 className={styles.siteName}>{site.name}</h2>
                            <span className={`${styles.statusBadge} ${styles[site.status]}`}>
                                {isCompleted ? "完了" : isTentative ? "仮押さえ" : "進行中"}
                            </span>
                        </div>
                        <button
                            className={styles.closeButton}
                            onClick={onClose}
                            aria-label="閉じる"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    {/* スクロールコンテンツ */}
                    <div className={styles.content}>
                        {/* 注意事項 — 最優先表示 */}
                        {site.cautions && (
                            <div className={styles.cautionsSection}>
                                <div className={styles.cautionsLabel}>
                                    <AlertTriangle size={18} />
                                    注意事項
                                </div>
                                <div className={styles.cautionsText}>
                                    {site.cautions}
                                </div>
                            </div>
                        )}

                        {/* 工事項目 */}
                        {lineItems.length > 0 && (
                            <div className={styles.section}>
                                <span className={styles.sectionLabel}>工事項目</span>
                                <div className={styles.lineItemsTable}>
                                    {lineItems.map((item) => (
                                        <div key={item.id} className={styles.lineItemRow}>
                                            <span className={styles.lineItemName}>{item.item_name}</span>
                                            {(item.quantity != null || item.unit_name || item.unit_price != null) && (
                                                <span className={styles.lineItemDetail}>
                                                    {item.quantity != null && item.quantity}
                                                    {item.unit_name && ` ${item.unit_name}`}
                                                    {item.unit_price != null && ` × ¥${item.unit_price.toLocaleString()}`}
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* 基本情報 */}
                        {(site.client || site.address || site.started_at || site.expected_completion_at || assignedMembers.length > 0 || schedulePattern || (site.current_accumulated_cost ?? 0) > 0) && (
                            <div className={styles.infoSection}>
                                {site.client && (
                                    <div className={styles.infoRow}>
                                        <Building2 size={16} className={styles.infoIcon} />
                                        <span className={styles.infoText}>{site.client.name}</span>
                                    </div>
                                )}
                                {site.address && (
                                    <div className={styles.infoRow}>
                                        <MapPin size={16} className={styles.infoIcon} />
                                        <span className={styles.infoText}>{site.address}</span>
                                    </div>
                                )}
                                {(site.started_at || site.expected_completion_at) && (
                                    <div className={styles.infoRow}>
                                        <Calendar size={16} className={styles.infoIcon} />
                                        <span className={styles.infoText}>{formatSiteDateRange(site.started_at, site.expected_completion_at)}</span>
                                    </div>
                                )}
                                {schedulePattern && (
                                    <div className={styles.infoRow}>
                                        <Calendar size={16} className={styles.infoIcon} />
                                        <span className={styles.infoText}>{schedulePattern}</span>
                                    </div>
                                )}
                                {assignedMembers.length > 0 && (
                                    <div className={styles.infoRow}>
                                        <Users size={16} className={styles.infoIcon} />
                                        <span className={styles.infoText}>
                                            {assignedMembers.map((m) => m.full_name || m.username).join("、")}
                                        </span>
                                    </div>
                                )}
                                {typeof site.current_accumulated_cost === "number" && site.current_accumulated_cost > 0 && (
                                    <div className={styles.infoRow}>
                                        <CircleDollarSign size={16} className={styles.infoIcon} />
                                        <span className={styles.infoText}>
                                            現在の累積支出金 {formatYen(site.current_accumulated_cost)}
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* V3.3 cutover: 自分の役割とレベル の自己申告は LevelDraftSheet
                            (確認ベル経由) に移管。SiteDetailModal の levelDraft セクションは
                            Phase 6 で廃止。docs/REWARD_SYSTEM_V33.md §7. */}

                        {/* 添付ファイル */}
                        <div className={styles.attachmentsSection}>
                            <div className={styles.attachmentsHeader}>
                                <span className={styles.sectionLabel}>添付ファイル</span>
                            </div>

                            {loadingDocs ? (
                                <div className={styles.loadingDocs}>
                                    <Loader2 size={20} className={styles.spinner} />
                                </div>
                            ) : documents.length > 0 ? (
                                <div className={styles.thumbnailGrid}>
                                    {documents.map((doc) => {
                                        const url = getDocumentUrl(doc);
                                        return (
                                            <div
                                                key={doc.id}
                                                className={styles.thumbnail}
                                                onClick={() => url && window.open(url, "_blank")}
                                            >
                                                {isImageDoc(doc) && url ? (
                                                    <img
                                                        src={url}
                                                        alt={doc.original_filename || ""}
                                                        className={styles.thumbnailImage}
                                                    />
                                                ) : (
                                                    <div className={styles.thumbnailFile}>
                                                        <FileText size={24} />
                                                        <span className={styles.thumbnailFileName}>
                                                            {doc.original_filename || "ファイル"}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                    {/* アップロードボタン（グリッド内） */}
                                    <button
                                        className={styles.uploadButton}
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={uploading}
                                    >
                                        {uploading ? (
                                            <Loader2 size={24} />
                                        ) : (
                                            <Camera size={24} />
                                        )}
                                        <span className={styles.uploadLabel}>追加</span>
                                    </button>
                                </div>
                            ) : (
                                <div className={styles.emptyAttachments}>
                                    <button
                                        className={styles.uploadOnlyButton}
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={uploading}
                                    >
                                        {uploading ? (
                                            <Loader2 size={20} />
                                        ) : (
                                            <Camera size={20} />
                                        )}
                                        写真・ファイルを追加
                                    </button>
                                </div>
                            )}

                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*,application/pdf"
                                capture="environment"
                                className={styles.fileInput}
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) handleFileUpload(file);
                                    e.target.value = "";
                                }}
                            />
                        </div>

                        {/* エラー表示 */}
                        {error && (
                            <div style={{
                                padding: "12px",
                                background: "var(--md-sys-color-error-container)",
                                borderRadius: "var(--md-sys-shape-corner-small)",
                                color: "var(--md-sys-color-on-error-container)",
                                fontSize: "14px",
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                            }}>
                                <AlertTriangle size={16} />
                                {error}
                            </div>
                        )}
                    </div>

                    {/* ボトムアクション */}
                    <div className={styles.bottomActions}>
                        <button
                            className={styles.deleteButton}
                            onClick={() => setShowDeleteConfirm(true)}
                            aria-label="削除"
                        >
                            <Trash2 size={18} />
                        </button>
                        <button
                            className={styles.editButton}
                            onClick={() => setShowEditModal(true)}
                        >
                            <Pencil size={18} />
                            編集
                        </button>
                        {!isCompleted && !isTentative ? (
                            <button
                                className={styles.completeButton}
                                onClick={handleCompleteClick}
                            >
                                <CheckCircle2 size={18} />
                                完了にする
                            </button>
                        ) : site.completed_at ? (
                            <div className={styles.completedSummary}>
                                <div className={styles.completedDate}>
                                    完了: {new Date(site.completed_at).toLocaleDateString("ja-JP")}
                                </div>
                                <p className={styles.completionNote}>{buildCompletionNote(closePhase)}</p>
                                {rewardReturnHref && (
                                    <Link className={styles.rewardLinkButton} to={rewardReturnHref}>
                                        この月のPATH報酬を確認
                                    </Link>
                                )}
                            </div>
                        ) : null}
                    </div>
                </motion.div>
            </div>

            {/* 削除確認ダイアログ */}
            <AnimatePresence>
                {showDeleteConfirm && (
                    <div className={styles.overlay} onClick={() => setShowDeleteConfirm(false)} style={{ zIndex: 1002 }}>
                        <motion.div
                            className={styles.deleteDialog}
                            onClick={(e) => e.stopPropagation()}
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                        >
                            <h3 className={styles.deleteDialogTitle}>
                                <Trash2 size={20} />
                                現場を削除
                            </h3>
                            <p className={styles.deleteDialogDesc}>
                                「{site.name}」を削除します。削除理由を入力してください。
                            </p>
                            <textarea
                                className={styles.deleteReasonInput}
                                rows={3}
                                value={deleteReason}
                                onChange={(e) => setDeleteReason(e.target.value)}
                                placeholder="例: 受注キャンセル、重複登録 など"
                                autoFocus
                            />
                            <div className={styles.deleteDialogActions}>
                                <button
                                    className={styles.cancelDeleteButton}
                                    onClick={() => {
                                        setShowDeleteConfirm(false);
                                        setDeleteReason("");
                                    }}
                                >
                                    キャンセル
                                </button>
                                <button
                                    className={styles.confirmDeleteButton}
                                    onClick={handleDelete}
                                    disabled={deleting || !deleteReason.trim()}
                                >
                                    {deleting && <Loader2 size={16} />}
                                    削除する
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* 完了選択ダイアログ */}
            <AnimatePresence>
                {showCompleteChoice && (
                    <div className={styles.overlay} onClick={() => setShowCompleteChoice(false)} style={{ zIndex: 1002 }}>
                        <motion.div
                            className={styles.completeDialog}
                            onClick={(e) => e.stopPropagation()}
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                        >
                            <h3 className={styles.completeDialogTitle}>
                                <CheckCircle2 size={20} />
                                現場を完了
                            </h3>
                            <p className={styles.completeDialogDesc}>
                                工事項目が{lineItems.length}件登録されています。売上登録も一緒に行いますか？
                            </p>
                            <div className={styles.completeChoiceButtons}>
                                <button
                                    className={styles.completeWithSalesButton}
                                    onClick={handleCompleteWithSales}
                                >
                                    <TrendingUp size={18} />
                                    売上登録して完了
                                </button>
                                <button
                                    className={styles.completeOnlyButton}
                                    onClick={openCloseModal}
                                >
                                    そのまま締め入力へ
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* 売上登録モーダル（工事項目プリフィル） */}
            <AnimatePresence>
                {showSalesModal && (
                    <SalesModal
                        onClose={() => setShowSalesModal(false)}
                        onSuccess={handleSalesSuccess}
                        initialSiteId={site.id}
                        initialItems={lineItems.map((li) => ({
                            item_name: li.item_name,
                            quantity: li.quantity,
                            unit_name: li.unit_name || "",
                            unit_price: li.unit_price,
                        }))}
                        initialDescription={site.description}
                    />
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showCloseModal && (
                    <SiteCompleteWithCloseModal
                        site={site}
                        members={members}
                        initialRecognizedRevenue={closeDraftRevenue}
                        onClose={() => setShowCloseModal(false)}
                        onSuccess={handleCompleteWithCloseSuccess}
                    />
                )}
            </AnimatePresence>

            {/* 編集モーダル */}
            <AnimatePresence>
                {showEditModal && (
                    <SiteFormModal
                        site={site}
                        onClose={() => setShowEditModal(false)}
                        onSuccess={handleEditSuccess}
                    />
                )}
            </AnimatePresence>
        </>
    );
}

function buildCompleteWithCloseMessage(siteName: string, result: CompleteSiteWithCloseResult): string {
    if (result.close_auto_executed) {
        return `「${siteName}」を完了し、現場締めまで確定しました。`;
    }

    return `「${siteName}」を完了し、現場締め proposal を送信しました。`;
}

function buildCompletionNote(closePhase: Site["close_phase"]): string {
    switch (closePhase) {
        case "completed_close_executed":
            return "現場締めまで確定しています。変更が必要な場合は reopen / reverse の運用フローで戻します。";
        case "completed_close_pending":
            return "現場完了は記録済みです。現場締め proposal は承認待ちです。";
        case "completed_close_rejected":
            return "現場完了は記録済みです。現場締めは差し戻されています。管理導線から再送してください。";
        case "completed_unclosed":
            return "現場完了は記録済みですが、締めは未送信です。管理導線から現場締めを送ってください。";
        default:
            return "完了の取り消しは売上連動も巻き戻すため、通常画面には出していません。必要時は運用対応です。";
    }
}

function buildRewardReturnHref(site: Site, searchParams: URLSearchParams): string | null {
    const period =
        normalizeMonthValue(searchParams.get("period")) ||
        deriveRewardMonthFromSite(site);

    if (!period) {
        return null;
    }

    return buildMoneyRewardHref({
        period,
        site: site.id,
        member: searchParams.get("member"),
    });
}

function deriveRewardMonthFromSite(site: Site): string | null {
    return (
        normalizeMonthValue(site.completed_at) ||
        normalizeMonthValue(site.expected_completion_at) ||
        normalizeMonthValue(site.started_at)
    );
}

function normalizeMonthValue(value?: string | null): string | null {
    if (!value) {
        return null;
    }

    const directMatch = value.match(/^(\d{4})-(\d{2})$/);
    if (directMatch) {
        return directMatch[0];
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}`;
}
