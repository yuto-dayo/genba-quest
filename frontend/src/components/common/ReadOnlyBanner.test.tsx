import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReadOnlyBanner } from "./ReadOnlyBanner";

describe("ReadOnlyBanner", () => {
    it("announces the read-only state politely", () => {
        render(<ReadOnlyBanner />);

        const banner = screen.getByRole("status");
        expect(banner).toHaveAttribute("aria-live", "polite");
        expect(screen.getByText("過去月の閲覧モード")).toBeInTheDocument();
        expect(screen.getByText("修正は新しい月の逆仕訳で行います")).toBeInTheDocument();
    });
});
