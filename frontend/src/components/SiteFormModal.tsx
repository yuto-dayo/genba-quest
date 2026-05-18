import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { X, Loader2, AlertTriangle, Check, Plus, Trash2, Pencil, Receipt, Wand2, Paperclip, FileText } from "lucide-react";
import {
    createSite,
    updateSite,
    fetchClients,
    createClient,
    fetchMembers,
    fetchSiteLineItems,
    parseSiteDraftFromText,
    saveSiteLineItems,
    uploadSiteDocument,
    type Site,
    type Member,
    type SiteLineItem,
    type SiteDraftFromText,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import {
    normalizeDateList,
    normalizeSiteScheduleMode,
    normalizeWeekdays,
    SITE_SCHEDULE_MODE_OPTIONS,
    WEEKDAY_OPTIONS,
} from "../lib/siteSchedule";
import { ExpenseModal } from "./ExpenseModal";
import styles from "./SiteFormModal.module.css";

interface LineItemForm {
    key: string; // client-only key for React
    id?: string; // DB id (for existing items)
    item_name: string;
    quantity: string;
    unit_name: string;
    unit_price: string;
}

function createEmptyLineItem(): LineItemForm {
    return {
        key: crypto.randomUUID?.() || `li-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        item_name: "",
        quantity: "",
        unit_name: "",
        unit_price: "",
    };
}

function lineItemFromDb(item: SiteLineItem): LineItemForm {
    return {
        key: item.id,
        id: item.id,
        item_name: item.item_name,
        quantity: item.quantity != null ? String(item.quantity) : "",
        unit_name: item.unit_name || "",
        unit_price: item.unit_price != null ? String(item.unit_price) : "",
    };
}

function lineItemFromDraft(item: SiteDraftFromText["line_items"][number], index: number): LineItemForm {
    return {
        key: crypto.randomUUID?.() || `draft-li-${index}-${Date.now()}`,
        item_name: item.item_name,
        quantity: item.quantity != null ? String(item.quantity) : "",
        unit_name: item.unit_name || "",
        unit_price: item.unit_price != null ? String(item.unit_price) : "",
    };
}

function normalizeForMatch(value: string): string {
    return value.replace(/\s+/g, "").toLowerCase();
}

function findMatchingClientId(
    clientName: string | null | undefined,
    clients: Array<{ id: string; name: string }>
): string | null {
    if (!clientName) {
        return null;
    }

    const normalizedCandidate = normalizeForMatch(clientName);
    if (!normalizedCandidate) {
        return null;
    }

    const exact = clients.find((client) => normalizeForMatch(client.name) === normalizedCandidate);
    if (exact) {
        return exact.id;
    }

    const partial = clients.find((client) => {
        const normalizedClient = normalizeForMatch(client.name);
        return normalizedClient.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedClient);
    });

    return partial?.id || null;
}

function hasLineItemContent(item: LineItemForm | null): item is LineItemForm {
    if (!item) {
        return false;
    }

    return [item.item_name, item.quantity, item.unit_name, item.unit_price].some((value) =>
        value.trim()
    );
}

function parseNumericInput(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalNonNegativeIntegerInput(value: string): number | null | undefined {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < 0) {
        return undefined;
    }

    return parsed;
}

function formatYen(value: number): string {
    return `¥${Math.round(value).toLocaleString("ja-JP")}`;
}

function calculateLineItemSubtotal(item: LineItemForm): number | null {
    const quantity = parseNumericInput(item.quantity);
    const unitPrice = parseNumericInput(item.unit_price);

    if (quantity === null || unitPrice === null) {
        return null;
    }

    return quantity * unitPrice;
}

function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = typeof reader.result === "string" ? reader.result : "";
            const [, base64] = result.split(",");
            if (!base64) {
                reject(new Error("ファイルを読み込めませんでした"));
                return;
            }
            resolve(base64);
        };
        reader.onerror = () => reject(new Error("ファイルを読み込めませんでした"));
        reader.readAsDataURL(file);
    });
}

async function uploadSiteAttachments(siteId: string, files: File[]) {
    for (const file of files) {
        const fileBase64 = await readFileAsBase64(file);
        await uploadSiteDocument(siteId, {
            file_base64: fileBase64,
            mime_type: file.type || "application/octet-stream",
            original_filename: file.name,
        });
    }
}

interface SiteFormModalProps {
    site?: Site;
    initialAction?: "lineItem";
    initialStartedAt?: string;
    onClose: () => void;
    onSuccess: (created?: Site) => void | Promise<void>;
    readOnly?: boolean;
}

export function SiteFormModal({
    site,
    initialAction,
    initialStartedAt,
    onClose,
    onSuccess,
    readOnly = false,
}: SiteFormModalProps) {
    const isEdit = !!site;

    const [name, setName] = useState(site?.name || "");
    const [siteStatus, setSiteStatus] = useState<"active" | "tentative">(
        site?.status === "tentative" ? "tentative" : "active"
    );
    const [cautions, setCautions] = useState(site?.cautions || "");
    const [address, setAddress] = useState(site?.address || "");
    const [clientId, setClientId] = useState(site?.client_id || "");
    const [assignedUsers, setAssignedUsers] = useState<string[]>(site?.assigned_users || []);
    const [requiredWorkerCount, setRequiredWorkerCount] = useState(
        site?.required_worker_count == null ? "" : String(site.required_worker_count)
    );
    const [startedAt, setStartedAt] = useState(site?.started_at || initialStartedAt || "");
    const [expectedCompletionAt, setExpectedCompletionAt] = useState(site?.expected_completion_at || "");
    const [scheduleMode, setScheduleMode] = useState(normalizeSiteScheduleMode(site?.schedule_mode));
    const [workingWeekdays, setWorkingWeekdays] = useState<number[]>(
        normalizeWeekdays(site?.working_weekdays).length > 0
            ? normalizeWeekdays(site?.working_weekdays)
            : [1, 2, 3, 4, 5]
    );
    const [customWorkDates, setCustomWorkDates] = useState<string[]>(normalizeDateList(site?.custom_work_dates));
    const [customDateInput, setCustomDateInput] = useState("");
    const [lineItems, setLineItems] = useState<LineItemForm[]>([]);
    const [lineItemDraft, setLineItemDraft] = useState<LineItemForm | null>(null);
    const [lineItemsLoaded, setLineItemsLoaded] = useState(!isEdit);
    const [lineItemError, setLineItemError] = useState<string | null>(null);
    const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
    const [clientNameInput, setClientNameInput] = useState("");
    const [members, setMembers] = useState<Member[]>([]);
    const [draftText, setDraftText] = useState("");
    const [draftLoading, setDraftLoading] = useState(false);
    const [draftSummary, setDraftSummary] = useState<SiteDraftFromText | null>(null);
    const [draftClientName, setDraftClientName] = useState<string | null>(null);
    const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showExpenseModal, setShowExpenseModal] = useState(false);
    const [expenseSaved, setExpenseSaved] = useState(false);
    const attachmentInputRef = useRef<HTMLInputElement>(null);
    const lineItemsSectionRef = useRef<HTMLDivElement>(null);
    const initialActionHandledRef = useRef(false);
    const canEditStatus = !isEdit || site.status === "active" || site.status === "tentative";

    useEffect(() => {
        fetchClients()
            .then(setClients)
            .catch(() => {/* clients dropdown is optional */});
        fetchMembers()
            .then(setMembers)
            .catch(() => {/* members list is optional */});
        if (isEdit) {
            setLineItemsLoaded(false);
            fetchSiteLineItems(site.id)
                .then((items) => setLineItems(items.map(lineItemFromDb)))
                .catch(() => {})
                .finally(() => setLineItemsLoaded(true));
        }
    }, [isEdit, site?.id]);

    useEffect(() => {
        if (initialAction !== "lineItem" || initialActionHandledRef.current || !lineItemsLoaded) {
            return;
        }

        initialActionHandledRef.current = true;
        setLineItemDraft(createEmptyLineItem());
    }, [initialAction, lineItemsLoaded]);

    useEffect(() => {
        if (initialAction !== "lineItem" || !lineItemDraft) {
            return;
        }

        window.setTimeout(() => {
            lineItemsSectionRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
        }, 0);
    }, [initialAction, lineItemDraft]);

    const handleAddLineItem = () => {
        if (lineItemDraft) {
            return;
        }

        setError(null);
        setLineItemDraft(createEmptyLineItem());
        setLineItemError(null);
    };

    const handleRemoveLineItem = (key: string) => {
        if (lineItemDraft?.key === key) {
            setLineItemDraft(null);
            setLineItemError(null);
        }
        setLineItems((prev) => prev.filter((li) => li.key !== key));
    };

    const handleStartEditLineItem = (key: string) => {
        const target = lineItems.find((li) => li.key === key);
        if (!target) {
            return;
        }

        setError(null);
        setLineItemDraft({ ...target });
        setLineItemError(null);
    };

    const handleDraftLineItemChange = (
        field: keyof Omit<LineItemForm, "key" | "id">,
        value: string
    ) => {
        setLineItemDraft((prev) => (prev ? { ...prev, [field]: value } : prev));
        setLineItemError(null);
    };

    const handleCancelLineItemDraft = () => {
        setLineItemDraft(null);
        setLineItemError(null);
    };

    const handleSaveLineItemDraft = () => {
        if (!lineItemDraft) {
            return;
        }

        if (!lineItemDraft.item_name.trim()) {
            setLineItemError("工事名を入力してください");
            return;
        }

        const normalizedDraft: LineItemForm = {
            ...lineItemDraft,
            item_name: lineItemDraft.item_name.trim(),
            quantity: lineItemDraft.quantity.trim(),
            unit_name: lineItemDraft.unit_name.trim(),
            unit_price: lineItemDraft.unit_price.trim(),
        };

        setLineItems((prev) => {
            const existingIndex = prev.findIndex((li) => li.key === normalizedDraft.key);
            if (existingIndex >= 0) {
                return prev.map((li) => (li.key === normalizedDraft.key ? normalizedDraft : li));
            }

            return [...prev, normalizedDraft];
        });

        setError(null);
        setLineItemDraft(null);
        setLineItemError(null);
    };

    const toggleMember = (memberId: string) => {
        setAssignedUsers((prev) =>
            prev.includes(memberId)
                ? prev.filter((id) => id !== memberId)
                : [...prev, memberId]
        );
    };

    const toggleWeekday = (weekday: number) => {
        setWorkingWeekdays((prev) =>
            prev.includes(weekday)
                ? prev.filter((value) => value !== weekday)
                : [...prev, weekday].sort((a, b) => a - b)
        );
    };

    const handleAddCustomWorkDate = () => {
        if (!customDateInput) {
            return;
        }

        setCustomWorkDates((prev) => normalizeDateList([...prev, customDateInput]));
        setCustomDateInput("");
    };

    const handleRemoveCustomWorkDate = (date: string) => {
        setCustomWorkDates((prev) => prev.filter((value) => value !== date));
    };

    const applyDraftToForm = (draft: SiteDraftFromText) => {
        if (draft.name) {
            setName(draft.name);
        }
        if (draft.address) {
            setAddress(draft.address);
        }
        if (draft.started_at) {
            setStartedAt(draft.started_at);
        }
        if (draft.expected_completion_at) {
            setExpectedCompletionAt(draft.expected_completion_at);
        }
        if (draft.cautions) {
            setCautions(draft.cautions);
        }
        if (draft.schedule_mode) {
            setScheduleMode(draft.schedule_mode);
        }
        if (draft.working_weekdays && draft.working_weekdays.length > 0) {
            setWorkingWeekdays(draft.working_weekdays);
        }
        if (draft.line_items.length > 0) {
            setLineItems(draft.line_items.map(lineItemFromDraft));
            setLineItemDraft(null);
            setLineItemError(null);
        }

        const matchedClientId = findMatchingClientId(draft.client_name, clients);
        if (matchedClientId) {
            setClientId(matchedClientId);
            setClientNameInput("");
            setDraftClientName(null);
        } else {
            setClientNameInput(draft.client_name || "");
            setDraftClientName(draft.client_name || null);
        }
    };

    const resolveClientIdForSubmit = async (): Promise<string | undefined> => {
        const typedClientName = clientNameInput.trim();
        if (!typedClientName) {
            return clientId || undefined;
        }

        const matchedClientId = findMatchingClientId(typedClientName, clients);
        if (matchedClientId) {
            return matchedClientId;
        }

        const createdClient = await createClient({ name: typedClientName });
        setClients((prev) => [...prev, { id: createdClient.id, name: createdClient.name }]);
        setClientId(createdClient.id);
        setClientNameInput("");
        return createdClient.id;
    };

    const handleParseDraft = async () => {
        if (!draftText.trim()) {
            setError("現場内容の文章を入力してください");
            return;
        }

        try {
            setDraftLoading(true);
            setError(null);
            const draft = await parseSiteDraftFromText(draftText);
            applyDraftToForm(draft);
            setDraftSummary(draft);
        } catch (err: unknown) {
            setDraftSummary(null);
            setDraftClientName(null);
            setError(getErrorMessage(err));
        } finally {
            setDraftLoading(false);
        }
    };

    const handleAttachmentSelect = (files: FileList | null) => {
        const selectedFiles = Array.from(files || []);
        if (selectedFiles.length === 0) {
            return;
        }
        setError(null);
        setAttachmentFiles((prev) => [...prev, ...selectedFiles]);
    };

    const handleRemoveAttachment = (index: number) => {
        setAttachmentFiles((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (readOnly) {
            setError("過去月は閲覧専用です。修正は新しい月の逆仕訳で行います。");
            return;
        }
        if (!name.trim()) return;

        try {
            setSaving(true);
            setError(null);

            const normalizedRequiredWorkerCount =
                parseOptionalNonNegativeIntegerInput(requiredWorkerCount);
            if (normalizedRequiredWorkerCount === undefined) {
                setError("必要人数は0以上の整数で入力してください");
                return;
            }

            if (startedAt && expectedCompletionAt && startedAt > expectedCompletionAt) {
                setError("工期の開始日は完了予定日以前にしてください");
                return;
            }

            if (scheduleMode === "weekdays" && workingWeekdays.length === 0) {
                setError("曜日施工を選ぶ場合は、少なくとも1つ曜日を選択してください");
                return;
            }

            if (scheduleMode === "custom" && customWorkDates.length === 0) {
                setError("個別日施工を選ぶ場合は、施工日を1日以上追加してください");
                return;
            }

            if (scheduleMode === "continuous" && !startedAt && !expectedCompletionAt) {
                setError("連続施工の場合は開始日または完了予定日を設定してください");
                return;
            }

            let lineItemsToPersist = [...lineItems];

            if (hasLineItemContent(lineItemDraft)) {
                if (!lineItemDraft.item_name.trim()) {
                    setError("編集中の工事項目に工事名を入力するか、キャンセルしてください");
                    return;
                }

                const normalizedDraft: LineItemForm = {
                    ...lineItemDraft,
                    item_name: lineItemDraft.item_name.trim(),
                    quantity: lineItemDraft.quantity.trim(),
                    unit_name: lineItemDraft.unit_name.trim(),
                    unit_price: lineItemDraft.unit_price.trim(),
                };

                const existingIndex = lineItemsToPersist.findIndex((li) => li.key === normalizedDraft.key);
                if (existingIndex >= 0) {
                    lineItemsToPersist = lineItemsToPersist.map((li) =>
                        li.key === normalizedDraft.key ? normalizedDraft : li
                    );
                } else {
                    lineItemsToPersist = [...lineItemsToPersist, normalizedDraft];
                }
            }

            const resolvedClientId = await resolveClientIdForSubmit();

            const payload = {
                name: name.trim(),
                cautions: cautions.trim() || undefined,
                address: address.trim() || undefined,
                client_id: resolvedClientId,
                assigned_users: assignedUsers.length > 0 ? assignedUsers : undefined,
                required_worker_count: normalizedRequiredWorkerCount,
                started_at: startedAt || undefined,
                expected_completion_at: expectedCompletionAt || undefined,
                schedule_mode: scheduleMode,
                working_weekdays: scheduleMode === "weekdays" ? workingWeekdays : undefined,
                custom_work_dates: scheduleMode === "custom" ? customWorkDates : undefined,
                ...(canEditStatus ? { status: siteStatus } : {}),
            };

            // 有効な工事項目だけ抽出（名前が入っているもの）
            const validItems = lineItemsToPersist
                .filter((li) => li.item_name.trim())
                .map((li, index) => ({
                    ...(li.id ? { id: li.id } : {}),
                    item_name: li.item_name.trim(),
                    quantity: li.quantity ? Number(li.quantity) : null,
                    unit_name: li.unit_name.trim() || undefined,
                    unit_price: li.unit_price ? Number(li.unit_price) : null,
                    sort_order: index,
                }));

            if (isEdit) {
                await updateSite(site.id, payload);
                await saveSiteLineItems(site.id, validItems);
                await onSuccess();
            } else {
                const created = await createSite(payload);
                if (created?.id && validItems.length > 0) {
                    await saveSiteLineItems(created.id, validItems);
                }
                if (created?.id && attachmentFiles.length > 0) {
                    await uploadSiteAttachments(created.id, attachmentFiles);
                }
                await onSuccess(created);
            }
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    const handleExpenseSuccess = () => {
        setShowExpenseModal(false);
        setExpenseSaved(true);
    };

    return (
        <>
            <div className={styles.overlay} onClick={onClose}>
                <motion.div
                    className={styles.modal}
                    onClick={(e) => e.stopPropagation()}
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    role="dialog"
                    aria-modal="true"
                >
                <div className={styles.header}>
                    <h2 className={styles.title}>
                        {isEdit ? "現場を編集" : "新規現場"}
                    </h2>
                    <button
                        className={styles.closeButton}
                        onClick={onClose}
                        aria-label="閉じる"
                    >
                        <X size={20} />
                    </button>
                </div>

                {error && (
                    <div className={styles.error}>
                        <AlertTriangle size={16} />
                        {error}
                    </div>
                )}

                <form className={styles.form} onSubmit={handleSubmit}>
                    <fieldset
                        className={styles.readOnlyFieldset}
                        disabled={readOnly}
                        aria-disabled={readOnly ? "true" : undefined}
                    >
                    {!isEdit && (
                        <div className={styles.smartDraftCard}>
                            <div className={styles.smartDraftHeader}>
                                <div>
                                    <label className={styles.label}>
                                        <Wand2 size={14} />
                                        文章から自動入力
                                    </label>
                                    <p className={styles.smartDraftText}>
                                        お客さんから届いた文章や発注メモを貼ると、現場情報の下書きを作ります。
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    className={styles.smartDraftButton}
                                    onClick={handleParseDraft}
                                    disabled={draftLoading || !draftText.trim()}
                                >
                                    {draftLoading ? <Loader2 size={16} className={styles.spinner} /> : <Wand2 size={16} />}
                                    自動入力
                                </button>
                            </div>
                            <textarea
                                className={`${styles.textarea} ${styles.smartDraftTextarea}`}
                                rows={6}
                                value={draftText}
                                onChange={(e) => setDraftText(e.target.value)}
                                placeholder={"例:\n現場名: 渋谷オフィス改修工事\n元請: 株式会社GENBA\n住所: 東京都渋谷区...\n工期: 2026年4月20日〜2026年5月10日\n注意: 搬入は8時以降"}
                            />
                            <span className={styles.smartDraftHint}>
                                既に入力した値がある場合は、抽出結果で上書きされます。
                            </span>
                            {draftSummary && (
                                <div className={styles.smartDraftSummary}>
                                    <span>
                                        抽出精度の目安 {Math.round(draftSummary.confidence * 100)}%
                                    </span>
                                    <span>{draftSummary.detected_fields}項目を反映</span>
                                    {draftClientName && <span>取引先候補: {draftClientName}</span>}
                                </div>
                            )}
                        </div>
                    )}

                    {canEditStatus && (
                        <div className={styles.formGroup}>
                            <label className={styles.label}>登録状態</label>
                            <div className={styles.statusChoiceGrid}>
                                <button
                                    type="button"
                                    className={`${styles.statusChoiceCard} ${siteStatus === "active" ? styles.statusChoiceCardSelected : ""}`}
                                    onClick={() => setSiteStatus("active")}
                                >
                                    <strong>
                                        {siteStatus === "active" && <Check size={14} />}
                                        受注済み
                                    </strong>
                                    <span>日程と稼働に反映します</span>
                                </button>
                                <button
                                    type="button"
                                    className={`${styles.statusChoiceCard} ${siteStatus === "tentative" ? styles.statusChoiceCardSelected : ""}`}
                                    onClick={() => setSiteStatus("tentative")}
                                >
                                    <strong>
                                        {siteStatus === "tentative" && <Check size={14} />}
                                        仮押さえ
                                    </strong>
                                    <span>候補として残します</span>
                                </button>
                            </div>
                        </div>
                    )}

                    <div className={styles.formGroup}>
                        <label className={styles.label}>取引先</label>
                        {clients.length > 0 && (
                            <select
                                className={styles.select}
                                value={clientId}
                                onChange={(e) => {
                                    setClientId(e.target.value);
                                    setClientNameInput("");
                                    setDraftClientName(null);
                                }}
                            >
                                <option value="">選択してください</option>
                                {clients.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name}
                                    </option>
                                ))}
                            </select>
                        )}
                        <input
                            type="text"
                            className={styles.input}
                            value={clientNameInput}
                            onChange={(e) => {
                                setClientNameInput(e.target.value);
                                setDraftClientName(null);
                            }}
                            placeholder={clients.length > 0 ? "未登録の取引先名を入力" : "取引先名を入力"}
                        />
                        <span className={styles.scheduleHint}>
                            {clients.length > 0
                                ? "既存を選択するか、未登録名を入力すると保存時に取引先を追加します。"
                                : "取引先一覧が空です。ここに入力すると保存時に取引先を追加します。"}
                        </span>
                    </div>

                    <div className={styles.formGroup}>
                        <label className={styles.label}>
                            現場名 <span className={styles.required}>*</span>
                        </label>
                        <input
                            type="text"
                            className={styles.input}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="例: 田中邸新築工事"
                            required
                            autoFocus
                        />
                    </div>

                    <div className={styles.formGroup}>
                        <label className={styles.label}>住所</label>
                        <input
                            type="text"
                            className={styles.input}
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            placeholder="例: 東京都渋谷区..."
                        />
                    </div>

                    {/* 担当者 */}
                    {members.length > 0 && (
                        <div className={styles.formGroup}>
                            <label className={styles.label}>担当者</label>
                            <div className={styles.memberChips}>
                                {members.map((m) => {
                                    const selected = assignedUsers.includes(m.id);
                                    return (
                                        <button
                                            key={m.id}
                                            type="button"
                                            className={`${styles.memberChip} ${selected ? styles.memberChipSelected : ""}`}
                                            onClick={() => toggleMember(m.id)}
                                        >
                                            {selected && <Check size={14} />}
                                            {m.full_name || m.username || "?"}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <div className={styles.formGroup}>
                        <label className={styles.label}>必要人数</label>
                        <input
                            type="number"
                            inputMode="numeric"
                            min="0"
                            step="1"
                            className={styles.input}
                            value={requiredWorkerCount}
                            onChange={(e) => setRequiredWorkerCount(e.target.value)}
                            placeholder="未設定"
                        />
                        <span className={styles.scheduleHint}>
                            未設定の現場はスケジュールの不足計算から外れます。
                        </span>
                    </div>

                    {/* 工期 */}
                    <div className={styles.formGroup}>
                        <label className={styles.label}>工期（全体期間）</label>
                        <div className={styles.dateRange}>
                            <input
                                type="date"
                                className={styles.input}
                                value={startedAt}
                                onChange={(e) => setStartedAt(e.target.value)}
                            />
                            <span className={styles.dateSeparator}>〜</span>
                            <input
                                type="date"
                                className={styles.input}
                                value={expectedCompletionAt}
                                onChange={(e) => setExpectedCompletionAt(e.target.value)}
                            />
                        </div>
                        <span className={styles.scheduleHint}>
                            見積や全体管理に使う期間です。飛び飛び施工は下の施工パターンで設定できます。
                        </span>
                    </div>

                    <div className={styles.formGroup}>
                        <label className={styles.label}>施工パターン</label>
                        <div className={styles.scheduleModeGrid}>
                            {SITE_SCHEDULE_MODE_OPTIONS.map((option) => {
                                const selected = scheduleMode === option.value;
                                return (
                                    <button
                                        key={option.value}
                                        type="button"
                                        className={`${styles.scheduleModeCard} ${selected ? styles.scheduleModeCardSelected : ""}`}
                                        onClick={() => setScheduleMode(option.value)}
                                    >
                                        <strong>{option.label}</strong>
                                        <span>{option.description}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {scheduleMode === "weekdays" && (
                        <div className={styles.formGroup}>
                            <label className={styles.label}>施工曜日</label>
                            <div className={styles.weekdayChips}>
                                {WEEKDAY_OPTIONS.map((option) => {
                                    const selected = workingWeekdays.includes(option.value);
                                    return (
                                        <button
                                            key={option.value}
                                            type="button"
                                            className={`${styles.weekdayChip} ${selected ? styles.weekdayChipSelected : ""}`}
                                            onClick={() => toggleWeekday(option.value)}
                                        >
                                            {option.shortLabel}
                                        </button>
                                    );
                                })}
                            </div>
                            <span className={styles.scheduleHint}>
                                期間内のうち、選んだ曜日だけカレンダーに自動表示します。
                            </span>
                        </div>
                    )}

                    {scheduleMode === "custom" && (
                        <div className={styles.formGroup}>
                            <label className={styles.label}>施工日</label>
                            <div className={styles.customDateRow}>
                                <input
                                    type="date"
                                    className={styles.input}
                                    value={customDateInput}
                                    onChange={(e) => setCustomDateInput(e.target.value)}
                                />
                                <button
                                    type="button"
                                    className={styles.addCustomDateButton}
                                    onClick={handleAddCustomWorkDate}
                                    disabled={!customDateInput}
                                >
                                    <Plus size={14} />
                                    追加
                                </button>
                            </div>
                            {customWorkDates.length > 0 && (
                                <div className={styles.customDateList}>
                                    {customWorkDates.map((date) => (
                                        <span key={date} className={styles.customDateChip}>
                                            {new Date(`${date}T00:00:00`).toLocaleDateString("ja-JP", {
                                                month: "short",
                                                day: "numeric",
                                            })}
                                            <button
                                                type="button"
                                                className={styles.customDateChipRemove}
                                                onClick={() => handleRemoveCustomWorkDate(date)}
                                                aria-label={`${date} を削除`}
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            )}
                            <span className={styles.scheduleHint}>
                                日にちを空ける現場は、実際に入る日だけ登録してください。
                            </span>
                        </div>
                    )}

                    {!isEdit && (
                        <div className={styles.attachmentSection}>
                            <div className={styles.attachmentHeader}>
                                <div>
                                    <label className={styles.label}>
                                        <Paperclip size={14} />
                                        添付
                                    </label>
                                    <p className={styles.attachmentText}>
                                        発注書や見積メモを一緒に残せます。
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    className={styles.attachmentButton}
                                    onClick={() => attachmentInputRef.current?.click()}
                                >
                                    <Paperclip size={16} />
                                    追加
                                </button>
                            </div>
                            {attachmentFiles.length > 0 ? (
                                <div className={styles.attachmentList}>
                                    {attachmentFiles.map((file, index) => (
                                        <div key={`${file.name}-${file.size}-${index}`} className={styles.attachmentItem}>
                                            <FileText size={16} />
                                            <span className={styles.attachmentName}>{file.name}</span>
                                            <span className={styles.attachmentSize}>
                                                {Math.max(1, Math.round(file.size / 1024)).toLocaleString("ja-JP")}KB
                                            </span>
                                            <button
                                                type="button"
                                                className={styles.attachmentRemoveButton}
                                                onClick={() => handleRemoveAttachment(index)}
                                                aria-label={`${file.name}を外す`}
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    className={styles.attachmentEmptyButton}
                                    onClick={() => attachmentInputRef.current?.click()}
                                >
                                    <Paperclip size={16} />
                                    ファイルを添付
                                </button>
                            )}
                            <input
                                ref={attachmentInputRef}
                                type="file"
                                accept="image/*,application/pdf"
                                multiple
                                className={styles.fileInput}
                                onChange={(event) => {
                                    handleAttachmentSelect(event.target.files);
                                    event.target.value = "";
                                }}
                            />
                        </div>
                    )}

                    <div className={styles.expenseShortcutSection}>
                        <div className={styles.expenseShortcutHeader}>
                            <div>
                                <label className={styles.label}>現場雑費</label>
                                <p className={styles.expenseShortcutText}>
                                    駐車場代や高速代などの雑費は、現場にひも付けた経費としてここから登録できます。
                                </p>
                            </div>
                            <button
                                type="button"
                                className={styles.expenseShortcutButton}
                                onClick={() => {
                                    setExpenseSaved(false);
                                    setShowExpenseModal(true);
                                }}
                                disabled={!isEdit}
                            >
                                <Receipt size={16} />
                                雑費を登録
                            </button>
                        </div>
                        {!isEdit && (
                            <span className={styles.expenseShortcutHint}>
                                新規現場は作成後に雑費登録できます。
                            </span>
                        )}
                        {expenseSaved && (
                            <span className={styles.expenseShortcutSuccess}>
                                現場にひも付く雑費を登録しました。
                            </span>
                        )}
                    </div>

                    {/* 工事項目 */}
                    <div className={styles.lineItemsSection} ref={lineItemsSectionRef}>
                        <div className={styles.lineItemsHeader}>
                            <label className={styles.label}>工事項目</label>
                            <button
                                type="button"
                                className={styles.addLineItemButton}
                                onClick={handleAddLineItem}
                                disabled={lineItemDraft !== null}
                            >
                                <Plus size={14} />
                                追加
                            </button>
                        </div>
                        {lineItems.length === 0 && !lineItemDraft ? (
                            <button
                                type="button"
                                className={styles.addLineItemEmpty}
                                onClick={handleAddLineItem}
                            >
                                <Plus size={16} />
                                工事項目を追加（任意）
                            </button>
                        ) : null}

                        {lineItems.length > 0 && (
                            <div className={styles.lineItemsList}>
                                <div className={styles.lineItemListHeader} aria-hidden="true">
                                    <span>工事名</span>
                                    <div className={styles.headerMetrics}>
                                        <span>数量</span>
                                        <span>単位</span>
                                        <span>単価</span>
                                    </div>
                                    <span>操作</span>
                                </div>
                                {lineItems.map((li, index) => (
                                    <div key={li.key} className={styles.lineItemRowCard}>
                                        <div className={styles.lineItemCellPrimary}>
                                            <span className={styles.lineItemIndex}>{index + 1}</span>
                                            <strong className={styles.lineItemSummaryTitle}>
                                                {li.item_name}
                                            </strong>
                                            {calculateLineItemSubtotal(li) !== null && (
                                                <span className={styles.lineItemSummaryMeta}>
                                                    小計 {formatYen(calculateLineItemSubtotal(li) as number)}
                                                </span>
                                            )}
                                        </div>
                                        <div className={styles.lineItemMetrics}>
                                            <div className={styles.lineItemCell}>
                                                <span className={styles.mobileLabel}>数量</span>
                                                <span className={styles.cellValue}>{li.quantity.trim() || "-"}</span>
                                            </div>
                                            <div className={styles.lineItemCell}>
                                                <span className={styles.mobileLabel}>単位</span>
                                                <span className={styles.cellValue}>{li.unit_name.trim() || "-"}</span>
                                            </div>
                                            <div className={styles.lineItemCell}>
                                                <span className={styles.mobileLabel}>単価</span>
                                                <span className={styles.cellValue}>{parseNumericInput(li.unit_price) !== null
                                                    ? formatYen(parseNumericInput(li.unit_price) as number)
                                                    : "-"}</span>
                                            </div>
                                        </div>
                                        <div className={styles.lineItemSummaryActions}>
                                            <button
                                                type="button"
                                                className={styles.editLineItemButton}
                                                onClick={() => handleStartEditLineItem(li.key)}
                                                disabled={lineItemDraft !== null}
                                            >
                                                <Pencil size={14} />
                                                編集
                                            </button>
                                            <button
                                                type="button"
                                                className={styles.removeLineItemButton}
                                                onClick={() => handleRemoveLineItem(li.key)}
                                                aria-label={`項目${index + 1}を削除`}
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {lineItemDraft && (
                            <div className={styles.lineItemEditor}>
                                <div className={styles.lineItemEditorHeader}>
                                    <div className={styles.lineItemEditorHeading}>
                                        <span className={styles.lineItemEditorEyebrow}>
                                            {lineItems.some((li) => li.key === lineItemDraft.key)
                                                ? "編集中"
                                                : "新規項目"}
                                        </span>
                                        <strong className={styles.lineItemEditorTitle}>
                                            {lineItems.some((li) => li.key === lineItemDraft.key)
                                                ? lineItemDraft.item_name || "工事項目を編集"
                                                : "工事項目を追加"}
                                        </strong>
                                    </div>
                                </div>

                                <div className={styles.formGroup}>
                                    <label className={styles.lineItemFieldLabel}>工事名</label>
                                    <input
                                        type="text"
                                        className={styles.input}
                                        value={lineItemDraft.item_name}
                                        onChange={(e) => handleDraftLineItemChange("item_name", e.target.value)}
                                        placeholder="工事名（例: 床工事）"
                                    />
                                </div>

                                <div className={styles.lineItemGrid}>
                                    <div className={styles.formGroup}>
                                        <label className={styles.lineItemFieldLabel}>数量</label>
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            min="0"
                                            step="0.01"
                                            className={styles.input}
                                            value={lineItemDraft.quantity}
                                            onChange={(e) => handleDraftLineItemChange("quantity", e.target.value)}
                                            placeholder="1"
                                        />
                                    </div>
                                    <div className={styles.formGroup}>
                                        <label className={styles.lineItemFieldLabel}>単位</label>
                                        <input
                                            type="text"
                                            className={styles.input}
                                            value={lineItemDraft.unit_name}
                                            onChange={(e) => handleDraftLineItemChange("unit_name", e.target.value)}
                                            placeholder="人工 / ㎡ / 式"
                                        />
                                    </div>
                                    <div className={`${styles.formGroup} ${styles.lineItemWideField}`}>
                                        <label className={styles.lineItemFieldLabel}>単価</label>
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            min="0"
                                            step="1"
                                            className={styles.input}
                                            value={lineItemDraft.unit_price}
                                            onChange={(e) => handleDraftLineItemChange("unit_price", e.target.value)}
                                            placeholder="0"
                                        />
                                    </div>
                                </div>

                                {lineItemError && (
                                    <div className={styles.lineItemDraftError}>
                                        <AlertTriangle size={14} />
                                        {lineItemError}
                                    </div>
                                )}

                                <div className={styles.lineItemEditorActions}>
                                    <button
                                        type="button"
                                        className={styles.cancelDraftButton}
                                        onClick={handleCancelLineItemDraft}
                                    >
                                        キャンセル
                                    </button>
                                    <button
                                        type="button"
                                        className={styles.saveDraftButton}
                                        onClick={handleSaveLineItemDraft}
                                    >
                                        {lineItems.some((li) => li.key === lineItemDraft.key)
                                            ? "この項目を更新"
                                            : "この項目を追加"}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className={styles.formGroup}>
                        <label className={styles.label}>
                            <AlertTriangle size={14} />
                            注意事項
                        </label>
                        <textarea
                            className={`${styles.textarea} ${styles.cautionTextarea}`}
                            rows={3}
                            value={cautions}
                            onChange={(e) => setCautions(e.target.value)}
                            placeholder="安全上の注意点、特記事項など"
                        />
                        <span className={styles.cautionHint}>
                            <AlertTriangle size={12} />
                            安全に関わる情報は必ず記載してください
                        </span>
                    </div>

                    </fieldset>

                    <div className={styles.formActions}>
                        <button
                            type="button"
                            className={styles.cancelButton}
                            onClick={onClose}
                        >
                            キャンセル
                        </button>
                        <button
                            type="submit"
                            className={styles.submitButton}
                            disabled={readOnly || saving || !name.trim()}
                            aria-disabled={readOnly || saving || !name.trim() ? "true" : undefined}
                        >
                            {saving ? (
                                <Loader2 size={18} className={styles.spinner} />
                            ) : null}
                            {isEdit ? "保存" : "作成"}
                        </button>
                    </div>
                </form>
                </motion.div>
            </div>
            {site && (
                <ExpenseModal
                    open={showExpenseModal}
                    onClose={() => setShowExpenseModal(false)}
                    onSuccess={handleExpenseSuccess}
                    initialSiteId={site.id}
                    initialCategory="other"
                    initialTaxCategory="00_TAXFREE"
                />
            )}
        </>
    );
}
