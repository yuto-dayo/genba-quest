import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MemberInvoiceRegistrationStatus } from "../../lib/api";
import { InvoiceRegistrationBadge } from "./InvoiceRegistrationBadge";

describe("InvoiceRegistrationBadge", () => {
    it.each([
        ["registered", "インボイス登録状況 適格 T1234567890123"],
        ["exempt", "インボイス登録状況 経過措置 80%"],
        ["transitional", "インボイス登録状況 経過措置 控除80%"],
        ["unknown", "インボイス登録状況 未確認"],
    ] satisfies Array<[MemberInvoiceRegistrationStatus, string]>)(
        "renders %s state",
        (status, label) => {
            render(
                <InvoiceRegistrationBadge
                    status={status}
                    registrationNumber={status === "registered" ? "T1234567890123" : null}
                    asOf={new Date(Date.UTC(2026, 9, 1))}
                    settingsHref="/settings?setting=classification"
                />,
            );

            expect(screen.getByLabelText(label)).toBeInTheDocument();
        },
    );

    it("keeps the unknown setup link out of compact table badges", () => {
        render(
            <InvoiceRegistrationBadge
                status="unknown"
                size="small"
                settingsHref="/settings?setting=classification"
            />,
        );

        expect(screen.getByLabelText("インボイス登録状況 未確認")).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "設定" })).not.toBeInTheDocument();
    });
});
