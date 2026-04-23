import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, CalendarPlus2, Loader2, X } from 'lucide-react';
import {
    fetchMembers,
    fetchSites,
    submitAssignmentCreateProposal,
    type Member,
    type Site,
} from '../../lib/api';
import styles from './CalendarScheduleModal.module.css';

interface CalendarScheduleModalProps {
    initialDate: string;
    defaultMemberId?: string | null;
    onClose: () => void;
    onCreated: () => Promise<void> | void;
}

function getMemberLabel(member: Member): string {
    return member.full_name || member.username || member.id;
}

export function CalendarScheduleModal({
    initialDate,
    defaultMemberId = null,
    onClose,
    onCreated,
}: CalendarScheduleModalProps) {
    const [sites, setSites] = useState<Site[]>([]);
    const [members, setMembers] = useState<Member[]>([]);
    const [siteId, setSiteId] = useState('');
    const [memberId, setMemberId] = useState(defaultMemberId ?? '');
    const [date, setDate] = useState(initialDate);
    const [note, setNote] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;

        const loadOptions = async () => {
            try {
                const [sitesData, membersData] = await Promise.all([
                    fetchSites(),
                    fetchMembers(),
                ]);

                if (!active) {
                    return;
                }

                setSites(sitesData);
                setMembers(membersData);

                const selectableSites = sitesData.filter((site) =>
                    ['active', 'in_progress'].includes(site.status)
                );

                setSiteId((current) => current || selectableSites[0]?.id || sitesData[0]?.id || '');
                if (defaultMemberId) {
                    setMemberId(defaultMemberId);
                } else {
                    setMemberId((current) => current || membersData[0]?.id || '');
                }
            } catch (loadError) {
                console.error('Failed to load schedule modal options:', loadError);
                if (active) {
                    setError('候補を読み込めませんでした。時間をおいてもう一度お試しください。');
                }
            } finally {
                if (active) {
                    setIsLoading(false);
                }
            }
        };

        void loadOptions();

        return () => {
            active = false;
        };
    }, [defaultMemberId]);

    useEffect(() => {
        setDate(initialDate);
    }, [initialDate]);

    const activeSites = useMemo(() => {
        const selectable = sites.filter((site) => ['active', 'in_progress'].includes(site.status));
        return selectable.length > 0 ? selectable : sites;
    }, [sites]);

    const selectedSite = activeSites.find((site) => site.id === siteId) || null;
    const selectedMember = members.find((member) => member.id === memberId) || null;

    const canSubmit =
        !isLoading &&
        !isSubmitting &&
        Boolean(siteId) &&
        Boolean(memberId) &&
        Boolean(date);

    const handleSubmit = async () => {
        if (!selectedSite || !memberId || !date || isSubmitting) {
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            await submitAssignmentCreateProposal({
                worker_id: memberId,
                site_id: selectedSite.id,
                site_name: selectedSite.name,
                date,
                note,
            });

            await onCreated();
            onClose();
        } catch (submitError) {
            console.error('Failed to create assignment proposal:', submitError);
            setError('変更案を送れませんでした。時間をおいてもう一度お試しください。');
        } finally {
            setIsSubmitting(false);
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
                aria-labelledby="calendar-schedule-modal-title"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 24 }}
                onClick={(event) => event.stopPropagation()}
            >
                <header className={styles.header}>
                    <div className={styles.titleGroup}>
                        <span className={styles.iconBadge}>
                            <CalendarPlus2 size={18} />
                        </span>
                        <div>
                            <h2 id="calendar-schedule-modal-title" className={styles.title}>
                                予定を追加
                            </h2>
                            <p className={styles.subtitle}>
                                ここで出すのは変更案です。承認後に反映されます。
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        className={styles.closeButton}
                        onClick={onClose}
                        aria-label="閉じる"
                    >
                        <X size={20} />
                    </button>
                </header>

                {error && (
                    <div className={styles.errorBanner}>
                        <AlertTriangle size={16} />
                        <span>{error}</span>
                    </div>
                )}

                {isLoading ? (
                    <div className={styles.loadingState}>
                        <Loader2 size={20} className={styles.loadingIcon} />
                        <span>候補を読み込み中</span>
                    </div>
                ) : (
                    <>
                        <div className={styles.contextRow}>
                            <span className={styles.contextChip}>日付 {date}</span>
                            {selectedSite && (
                                <span className={styles.contextChip}>現場 {selectedSite.name}</span>
                            )}
                            {selectedMember && (
                                <span className={styles.contextChip}>
                                    担当 {getMemberLabel(selectedMember)}
                                </span>
                            )}
                        </div>

                        <div className={styles.formGrid}>
                            <label className={styles.field}>
                                <span className={styles.label}>日付</span>
                                <input
                                    className={styles.input}
                                    type="date"
                                    value={date}
                                    onChange={(event) => setDate(event.target.value)}
                                />
                            </label>

                            <label className={styles.field}>
                                <span className={styles.label}>現場</span>
                                <select
                                    className={styles.select}
                                    value={siteId}
                                    onChange={(event) => setSiteId(event.target.value)}
                                >
                                    <option value="">現場を選択</option>
                                    {activeSites.map((site) => (
                                        <option key={site.id} value={site.id}>
                                            {site.name}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <label className={styles.field}>
                                <span className={styles.label}>メンバー</span>
                                <select
                                    className={styles.select}
                                    value={memberId}
                                    onChange={(event) => setMemberId(event.target.value)}
                                >
                                    <option value="">メンバーを選択</option>
                                    {members.map((member) => (
                                        <option key={member.id} value={member.id}>
                                            {getMemberLabel(member)}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <label className={styles.field}>
                                <span className={styles.label}>ひとこと</span>
                                <textarea
                                    className={styles.textarea}
                                    rows={4}
                                    value={note}
                                    onChange={(event) => setNote(event.target.value)}
                                    placeholder="例: 欠員が出たため入れ替え"
                                />
                            </label>
                        </div>
                    </>
                )}

                <footer className={styles.footer}>
                    <p className={styles.footerNote}>
                        保存ではなく変更案を送ります。確定は承認のあとです。
                    </p>
                    <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={onClose}
                        disabled={isSubmitting}
                    >
                        キャンセル
                    </button>
                    <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={handleSubmit}
                        disabled={!canSubmit}
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 size={16} className={styles.loadingIcon} />
                                送信中...
                            </>
                        ) : (
                            '変更案を送る'
                        )}
                    </button>
                </footer>
            </motion.div>
        </motion.div>
    );
}
