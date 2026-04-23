import { AlertTriangle, Briefcase, Check, Clock3, FileText, MapPin, Plus, Users } from 'lucide-react';
import type { Assignment, AssignmentStatus } from '../../types/calendar';
import type { FocusItemRecord, Site } from '../../lib/api';
import styles from './TodayComponents.module.css';

type DayLogStatus = 'none' | 'saved' | 'locked';

interface TodayAssignmentsProps {
    assignments: Assignment[];
    sites: Site[];
    focusItems: FocusItemRecord[];
    completingId: string | null;
    onCompleteFocusItem: (item: FocusItemRecord) => void;
    onOpenSite: (site: Site) => void;
    onRecordDayLog: (site: Site) => void;
    onAddFocusItem: (site: Site) => void;
    getDayLogStatus: (siteId: string) => DayLogStatus;
}

const STATUS_ORDER: AssignmentStatus[] = ['pending', 'confirmed', 'scheduled', 'completed'];

const STATUS_LABELS: Record<AssignmentStatus, string> = {
    pending: '要確認',
    confirmed: '承認済み',
    scheduled: '確定',
    completed: '完了',
};

const STATUS_CLASS_NAMES: Record<AssignmentStatus, string> = {
    pending: styles.assignmentStatusPending,
    confirmed: styles.assignmentStatusConfirmed,
    scheduled: styles.assignmentStatusScheduled,
    completed: styles.assignmentStatusCompleted,
};

function resolveSiteStatus(assignments: Assignment[]): AssignmentStatus {
    return (
        STATUS_ORDER.find((status) => assignments.some((assignment) => assignment.status === status)) ||
        'scheduled'
    );
}

function compareTime(a?: string, b?: string) {
    return (a || '99:99').localeCompare(b || '99:99');
}

function buildGoogleMapsUrl(address: string) {
    const query = encodeURIComponent(address);
    return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

function findSiteByAssignment(siteId: string | undefined, siteName: string | undefined, sites: Site[]) {
    if (siteId) {
        const byId = sites.find((site) => site.id === siteId);
        if (byId) {
            return byId;
        }
    }

    if (siteName) {
        return sites.find((site) => site.name === siteName) || null;
    }

    return null;
}

export function TodayAssignments({
    assignments,
    sites,
    focusItems,
    completingId,
    onCompleteFocusItem,
    onOpenSite,
    onRecordDayLog,
    onAddFocusItem,
    getDayLogStatus,
}: TodayAssignmentsProps) {
    const siteGroups = assignments.reduce<Map<string, Assignment[]>>((map, assignment) => {
        const key = assignment.site_id || assignment.site_name;
        const current = map.get(key) || [];
        current.push(assignment);
        map.set(key, current);
        return map;
    }, new Map());

    const siteSummaries = Array.from(siteGroups.entries()).map(([key, group]) => {
        const earliestStart = group.reduce<string | undefined>((current, assignment) => {
            if (!current) {
                return assignment.start_time;
            }
            return compareTime(assignment.start_time, current) < 0 ? assignment.start_time : current;
        }, undefined);
        const site = findSiteByAssignment(group[0]?.site_id, group[0]?.site_name, sites);
        const workerCount = Math.max(
            site?.assigned_users?.length || 0,
            ...group.map((assignment) => assignment.worker_count || 1)
        );

        return {
            siteId: key,
            siteName: group[0]?.site_name || '現場未設定',
            earliestStart,
            workerCount,
            status: resolveSiteStatus(group),
            site,
        };
    }).sort((a, b) => {
        const timeCompare = compareTime(a.earliestStart, b.earliestStart);
        if (timeCompare !== 0) {
            return timeCompare;
        }
        return a.siteName.localeCompare(b.siteName);
    });

    return (
        <div className={styles.assignmentsContainer}>
            <div className={styles.assignmentsHeader}>
                <Briefcase size={20} />
                <span>今日の現場</span>
                <span className={styles.assignmentsCount}>{siteSummaries.length}件</span>
            </div>

            {siteSummaries.length === 0 ? (
                <div className={styles.emptyAssignments}>
                    <span>今日動く現場はありません</span>
                </div>
            ) : (
                siteSummaries.map((site) => {
                    const dayLogStatus = site.site ? getDayLogStatus(site.site.id) : 'none';
                    const dayLogLabel =
                        dayLogStatus === 'none'
                            ? '記録'
                            : dayLogStatus === 'saved'
                              ? '編集'
                              : '記録済み';
                    const dayLogButtonClass =
                        dayLogStatus === 'locked'
                            ? styles.assignmentActionButton
                            : `${styles.assignmentActionButton} ${styles.assignmentActionPrimary}`;

                    return (
                    <div key={site.siteId || site.siteName} className={styles.assignmentCard}>
                        <div className={styles.assignmentMain}>
                            <div className={styles.assignmentTopRow}>
                                <div className={styles.assignmentHeading}>
                                    <div className={styles.siteName}>{site.siteName}</div>
                                    {site.site?.client?.name && (
                                        <div className={styles.clientName}>{site.site.client.name}</div>
                                    )}
                                </div>
                                <span
                                    className={`${styles.assignmentStatus} ${STATUS_CLASS_NAMES[site.status]}`}
                                >
                                    {STATUS_LABELS[site.status]}
                                </span>
                            </div>
                            <div className={styles.assignmentMetaRow}>
                                <span className={styles.assignmentMeta}>
                                    <Clock3 size={14} />
                                    {site.earliestStart || '時間未設定'}
                                </span>
                                <span className={styles.assignmentMeta}>
                                    <Users size={14} />
                                    {site.workerCount}名
                                </span>
                                <span className={styles.assignmentMeta}>
                                    <MapPin size={14} />
                                    現場稼働
                                </span>
                            </div>

                            {site.site?.address && (
                                <div className={styles.assignmentAddress}>
                                    <MapPin size={14} />
                                    <span>{site.site.address}</span>
                                </div>
                            )}

                            {(site.site?.cautions || site.site?.description) && (
                                <div
                                    className={`${styles.assignmentInsight} ${
                                        site.site.cautions ? styles.assignmentInsightCaution : styles.assignmentInsightNote
                                    }`}
                                >
                                    {site.site.cautions ? <AlertTriangle size={14} /> : <FileText size={14} />}
                                    <span>{site.site.cautions || site.site?.description}</span>
                                </div>
                            )}

                            {site.site && (
                                <div className={styles.assignmentActions}>
                                    {site.site.address ? (
                                        <a
                                            className={styles.assignmentActionButton}
                                            href={buildGoogleMapsUrl(site.site.address)}
                                            target="_blank"
                                            rel="noreferrer"
                                        >
                                            <MapPin size={14} />
                                            地図
                                        </a>
                                    ) : (
                                        <button
                                            type="button"
                                            className={styles.assignmentActionButton}
                                            disabled
                                        >
                                            <MapPin size={14} />
                                            地図
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        className={styles.assignmentActionButton}
                                        onClick={() => onOpenSite(site.site!)}
                                    >
                                        <FileText size={14} />
                                        書類・メモ
                                    </button>
                                    <button
                                        type="button"
                                        className={dayLogButtonClass}
                                        onClick={() => onRecordDayLog(site.site!)}
                                        disabled={dayLogStatus === 'locked'}
                                    >
                                        <Plus size={14} />
                                        {dayLogLabel}
                                    </button>
                                </div>
                            )}

                            {site.site && (
                                <div className={styles.siteTaskSection}>
                                    <div className={styles.siteTaskHeader}>
                                        <span>今日やること</span>
                                        <span className={styles.siteTaskCount}>
                                            {
                                                focusItems.filter(
                                                    (item) => item.site_id === site.site!.id && item.horizon === 'today'
                                                ).length
                                            }
                                            件
                                        </span>
                                    </div>
                                    {focusItems
                                        .filter((item) => item.site_id === site.site!.id && item.horizon === 'today')
                                        .slice(0, 3)
                                        .map((item) => (
                                            <button
                                                key={item.id}
                                                type="button"
                                                className={styles.siteTaskItem}
                                                onClick={() => onCompleteFocusItem(item)}
                                                disabled={completingId === item.id}
                                            >
                                                <span className={styles.siteTaskCheck}>
                                                    {completingId === item.id ? (
                                                        <span className={styles.siteTaskSpinner} />
                                                    ) : (
                                                        <Check size={14} />
                                                    )}
                                                </span>
                                                <span className={styles.siteTaskBody}>
                                                    <span className={styles.siteTaskTitle}>{item.title}</span>
                                                    {item.note && (
                                                        <span className={styles.siteTaskNote}>{item.note}</span>
                                                    )}
                                                </span>
                                            </button>
                                        ))}
                                    {focusItems.filter((item) => item.site_id === site.site!.id && item.horizon === 'today').length === 0 && (
                                        <button
                                            type="button"
                                            className={styles.siteTaskEmpty}
                                            onClick={() => onAddFocusItem(site.site!)}
                                        >
                                            <Plus size={14} />
                                            今日やることを追加
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                    );
                })
            )}
        </div>
    );
}
