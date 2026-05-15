import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemberCarousel } from "./MemberCarousel";

describe("MemberCarousel", () => {
    it("pins the reward self member first and routes the tap with that member id", () => {
        const onCardTap = vi.fn();

        render(
            <MemberCarousel
                mode="reward"
                selfMemberId="membership-self"
                isFinalized
                onCardTap={onCardTap}
                onSeeAllTap={vi.fn()}
                members={[
                    {
                        member_id: "membership-other",
                        nickname: "タケ",
                        level: "L3",
                        attendance_days: 18,
                        amount: 210000,
                        status: "finalized",
                        has_invoice: true,
                        has_paid: false,
                    },
                    {
                        member_id: "membership-self",
                        nickname: "ユウト",
                        level: "L3",
                        attendance_days: 12,
                        amount: 245000,
                        status: "finalized",
                        has_invoice: false,
                        has_paid: false,
                    },
                ]}
            />,
        );

        const cards = screen.getAllByRole("button");
        expect(cards[0]).toHaveAccessibleName(/自分、報酬/);
        expect(cards[0]).toHaveTextContent("請求書を出す");

        fireEvent.click(cards[0]);

        expect(onCardTap).toHaveBeenCalledWith("membership-self");
    });

    it("pins the reimbursement self member first", () => {
        render(
            <MemberCarousel
                mode="expense"
                selfMemberId="membership-self"
                onCardTap={vi.fn()}
                onSeeAllTap={vi.fn()}
                members={[
                    {
                        member_id: "membership-other",
                        nickname: "タケ",
                        total_advanced: 12000,
                        unsettled: 12000,
                        settled: 0,
                        count_pending: 1,
                        status: "pending",
                    },
                    {
                        member_id: "membership-self",
                        nickname: "ユウト",
                        total_advanced: 4500,
                        unsettled: 4500,
                        settled: 0,
                        count_pending: 1,
                        status: "in_review",
                    },
                ]}
            />,
        );

        expect(screen.getAllByRole("button")[0]).toHaveAccessibleName(/自分、立替/);
    });
});
