import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ChevronDown, ChevronUp, CircleCheck, MessageSquare, UserCircle2, X } from "lucide-react";
import {
    addCommunicationLog,
    createCommunicationConversation,
    fetchMembers,
    fetchSites,
    updateCommunicationConversation,
    type CommunicationChannel,
    type CommunicationConversationRecord,
    type CommunicationDirection,
    type Member,
    type Site,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import styles from "./CommunicationRecordSheet.module.css";

export type RecordTargetKind = "follow_up" | "new_topic";

export type RecordDraft = {
    targetKind: RecordTargetKind;
    conversationId?: string;
    partnerName?: string;
    partnerEmail?: string;
    topicTitle?: string;
    body: string;
    channel: Exclude<CommunicationChannel, "system">;
    direction: CommunicationDirection;
    ownerId?: string;
    nextAction?: string;
    dueDate?: string;
    siteId?: string;
    dirtyMeta: boolean;
};

type ContactSeed = {
    partnerName?: string | null;
    partnerEmail?: string | null;
    clientName?: string | null;
};

type MetaRetryState = {
    conversationId: string;
    payload: {
        assignee_user_id?: string | null;
        site_id?: string | null;
        next_action?: string | null;
        next_action_due_date?: string | null;
    };
};

type BannerState =
    | {
          tone: "success" | "warning" | "error";
          message: string;
      }
    | null;

export interface CommunicationRecordSheetSaveResult {
    contactKey: string | null;
    conversationId: string | null;
}

interface CommunicationRecordSheetProps {
    open: boolean;
    onClose: () => void;
    initialTargetKind?: RecordTargetKind;
    activeConversationSummary?: CommunicationConversationRecord | null;
    contactSeed?: ContactSeed;
    availableMembers?: Member[];
    availableSites?: Site[];
    onSaved?: (result: CommunicationRecordSheetSaveResult) => Promise<void> | void;
    onRequestPickContext?: () => void;
}

function formatDateOnly(value?: string | null): string {
    if (!value) {
        return "未設定";
    }

    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleDateString("ja-JP", {
        month: "2-digit",
        day: "2-digit",
    });
}

function normalizeKeyPart(value?: string | null): string {
    return (value || "")
        .toLowerCase()
        .normalize("NFKC")
        .replace(/\s+/g, " ")
        .trim();
}

function buildContactKey(name?: string | null, email?: string | null, clientName?: string | null): string | null {
    const normalizedEmail = normalizeKeyPart(email);
    if (normalizedEmail) {
        return normalizedEmail;
    }

    const candidate = [normalizeKeyPart(name), normalizeKeyPart(clientName)].filter(Boolean).join("--");
    return candidate || null;
}

function getDefaultChannel(activeConversation?: CommunicationRecordSheetProps["activeConversationSummary"]) {
    if (activeConversation?.last_channel && activeConversation.last_channel !== "system") {
        return activeConversation.last_channel;
    }

    return "phone";
}

function getDefaultDirection(targetKind: RecordTargetKind): CommunicationDirection {
    return targetKind === "follow_up" ? "internal" : "inbound";
}

function getMetaBaseline(activeConversation?: CommunicationRecordSheetProps["activeConversationSummary"] | null) {
    return {
        ownerId: activeConversation?.assignee?.id || "",
        nextAction: activeConversation?.next_action || "",
        dueDate: activeConversation?.next_action_due_date || "",
        siteId: activeConversation?.site?.id || "",
    };
}

function buildInitialDraft({
    targetKind,
    activeConversation,
    contactSeed,
}: {
    targetKind: RecordTargetKind;
    activeConversation?: CommunicationConversationRecord | null;
    contactSeed?: ContactSeed;
}): RecordDraft {
    const baseline = getMetaBaseline(activeConversation);

    return {
        targetKind,
        conversationId: targetKind === "follow_up" ? activeConversation?.id : undefined,
        partnerName: contactSeed?.partnerName || "",
        partnerEmail: contactSeed?.partnerEmail || "",
        topicTitle: "",
        body: "",
        channel: getDefaultChannel(activeConversation),
        direction: getDefaultDirection(targetKind),
        ownerId: baseline.ownerId,
        nextAction: baseline.nextAction,
        dueDate: baseline.dueDate,
        siteId: baseline.siteId,
        dirtyMeta: false,
    };
}

function buildMetaPayload(draft: RecordDraft) {
    return {
        assignee_user_id: draft.ownerId || null,
        site_id: draft.siteId || null,
        next_action: draft.nextAction || null,
        next_action_due_date: draft.dueDate || null,
    };
}

function generateTopicTitle(draft: RecordDraft): string {
    if (draft.topicTitle?.trim()) {
        return draft.topicTitle.trim();
    }

    const normalizedBody = draft.body.trim().replace(/\s+/g, " ");
    if (normalizedBody) {
        return normalizedBody.slice(0, 28);
    }

    const channelLabel =
        draft.channel === "phone"
            ? "電話"
            : draft.channel === "line"
              ? "LINE"
              : draft.channel === "gmail"
                ? "メール"
                : draft.channel === "in_person"
                  ? "対面"
                  : draft.channel === "sms"
                    ? "SMS"
                    : "連絡";
    const dateLabel = new Date().toLocaleDateString("ja-JP", { month: "2-digit", day: "2-digit" });
    return `${dateLabel} ${channelLabel}の記録`;
}

function hasDraftContent(draft: RecordDraft) {
    return Boolean(
        draft.body.trim() ||
            draft.topicTitle?.trim() ||
            draft.dirtyMeta,
    );
}

export function CommunicationRecordSheet({
    open,
    onClose,
    initialTargetKind = "new_topic",
    activeConversationSummary = null,
    contactSeed,
    availableMembers,
    availableSites,
    onSaved,
    onRequestPickContext,
}: CommunicationRecordSheetProps) {
    const fallbackTargetKind: RecordTargetKind = activeConversationSummary ? "follow_up" : initialTargetKind;
    const [draft, setDraft] = useState<RecordDraft>(() =>
        buildInitialDraft({
            targetKind: fallbackTargetKind,
            activeConversation: activeConversationSummary,
            contactSeed,
        }),
    );
    const [targetPickerOpen, setTargetPickerOpen] = useState(false);
    const [metaOpen, setMetaOpen] = useState(false);
    const [banner, setBanner] = useState<BannerState>(null);
    const [saving, setSaving] = useState(false);
    const [retryingMeta, setRetryingMeta] = useState(false);
    const [metaRetryState, setMetaRetryState] = useState<MetaRetryState | null>(null);
    const [fetchedMembers, setFetchedMembers] = useState<Member[]>([]);
    const [fetchedSites, setFetchedSites] = useState<Site[]>([]);
    const [referenceLoadError, setReferenceLoadError] = useState<string | null>(null);
    const bodyRef = useRef<HTMLTextAreaElement | null>(null);

    const members = availableMembers ?? fetchedMembers;
    const sites = availableSites ?? fetchedSites;
    const metaBaseline = useMemo(() => getMetaBaseline(activeConversationSummary), [activeConversationSummary]);
    const draftHasContent = hasDraftContent(draft);

    useEffect(() => {
        if (!open) {
            return;
        }

        const timerId = window.setTimeout(() => {
            bodyRef.current?.focus();
        }, 0);

        return () => window.clearTimeout(timerId);
    }, [open]);

    useEffect(() => {
        if (!open || (availableMembers && availableSites)) {
            return;
        }

        let cancelled = false;
        void Promise.all([
            availableMembers ? Promise.resolve(availableMembers) : fetchMembers(),
            availableSites ? Promise.resolve(availableSites) : fetchSites(),
        ])
            .then(([memberData, siteData]) => {
                if (cancelled) {
                    return;
                }

                if (!availableMembers) {
                    setFetchedMembers(memberData);
                }
                if (!availableSites) {
                    setFetchedSites(siteData);
                }
                setReferenceLoadError(null);
            })
            .catch((requestError) => {
                if (cancelled) {
                    return;
                }

                setReferenceLoadError(getErrorMessage(requestError));
            });

        return () => {
            cancelled = true;
        };
    }, [availableMembers, availableSites, open]);

    useEffect(() => {
        if (!draftHasContent) {
            setDraft(
                buildInitialDraft({
                    targetKind: activeConversationSummary ? "follow_up" : initialTargetKind,
                    activeConversation: activeConversationSummary,
                    contactSeed,
                }),
            );
        }
    }, [
        activeConversationSummary,
        contactSeed,
        contactSeed?.clientName,
        contactSeed?.partnerEmail,
        contactSeed?.partnerName,
        initialTargetKind,
        draft.body,
        draft.topicTitle,
        draft.dirtyMeta,
        draft.direction,
        draft.channel,
        draft.ownerId,
        draft.nextAction,
        draft.dueDate,
        draft.siteId,
        draft.partnerName,
        draft.partnerEmail,
        draftHasContent,
    ]);

    const saveTargetLabel =
        draft.targetKind === "follow_up"
            ? activeConversationSummary
                ? `今の話の続き（${activeConversationSummary.title}）`
                : "今の話の続き（未選択）"
            : "別の話として記録";

    const metaSummary = [
        draft.ownerId
            ? `担当: ${
                  members.find((member) => member.id === draft.ownerId)?.full_name ||
                  members.find((member) => member.id === draft.ownerId)?.username ||
                  "担当あり"
              }`
            : "担当: 未設定",
        draft.nextAction?.trim() ? `次: ${draft.nextAction.trim()}` : "次: 未設定",
        draft.dueDate ? `期限: ${formatDateOnly(draft.dueDate)}` : "期限: 未設定",
    ].join(" / ");

    function updateDraft(next: Partial<RecordDraft>) {
        setDraft((current) => {
            const merged = { ...current, ...next };
            const baseline =
                merged.targetKind === "follow_up"
                    ? metaBaseline
                    : {
                          ownerId: "",
                          nextAction: "",
                          dueDate: "",
                          siteId: "",
                      };

            return {
                ...merged,
                dirtyMeta:
                    (merged.ownerId || "") !== baseline.ownerId ||
                    (merged.nextAction || "") !== baseline.nextAction ||
                    (merged.dueDate || "") !== baseline.dueDate ||
                    (merged.siteId || "") !== baseline.siteId,
            };
        });
    }

    function switchTargetKind(nextTargetKind: RecordTargetKind) {
        setDraft((current) => {
            const nextMeta =
                current.dirtyMeta
                    ? {
                          ownerId: current.ownerId || "",
                          nextAction: current.nextAction || "",
                          dueDate: current.dueDate || "",
                          siteId: current.siteId || "",
                      }
                    : nextTargetKind === "follow_up"
                      ? metaBaseline
                      : {
                            ownerId: "",
                            nextAction: "",
                            dueDate: "",
                            siteId: "",
                        };

            const nextDraft: RecordDraft = {
                ...current,
                targetKind: nextTargetKind,
                conversationId: nextTargetKind === "follow_up" ? activeConversationSummary?.id : undefined,
                direction:
                    current.body.trim().length > 0 || current.topicTitle?.trim()
                        ? current.direction
                        : getDefaultDirection(nextTargetKind),
                channel: current.channel || getDefaultChannel(activeConversationSummary),
                ownerId: nextMeta.ownerId,
                nextAction: nextMeta.nextAction,
                dueDate: nextMeta.dueDate,
                siteId: nextMeta.siteId,
            };

            const baseline =
                nextTargetKind === "follow_up"
                    ? metaBaseline
                    : {
                          ownerId: "",
                          nextAction: "",
                          dueDate: "",
                          siteId: "",
                      };

            nextDraft.dirtyMeta =
                (nextDraft.ownerId || "") !== baseline.ownerId ||
                (nextDraft.nextAction || "") !== baseline.nextAction ||
                (nextDraft.dueDate || "") !== baseline.dueDate ||
                (nextDraft.siteId || "") !== baseline.siteId;

            return nextDraft;
        });
        setTargetPickerOpen(false);
        setBanner(null);
    }

    async function notifySaved(result: CommunicationRecordSheetSaveResult) {
        if (!onSaved) {
            return;
        }

        try {
            await onSaved(result);
        } catch (requestError) {
            console.error("communication record saved but follow-up refresh failed:", requestError);
        }
    }

    function resetAfterSave(nextTargetKind: RecordTargetKind) {
        setDraft((current) => {
            const baseline =
                nextTargetKind === "follow_up"
                    ? {
                          ownerId: current.ownerId || "",
                          nextAction: current.nextAction || "",
                          dueDate: current.dueDate || "",
                          siteId: current.siteId || "",
                      }
                    : {
                          ownerId: "",
                          nextAction: "",
                          dueDate: "",
                          siteId: "",
                      };

            return {
                ...current,
                targetKind: nextTargetKind,
                conversationId: nextTargetKind === "follow_up" ? current.conversationId : undefined,
                topicTitle: "",
                body: "",
                dirtyMeta:
                    (current.ownerId || "") !== baseline.ownerId ||
                    (current.nextAction || "") !== baseline.nextAction ||
                    (current.dueDate || "") !== baseline.dueDate ||
                    (current.siteId || "") !== baseline.siteId,
            };
        });
        setMetaRetryState(null);
    }

    async function retryMetaUpdate() {
        if (!metaRetryState) {
            return;
        }

        try {
            setRetryingMeta(true);
            await updateCommunicationConversation(metaRetryState.conversationId, metaRetryState.payload);
            setMetaRetryState(null);
            setDraft((current) => ({ ...current, dirtyMeta: false }));
            setBanner({ tone: "success", message: "担当と次の動きを更新しました。" });
            await notifySaved({
                contactKey: buildContactKey(draft.partnerName, draft.partnerEmail, contactSeed?.clientName),
                conversationId: metaRetryState.conversationId,
            });
        } catch (requestError) {
            setBanner({ tone: "error", message: getErrorMessage(requestError) });
        } finally {
            setRetryingMeta(false);
        }
    }

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        if (!draft.body.trim()) {
            setBanner({ tone: "error", message: "やりとり内容を入れてください。" });
            return;
        }

        setBanner(null);

        if (draft.targetKind === "follow_up") {
            const conversationId = draft.conversationId || activeConversationSummary?.id;
            if (!conversationId) {
                setBanner({ tone: "error", message: "続きとして記録する話を選んでください。" });
                return;
            }

            try {
                setSaving(true);
                await addCommunicationLog(conversationId, {
                    channel: draft.channel,
                    direction: draft.direction,
                    body: draft.body.trim(),
                    participant_name: draft.partnerName || null,
                    participant_email: draft.partnerEmail || null,
                    log_kind: "note",
                });

                if (draft.dirtyMeta) {
                    const payload = buildMetaPayload(draft);
                    try {
                        await updateCommunicationConversation(conversationId, payload);
                        await notifySaved({
                            contactKey: buildContactKey(
                                draft.partnerName,
                                draft.partnerEmail,
                                activeConversationSummary?.client_name || contactSeed?.clientName,
                            ),
                            conversationId,
                        });
                        setBanner({ tone: "success", message: "連絡を記録しました。" });
                        resetAfterSave("follow_up");
                    } catch {
                        setMetaRetryState({ conversationId, payload });
                        setDraft((current) => ({ ...current, body: "" }));
                        await notifySaved({
                            contactKey: buildContactKey(
                                draft.partnerName,
                                draft.partnerEmail,
                                activeConversationSummary?.client_name || contactSeed?.clientName,
                            ),
                            conversationId,
                        });
                        setBanner({
                            tone: "warning",
                            message: "連絡は記録しました。担当と次の動きの更新だけ失敗しました。",
                        });
                    }
                } else {
                    await notifySaved({
                        contactKey: buildContactKey(
                            draft.partnerName,
                            draft.partnerEmail,
                            activeConversationSummary?.client_name || contactSeed?.clientName,
                        ),
                        conversationId,
                    });
                    setBanner({ tone: "success", message: "連絡を記録しました。" });
                    resetAfterSave("follow_up");
                }
            } catch (requestError) {
                setBanner({ tone: "error", message: getErrorMessage(requestError) });
            } finally {
                setSaving(false);
            }

            return;
        }

        try {
            setSaving(true);
            const created = await createCommunicationConversation({
                title: generateTopicTitle(draft),
                channel: draft.channel,
                direction: draft.direction,
                body: draft.body.trim(),
                assignee_user_id: draft.ownerId || null,
                site_id: draft.siteId || null,
                next_action: draft.nextAction || null,
                next_action_due_date: draft.dueDate || null,
                participant_name: draft.partnerName || null,
                participant_email: draft.partnerEmail || null,
                log_kind: "message",
            });

            await notifySaved({
                contactKey: buildContactKey(
                    draft.partnerName,
                    draft.partnerEmail,
                    created.conversation.client_name || contactSeed?.clientName,
                ),
                conversationId: created.conversation.id,
            });

            setBanner({ tone: "success", message: "連絡を記録しました。" });
            setDraft(
                buildInitialDraft({
                    targetKind: "new_topic",
                    activeConversation: null,
                    contactSeed,
                }),
            );
        } catch (requestError) {
            setBanner({ tone: "error", message: getErrorMessage(requestError) });
        } finally {
            setSaving(false);
        }
    }

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className={styles.overlay}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                >
                    <motion.section
                        className={styles.sheet}
                        initial={{ opacity: 0, y: 18 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 18 }}
                        transition={{ duration: 0.18, ease: "easeOut" }}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="communication-record-sheet-title"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className={styles.header}>
                            <div className={styles.heading}>
                                <h2 id="communication-record-sheet-title">連絡を記録</h2>
                                <p>今あったやりとりを先に残して、必要なら担当と次の動きも整えます。</p>
                            </div>
                            <button
                                type="button"
                                className={styles.closeButton}
                                onClick={onClose}
                                aria-label="閉じる"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <form className={styles.form} onSubmit={handleSubmit}>
                            {banner && (
                                <div
                                    className={`${styles.banner} ${
                                        banner.tone === "success"
                                            ? styles.bannerSuccess
                                            : banner.tone === "warning"
                                              ? styles.bannerWarning
                                              : styles.bannerError
                                    }`}
                                >
                                    {banner.tone === "success" ? <CircleCheck size={16} /> : <AlertCircle size={16} />}
                                    <span>{banner.message}</span>
                                    {banner.tone === "warning" && metaRetryState && (
                                        <button
                                            type="button"
                                            className={styles.inlineAction}
                                            onClick={() => void retryMetaUpdate()}
                                            disabled={retryingMeta}
                                        >
                                            {retryingMeta ? "再試行中..." : "もう一度更新する"}
                                        </button>
                                    )}
                                </div>
                            )}

                            {referenceLoadError && (
                                <div className={`${styles.banner} ${styles.bannerError}`}>
                                    <AlertCircle size={16} />
                                    <span>{referenceLoadError}</span>
                                </div>
                            )}

                            <section className={styles.card}>
                                <div className={styles.labelRow}>
                                    <span className={styles.sectionLabel}>保存先</span>
                                    <button
                                        type="button"
                                        className={styles.inlineAction}
                                        onClick={() => setTargetPickerOpen((current) => !current)}
                                    >
                                        変更
                                    </button>
                                </div>
                                <strong className={styles.targetValue}>{saveTargetLabel}</strong>

                                {targetPickerOpen && (
                                    <div className={styles.targetPicker}>
                                        <button
                                            type="button"
                                            className={`${styles.targetOption} ${
                                                draft.targetKind === "follow_up" ? styles.targetOptionActive : ""
                                            }`}
                                            onClick={() => switchTargetKind("follow_up")}
                                        >
                                            今の話の続き
                                        </button>
                                        <button
                                            type="button"
                                            className={`${styles.targetOption} ${
                                                draft.targetKind === "new_topic" ? styles.targetOptionActive : ""
                                            }`}
                                            onClick={() => switchTargetKind("new_topic")}
                                        >
                                            別の話として記録
                                        </button>
                                    </div>
                                )}
                            </section>

                            {draft.targetKind === "follow_up" && activeConversationSummary ? (
                                <section className={styles.previewCard}>
                                    <div className={styles.previewHeader}>
                                        <UserCircle2 size={16} />
                                        <span>{activeConversationSummary.participant_summary || "相手未設定"}</span>
                                    </div>
                                    <strong>今の話: {activeConversationSummary.title}</strong>
                                    <p>前回: {activeConversationSummary.last_message_preview || "要点はまだありません。"}</p>
                                    <div className={styles.previewMeta}>
                                        <span>
                                            担当: {activeConversationSummary.assignee?.name || "未設定"}
                                        </span>
                                        <span>次: {activeConversationSummary.next_action || "未設定"}</span>
                                        <span>期限: {formatDateOnly(activeConversationSummary.next_action_due_date)}</span>
                                    </div>
                                </section>
                            ) : null}

                            {draft.targetKind === "follow_up" && !activeConversationSummary ? (
                                <section className={styles.emptyState}>
                                    <MessageSquare size={26} />
                                    <strong>続きとして記録する話がまだありません</strong>
                                    <span>一覧から相手を選ぶか、このまま別の話として記録できます。</span>
                                    <div className={styles.emptyActions}>
                                        <button type="button" className={styles.secondaryButton} onClick={onRequestPickContext ?? onClose}>
                                            相手を選ぶ
                                        </button>
                                        <button type="button" className={styles.primaryButton} onClick={() => switchTargetKind("new_topic")}>
                                            別の話として記録する
                                        </button>
                                    </div>
                                </section>
                            ) : (
                                <>
                                    <section className={styles.card}>
                                        <label className={styles.field}>
                                            <span>やりとり内容</span>
                                            <textarea
                                                ref={bodyRef}
                                                rows={6}
                                                value={draft.body}
                                                onChange={(event) => updateDraft({ body: event.target.value })}
                                                placeholder="何があったかを、そのまま短く残します。"
                                            />
                                        </label>
                                        <div className={styles.inlineGrid}>
                                            <label className={styles.field}>
                                                <span>チャネル</span>
                                                <select
                                                    value={draft.channel}
                                                    onChange={(event) =>
                                                        updateDraft({
                                                            channel: event.target.value as Exclude<CommunicationChannel, "system">,
                                                        })
                                                    }
                                                >
                                                    <option value="phone">電話</option>
                                                    <option value="line">LINE</option>
                                                    <option value="in_person">対面</option>
                                                    <option value="sms">SMS</option>
                                                    <option value="manual">手動メモ</option>
                                                    <option value="gmail">メール</option>
                                                </select>
                                            </label>
                                            <label className={styles.field}>
                                                <span>方向</span>
                                                <select
                                                    value={draft.direction}
                                                    onChange={(event) =>
                                                        updateDraft({
                                                            direction: event.target.value as CommunicationDirection,
                                                        })
                                                    }
                                                >
                                                    <option value="inbound">受信</option>
                                                    <option value="outbound">送信</option>
                                                    <option value="internal">内部</option>
                                                </select>
                                            </label>
                                        </div>
                                    </section>

                                    {draft.targetKind === "new_topic" && (
                                        <section className={styles.card}>
                                            <div className={styles.inlineGrid}>
                                                <label className={styles.field}>
                                                    <span>何の話か</span>
                                                    <input
                                                        value={draft.topicTitle || ""}
                                                        onChange={(event) => updateDraft({ topicTitle: event.target.value })}
                                                        placeholder="空なら本文から仮のタイトルを作ります"
                                                    />
                                                </label>
                                                <label className={styles.field}>
                                                    <span>相手名</span>
                                                    <input
                                                        value={draft.partnerName || ""}
                                                        onChange={(event) => updateDraft({ partnerName: event.target.value })}
                                                        placeholder="必要なときだけ入れます"
                                                    />
                                                </label>
                                            </div>
                                            <label className={styles.field}>
                                                <span>メール</span>
                                                <input
                                                    value={draft.partnerEmail || ""}
                                                    onChange={(event) => updateDraft({ partnerEmail: event.target.value })}
                                                    placeholder="name@example.com"
                                                />
                                            </label>
                                        </section>
                                    )}

                                    <section className={styles.card}>
                                        <button
                                            type="button"
                                            className={styles.disclosureButton}
                                            onClick={() => setMetaOpen((current) => !current)}
                                        >
                                            <div>
                                                <strong>担当と次の動き</strong>
                                                <span>
                                                    {metaSummary}
                                                    {draft.dirtyMeta ? " / 変更あり" : ""}
                                                </span>
                                            </div>
                                            {metaOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                                        </button>

                                        {metaOpen && (
                                            <div className={styles.metaFields}>
                                                <div className={styles.inlineGrid}>
                                                    <label className={styles.field}>
                                                        <span>担当</span>
                                                        <select
                                                            value={draft.ownerId || ""}
                                                            onChange={(event) => updateDraft({ ownerId: event.target.value })}
                                                        >
                                                            <option value="">未設定</option>
                                                            {members.map((member) => (
                                                                <option key={member.id} value={member.id}>
                                                                    {member.full_name || member.username || member.id}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </label>
                                                    <label className={styles.field}>
                                                        <span>期限</span>
                                                        <input
                                                            type="date"
                                                            value={draft.dueDate || ""}
                                                            onChange={(event) => updateDraft({ dueDate: event.target.value })}
                                                        />
                                                    </label>
                                                </div>
                                                <label className={styles.field}>
                                                    <span>次にやること</span>
                                                    <textarea
                                                        rows={3}
                                                        value={draft.nextAction || ""}
                                                        onChange={(event) => updateDraft({ nextAction: event.target.value })}
                                                        placeholder="次に誰が何をするか"
                                                    />
                                                </label>
                                                <label className={styles.field}>
                                                    <span>現場</span>
                                                    <select
                                                        value={draft.siteId || ""}
                                                        onChange={(event) => updateDraft({ siteId: event.target.value })}
                                                    >
                                                        <option value="">未設定</option>
                                                        {sites.map((site) => (
                                                            <option key={site.id} value={site.id}>
                                                                {site.name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>
                                            </div>
                                        )}
                                    </section>
                                </>
                            )}

                            <div className={styles.footer}>
                                <div className={styles.footerNote}>
                                    {draft.dirtyMeta ? "担当と次の動きも更新します。" : "本文だけ先に記録します。"}
                                </div>
                                <div className={styles.footerActions}>
                                    <button type="button" className={styles.secondaryButton} onClick={onClose}>
                                        閉じる
                                    </button>
                                    <button
                                        type="submit"
                                        className={styles.primaryButton}
                                        disabled={
                                            saving ||
                                            (draft.targetKind === "follow_up" && !activeConversationSummary && !draft.conversationId)
                                        }
                                    >
                                        {saving ? "記録中..." : "記録する"}
                                    </button>
                                </div>
                            </div>
                        </form>
                    </motion.section>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
