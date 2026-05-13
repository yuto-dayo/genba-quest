import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LevelRevisionSheet } from "./LevelRevisionSheet";

const revisePathV33LevelDraft = vi.fn();
const fetchSite = vi.fn();

vi.mock("framer-motion", () => ({
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
    motion: new Proxy(
        {},
        {
            get: () => ({ children, ...props }: ComponentProps<"div">) => <div {...props}>{children}</div>,
        },
    ),
}));

vi.mock("../lib/api", async () => {
    const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
    return {
        ...actual,
        revisePathV33LevelDraft: (...args: unknown[]) => revisePathV33LevelDraft(...args),
        fetchSite: (...args: unknown[]) => fetchSite(...args),
    };
});

const baseDraft = {
    id: "draft-1",
    org_id: "org-1",
    site_id: "site-1",
    member_id: "member-1",
    tier: 2 as const,
    work_days: 2,
    self_comment: "before",
    evidence: {},
    submitted_at: "2026-05-01T00:00:00.000Z",
    locked_at: null,
};

describe("LevelRevisionSheet", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fetchSite.mockResolvedValue({
            id: "site-1",
            name: "A棟クロス",
            address: "東京都渋谷区1-2-3",
            work_types: ["内装"],
        });
        revisePathV33LevelDraft.mockResolvedValue({
            draft: { ...baseDraft, tier: 3, self_comment: "after" },
            preview: {},
        });
    });

    it("disables submit when reason is empty", async () => {
        render(
            <LevelRevisionSheet
                open
                onClose={() => {}}
                draft={baseDraft}
                memberId="member-1"
            />,
        );

        const submit = await screen.findByRole("button", { name: "変更を保存" });
        expect(submit).toBeDisabled();
    });

    it("enables submit when reason is filled", async () => {
        render(
            <LevelRevisionSheet
                open
                onClose={() => {}}
                draft={baseDraft}
                memberId="member-1"
            />,
        );

        await waitFor(() => {
            expect(fetchSite).toHaveBeenCalledWith("site-1");
        });
        const reasonInput = screen.getByPlaceholderText("なぜ修正するかを入力してください");
        fireEvent.change(reasonInput, { target: { value: "理由あり" } });

        await waitFor(() => {
            expect(screen.getByRole("button", { name: "変更を保存" })).toBeEnabled();
        });
    });

    it("calls onRevised after successful submit", async () => {
        const onRevised = vi.fn();
        const onClose = vi.fn();

        render(
            <LevelRevisionSheet
                open
                onClose={onClose}
                draft={baseDraft}
                memberId="member-1"
                onRevised={onRevised}
            />,
        );

        await waitFor(() => {
            expect(fetchSite).toHaveBeenCalledWith("site-1");
        });
        fireEvent.change(screen.getByPlaceholderText("なぜ修正するかを入力してください"), {
            target: { value: "理由あり" },
        });
        fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));

        await waitFor(() => {
            expect(revisePathV33LevelDraft).toHaveBeenCalledWith(
                expect.objectContaining({ draft_id: "draft-1", reason: "理由あり" }),
            );
        });
        await waitFor(() => {
            expect(onRevised).toHaveBeenCalled();
            expect(onClose).toHaveBeenCalled();
        });
    });

    it("shows mapped lock error message", async () => {
        revisePathV33LevelDraft.mockRejectedValue(new Error("PATH_V33_DRAFT_LOCKED"));

        render(
            <LevelRevisionSheet
                open
                onClose={() => {}}
                draft={baseDraft}
                memberId="member-1"
            />,
        );

        await waitFor(() => {
            expect(fetchSite).toHaveBeenCalledWith("site-1");
        });
        fireEvent.change(screen.getByPlaceholderText("なぜ修正するかを入力してください"), {
            target: { value: "理由あり" },
        });
        fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));

        await waitFor(() => {
            expect(
                screen.getByText("修正に失敗: この申告は確定済みのため修正できません。月締め後の変更は管理者に相談してください。"),
            ).toBeInTheDocument();
        });
    });
});
