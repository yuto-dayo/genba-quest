import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvoiceFilterRow } from "./InvoiceFilterRow";

const track = vi.fn();

vi.mock("../../lib/telemetry", () => ({
    track: (...args: unknown[]) => track(...args),
}));

describe("InvoiceFilterRow", () => {
    beforeEach(() => {
        track.mockClear();
    });

    it("hides empty overdue and draft chips while keeping this week and all available", () => {
        render(
            <InvoiceFilterRow
                value="all"
                counts={{ overdue: 0, this_week: 2, draft: 0, all: 4 }}
                onChange={vi.fn()}
            />,
        );

        expect(screen.queryByRole("button", { name: /期限超過/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /下書き/ })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: /今週入金予定/ })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "全部" })).toHaveAttribute("aria-pressed", "true");
    });

    it("notifies bucket changes", () => {
        const onChange = vi.fn();
        render(
            <InvoiceFilterRow
                value="overdue"
                counts={{ overdue: 3, this_week: 1, draft: 1, all: 5 }}
                onChange={onChange}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: /今週入金予定/ }));

        expect(onChange).toHaveBeenCalledWith("this_week");
        expect(track).toHaveBeenCalledWith({
            type: "money.partner_tab.filter_changed",
            bucket: "this_week",
        });
    });
});
