import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { usePayoutSelection } from "./usePayoutSelection";

function HookHarness({ initialMemberId }: { initialMemberId: string | null }) {
    const selection = usePayoutSelection(initialMemberId);

    return (
        <div>
            <span data-testid="selected">{selection.selectedMemberId ?? "none"}</span>
            <span data-testid="mode">{selection.viewMode}</span>
            <button type="button" onClick={() => selection.onSelectMember("member-other")}>
                other
            </button>
            <button type="button" onClick={() => selection.onSelectMember("all")}>
                all
            </button>
        </div>
    );
}

function RerenderHarness() {
    const [initialMemberId, setInitialMemberId] = useState<string | null>("member-self");

    return (
        <div>
            <HookHarness initialMemberId={initialMemberId} />
            <button type="button" onClick={() => setInitialMemberId("member-next")}>
                reset
            </button>
        </div>
    );
}

describe("usePayoutSelection", () => {
    it("starts from the initial member in single mode", () => {
        render(<HookHarness initialMemberId="member-self" />);

        expect(screen.getByTestId("selected")).toHaveTextContent("member-self");
        expect(screen.getByTestId("mode")).toHaveTextContent("single");
    });

    it("switches between a member and all mode", () => {
        render(<HookHarness initialMemberId="member-self" />);

        fireEvent.click(screen.getByRole("button", { name: "all" }));
        expect(screen.getByTestId("selected")).toHaveTextContent("none");
        expect(screen.getByTestId("mode")).toHaveTextContent("all");

        fireEvent.click(screen.getByRole("button", { name: "other" }));
        expect(screen.getByTestId("selected")).toHaveTextContent("member-other");
        expect(screen.getByTestId("mode")).toHaveTextContent("single");
    });

    it("resets when the initial member changes after data loads", () => {
        render(<RerenderHarness />);

        fireEvent.click(screen.getByRole("button", { name: "all" }));
        fireEvent.click(screen.getByRole("button", { name: "reset" }));

        expect(screen.getByTestId("selected")).toHaveTextContent("member-next");
        expect(screen.getByTestId("mode")).toHaveTextContent("single");
    });
});
