import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { PathV31Tab } from "./PathV31Tab";

const fetchPathV31DayLogs = vi.fn();
const fetchPathV31SiteCloses = vi.fn();
const previewPathV31MonthlyDistribution = vi.fn();
const createPathV31MonthlyDistributionProposal = vi.fn();
const createPathV31SiteCloseProposal = vi.fn();
const createPathV31SiteCloseReopenProposal = vi.fn();
const fetchPathV31Experience = vi.fn();
const recommendPathV31LeadAssignment = vi.fn();

vi.mock("../../lib/api", () => ({
    fetchPathV31DayLogs: (...args: unknown[]) => fetchPathV31DayLogs(...args),
    fetchPathV31SiteCloses: (...args: unknown[]) => fetchPathV31SiteCloses(...args),
    previewPathV31MonthlyDistribution: (...args: unknown[]) => previewPathV31MonthlyDistribution(...args),
    createPathV31MonthlyDistributionProposal: (...args: unknown[]) =>
        createPathV31MonthlyDistributionProposal(...args),
    createPathV31SiteCloseProposal: (...args: unknown[]) => createPathV31SiteCloseProposal(...args),
    createPathV31SiteCloseReopenProposal: (...args: unknown[]) =>
        createPathV31SiteCloseReopenProposal(...args),
    fetchPathV31Experience: (...args: unknown[]) => fetchPathV31Experience(...args),
    recommendPathV31LeadAssignment: (...args: unknown[]) => recommendPathV31LeadAssignment(...args),
}));

describe("PathV31Tab", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fetchPathV31DayLogs.mockResolvedValue({ logs: [] });
        fetchPathV31SiteCloses.mockResolvedValue({ site_closes: [] });
        previewPathV31MonthlyDistribution.mockResolvedValue({
            month: "2026-04",
            pool_amount: 120000,
            floor_rate: 0.6,
            result_rate: 0.4,
            nonlinear_exponent: 1.2,
            members: [],
            path_rule_version_id: "rule-1",
            path_rule_version: "v3.1",
            path_rule_fingerprint: "fp-1",
            calculation_snapshot: {},
        });
    });

    it("defaults to the monthly tab and removes the today entry point", async () => {
        render(<PathV31Tab />);

        expect(screen.queryByRole("button", { name: "今日の記録" })).not.toBeInTheDocument();

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "月次分配" })).toBeInTheDocument();
        });

        expect(
            screen.getByText("今日の記録は Today 画面の各現場カードから入力してください。"),
        ).toBeInTheDocument();
    });
});
