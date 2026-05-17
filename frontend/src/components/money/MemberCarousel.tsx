import { MemberCard, SeeAllCard, type MoneyStatusTone } from "./MemberCard";
import { track } from "../../lib/telemetry";
import styles from "./MemberCarousel.module.css";

export interface TeamMemberRewardLike {
    member_id: string;
    nickname: string;
    level: "L1" | "L2" | "L3" | "L4" | "L5";
    attendance_days: number;
    amount: number;
    status: "finalized" | "preview" | "pending";
    has_invoice: boolean;
    has_paid: boolean;
}

export interface TeamMemberReimbursementLike {
    member_id: string;
    nickname: string;
    total_advanced: number;
    unsettled: number;
    settled: number;
    count_pending: number;
    status: "pending" | "in_review" | "none" | "settled";
}

type RewardProps = {
    mode: "reward";
    members: TeamMemberRewardLike[];
    selfMemberId?: string | null;
    isFinalized: boolean;
    onCardTap: (memberId: string) => void;
    onSeeAllTap: () => void;
};

type ExpenseProps = {
    mode: "expense";
    members: TeamMemberReimbursementLike[];
    selfMemberId?: string | null;
    onCardTap: (memberId: string) => void;
    onSeeAllTap: () => void;
};

type MemberCarouselProps = RewardProps | ExpenseProps;

function sortRewardMembers(
    members: TeamMemberRewardLike[],
    selfMemberId?: string | null,
) {
    const self = selfMemberId ? members.find((member) => member.member_id === selfMemberId) : null;
    const rest = members
        .filter((member) => member.member_id !== self?.member_id)
        .sort((left, right) => right.attendance_days - left.attendance_days);
    return self ? [self, ...rest] : rest;
}

function sortExpenseMembers(
    members: TeamMemberReimbursementLike[],
    selfMemberId?: string | null,
) {
    const self = selfMemberId ? members.find((member) => member.member_id === selfMemberId) : null;
    const rest = members
        .filter((member) => member.member_id !== self?.member_id)
        .sort((left, right) => right.total_advanced - left.total_advanced);
    return self ? [self, ...rest] : rest;
}

function rewardStatus(member: TeamMemberRewardLike, isFinalized: boolean): {
    label: string;
    tone: MoneyStatusTone;
    ctaLabel?: string;
} {
    if (!isFinalized || member.status === "preview") {
        return { label: "試算中", tone: "draft" };
    }
    if (member.has_paid) {
        return { label: "支払済", tone: "completed" };
    }
    if (member.has_invoice) {
        return { label: "発行済", tone: "completed" };
    }
    return { label: "未発行", tone: "pending", ctaLabel: "請求書を出す" };
}

function expenseStatus(status: TeamMemberReimbursementLike["status"]): {
    label: string;
    tone: MoneyStatusTone;
} {
    switch (status) {
        case "pending":
            return { label: "精算待ち", tone: "pending" };
        case "in_review":
            return { label: "確認中", tone: "draft" };
        case "settled":
            return { label: "振込済", tone: "completed" };
        case "none":
        default:
            return { label: "なし", tone: "draft" };
    }
}

export function MemberCarousel(props: MemberCarouselProps) {
    if (props.mode === "reward") {
        const orderedMembers = sortRewardMembers(props.members, props.selfMemberId);
        const inferredSelfId = props.selfMemberId ?? null;
        const showSeeAll = orderedMembers.length > 1;

        return (
            <div className={styles.carousel} role="list">
                {orderedMembers.length === 0 && (
                    <div className={styles.emptyCard} role="listitem">
                        報酬なし
                    </div>
                )}
                {orderedMembers.map((member) => {
                    const isSelf = member.member_id === inferredSelfId;
                    const status = rewardStatus(member, props.isFinalized);
                    return (
                        <div role="listitem" key={member.member_id}>
                            <MemberCard
                                mode="reward"
                                variant={isSelf ? "self" : "other"}
                                name={member.nickname}
                                amount={member.amount}
                                statusLabel={status.label}
                                statusTone={status.tone}
                                subLabel={`${member.level} / ${member.attendance_days}日`}
                                ctaLabel={isSelf ? status.ctaLabel : undefined}
                                onTap={() => {
                                    track({
                                        type: "money.reward_card.tapped",
                                        is_self: isSelf,
                                        status: member.status,
                                    });
                                    props.onCardTap(member.member_id);
                                }}
                            />
                        </div>
                    );
                })}
                {showSeeAll && (
                    <div role="listitem">
                        <SeeAllCard onTap={props.onSeeAllTap} />
                    </div>
                )}
            </div>
        );
    }

    const orderedMembers = sortExpenseMembers(props.members, props.selfMemberId);
    const inferredSelfId = props.selfMemberId ?? null;
    const showSeeAll = orderedMembers.length > 1;

    return (
        <div className={styles.carousel} role="list">
            {orderedMembers.length === 0 && (
                <div className={styles.emptyCard} role="listitem">
                    立替なし
                </div>
            )}
            {orderedMembers.map((member) => {
                const isSelf = member.member_id === inferredSelfId;
                const status = expenseStatus(member.status);
                return (
                    <div role="listitem" key={member.member_id}>
                        <MemberCard
                            mode="expense"
                            variant={isSelf ? "self" : "other"}
                            name={member.nickname}
                            amount={member.unsettled || member.total_advanced}
                            statusLabel={status.label}
                            statusTone={status.tone}
                            subLabel={`${member.count_pending}件`}
                            onTap={() => props.onCardTap(member.member_id)}
                        />
                    </div>
                );
            })}
            {showSeeAll && (
                <div role="listitem">
                    <SeeAllCard onTap={props.onSeeAllTap} />
                </div>
            )}
        </div>
    );
}
