import { useEffect, useState } from "react";
import { CalendarClock, ClipboardCheck, Loader2, X } from "lucide-react";
import {
    PATH_BIG_SKILL_KEYS,
    PATH_BIG_SKILL_STATE_OPTIONS,
    fetchPathForms,
    savePathForm,
    type PathBigSkillKey,
    type PathBigSkillState,
    type PathMonthlyEvaluationForm,
    type PathMonthlyEvaluationFormInput,
} from "../../lib/api";
import { getErrorMessage } from "../../lib/error";
import { supabase } from "../../lib/supabase";
import styles from "./MonthlyEvaluationModal.module.css";

const BIG_SKILL_LABELS: Record<PathBigSkillKey, string> = {
    cross_work: "クロス施工力",
    putty_foundation: "パテ・下地処理力",
    planning_preparation: "段取り・準備力",
    quality_stability: "品質安定力",
    site_trust: "現場信頼形成力",
    education_support: "教育・支援力",
};

const BIG_SKILL_STATE_LABELS: Record<PathBigSkillState, string> = {
    unverified: "未確認",
    assist_required: "補助あり",
    conditional: "条件付き",
    near_independent: "ほぼ自走",
    stable_independent: "安定自走",
};

const REWORK_FLAG_LABELS: Record<NonNullable<PathMonthlyEvaluationForm["rework_flag"]>, string> = {
    none: "なし",
    minor: "軽微",
    major: "重大",
};

const MONTHLY_EVALUATION_START_DAY = 25;

function currentMonthValue() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(value: string) {
    const [year, month] = value.split("-");
    if (!year || !month) {
        return value;
    }
    return `${year}/${month}`;
}

function buildEmptyForm(month: string, memberId: string): PathMonthlyEvaluationFormInput {
    return {
        month,
        member_id: memberId,
        selected_big_skill_states: PATH_BIG_SKILL_KEYS.reduce((acc, key) => {
            acc[key] = "unverified";
            return acc;
        }, {} as Record<PathBigSkillKey, PathBigSkillState>),
        selected_roles: [],
        site_ids: [],
        photo_flag: false,
        rework_flag: "none",
        comment: "",
    };
}

function splitCsv(value: string): string[] {
    return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function joinCsv(values: string[] | undefined): string {
    return (values || []).join(", ");
}

function isSubmissionWindowOpen(date: Date) {
    return date.getDate() >= MONTHLY_EVALUATION_START_DAY;
}

interface MonthlyEvaluationModalProps {
    onClose: () => void;
    onSaved: (message: string) => void;
}

export function MonthlyEvaluationModal({ onClose, onSaved }: MonthlyEvaluationModalProps) {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [memberId, setMemberId] = useState("");
    const [month] = useState(currentMonthValue);
    const [formInput, setFormInput] = useState<PathMonthlyEvaluationFormInput>(() => buildEmptyForm(currentMonthValue(), ""));
    const [roleInput, setRoleInput] = useState("");
    const [siteInput, setSiteInput] = useState("");
    const [existingUpdatedAt, setExistingUpdatedAt] = useState<string | null>(null);
    const submissionWindowOpen = isSubmissionWindowOpen(new Date());

    useEffect(() => {
        const load = async () => {
            try {
                setLoading(true);
                setError(null);

                const {
                    data: { session },
                } = await supabase.auth.getSession();
                const currentUserId = session?.user?.id || "";

                if (!currentUserId) {
                    throw new Error("ログイン中のユーザーが取得できません");
                }

                const { forms } = await fetchPathForms({
                    month,
                    member_id: currentUserId,
                    limit: 1,
                });

                const currentForm = forms[0] || null;
                setMemberId(currentUserId);
                setFormInput({
                    ...buildEmptyForm(month, currentUserId),
                    selected_big_skill_states: currentForm?.selected_big_skill_states || buildEmptyForm(month, currentUserId).selected_big_skill_states,
                    selected_roles: currentForm?.selected_roles || [],
                    site_ids: currentForm?.site_ids || [],
                    photo_flag: currentForm?.photo_flag || false,
                    rework_flag: currentForm?.rework_flag || "none",
                    comment: currentForm?.comment || "",
                });
                setRoleInput(joinCsv(currentForm?.selected_roles));
                setSiteInput(joinCsv(currentForm?.site_ids));
                setExistingUpdatedAt(currentForm?.updated_at || null);
            } catch (loadError: unknown) {
                setError(getErrorMessage(loadError));
            } finally {
                setLoading(false);
            }
        };

        void load();
    }, [month]);

    const handleSubmit = async () => {
        if (!memberId) {
            setError("ログイン中のユーザーが取得できません");
            return;
        }

        if (!submissionWindowOpen) {
            setError("月末フォームは毎月25日から月末まで入力できます");
            return;
        }

        try {
            setSaving(true);
            setError(null);

            await savePathForm({
                ...formInput,
                month,
                member_id: memberId,
                selected_roles: splitCsv(roleInput),
                site_ids: splitCsv(siteInput),
            });

            onSaved(`${formatMonthLabel(month)} の月末フォームを保存しました`);
        } catch (saveError: unknown) {
            setError(getErrorMessage(saveError));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div
                className={styles.modal}
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="monthly-evaluation-title"
            >
                <div className={styles.header}>
                    <div>
                        <p className={styles.eyebrow}>Month-End Self Review</p>
                        <h2 id="monthly-evaluation-title" className={styles.title}>
                            月末フォーム
                        </h2>
                        <p className={styles.subtitle}>
                            入力期間中のみ、今月分だけ保存できます。報酬や確定評価の元になる自己評価です。
                        </p>
                    </div>
                    <button type="button" className={styles.closeButton} onClick={onClose} aria-label="閉じる">
                        <X size={18} />
                    </button>
                </div>

                {loading ? (
                    <div className={styles.loadingState}>
                        <Loader2 size={18} className={styles.spinner} />
                        <span>フォームを読み込み中...</span>
                    </div>
                ) : (
                    <>
                        {error && <div className={styles.errorBanner}>{error}</div>}

                        {!submissionWindowOpen && (
                            <div className={styles.infoBanner}>
                                月末フォームは毎月25日から月末まで入力できます。期間外は保存できません。
                            </div>
                        )}

                        <div className={styles.summaryCard}>
                            <div className={styles.summaryItem}>
                                <span className={styles.summaryLabel}>対象月</span>
                                <strong>{formatMonthLabel(month)}</strong>
                            </div>
                            <div className={styles.summaryItem}>
                                <span className={styles.summaryLabel}>入力期間</span>
                                <strong>毎月25日から月末まで</strong>
                            </div>
                            <div className={styles.summaryItem}>
                                <span className={styles.summaryLabel}>前回保存</span>
                                <strong>
                                    {existingUpdatedAt
                                        ? new Date(existingUpdatedAt).toLocaleString("ja-JP", {
                                              month: "2-digit",
                                              day: "2-digit",
                                              hour: "2-digit",
                                              minute: "2-digit",
                                          })
                                        : "まだありません"}
                                </strong>
                            </div>
                        </div>

                        <div className={styles.formSection}>
                            <div className={styles.sectionHeader}>
                                <CalendarClock size={16} />
                                <strong>6つの主評価項目</strong>
                            </div>
                            <div className={styles.skillGrid}>
                                {PATH_BIG_SKILL_KEYS.map((key) => (
                                    <label key={key} className={styles.field}>
                                        <span>{BIG_SKILL_LABELS[key]}</span>
                                        <select
                                            className={styles.select}
                                            value={formInput.selected_big_skill_states?.[key] || "unverified"}
                                            onChange={(event) =>
                                                setFormInput((current) => ({
                                                    ...current,
                                                    selected_big_skill_states: {
                                                        ...current.selected_big_skill_states,
                                                        [key]: event.target.value as PathBigSkillState,
                                                    },
                                                }))
                                            }
                                        >
                                            {PATH_BIG_SKILL_STATE_OPTIONS.map((option) => (
                                                <option key={option} value={option}>
                                                    {BIG_SKILL_STATE_LABELS[option]}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div className={styles.formSection}>
                            <div className={styles.sectionHeader}>
                                <ClipboardCheck size={16} />
                                <strong>今月の現場メモ</strong>
                            </div>
                            <div className={styles.inlineGrid}>
                                <label className={styles.field}>
                                    <span>担当ロール</span>
                                    <input
                                        className={styles.input}
                                        value={roleInput}
                                        onChange={(event) => setRoleInput(event.target.value)}
                                        placeholder="主担当, 段取り, 応援"
                                    />
                                </label>
                                <label className={styles.field}>
                                    <span>現場ID</span>
                                    <input
                                        className={styles.input}
                                        value={siteInput}
                                        onChange={(event) => setSiteInput(event.target.value)}
                                        placeholder="site-001, site-002"
                                    />
                                </label>
                            </div>
                            <div className={styles.inlineGrid}>
                                <label className={styles.toggleCard}>
                                    <input
                                        type="checkbox"
                                        checked={Boolean(formInput.photo_flag)}
                                        onChange={(event) =>
                                            setFormInput((current) => ({
                                                ...current,
                                                photo_flag: event.target.checked,
                                            }))
                                        }
                                    />
                                    <span>写真を提出した</span>
                                </label>
                                <label className={styles.field}>
                                    <span>手直しフラグ</span>
                                    <select
                                        className={styles.select}
                                        value={formInput.rework_flag || "none"}
                                        onChange={(event) =>
                                            setFormInput((current) => ({
                                                ...current,
                                                rework_flag: event.target.value as NonNullable<PathMonthlyEvaluationForm["rework_flag"]>,
                                            }))
                                        }
                                    >
                                        {Object.entries(REWORK_FLAG_LABELS).map(([value, label]) => (
                                            <option key={value} value={value}>
                                                {label}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                            <label className={styles.field}>
                                <span>月末コメント</span>
                                <textarea
                                    className={styles.textarea}
                                    value={formInput.comment || ""}
                                    onChange={(event) =>
                                        setFormInput((current) => ({
                                            ...current,
                                            comment: event.target.value,
                                        }))
                                    }
                                    placeholder="今月できたこと、未確認のこと、次月に見てほしい点"
                                />
                            </label>
                        </div>

                        <div className={styles.actions}>
                            <button type="button" className={styles.secondaryButton} onClick={onClose}>
                                後で入力する
                            </button>
                            <button
                                type="button"
                                className={styles.primaryButton}
                                onClick={handleSubmit}
                                disabled={saving || !submissionWindowOpen}
                            >
                                {saving ? "保存中..." : "月末フォームを保存"}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
