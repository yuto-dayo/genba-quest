import { AlertTriangle, Check, Clock3, FileText, MapPin, Plus, ShieldCheck } from 'lucide-react';
import type { Assignment } from '../../types/calendar';
import type { FocusItemRecord, Site } from '../../lib/api';
import styles from './TodayComponents.module.css';

type DayLogStatus = 'none' | 'saved' | 'locked';
export type SiteInputStatus = 'role_missing' | 'role_saved' | 'reward_missing' | 'reward_saved' | 'locked';

interface TodayAssignmentsProps {
    assignments: Assignment[];
    sites: Site[];
    focusItems: FocusItemRecord[];
    completingId: string | null;
    onCompleteFocusItem: (item: FocusItemRecord) => void;
    onViewSiteMemo: (site: Site) => void;
    onPlanRole: (site: Site) => void;
    onRecordRewardInput: (site: Site) => void;
    onAddFocusItem: (site: Site) => void;
    getDayLogStatus: (siteId: string) => DayLogStatus;
    getSiteInputStatus: (siteId: string) => SiteInputStatus;
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
    onViewSiteMemo,
    onPlanRole,
    onRecordRewardInput,
    onAddFocusItem,
    getDayLogStatus,
    getSiteInputStatus,
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

        return {
            siteId: key,
            siteName: group[0]?.site_name || '現場未設定',
            earliestStart,
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
            {siteSummaries.length === 0 ? (
                <div className={styles.emptyAssignments}>
                    <span>今日動く現場はありません</span>
                </div>
            ) : (
                siteSummaries.map((site) => {
                    const dayLogStatus = site.site ? getDayLogStatus(site.site.id) : 'none';
                    const siteInputStatus = site.site ? getSiteInputStatus(site.site.id) : 'role_missing';
                    const showRewardAction =
                        siteInputStatus === 'role_saved' ||
                        siteInputStatus === 'reward_missing' ||
                        siteInputStatus === 'reward_saved';

                    return (
                    <div key={site.siteId || site.siteName} className={styles.assignmentCard}>
                        <div className={styles.assignmentMain}>
                            <div className={styles.assignmentTopRow}>
                                <div className={styles.assignmentHeading}>
                                    <div className={styles.siteTitleRow}>
                                        <div className={styles.siteName}>{site.siteName}</div>
                                        {site.site?.address && (
                                            <a
                                                className={styles.siteMapIconLink}
                                                href={buildGoogleMapsUrl(site.site.address)}
                                                target="_blank"
                                                rel="noreferrer"
                                                aria-label="地図を開く"
                                                title="地図を開く"
                                            >
                                                <MapPin size={16} />
                                            </a>
                                        )}
                                    </div>
                                    {site.site?.client?.name && (
                                        <div className={styles.clientName}>{site.site.client.name}</div>
                                    )}
                                    {site.site?.address && (
                                        <div className={styles.assignmentAddress}>{site.site.address}</div>
                                    )}
                                </div>
                            </div>
                            <div className={styles.assignmentMetaRow}>
                                <span className={styles.assignmentMeta}>
                                    <Clock3 size={14} />
                                    {site.earliestStart || '時間未設定'}
                                </span>
                            </div>

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
                                    <button
                                        type="button"
                                        className={`${styles.assignmentActionButton} ${
                                            dayLogStatus === 'none' ? styles.assignmentActionPrimary : ''
                                        }`}
                                        onClick={() => onViewSiteMemo(site.site!)}
                                    >
                                        <FileText size={14} />
                                        メモ
                                    </button>
                                    <button
                                        type="button"
                                        className={`${styles.assignmentActionButton} ${
                                            siteInputStatus === 'role_missing' ? styles.assignmentActionPrimary : ''
                                        }`}
                                        onClick={() => onPlanRole(site.site!)}
                                        disabled={siteInputStatus === 'locked'}
                                    >
                                        <ShieldCheck size={14} />
                                        役割
                                    </button>
                                    {showRewardAction && (
                                        <button
                                            type="button"
                                            className={`${styles.assignmentActionButton} ${
                                                siteInputStatus === 'reward_missing' ? styles.assignmentActionPrimary : ''
                                            }`}
                                            onClick={() => onRecordRewardInput(site.site!)}
                                        >
                                            <Check size={14} />
                                            責任
                                        </button>
                                    )}
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
