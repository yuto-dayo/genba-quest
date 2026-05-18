import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import {
    completeSiteWithClose,
    fetchPathV31DayLogs,
    type CompleteSiteWithCloseResult,
    type Member,
    type PathV31DayLog,
    type PathV31RoleType,
    type Site,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import { normalizeDateList, normalizeSiteScheduleMode, normalizeWeekdays } from "../lib/siteSchedule";
import styles from "./SiteCompleteWithCloseModal.module.css";

interface SiteCompleteWithCloseModalProps {
    site: Site;
    members?: Member[];
    initialRecognizedRevenue?: number | null;
    onClose: () => void;
    onSuccess: (result: CompleteSiteWithCloseResult) => void;
    readOnly?: boolean;
}

interface SiteDayLogDraftForm {
    id: string;
    date: string;
    member_id: string;
    member_name: string;
    role_type: PathV31RoleType;
    credited_unit: string;
}

const COST_FIELD_KEYS = [
    "material_cost",
    "external_cost",
    "direct_cost",
    "overhead_allocated",
    "known_rework_cost",
    "approved_adjustments",
] as const;

function createClientRequestId(): string {
    return globalThis.crypto?.randomUUID?.() || `site-close-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toNumber(value: string): number {
    if (!value.trim()) {
        return 0;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function toDateKey(value?: string | null): string | null {
    if (!value) {
        return null;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return value;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(
        parsed.getDate(),
    ).padStart(2, "0")}`;
}

function buildDateRange(startKey: string, endKey: string): string[] {
    const start = new Date(`${startKey}T00:00:00`);
    const end = new Date(`${endKey}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
        return [];
    }

    const dates: string[] = [];
    const current = new Date(start);
    while (current <= end && dates.length < 120) {
        dates.push(toDateKey(current.toISOString()) || startKey);
        current.setDate(current.getDate() + 1);
    }
    return dates;
}

function getMemberName(member: Member | undefined, fallbackId: string): string {
    return member?.full_name || member?.display_name || member?.username || fallbackId.slice(0, 8);
}

function buildDraftDayLogs(site: Site, members: Member[]): SiteDayLogDraftForm[] {
    const assignedUserIds = Array.from(new Set(site.assigned_users ?? []));
    if (assignedUserIds.length === 0) {
        return [];
    }

    const mode = normalizeSiteScheduleMode(site.schedule_mode);
    const today = toDateKey(new Date().toISOString()) || "";
    const startKey = toDateKey(site.started_at) || toDateKey(site.expected_completion_at) || today;
    const endKey = toDateKey(site.completed_at) || toDateKey(site.expected_completion_at) || today;
    const dates =
        mode === "custom"
            ? normalizeDateList(site.custom_work_dates).filter((date) => date <= endKey)
            : buildDateRange(startKey, endKey).filter((date) => {
                  if (mode !== "weekdays") {
                      return true;
                  }
                  const weekdays = normalizeWeekdays(site.working_weekdays);
                  return weekdays.length === 0 || weekdays.includes(new Date(`${date}T00:00:00`).getDay());
              });
    const targetDates = dates.length > 0 ? dates : [endKey || today];
    const memberById = new Map(members.map((member) => [member.id, member]));

    return targetDates.flatMap((date) =>
        assignedUserIds.map((memberId) => ({
            id: `${date}:${memberId}`,
            date,
            member_id: memberId,
            member_name: getMemberName(memberById.get(memberId), memberId),
            role_type: "support",
            credited_unit: "1",
        })),
    );
}

export function SiteCompleteWithCloseModal({
    site,
    members = [],
    initialRecognizedRevenue,
    onClose,
    onSuccess,
    readOnly = false,
}: SiteCompleteWithCloseModalProps) {
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [submittedOnce, setSubmittedOnce] = useState(false);
    const [clientRequestId, setClientRequestId] = useState(() => createClientRequestId());
    const [dayLogs, setDayLogs] = useState<PathV31DayLog[]>([]);
    const [selectedDayLogIds, setSelectedDayLogIds] = useState<string[]>([]);
    const [siteDayLogDrafts, setSiteDayLogDrafts] = useState<SiteDayLogDraftForm[]>(() =>
        buildDraftDayLogs(site, members),
    );
    const [form, setForm] = useState({
        recognized_revenue: String(initialRecognizedRevenue ?? site.revenue ?? 0),
        material_cost: "0",
        external_cost: "0",
        direct_cost: "0",
        overhead_allocated: "0",
        known_rework_cost: "0",
        approved_adjustments: "0",
        difficulty_band: "S1" as "S1" | "S2" | "S3",
        share_mode: "auto_points" as "auto_points" | "fixed_template",
    });

    useEffect(() => {
        let cancelled = false;

        void (async () => {
            try {
                setLoading(true);
                setError(null);
                const response = await fetchPathV31DayLogs({ site_id: site.id, limit: 200 });
                if (cancelled) {
                    return;
                }
                const eligibleLogs = response.logs.filter((log) => !log.locked_by_site_close_id);
                setDayLogs(eligibleLogs);
                setSelectedDayLogIds(eligibleLogs.map((log) => log.id));
                if (eligibleLogs.length === 0) {
                    setSiteDayLogDrafts(buildDraftDayLogs(site, members));
                }
            } catch (requestError) {
                if (!cancelled) {
                    setError(requestError instanceof Error ? requestError.message : "日報の取得に失敗しました");
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [members, site]);

    const distributableProfit = useMemo(() => {
        const recognizedRevenue = toNumber(form.recognized_revenue);
        const costs = COST_FIELD_KEYS.reduce((sum, key) => sum + toNumber(form[key]), 0);
        return recognizedRevenue - costs;
    }, [form]);

    const resetIdempotencyOnEdit = () => {
        if (!submittedOnce) {
            return;
        }
        setClientRequestId(createClientRequestId());
        setSubmittedOnce(false);
    };

    const handleToggleDayLog = (dayLogId: string) => {
        resetIdempotencyOnEdit();
        setSelectedDayLogIds((current) =>
            current.includes(dayLogId)
                ? current.filter((candidate) => candidate !== dayLogId)
                : [...current, dayLogId],
        );
    };

    const handleSubmit = async () => {
        if (readOnly) {
            setError("過去月は閲覧専用です。修正は新しい月の逆仕訳で行います。");
            return;
        }

        const usingDrafts = selectedDayLogIds.length === 0;

        try {
            setSubmitting(true);
            setError(null);
            setSubmittedOnce(true);
            const result = await completeSiteWithClose(site.id, {
                client_request_id: clientRequestId,
                expected_site_updated_at: site.updated_at,
                recognized_revenue: toNumber(form.recognized_revenue),
                included_day_log_ids: selectedDayLogIds,
                site_day_log_drafts: usingDrafts
                    ? siteDayLogDrafts.map((draft) => ({
                          date: draft.date,
                          member_id: draft.member_id,
                          role_type: draft.role_type,
                          credited_unit: toNumber(draft.credited_unit) || 1,
                          trade_families: [],
                          memo: "site_close_assignment_supplement",
                      }))
                    : undefined,
                material_cost: toNumber(form.material_cost),
                external_cost: toNumber(form.external_cost),
                direct_cost: toNumber(form.direct_cost),
                overhead_allocated: toNumber(form.overhead_allocated),
                known_rework_cost: toNumber(form.known_rework_cost),
                approved_adjustments: toNumber(form.approved_adjustments),
                difficulty_band: form.difficulty_band,
                share_mode: form.share_mode,
            });
            onSuccess(result);
        } catch (requestError: unknown) {
            setError(getErrorMessage(requestError));
        } finally {
            setSubmitting(false);
        }
    };

    const updateDraft = <K extends keyof SiteDayLogDraftForm>(
        draftId: string,
        key: K,
        value: SiteDayLogDraftForm[K],
    ) => {
        resetIdempotencyOnEdit();
        setSiteDayLogDrafts((current) =>
            current.map((draft) => (draft.id === draftId ? { ...draft, [key]: value } : draft)),
        );
    };

    const updateField = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
        resetIdempotencyOnEdit();
        setForm((current) => ({
            ...current,
            [key]: value,
        }));
    };

    return (
        <div className={styles.overlay} onClick={onClose}>
            <motion.div
                className={styles.dialog}
                onClick={(event) => event.stopPropagation()}
                initial={{ y: 24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 24, opacity: 0 }}
                transition={{ duration: 0.2 }}
                role="dialog"
                aria-modal="true"
                aria-label="現場締め入力"
            >
                <div className={styles.header}>
                    <div>
                        <div className={styles.eyebrow}>現場完了フロー</div>
                        <h3 className={styles.title}>現場締めを入力</h3>
                        <p className={styles.description}>
                            完了 fact を記録し、同時に現場締め proposal を送ります。
                        </p>
                    </div>
                    <button type="button" className={styles.closeButton} onClick={onClose} aria-label="閉じる">
                        <X size={18} />
                    </button>
                </div>

                {loading ? (
                    <div className={styles.loading}>
                        <Loader2 size={18} className={styles.spinner} />
                        日報を読み込み中...
                    </div>
                ) : (
                    <>
                        <div className={styles.section}>
                            <label className={styles.field}>
                                <span>recognized_revenue</span>
                                <input
                                    className={styles.input}
                                    type="number"
                                    value={form.recognized_revenue}
                                    onChange={(event) => updateField("recognized_revenue", event.target.value)}
                                    disabled={readOnly}
                                />
                            </label>
                            <div className={styles.grid}>
                                {COST_FIELD_KEYS.map((key) => (
                                    <label key={key} className={styles.field}>
                                        <span>{key}</span>
                                        <input
                                            className={styles.input}
                                            type="number"
                                            value={form[key]}
                                            onChange={(event) => updateField(key, event.target.value)}
                                            disabled={readOnly}
                                        />
                                    </label>
                                ))}
                            </div>
                            <div className={styles.grid}>
                                <label className={styles.field}>
                                    <span>difficulty_band</span>
                                    <select
                                            className={styles.select}
                                            value={form.difficulty_band}
                                            onChange={(event) =>
                                                updateField("difficulty_band", event.target.value as "S1" | "S2" | "S3")
                                            }
                                            disabled={readOnly}
                                        >
                                        <option value="S1">S1</option>
                                        <option value="S2">S2</option>
                                        <option value="S3">S3</option>
                                    </select>
                                </label>
                                <label className={styles.field}>
                                    <span>share_mode</span>
                                    <select
                                            className={styles.select}
                                            value={form.share_mode}
                                            onChange={(event) =>
                                                updateField("share_mode", event.target.value as "auto_points" | "fixed_template")
                                            }
                                            disabled={readOnly}
                                        >
                                        <option value="auto_points">auto_points</option>
                                        <option value="fixed_template">fixed_template</option>
                                    </select>
                                </label>
                            </div>
                            <div className={styles.summary}>
                                <CheckCircle2 size={16} />
                                想定 distributable_profit: ¥{distributableProfit.toLocaleString("ja-JP")}
                            </div>
                        </div>

                        <div className={styles.section}>
                            <div className={styles.sectionHeader}>
                                <h4 className={styles.sectionTitle}>締め対象の日報</h4>
                                <span className={styles.sectionMeta}>{selectedDayLogIds.length}件選択</span>
                            </div>
                            {dayLogs.length === 0 ? (
                                <div className={styles.draftLogList}>
                                    <div className={styles.empty}>
                                        未lockの日報がないため、配置から日報を作ります。
                                    </div>
                                    {siteDayLogDrafts.map((draft) => (
                                        <div key={draft.id} className={styles.draftLogItem}>
                                            <div className={styles.draftLogName}>
                                                <span>{draft.member_name}</span>
                                                <small>{draft.date}</small>
                                            </div>
                                            <select
                                                className={styles.select}
                                                value={draft.role_type}
                                                onChange={(event) =>
                                                    updateDraft(
                                                        draft.id,
                                                        "role_type",
                                                        event.target.value as PathV31RoleType,
                                                    )
                                                }
                                                disabled={readOnly}
                                            >
                                                <option value="lead">lead</option>
                                                <option value="solo">solo</option>
                                                <option value="assist">assist</option>
                                                <option value="support">support</option>
                                            </select>
                                            <input
                                                className={styles.unitInput}
                                                type="number"
                                                min="0.25"
                                                step="0.25"
                                                value={draft.credited_unit}
                                                onChange={(event) =>
                                                    updateDraft(draft.id, "credited_unit", event.target.value)
                                                }
                                                aria-label={`${draft.member_name} unit`}
                                                disabled={readOnly}
                                            />
                                        </div>
                                    ))}
                                    {siteDayLogDrafts.length === 0 && (
                                        <div className={styles.empty}>
                                            画面で配置を確認できません。送信時に承認済みの配置proposalから補完を試します。
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className={styles.logList}>
                                    {dayLogs.map((log) => {
                                        const checked = selectedDayLogIds.includes(log.id);
                                        return (
                                            <label key={log.id} className={styles.logItem}>
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    onChange={() => handleToggleDayLog(log.id)}
                                                    disabled={readOnly}
                                                />
                                                <div className={styles.logText}>
                                                    <span>{log.date}</span>
                                                    <span>{log.role_type}</span>
                                                    <span>{log.credited_unit} unit</span>
                                                </div>
                                            </label>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </>
                )}

                {error && (
                    <div className={styles.error}>
                        <AlertTriangle size={16} />
                        <span>{error}</span>
                    </div>
                )}

                <div className={styles.actions}>
                    <button type="button" className={styles.secondaryButton} onClick={onClose} disabled={submitting}>
                        キャンセル
                    </button>
                    <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={handleSubmit}
                        disabled={readOnly || loading || submitting}
                        aria-disabled={readOnly || loading || submitting ? "true" : undefined}
                    >
                        {submitting ? <Loader2 size={18} className={styles.spinner} /> : <CheckCircle2 size={18} />}
                        完了して締め送信
                    </button>
                </div>
            </motion.div>
        </div>
    );
}
