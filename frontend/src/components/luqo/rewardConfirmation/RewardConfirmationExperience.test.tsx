import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RewardConfirmationExperience } from "./RewardConfirmationExperience";

const fetchOrgContext = vi.fn();
const fetchPathRewardConfirmation = vi.fn();
const askPathRewardConfirmationQuestion = vi.fn();
const getSession = vi.fn();

vi.mock("../../../lib/api", async () => {
    const actual = await vi.importActual<typeof import("../../../lib/api")>("../../../lib/api");
    return {
        ...actual,
        fetchOrgContext: (...args: unknown[]) => fetchOrgContext(...args),
        fetchPathRewardConfirmation: (...args: unknown[]) => fetchPathRewardConfirmation(...args),
        askPathRewardConfirmationQuestion: (...args: unknown[]) => askPathRewardConfirmationQuestion(...args),
    };
});

vi.mock("../../../lib/supabase", () => ({
    supabase: {
        auth: {
            getSession: (...args: unknown[]) => getSession(...args),
        },
    },
}));

vi.mock("../PathV31Tab", () => ({
    PathV31Tab: () => <div>path-v31-tab</div>,
}));

const summary = {
    month: "2026-04",
    member_id: "member-1",
    member_name: "田中 太郎",
    status: "試算中" as const,
    estimated_amount: 160000,
    base_amount: 90000,
    result_amount: 65000,
    correction_amount: 5000,
    delta_amount: 10000,
    delta_empty_state: null,
    top_reasons: [
        {
            key: "workload" as const,
            label: "稼働量差分",
            direction: "increase" as const,
            summary: "最低保証が増えています",
            impact_amount: 10000,
            evidence_refs: [{ kind: "status" as const, label: "最低保証 90,000円" }],
        },
    ],
    increase_reasons: [
        {
            key: "workload" as const,
            label: "稼働量差分",
            direction: "increase" as const,
            summary: "最低保証が増えています",
            impact_amount: 10000,
            evidence_refs: [{ kind: "status" as const, label: "最低保証 90,000円" }],
        },
    ],
    decrease_reasons: [],
    explanation_cards: [],
    explanation_missing: false,
    explanation_missing_message: null,
    site_breakdown: [],
    corrections: {
        total_amount: 5000,
        applied_amount: 5000,
        count: 1,
        has_corrections: true,
        items: [],
    },
    evidence_refs: [{ kind: "section" as const, label: "金額の理由", anchor: "reward-reasons" }],
    internal_controls: {
        can_manage: true,
        month: "2026-04",
    },
};

function renderExperience(options: { focusMemberId?: string | null } = { focusMemberId: "member-1" }) {
    return render(
        <MemoryRouter>
            <RewardConfirmationExperience initialPeriod="2026-04" focusMemberId={options.focusMemberId} />
        </MemoryRouter>,
    );
}

describe("RewardConfirmationExperience QA", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fetchOrgContext.mockResolvedValue({ membership: { role: "member", user_id: "member-1" } });
        getSession.mockResolvedValue({ data: { session: { user: { id: "member-1" } } } });
        fetchPathRewardConfirmation.mockResolvedValue(summary);
        askPathRewardConfirmationQuestion.mockResolvedValue({
            conclusion: "今月の見込みは160000円です。",
            amount_breakdown: [
                {
                    label: "今月の見込み",
                    amount: 160000,
                    detail: "最低保証、成果反映、補正を合わせた金額です。",
                    evidence_refs: [{ kind: "section", label: "金額の理由", anchor: "reward-reasons" }],
                },
            ],
            why_changed: ["最低保証が増えています。"],
            adjustments: [
                {
                    label: "来月調整",
                    amount: 5000,
                    detail: "反映済みの補正です。",
                    evidence_refs: [{ kind: "section", label: "来月の調整", anchor: "reward-corrections" }],
                },
            ],
            evidence_refs: [{ kind: "section", label: "金額の理由", anchor: "reward-reasons" }],
            next_action: "来月も稼働量を確認してください。",
            confidence: "medium",
        });
    });

    it("renders the fixed analysis schema in the expected sections", async () => {
        renderExperience();

        await screen.findByText("今月の精算額");
        fireEvent.click(screen.getByRole("button", { name: "PATH報酬を質問する" }));
        fireEvent.change(screen.getByLabelText("PATH報酬への質問"), {
            target: { value: "金額の理由を短く教えて" },
        });
        fireEvent.click(screen.getByRole("button", { name: "質問を送る" }));

        await screen.findByText("今月の見込みは160000円です。");
        expect(screen.getByText("金額の理由を短く教えて")).toBeInTheDocument();
        expect(screen.getByText("金額の内訳")).toBeInTheDocument();
        expect(screen.getByText("理由")).toBeInTheDocument();
        expect(screen.getAllByText("来月調整").length).toBeGreaterThan(0);
        expect(screen.getByText("根拠")).toBeInTheDocument();
        expect(screen.getByText("最低保証が増えています。")).toBeInTheDocument();
        expect(screen.getByText("反映済みの補正です。")).toBeInTheDocument();
    });

    it("renders reward amounts returned by the confirmation summary API", async () => {
        renderExperience();

        await screen.findByText("今月の精算額");

        expect(screen.getByText("対象: 田中 太郎")).toBeInTheDocument();
        expect(screen.getByText("¥160,000")).toBeInTheDocument();
        expect(screen.getByText("+¥10,000")).toBeInTheDocument();
        expect(screen.queryByText("気になる金額はAIに確認")).not.toBeInTheDocument();
        expect(screen.queryByText("精算チェック")).not.toBeInTheDocument();
        expect(screen.queryByRole("heading", { name: "増えた要因" })).not.toBeInTheDocument();
        expect(screen.queryByRole("heading", { name: "減った要因" })).not.toBeInTheDocument();
    });

    it("keeps the answer panel stable when the QA API fails", async () => {
        askPathRewardConfirmationQuestion.mockRejectedValue(new Error("回答を取得できませんでした"));
        renderExperience();

        await screen.findByText("今月の精算額");
        fireEvent.click(screen.getByRole("button", { name: "PATH報酬を質問する" }));
        fireEvent.change(screen.getByLabelText("PATH報酬への質問"), {
            target: { value: "金額の理由を短く教えて" },
        });
        fireEvent.click(screen.getByRole("button", { name: "質問を送る" }));

        await waitFor(() => {
            expect(screen.getByText("回答を取得できませんでした")).toBeInTheDocument();
        });
        expect(screen.getByText("根拠を読み込めませんでした。")).toBeInTheDocument();
    });

    it("loads /path without a member query by falling back to org context user id", async () => {
        getSession.mockResolvedValue({ data: { session: null } });

        renderExperience({ focusMemberId: null });

        await screen.findByText("今月の精算額");
        expect(fetchPathRewardConfirmation).toHaveBeenCalledWith("2026-04", "member-1");
    });
});
