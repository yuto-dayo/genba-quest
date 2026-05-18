import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { PayoutHeroCard } from "./PayoutHeroCard";
import { usePayoutSelection } from "./usePayoutSelection";
import type {
    TeamMemberReimbursementLike,
    TeamMemberRewardLike,
} from "./MemberCarousel";
import type { PayoutTaxClassification } from "./payoutTaxUtils";

vi.mock("framer-motion", () => ({
    motion: new Proxy(
        {},
        {
            get: () => ({ children, ...props }: ComponentProps<"div">) => {
                const rest = { ...props } as Record<string, unknown>;
                delete rest.initial;
                delete rest.animate;
                delete rest.exit;
                delete rest.transition;
                return <div {...rest}>{children}</div>;
            },
        },
    ),
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
    useReducedMotion: () => false,
    animate: (_from: number, to: number, options: { onUpdate?: (latest: number) => void }) => {
        options.onUpdate?.(to);
        return { stop: vi.fn() };
    },
}));

const rewardMembers: TeamMemberRewardLike[] = [
    {
        member_id: "member-other",
        nickname: "タケ",
        level: "L3",
        level_source: "history",
        attendance_days: 18,
        amount: 210000,
        status: "finalized",
        has_invoice: true,
        has_paid: false,
    },
    {
        member_id: "member-self",
        nickname: "ユウト",
        level: "L4",
        level_source: "history",
        attendance_days: 20,
        amount: 192500,
        status: "preview",
        has_invoice: false,
        has_paid: false,
    },
];

const reimbursementMembers: TeamMemberReimbursementLike[] = [
    {
        member_id: "member-self",
        nickname: "ユウト",
        total_advanced: 45000,
        unsettled: 32500,
        settled: 12500,
        count_pending: 2,
        status: "pending",
    },
    {
        member_id: "member-other",
        nickname: "タケ",
        total_advanced: 12000,
        unsettled: 10000,
        settled: 2000,
        count_pending: 1,
        status: "pending",
    },
];

const memberTaxClassifications: Record<string, PayoutTaxClassification> = {
    "member-self": {
        contract_type: "subcontract",
        tax_withholding_category: "none",
        custom_withholding_rate: null,
        classification_check_status: "verified",
        classification_check_results: {
            q1_substitution: true,
            q2_time_freedom: true,
            q3_work_autonomy: true,
            q4_own_tools: true,
            q5_outcome_liability: true,
        },
        classification_notes: null,
        invoice_registration_status: "registered",
        invoice_registration_number: "T1234567890123",
        effective_from: "2026-05-01",
        decided_by: "admin-user",
        decided_at: "2026-05-02T00:00:00.000Z",
    },
    "member-other": {
        contract_type: "employee_like",
        tax_withholding_category: "10.21%",
        custom_withholding_rate: null,
        classification_check_status: "review_needed",
        classification_check_results: {
            q1_substitution: false,
            q2_time_freedom: false,
            q3_work_autonomy: false,
            q4_own_tools: true,
            q5_outcome_liability: true,
        },
        classification_notes: null,
        invoice_registration_status: "exempt",
        invoice_registration_number: null,
        effective_from: "2026-05-01",
        decided_by: "admin-user",
        decided_at: "2026-05-02T00:00:00.000Z",
    },
};

function Harness({
    onCardTap = vi.fn(),
}: {
    onCardTap?: (memberId: string) => void;
}) {
    const selection = usePayoutSelection("member-self");

    return (
        <PayoutHeroCard
            rewardMembers={rewardMembers}
            reimbursementMembers={reimbursementMembers}
            selfMemberId="member-self"
            isFinalized={false}
            selectedMemberId={selection.selectedMemberId}
            viewMode={selection.viewMode}
            memberTaxClassifications={memberTaxClassifications}
            onSelectMember={selection.onSelectMember}
            onCardTap={onCardTap}
        />
    );
}

describe("PayoutHeroCard", () => {
    it("renders chips in self, other, all order and shows the combined self payout", () => {
        render(<Harness />);

        const tabs = screen.getAllByRole("tab");
        expect(tabs.map((tab) => tab.textContent)).toEqual(["自分", "タケ", "全員"]);
        expect(tabs[0]).toHaveAttribute("aria-selected", "true");
        expect(tabs[0]).toHaveAttribute("aria-controls", "payout-hero-content");

        expect(screen.getByText("振込予定額")).toBeInTheDocument();
        expect(screen.getByLabelText("インボイス登録状況 適格")).toBeInTheDocument();
        expect(screen.getByText("¥225,000")).toBeInTheDocument();
        expect(screen.getByText("報酬 ¥192,500 + 立替 ¥32,500")).toBeInTheDocument();
        expect(screen.getByText("20日 · 試算中")).toBeInTheDocument();
    });

    it("switches member chips and opens the member modal from the detail button", () => {
        const onCardTap = vi.fn();
        render(<Harness onCardTap={onCardTap} />);

        fireEvent.click(screen.getByRole("tab", { name: "タケ" }));

        expect(screen.getByText("¥220,000")).toBeInTheDocument();
        expect(screen.getByText("報酬 ¥210,000 + 立替 ¥10,000")).toBeInTheDocument();
        expect(screen.getByLabelText("インボイス登録状況 経過措置 100%")).toBeInTheDocument();
        expect(screen.getByText("契約確認")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "もっと詳しく →" }));

        expect(onCardTap).toHaveBeenCalledWith("member-other");
    });

    it("shows all members as a semantic table and row taps open the modal", () => {
        const onCardTap = vi.fn();
        render(<Harness onCardTap={onCardTap} />);

        fireEvent.click(screen.getByRole("tab", { name: "全員" }));

        const table = screen.getByRole("table");
        expect(within(table).getByRole("columnheader", { name: "名前" })).toBeInTheDocument();
        expect(within(table).getByRole("columnheader", { name: "日数" })).toBeInTheDocument();
        expect(within(table).getByRole("columnheader", { name: "報酬" })).toBeInTheDocument();
        expect(within(table).getByRole("columnheader", { name: "振込予定" })).toBeInTheDocument();
        expect(screen.queryByRole("columnheader", { name: "level" })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("row", { name: "タケの振込予定 ¥220,000" }));

        expect(onCardTap).toHaveBeenCalledWith("member-other");
    });

    it("supports arrow-key chip navigation with selected tab state", () => {
        render(<Harness />);

        const tablist = screen.getByRole("tablist", { name: "振込予定の表示メンバー" });
        const tabs = screen.getAllByRole("tab");
        tabs[0].focus();

        fireEvent.keyDown(tablist, { key: "ArrowRight" });

        expect(tabs[1]).toHaveFocus();
        expect(tabs[1]).toHaveAttribute("aria-selected", "true");
        expect(screen.getByText("¥220,000")).toBeInTheDocument();
    });
});
