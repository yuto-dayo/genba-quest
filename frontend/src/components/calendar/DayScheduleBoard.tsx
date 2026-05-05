import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Plus, Users, X } from 'lucide-react';
import type { Member } from '../../lib/api';
import type {
    DayScheduleBoardModel,
    DayScheduleSiteBoard,
    DraftAssignmentCreate,
} from '../../lib/dayScheduleBoard';
import styles from './DayScheduleBoard.module.css';

interface DayScheduleBoardProps {
    board: DayScheduleBoardModel;
    members: Member[];
    onAddDraft: (
        draft: Omit<DraftAssignmentCreate, 'id'>,
        occupiedWorkerIdsForDate: string[]
    ) => { ok: boolean; message: string };
}

function formatDateLabel(dateStr: string): string {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) {
        return dateStr;
    }
    return date.toLocaleDateString('ja-JP', {
        month: 'numeric',
        day: 'numeric',
        weekday: 'short',
    });
}

function getMemberLabel(member: Member): string {
    return member.full_name || member.display_name || member.username || member.id;
}

function SiteWorkerList({ site }: { site: DayScheduleSiteBoard }) {
    const workers = [...site.confirmed_workers, ...site.draft_workers];

    if (workers.length === 0) {
        return <p className={styles.emptyWorkers}>まだ職人はいません</p>;
    }

    return (
        <div className={styles.workerList}>
            {site.confirmed_workers.map((worker) => (
                <span key={`confirmed-${worker.id}`} className={styles.workerChip}>
                    {worker.name}
                </span>
            ))}
            {site.draft_workers.map((worker) => (
                <span key={`draft-${worker.id}`} className={styles.workerChipDraft}>
                    {worker.name}
                    <span>追加案</span>
                </span>
            ))}
        </div>
    );
}

export function DayScheduleBoard({ board, members, onAddDraft }: DayScheduleBoardProps) {
    const [targetSite, setTargetSite] = useState<DayScheduleSiteBoard | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    const selectableMembers = useMemo(
        () => members.filter((member) => member.status !== 'removed' && member.status !== 'suspended'),
        [members]
    );

    const handleAdd = (member: Member) => {
        if (!targetSite) {
            return;
        }

        const result = onAddDraft(
            {
                date: board.date,
                site_id: targetSite.site_id,
                site_name: targetSite.site_name,
                worker_id: member.id,
                worker_name: getMemberLabel(member),
            },
            board.assigned_worker_ids_for_date
        );

        setMessage(result.message);
        if (result.ok) {
            setTargetSite(null);
        }
    };

    return (
        <section className={styles.container}>
            <header className={styles.header}>
                <div>
                    <span className={styles.eyebrow}>Day Board</span>
                    <h3>{formatDateLabel(board.date)} の現場</h3>
                    <p>不足がある現場だけ、職人を追加します。</p>
                </div>
                <span
                    className={`${styles.shortageSummary} ${
                        board.shortage_site_count > 0 ? styles.shortageWarn : styles.shortageOk
                    }`}
                >
                    {board.shortage_site_count > 0
                        ? `不足 ${board.shortage_site_count}件`
                        : '不足なし'}
                </span>
            </header>

            {message && (
                <div className={styles.message}>
                    <CheckCircle2 size={14} />
                    <span>{message}</span>
                </div>
            )}

            {board.sites.length === 0 ? (
                <div className={styles.emptyBoard}>この日の現場はありません。</div>
            ) : (
                <div className={styles.siteGrid}>
                    {board.sites.map((site) => {
                        const shortage = site.shortage_count;
                        const canAdd = !site.is_completed && shortage !== null && shortage > 0;

                        return (
                            <article
                                key={site.site_id}
                                className={`${styles.siteCard} ${
                                    site.is_completed
                                        ? styles.siteCardCompleted
                                        : canAdd
                                          ? styles.siteCardShortage
                                          : ''
                                }`}
                            >
                                <div className={styles.siteHeader}>
                                    <div>
                                        <h4>{site.site_name}</h4>
                                        <p>
                                            {site.required_worker_count === null
                                                ? '必要人数未設定'
                                                : `必要 ${site.required_worker_count}名`}
                                        </p>
                                    </div>
                                    {site.is_completed ? (
                                        <span className={styles.completionBadge}>
                                            <CheckCircle2 size={14} />
                                            完了
                                        </span>
                                    ) : (
                                        <span
                                            className={`${styles.shortageBadge} ${
                                                canAdd ? styles.shortageBadgeWarn : styles.shortageBadgeNeutral
                                            }`}
                                        >
                                            {shortage === null ? '対象外' : shortage > 0 ? `不足 ${shortage}` : '足りています'}
                                        </span>
                                    )}
                                </div>

                                <div className={styles.countGrid}>
                                    <span>
                                        <strong>{site.confirmed_count}</strong>
                                        配置済み
                                    </span>
                                    <span>
                                        <strong>{site.draft_count}</strong>
                                        追加案
                                    </span>
                                    <span>
                                        <strong>{site.projected_count}</strong>
                                        送信後
                                    </span>
                                </div>

                                <div className={styles.workerSection}>
                                    <div className={styles.workerSectionHeader}>
                                        <Users size={14} />
                                        <span>職人</span>
                                    </div>
                                    <SiteWorkerList site={site} />
                                </div>

                                <button
                                    type="button"
                                    className={styles.addButton}
                                    disabled={!canAdd}
                                    onClick={() => {
                                        setTargetSite(site);
                                        setMessage(null);
                                    }}
                                >
                                    <Plus size={15} />
                                    {site.is_completed ? '完了済み' : '職人を追加'}
                                </button>
                            </article>
                        );
                    })}
                </div>
            )}

            {targetSite && (
                <div className={styles.sheetOverlay} onClick={() => setTargetSite(null)}>
                    <div className={styles.sheet} onClick={(event) => event.stopPropagation()}>
                        <div className={styles.sheetHeader}>
                            <div>
                                <span className={styles.eyebrow}>追加候補</span>
                                <h4>{targetSite.site_name}</h4>
                                <p>この日の追加案に入れる職人を選びます。</p>
                            </div>
                            <button
                                type="button"
                                className={styles.closeButton}
                                onClick={() => setTargetSite(null)}
                                aria-label="閉じる"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className={styles.candidateList}>
                            {selectableMembers.map((member) => {
                                const alreadyAssigned = board.assigned_worker_ids_for_date.includes(member.id);
                                const workerStatus = board.worker_status_by_id[member.id];
                                const blocked = workerStatus?.severity === 'blocked';
                                const warning = workerStatus?.severity === 'warning';
                                const disabled = blocked || alreadyAssigned;

                                return (
                                    <button
                                        key={member.id}
                                        type="button"
                                        className={styles.candidateButton}
                                        disabled={disabled}
                                        onClick={() => handleAdd(member)}
                                    >
                                        <span>{getMemberLabel(member)}</span>
                                        {blocked ? (
                                            <small>{workerStatus.label}</small>
                                        ) : alreadyAssigned ? (
                                            <small>この日は追加済み</small>
                                        ) : warning ? (
                                            <small>{workerStatus.label}</small>
                                        ) : (
                                            <small>追加候補</small>
                                        )}
                                    </button>
                                );
                            })}
                        </div>

                        {selectableMembers.length === 0 && (
                            <div className={styles.sheetNotice}>
                                <AlertTriangle size={14} />
                                <span>職人一覧を読み込めませんでした。</span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </section>
    );
}
