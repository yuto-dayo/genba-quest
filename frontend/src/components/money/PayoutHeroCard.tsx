import {
    AnimatePresence,
    animate,
    motion as framerMotion,
    useReducedMotion,
} from "framer-motion";
import {
    type KeyboardEvent,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { motion as motionTokens } from "../../lib/motion/tokens";
import type {
    TeamMemberReimbursementLike,
    TeamMemberRewardLike,
} from "./MemberCarousel";
import styles from "./PayoutHeroCard.module.css";

export type {
    TeamMemberReimbursementLike,
    TeamMemberRewardLike,
} from "./MemberCarousel";

interface PayoutHeroCardProps {
    rewardMembers: TeamMemberRewardLike[];
    reimbursementMembers: TeamMemberReimbursementLike[];
    selfMemberId: string | null;
    isFinalized: boolean;
    selectedMemberId: string | null;
    viewMode: "single" | "all";
    pendingDisputeMemberIds?: string[];
    onSelectMember: (memberId: string | "all") => void;
    onCardTap: (memberId: string) => void;
}

export interface PayoutMember {
    member_id: string;
    nickname: string;
    attendance_days: number;
    rewardAmount: number;
    reimbursementAmount: number;
    payoutAmount: number;
}

const formatYen = (amount: number) =>
    `¥${new Intl.NumberFormat("ja-JP", {
        maximumFractionDigits: 0,
    }).format(amount)}`;

const payoutAmount = (
    member: Pick<TeamMemberRewardLike, "amount">,
    reimbursement: Pick<TeamMemberReimbursementLike, "unsettled"> | undefined,
) => member.amount + (reimbursement?.unsettled ?? 0);

function combineMembers(
    rewardMembers: TeamMemberRewardLike[],
    reimbursementMembers: TeamMemberReimbursementLike[],
    selfMemberId: string | null,
): PayoutMember[] {
    const reimbursementByMember = new Map(
        reimbursementMembers.map((member) => [member.member_id, member]),
    );
    const rewardByMember = new Map(
        rewardMembers.map((member) => [member.member_id, member]),
    );
    const ids = new Set<string>([
        ...rewardMembers.map((member) => member.member_id),
        ...reimbursementMembers.map((member) => member.member_id),
    ]);

    return Array.from(ids)
        .map((memberId) => {
            const reward = rewardByMember.get(memberId);
            const reimbursement = reimbursementByMember.get(memberId);
            const rewardAmount = reward?.amount ?? 0;
            const reimbursementAmount = reimbursement?.unsettled ?? 0;
            return {
                member_id: memberId,
                nickname: reward?.nickname ?? reimbursement?.nickname ?? "メンバー",
                attendance_days: reward?.attendance_days ?? 0,
                rewardAmount,
                reimbursementAmount,
                payoutAmount: reward
                    ? payoutAmount(reward, reimbursement)
                    : reimbursementAmount,
            };
        })
        .sort((left, right) => {
            if (left.member_id === selfMemberId) return -1;
            if (right.member_id === selfMemberId) return 1;
            return right.attendance_days - left.attendance_days;
        });
}

function statusLabel(isFinalized: boolean) {
    return isFinalized ? "確定済" : "試算中";
}

function AnimatedCurrency({ amount }: { amount: number }) {
    const shouldReduceMotion = useReducedMotion();
    const [displayAmount, setDisplayAmount] = useState(amount);
    const currentAmountRef = useRef(amount);

    useEffect(() => {
        if (shouldReduceMotion) {
            currentAmountRef.current = amount;
            return;
        }

        const controls = animate(currentAmountRef.current, amount, {
            type: "spring",
            stiffness: 120,
            damping: 20,
            mass: 1,
            restDelta: 1,
            onUpdate: (latest) => {
                const nextAmount = Math.round(latest);
                currentAmountRef.current = nextAmount;
                setDisplayAmount(nextAmount);
            },
        });

        return () => controls.stop();
    }, [amount, shouldReduceMotion]);

    return (
        <span className={styles.heroAmount}>
            {formatYen(shouldReduceMotion ? amount : displayAmount)}
        </span>
    );
}

export function PayoutMemberChips({
    members,
    selfMemberId,
    selectedMemberId,
    viewMode,
    contentId,
    onSelectMember,
}: {
    members: PayoutMember[];
    selfMemberId: string | null;
    selectedMemberId: string | null;
    viewMode: "single" | "all";
    contentId: string;
    onSelectMember: (memberId: string | "all") => void;
}) {
    const options = [
        ...members.map((member) => ({
            id: member.member_id,
            label: member.member_id === selfMemberId ? "自分" : member.nickname,
            value: member.member_id,
            selected: viewMode === "single" && selectedMemberId === member.member_id,
        })),
        {
            id: "all",
            label: "全員",
            value: "all" as const,
            selected: viewMode === "all",
        },
    ];

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
            return;
        }
        event.preventDefault();

        const tabs = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
        );
        const activeIndex = tabs.findIndex((tab) => tab === document.activeElement);
        const fallbackIndex = options.findIndex((option) => option.selected);
        const currentIndex = activeIndex >= 0 ? activeIndex : Math.max(fallbackIndex, 0);
        const nextIndex = event.key === "ArrowRight"
            ? (currentIndex + 1) % tabs.length
            : (currentIndex - 1 + tabs.length) % tabs.length;
        const nextOption = options[nextIndex];

        tabs[nextIndex]?.focus();
        if (nextOption) {
            onSelectMember(nextOption.value);
        }
    };

    return (
        <div
            className={styles.chips}
            role="tablist"
            aria-label="振込予定の表示メンバー"
            onKeyDown={handleKeyDown}
        >
            {options.map((option) => (
                <button
                    key={option.id}
                    type="button"
                    role="tab"
                    aria-selected={option.selected}
                    aria-controls={contentId}
                    className={styles.chip}
                    onClick={() => onSelectMember(option.value)}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
}

export function PayoutAllMembersList({
    members,
    selfMemberId,
    pendingDisputeMemberIds = [],
    onCardTap,
}: {
    members: PayoutMember[];
    selfMemberId: string | null;
    pendingDisputeMemberIds?: string[];
    onCardTap: (memberId: string) => void;
}) {
    const pendingDisputes = new Set(pendingDisputeMemberIds);
    const handleRowKeyDown = (
        event: KeyboardEvent<HTMLTableRowElement>,
        memberId: string,
    ) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onCardTap(memberId);
        }
    };

    return (
        <div className={styles.tableWrap}>
            <table className={styles.table}>
                <thead>
                    <tr>
                        <th scope="col">名前</th>
                        <th scope="col">日数</th>
                        <th scope="col">報酬</th>
                        <th scope="col">振込予定</th>
                    </tr>
                </thead>
                <tbody>
                    {members.map((member) => {
                        const isSelf = member.member_id === selfMemberId;
                        return (
                            <tr
                                key={member.member_id}
                                className={isSelf ? styles.selfRow : undefined}
                                tabIndex={0}
                                onClick={() => onCardTap(member.member_id)}
                                onKeyDown={(event) => handleRowKeyDown(event, member.member_id)}
                                aria-label={`${isSelf ? "自分" : member.nickname}の振込予定 ${formatYen(member.payoutAmount)}`}
                            >
                                <th scope="row">
                                    {isSelf ? "自分" : member.nickname}
                                    {pendingDisputes.has(member.member_id) && (
                                        <span className={styles.disputeBadge}>申立中</span>
                                    )}
                                </th>
                                <td>{member.attendance_days}日</td>
                                <td>{formatYen(member.rewardAmount)}</td>
                                <td>{formatYen(member.payoutAmount)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

export function PayoutHeroCard({
    rewardMembers,
    reimbursementMembers,
    selfMemberId,
    isFinalized,
    selectedMemberId,
    viewMode,
    pendingDisputeMemberIds = [],
    onSelectMember,
    onCardTap,
}: PayoutHeroCardProps) {
    const shouldReduceMotion = useReducedMotion();
    const members = useMemo(
        () => combineMembers(rewardMembers, reimbursementMembers, selfMemberId),
        [reimbursementMembers, rewardMembers, selfMemberId],
    );
    const activeMember = viewMode === "single"
        ? members.find((member) => member.member_id === selectedMemberId) ?? members[0] ?? null
        : null;
    const contentId = "payout-hero-content";
    const currentStatus = statusLabel(isFinalized);
    const pendingDisputes = new Set(pendingDisputeMemberIds);

    return (
        <div className={styles.card}>
            <PayoutMemberChips
                members={members}
                selfMemberId={selfMemberId}
                selectedMemberId={activeMember?.member_id ?? selectedMemberId}
                viewMode={viewMode}
                contentId={contentId}
                onSelectMember={onSelectMember}
            />

            <div
                id={contentId}
                className={styles.content}
                aria-live="polite"
                aria-atomic="true"
            >
                <AnimatePresence mode="wait" initial={false}>
                    {viewMode === "all" ? (
                        <framerMotion.div
                            key="all"
                            className={styles.view}
                            initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={shouldReduceMotion ? undefined : { opacity: 0, y: -8 }}
                            transition={motionTokens.effects}
                        >
                            <PayoutAllMembersList
                                members={members}
                                selfMemberId={selfMemberId}
                                pendingDisputeMemberIds={pendingDisputeMemberIds}
                                onCardTap={onCardTap}
                            />
                        </framerMotion.div>
                    ) : (
                        <framerMotion.div
                            key={activeMember?.member_id ?? "empty"}
                            className={styles.view}
                            initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={shouldReduceMotion ? undefined : { opacity: 0, y: -8 }}
                            transition={motionTokens.effects}
                        >
                            {activeMember ? (
                                <div className={styles.single}>
                                    <framerMotion.span
                                        key={`label-${activeMember.member_id}`}
                                        className={styles.heroLabel}
                                        initial={shouldReduceMotion ? false : { opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={motionTokens.effects}
                                    >
                                        振込予定額
                                    </framerMotion.span>
                                    <AnimatedCurrency amount={activeMember.payoutAmount} />
                                    <div className={styles.breakdown}>
                                        報酬 {formatYen(activeMember.rewardAmount)} + 立替 {formatYen(activeMember.reimbursementAmount)}
                                    </div>
                                    <div className={styles.meta}>
                                        {activeMember.attendance_days}日 · {currentStatus}
                                        {pendingDisputes.has(activeMember.member_id) && (
                                            <span className={styles.inlineBadge}>申立中</span>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        className={styles.detailButton}
                                        onClick={() => onCardTap(activeMember.member_id)}
                                    >
                                        もっと詳しく →
                                    </button>
                                </div>
                            ) : (
                                <div className={styles.empty}>振込予定なし</div>
                            )}
                        </framerMotion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}
