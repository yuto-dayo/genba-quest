import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMonthCloseStatus } from "../lib/api";
import { usePastMonthGuard } from "./usePastMonthGuard";

vi.mock("../lib/api", () => ({
    fetchMonthCloseStatus: vi.fn(),
}));

const mockedFetchMonthCloseStatus = vi.mocked(fetchMonthCloseStatus);

describe("usePastMonthGuard", () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        vi.setSystemTime(new Date("2026-05-18T00:00:00.000Z"));
        mockedFetchMonthCloseStatus.mockReset();
        mockedFetchMonthCloseStatus.mockResolvedValue({ month: "2026-05", status: "open" });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("marks months before the current month as read-only", async () => {
        const { result } = renderHook(() => usePastMonthGuard("2026-04"));

        expect(result.current.isPast).toBe(true);
        expect(result.current.readOnly).toBe(true);
        await waitFor(() => {
            expect(mockedFetchMonthCloseStatus).toHaveBeenCalledWith("2026-04");
        });
        expect(result.current.isFinalized).toBe(false);
    });

    it("marks a finalized current month as read-only", async () => {
        mockedFetchMonthCloseStatus.mockResolvedValue({ month: "2026-05", status: "closed" });

        const { result } = renderHook(() => usePastMonthGuard("2026-05"));

        expect(result.current.isPast).toBe(false);
        await waitFor(() => {
            expect(result.current.isFinalized).toBe(true);
        });
        expect(result.current.readOnly).toBe(true);
    });
});
