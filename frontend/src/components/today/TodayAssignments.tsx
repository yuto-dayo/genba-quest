import { useState } from 'react';
import { AlertTriangle, Check, Clock3, FileText, Hammer, MapPin, Plus, ShieldCheck, UserRound, X } from 'lucide-react';
import type { Assignment } from '../../types/calendar';
import type { Member, Site, SiteLineItem } from '../../lib/api';
import styles from './TodayComponents.module.css';

type DayLogStatus = 'none' | 'saved' | 'locked';
export type SiteInputStatus = 'role_missing' | 'role_saved' | 'reward_missing' | 'reward_saved' | 'locked';

interface TodayAssignmentsProps {
    assignments: Assignment[];
    sites: Site[];
    members: Member[];
    siteLineItemsBySiteId: Record<string, SiteLineItem[]>;
    onViewSiteMemo: (site: Site) => void;
    onPlanRole: (site: Site) => void;
    onRecordRewardInput: (site: Site) => void;
    onAddConstruction: (site: Site) => void;
    getDayLogStatus: (siteId: string) => DayLogStatus;
    getSiteInputStatus: (siteId: string) => SiteInputStatus;
}

interface ConstructionModalState {
    site: Site;
    items: SiteLineItem[];
}

interface TeamAssigneeSummary {
    id: string;
    name: string;
    initial: string;
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

function formatConstructionMeta(item: SiteLineItem) {
    const quantity = item.quantity == null
        ? null
        : `${Number(item.quantity).toLocaleString('ja-JP')}${item.unit_name || ''}`;
    const unitPrice = item.unit_price == null
        ? null
        : `@¥${Number(item.unit_price).toLocaleString('ja-JP')}`;

    return [quantity, unitPrice].filter(Boolean).join(' ') || '数量未設定';
}

function formatConstructionChip(item: SiteLineItem) {
    return item.item_name
        .replace(/\s+@?\d[\d,]*(?:\.\d+)?\s*(?:円|人工|㎡|m2|m²|式|個|枚|本|日)?$/i, '')
        .trim() || item.item_name;
}

function getClientContactLabel(site: Site | null) {
    const contactPerson = site?.client?.contact_person?.trim();
    return contactPerson ? `先方 ${contactPerson}` : '先方担当未設定';
}

function normalizePhoneHref(phone?: string | null) {
    const normalized = phone?.replace(/[^\d+]/g, '');
    return normalized ? `tel:${normalized}` : null;
}

function getMemberLabel(member: Member | undefined, fallback: string) {
    return member?.display_name || member?.full_name || member?.username || fallback;
}

function getInitial(label: string) {
    return Array.from(label.trim())[0] || '担';
}

function getTeamAssignees(site: Site | null, assignments: Assignment[], members: Member[]): TeamAssigneeSummary[] {
    const memberIds = new Set<string>();

    site?.assigned_users?.forEach((id) => {
        if (id) {
            memberIds.add(id);
        }
    });

    assignments.forEach((assignment) => {
        if (assignment.user_id && assignment.user_id !== 'site') {
            memberIds.add(assignment.user_id);
        }
    });

    return Array.from(memberIds).map((id) => {
        const member = members.find((item) => item.id === id || item.user_id === id);
        const name = getMemberLabel(member, '担当');
        return {
            id,
            name,
            initial: getInitial(name),
        };
    });
}

function getTeamAssigneeTotal(site: Site | null, assignments: Assignment[], assigneeCount: number) {
    const siteAssignedCount = site?.assigned_users?.length || 0;
    const workerCount = assignments.reduce((max, assignment) => {
        return Math.max(max, assignment.worker_count || 0);
    }, 0);

    return Math.max(assigneeCount, siteAssignedCount, workerCount);
}

function getTeamAssigneeLabel(assignees: TeamAssigneeSummary[], totalCount: number) {
    if (assignees.length > 0) {
        const names = assignees.map((assignee) => assignee.name).join('、');
        return `チーム担当: ${names}`;
    }

    if (totalCount > 0) {
        return `チーム担当: ${totalCount}名`;
    }

    return 'チーム担当未設定';
}

export function TodayAssignments({
    assignments,
    sites,
    members,
    siteLineItemsBySiteId,
    onViewSiteMemo,
    onPlanRole,
    onRecordRewardInput,
    onAddConstruction,
    getDayLogStatus,
    getSiteInputStatus,
}: TodayAssignmentsProps) {
    const [constructionModal, setConstructionModal] = useState<ConstructionModalState | null>(null);

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
            assignments: group,
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
                    const constructionItems = site.site ? siteLineItemsBySiteId[site.site.id] || [] : [];
                    const constructionLabels = constructionItems.map(formatConstructionChip);
                    const shouldMarqueeConstruction = constructionLabels.length > 3;
                    const clientContactLabel = getClientContactLabel(site.site);
                    const clientContactShortLabel = site.site?.client?.contact_person?.trim() || '先方';
                    const clientPhoneHref = normalizePhoneHref(site.site?.client?.phone);
                    const teamAssignees = getTeamAssignees(site.site, site.assignments, members);
                    const teamAssigneeTotal = getTeamAssigneeTotal(site.site, site.assignments, teamAssignees.length);
                    const visibleTeamAssignees = teamAssignees.slice(0, 3);
                    const hiddenTeamAssigneeCount = visibleTeamAssignees.length > 0
                        ? Math.max(0, teamAssigneeTotal - visibleTeamAssignees.length)
                        : 0;
                    const teamAssigneeLabel = getTeamAssigneeLabel(teamAssignees, teamAssigneeTotal);

                    return (
                    <div key={site.siteId || site.siteName} className={styles.assignmentCard}>
                        <div className={styles.assignmentMain}>
                            <div className={styles.assignmentTopRow}>
                                <div className={styles.assignmentHeading}>
                                    <div className={styles.siteTitleRow}>
                                        <div className={styles.siteName}>{site.siteName}</div>
                                    </div>
                                    {site.site?.client?.name && (
                                        <div className={styles.clientName}>{site.site.client.name}</div>
                                    )}
                                    {site.site?.address && (
                                        <div className={styles.assignmentAddressRow}>
                                            <span className={styles.assignmentAddress}>{site.site.address}</span>
                                        </div>
                                    )}
                                </div>
                                {site.site && (
                                    <div className={styles.siteTopActions}>
                                        {clientPhoneHref ? (
                                            <a
                                                className={styles.siteTopAction}
                                                href={clientPhoneHref}
                                                aria-label={`${clientContactLabel}に電話`}
                                                title={clientContactLabel}
                                            >
                                                <UserRound size={22} />
                                                <span>{clientContactShortLabel}</span>
                                            </a>
                                        ) : (
                                            <span
                                                className={styles.siteTopAction}
                                                role="img"
                                                aria-label={clientContactLabel}
                                                title={clientContactLabel}
                                            >
                                                <UserRound size={22} />
                                                <span>{clientContactShortLabel}</span>
                                            </span>
                                        )}
                                        {site.site.address && (
                                            <a
                                                className={styles.siteTopAction}
                                                href={buildGoogleMapsUrl(site.site.address)}
                                                target="_blank"
                                                rel="noreferrer"
                                                aria-label="地図を開く"
                                                title="地図を開く"
                                            >
                                                <MapPin size={22} />
                                                <span>地図</span>
                                            </a>
                                        )}
                                    </div>
                                )}
                            </div>
                            <div className={styles.assignmentMetaRow}>
                                <span className={styles.assignmentMeta}>
                                    <Clock3 size={14} />
                                    <span className={styles.assignmentMetaText}>{site.earliestStart || '時間未設定'}</span>
                                </span>
                                <span className={styles.teamAssignees} aria-label={teamAssigneeLabel}>
                                    {visibleTeamAssignees.length > 0 ? (
                                        visibleTeamAssignees.map((assignee) => (
                                            <span
                                                key={assignee.id}
                                                className={styles.teamAssigneeInitial}
                                                title={assignee.name}
                                                aria-hidden="true"
                                            >
                                                {assignee.initial}
                                            </span>
                                        ))
                                    ) : (
                                        <span
                                            className={`${styles.teamAssigneeInitial} ${styles.teamAssigneeEmpty}`}
                                            title={teamAssigneeLabel}
                                            aria-hidden="true"
                                        >
                                            {teamAssigneeTotal > 0 ? teamAssigneeTotal : '未'}
                                        </span>
                                    )}
                                    {hiddenTeamAssigneeCount > 0 && (
                                        <span className={styles.teamAssigneeMore} aria-hidden="true">
                                            +{hiddenTeamAssigneeCount}
                                        </span>
                                    )}
                                </span>
                            </div>

                            {site.site?.cautions && (
                                <div
                                    className={`${styles.assignmentInsight} ${styles.assignmentInsightCaution}`}
                                >
                                    <AlertTriangle size={14} />
                                    <span>{site.site.cautions}</span>
                                </div>
                            )}

                            {site.site && (
                                <div className={styles.constructionSection}>
                                    <button
                                        type="button"
                                        className={styles.constructionSummaryButton}
                                        onClick={() => setConstructionModal({ site: site.site!, items: constructionItems })}
                                        aria-label={`${site.siteName}の工事内容を見る`}
                                    >
                                        <span className={styles.constructionTitle}>
                                            <Hammer size={14} />
                                            工事内容
                                        </span>
                                        <span
                                            className={`${styles.constructionChips} ${
                                                shouldMarqueeConstruction ? styles.constructionChipsMarquee : ''
                                            }`}
                                        >
                                            {constructionLabels.length > 0 ? (
                                                <span className={styles.constructionTickerTrack}>
                                                    {[
                                                        ...constructionLabels,
                                                        ...(shouldMarqueeConstruction ? constructionLabels : []),
                                                    ].map((label, index) => (
                                                        <span
                                                            key={`${label}-${index}`}
                                                            className={styles.constructionChip}
                                                            aria-hidden={index >= constructionLabels.length}
                                                        >
                                                            {label}
                                                        </span>
                                                    ))}
                                                </span>
                                            ) : (
                                                <span className={`${styles.constructionChip} ${styles.constructionChipMuted}`}>
                                                    {site.site.description ? '説明あり' : '未登録'}
                                                </span>
                                            )}
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        className={styles.constructionAddButton}
                                        onClick={() => onAddConstruction(site.site!)}
                                    >
                                        <Plus size={14} />
                                        工事追加
                                    </button>
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

                        </div>
                    </div>
                    );
                })
            )}

            {constructionModal && (
                <div
                    className={styles.constructionModalOverlay}
                    onClick={() => setConstructionModal(null)}
                >
                    <div
                        className={styles.constructionModal}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="construction-modal-title"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className={styles.constructionModalHeader}>
                            <div>
                                <h3 id="construction-modal-title" className={styles.constructionModalTitle}>
                                    工事内容
                                </h3>
                                <p className={styles.constructionModalSite}>{constructionModal.site.name}</p>
                            </div>
                            <button
                                type="button"
                                className={styles.constructionModalClose}
                                onClick={() => setConstructionModal(null)}
                                aria-label="閉じる"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {constructionModal.site.description && (
                            <p className={styles.constructionModalDescription}>
                                {constructionModal.site.description}
                            </p>
                        )}

                        {constructionModal.items.length > 0 ? (
                            <div className={styles.constructionModalList}>
                                {constructionModal.items.map((item) => (
                                    <div key={item.id} className={styles.constructionModalItem}>
                                        <span className={styles.constructionModalItemName}>{item.item_name}</span>
                                        <span className={styles.constructionModalItemMeta}>
                                            {formatConstructionMeta(item)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className={styles.constructionModalEmpty}>
                                工事項目は未登録です
                            </div>
                        )}

                        <button
                            type="button"
                            className={styles.constructionModalAddButton}
                            onClick={() => {
                                const targetSite = constructionModal.site;
                                setConstructionModal(null);
                                onAddConstruction(targetSite);
                            }}
                        >
                            <Plus size={16} />
                            工事追加
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
