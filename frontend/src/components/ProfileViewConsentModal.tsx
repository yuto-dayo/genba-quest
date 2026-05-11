import { useEffect, useMemo, useState } from "react";
import { Loader2, Shield, ShieldAlert, ShieldCheck, X } from "lucide-react";
import {
    createProfileViewRequest,
    fetchExtendedProfile,
    fetchProfileViewGrantsOutgoing,
    type ExtendedProfile,
    type ProfileViewGrant,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import styles from "./ProfileViewConsentModal.module.css";

interface ProfileViewConsentModalProps {
    targetUserId: string;
    targetDisplayName: string;
    onClose: () => void;
}

type AdminViewState =
    | { kind: "loading" }
    | { kind: "needs_request"; previousPending: ProfileViewGrant | null }
    | {
          kind: "pending";
          /** 既に申請済みで本人の承認待ち */
          requestedAt: string;
          purpose: string | null;
      }
    | { kind: "granted"; grant: ProfileViewGrant; profile: ExtendedProfile }
    | { kind: "error"; message: string };

const PROFILE_FIELD_LABELS: Array<{ key: keyof ExtendedProfile; label: string }> = [
    { key: "phone", label: "電話" },
    { key: "job_type", label: "職種" },
    { key: "employment_kind", label: "雇用区分" },
    { key: "trade_name", label: "屋号" },
    { key: "invoice_registration_number", label: "インボイス登録番号" },
    { key: "bank_name", label: "銀行名" },
    { key: "branch_name", label: "支店" },
    { key: "account_type", label: "口座種別" },
    { key: "account_number", label: "口座番号" },
    { key: "account_holder_kana", label: "口座名義(カナ)" },
    { key: "postal_code", label: "郵便番号" },
    { key: "prefecture", label: "都道府県" },
    { key: "city", label: "市区町村" },
    { key: "address_line1", label: "住所1" },
    { key: "address_line2", label: "住所2" },
    { key: "emergency_contact_name", label: "緊急連絡(氏名)" },
    { key: "emergency_phone", label: "緊急連絡(電話)" },
];

function formatExpiresIn(expiresAt: string): string {
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) return "期限切れ";
    const hours = Math.floor(ms / 3600_000);
    const mins = Math.floor((ms % 3600_000) / 60_000);
    if (hours >= 1) return `あと約 ${hours} 時間`;
    return `あと約 ${mins} 分`;
}

export function ProfileViewConsentModal({
    targetUserId,
    targetDisplayName,
    onClose,
}: ProfileViewConsentModalProps) {
    const [state, setState] = useState<AdminViewState>({ kind: "loading" });
    const [purpose, setPurpose] = useState("");
    const [durationHours, setDurationHours] = useState(24);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    const reload = useMemo(
        () => async () => {
            setState({ kind: "loading" });
            try {
                const { profile, grant } = await fetchExtendedProfile(targetUserId);
                if (grant) {
                    setState({ kind: "granted", grant, profile });
                    return;
                }
                // grant が無くても自分自身の場合は profile が返るので、そちらの処理は別 UI で。
                setState({ kind: "needs_request", previousPending: null });
            } catch (err) {
                const code = getErrorMessage(err);
                if (code === "PROFILE_VIEW_GRANT_REQUIRED") {
                    // grant 未取得: 過去に出した未承認の申請が無いかチェック
                    try {
                        const outgoing = await fetchProfileViewGrantsOutgoing();
                        const matchingPending = outgoing.grants.find(
                            (grant) =>
                                grant.target_user_id === targetUserId &&
                                grant.revoked_at === null &&
                                new Date(grant.expires_at).getTime() > Date.now(),
                        );
                        if (matchingPending) {
                            setState({ kind: "granted", grant: matchingPending, profile: {} as ExtendedProfile });
                            return;
                        }
                    } catch {
                        // outgoing が取れない場合は素直に申請フォームへ
                    }
                    setState({ kind: "needs_request", previousPending: null });
                    return;
                }
                setState({ kind: "error", message: code });
            }
        },
        [targetUserId],
    );

    useEffect(() => {
        void reload();
    }, [reload]);

    const onSubmit = async () => {
        if (purpose.trim().length < 4) {
            setSubmitError("用途を 4 文字以上で記入してください。");
            return;
        }
        setSubmitting(true);
        setSubmitError(null);
        try {
            await createProfileViewRequest({
                target_user_id: targetUserId,
                purpose: purpose.trim(),
                duration_hours: durationHours,
            });
            setState({
                kind: "pending",
                requestedAt: new Date().toISOString(),
                purpose: purpose.trim(),
            });
        } catch (err) {
            setSubmitError(getErrorMessage(err));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className={styles.overlay} role="dialog" aria-modal="true">
            <div className={styles.modal}>
                <div className={styles.header}>
                    <div>
                        <h2 className={styles.title}>
                            {targetDisplayName} の拡張情報
                        </h2>
                        <p className={styles.subtitle}>
                            振込先・インボイス番号・住所などは本人承認が必要です
                        </p>
                    </div>
                    <button
                        type="button"
                        className={styles.closeButton}
                        onClick={onClose}
                        aria-label="閉じる"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className={styles.body}>
                    {state.kind === "loading" && (
                        <p className={styles.intro}>
                            <Loader2 size={16} className="spin" /> 確認中...
                        </p>
                    )}

                    {state.kind === "error" && (
                        <p className={styles.errorMessage}>エラー: {state.message}</p>
                    )}

                    {state.kind === "needs_request" && (
                        <>
                            <p className={styles.intro}>
                                <Shield size={16} /> 本人の承認が必要な情報です。
                                目的を明示して申請を送ると、本人が許可すれば期限内のみ閲覧できます。
                            </p>
                            <div className={styles.field}>
                                <label className={styles.label} htmlFor="purpose">
                                    閲覧の目的 (本人に見えます)
                                </label>
                                <textarea
                                    id="purpose"
                                    className={styles.textarea}
                                    value={purpose}
                                    onChange={(e) => setPurpose(e.target.value)}
                                    placeholder="例: 月末振込でエラーが出たので口座情報を確認したい"
                                    maxLength={500}
                                />
                            </div>
                            <div className={styles.field}>
                                <label className={styles.label} htmlFor="duration">
                                    閲覧できる期間
                                </label>
                                <select
                                    id="duration"
                                    className={styles.select}
                                    value={durationHours}
                                    onChange={(e) => setDurationHours(Number(e.target.value))}
                                >
                                    <option value={1}>1 時間</option>
                                    <option value={6}>6 時間</option>
                                    <option value={24}>24 時間 (推奨)</option>
                                    <option value={72}>3 日</option>
                                    <option value={168}>1 週間</option>
                                </select>
                            </div>
                            {submitError && (
                                <p className={styles.errorMessage}>{submitError}</p>
                            )}
                        </>
                    )}

                    {state.kind === "pending" && (
                        <div className={styles.statusCard}>
                            <span className={styles.statusBadgePending}>
                                <ShieldAlert size={12} /> 本人承認待ち
                            </span>
                            <p className={styles.intro}>
                                本人に通知が届いています。承認されると、ここで拡張情報が表示できるようになります。
                            </p>
                            {state.purpose && (
                                <p className={styles.subtitle}>
                                    目的: {state.purpose}
                                </p>
                            )}
                        </div>
                    )}

                    {state.kind === "granted" && (
                        <>
                            <div className={styles.statusCard}>
                                <span className={styles.statusBadgeActive}>
                                    <ShieldCheck size={12} /> 閲覧中
                                </span>
                                <p className={styles.subtitle}>
                                    残り時間: {formatExpiresIn(state.grant.expires_at)}
                                </p>
                                <p className={styles.subtitle}>
                                    目的: {state.grant.purpose}
                                </p>
                            </div>

                            {state.profile.id ? (
                                <div className={styles.profileFields}>
                                    {PROFILE_FIELD_LABELS.map(({ key, label }) => (
                                        <div className={styles.profileField} key={key}>
                                            <span className={styles.profileFieldLabel}>
                                                {label}
                                            </span>
                                            <span className={styles.profileFieldValue}>
                                                {state.profile[key] ?? "—"}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className={styles.intro}>
                                    承認は得ましたが、まだ詳細を読み込めていません。再度開いてください。
                                </p>
                            )}
                        </>
                    )}
                </div>

                <div className={styles.actions}>
                    {state.kind === "needs_request" ? (
                        <>
                            <button
                                type="button"
                                className={styles.secondary}
                                onClick={onClose}
                                disabled={submitting}
                            >
                                キャンセル
                            </button>
                            <button
                                type="button"
                                className={styles.primary}
                                onClick={onSubmit}
                                disabled={submitting || purpose.trim().length < 4}
                            >
                                {submitting && <Loader2 size={14} className="spin" />}
                                本人に申請する
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            className={styles.secondary}
                            onClick={onClose}
                        >
                            閉じる
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
