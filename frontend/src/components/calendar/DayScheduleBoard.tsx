import { useMemo, useState } from 'react';
import { Check, CheckCircle2 } from 'lucide-react';
import type { Member, SiteLineItem } from '../../lib/api';
import type {
    DayScheduleBoardModel,
    DayScheduleSiteBoard,
} from '../../lib/dayScheduleBoard';
import styles from './DayScheduleBoard.module.css';

interface AssignmentToggleInput {
    date: string;
    site: DayScheduleSiteBoard;
    member: Member;
    selected: boolean;
    workLabel: string | null;
}

interface DayScheduleBoardProps {
    board: DayScheduleBoardModel;
    members: Member[];
    lineItemsBySiteId: Record<string, SiteLineItem[] | undefined>;
    selectedLineItemByDateSite: Record<string, string | null>;
    busyWorkerKeys: string[];
    onToggleWorker: (input: AssignmentToggleInput) => Promise<{ ok: boolean; message?: string }>;
    onSelectLineItem: (date: string, siteId: string, lineItemId: string | null) => void;
    readOnly?: boolean;
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

function getDateSiteKey(date: string, siteId: string): string {
    return `${date}:${siteId}`;
}

function formatLineItemLabel(item: SiteLineItem): string {
    const quantity = item.quantity != null ? String(item.quantity) : "";
    const unit = item.unit_name?.trim() || "";
    const amount = quantity || unit ? ` ${quantity}${unit}` : "";
    return `${item.item_name}${amount}`;
}

function getSelectedLineItem(
    items: SiteLineItem[] | undefined,
    selectedId: string | null | undefined
): SiteLineItem | null {
    if (!items || items.length === 0) {
        return null;
    }

    return items.find((item) => item.id === selectedId) ?? items[0] ?? null;
}

export function DayScheduleBoard({
    board,
    members,
    lineItemsBySiteId,
    selectedLineItemByDateSite,
    busyWorkerKeys,
    onToggleWorker,
    onSelectLineItem,
    readOnly = false,
}: DayScheduleBoardProps) {
    const [message, setMessage] = useState<string | null>(null);

    const selectableMembers = useMemo(
        () =>
            members.filter((member) => {
                const active = member.status !== 'removed' && member.status !== 'suspended';
                const workerStatus = board.worker_status_by_id[member.id];
                return active && workerStatus?.severity !== 'blocked';
            }),
        [board.worker_status_by_id, members]
    );

    const handleToggleWorker = (
        site: DayScheduleSiteBoard,
        member: Member,
        selectedLineItem: SiteLineItem | null,
        selected: boolean
    ) => {
        if (readOnly) {
            setMessage('過去月は閲覧専用です。修正は新しい月の逆仕訳で行います。');
            return;
        }

        const workLabel = selectedLineItem ? formatLineItemLabel(selectedLineItem) : null;
        setMessage(null);
        void onToggleWorker({
            date: board.date,
            site,
            member,
            selected,
            workLabel,
        }).then((result) => {
            setMessage(result.ok ? null : result.message || '担当を変えられませんでした。');
        });
    };

    return (
        <section className={styles.container}>
            <header className={styles.header}>
                <h3>{formatDateLabel(board.date)} の現場</h3>
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
                        const lineItems = lineItemsBySiteId[site.site_id] ?? [];
                        const selectedKey = getDateSiteKey(board.date, site.site_id);
                        const selectedLineItemId = selectedLineItemByDateSite[selectedKey];
                        const selectedLineItem = getSelectedLineItem(lineItems, selectedLineItemId);

                        return (
                            <article
                                key={site.site_id}
                                className={`${styles.siteCard} ${
                                    site.is_completed
                                        ? styles.siteCardCompleted
                                        : ''
                                }`}
                            >
                                <div className={styles.siteHeader}>
                                    <h4>{site.site_name}</h4>
                                    {site.is_completed ? (
                                        <span className={styles.completionBadge}>
                                            <CheckCircle2 size={14} />
                                            完了
                                        </span>
                                    ) : null}
                                </div>

                                <div className={styles.workContentField}>
                                    <label htmlFor={`work-content-${site.site_id}`}>工事内容</label>
                                    {lineItems.length > 0 ? (
                                        <select
                                            id={`work-content-${site.site_id}`}
                                            className={styles.workContentSelect}
                                            value={selectedLineItem?.id ?? lineItems[0]?.id ?? ""}
                                            onChange={(event) =>
                                                onSelectLineItem(board.date, site.site_id, event.target.value || null)
                                            }
                                        >
                                            {lineItems.map((item) => (
                                                <option key={item.id} value={item.id}>
                                                    {formatLineItemLabel(item)}
                                                </option>
                                            ))}
                                        </select>
                                    ) : (
                                        <span className={styles.missingWorkChip}>工事内容未登録</span>
                                    )}
                                </div>

                                {!site.is_completed && (
                                    <div className={styles.workerChipGrid}>
                                        {selectableMembers.map((member) => {
                                            const draftWorker = site.draft_workers.find(
                                                (worker) => worker.id === member.id
                                            );
                                            const confirmedHere = site.confirmed_workers.some(
                                                (worker) => worker.id === member.id
                                            );
                                            const assignedForDate = board.assigned_worker_ids_for_date.includes(member.id);
                                            const disabled = readOnly || (assignedForDate && !draftWorker && !confirmedHere);
                                            const selected = Boolean(draftWorker || confirmedHere);
                                            const busy = busyWorkerKeys.includes(
                                                `${board.date}:${site.site_id}:${member.id}`
                                            );
                                            const memberLabel = getMemberLabel(member);

                                            return (
                                                <button
                                                    key={member.id}
                                                    type="button"
                                                    className={[
                                                        styles.workerToggleChip,
                                                        selected ? styles.workerToggleChipSelected : '',
                                                        draftWorker ? styles.workerToggleChipDraft : '',
                                                    ]
                                                        .filter(Boolean)
                                                        .join(' ')}
                                                    disabled={disabled}
                                                    aria-disabled={disabled ? 'true' : undefined}
                                                    onClick={() => {
                                                        if (busy) {
                                                            return;
                                                        }
                                                        handleToggleWorker(site, member, selectedLineItem, selected);
                                                    }}
                                                    aria-pressed={selected}
                                                >
                                                    {selected && <Check size={13} aria-hidden="true" />}
                                                    <span>{memberLabel}</span>
                                                    {draftWorker?.work_label && (
                                                        <small>{draftWorker.work_label}</small>
                                                    )}
                                                    {disabled && <small>別現場</small>}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </article>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
