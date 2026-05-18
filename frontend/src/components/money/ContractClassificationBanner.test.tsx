import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MemberContractType, MemberInvoiceRegistrationStatus } from "../../lib/api";
import { ContractClassificationBanner } from "./ContractClassificationBanner";
import { InvoiceRegistrationBadge } from "./InvoiceRegistrationBadge";

describe("ContractClassificationBanner", () => {
    it("uses alert semantics for employee-like risk", () => {
        render(
            <ContractClassificationBanner
                contractType="employee_like"
                checkStatus="verified"
                settingsHref="/settings?setting=classification"
            />,
        );

        expect(screen.getByRole("alert")).toHaveTextContent("契約区分の見直しを推奨");
        expect(screen.getByRole("link", { name: "設定する" })).toHaveAttribute(
            "href",
            "/settings?setting=classification",
        );
    });

    it("uses status semantics for undetermined contract type", () => {
        render(<ContractClassificationBanner contractType="undetermined" checkStatus="unset" />);

        expect(screen.getByRole("status")).toHaveTextContent("契約区分が未設定です");
    });
});

describe("tax badge combination matrix", () => {
    const contractTypes: MemberContractType[] = ["subcontract", "employee_like", "undetermined"];
    const invoiceStatuses: MemberInvoiceRegistrationStatus[] = ["registered", "exempt", "transitional", "unknown"];

    it("covers contract_type 3 x invoice_status 4 without expanding modal tests", () => {
        const { container } = render(
            <table>
                <tbody>
                    {contractTypes.map((contractType) =>
                        invoiceStatuses.map((invoiceStatus) => (
                            <tr key={`${contractType}-${invoiceStatus}`}>
                                <td>{contractType}</td>
                                <td>
                                    <InvoiceRegistrationBadge
                                        status={invoiceStatus}
                                        registrationNumber={invoiceStatus === "registered" ? "T1234567890123" : null}
                                        asOf={new Date(Date.UTC(2026, 9, 1))}
                                        size="small"
                                    />
                                </td>
                                <td>
                                    <ContractClassificationBanner
                                        contractType={contractType}
                                        checkStatus={contractType === "subcontract" ? "verified" : "unset"}
                                    />
                                </td>
                            </tr>
                        )),
                    )}
                </tbody>
            </table>,
        );

        expect(container).toMatchSnapshot();
    });
});
