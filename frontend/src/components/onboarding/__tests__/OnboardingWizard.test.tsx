import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingWizard } from "../OnboardingWizard";

const completeOnboarding = vi.fn();
const compressImageForAvatar = vi.fn();
const upload = vi.fn();
const getPublicUrl = vi.fn();
const from = vi.fn();

vi.mock("framer-motion", () => ({
    motion: new Proxy(
        {},
        {
            get: () => ({ children, ...props }: ComponentProps<"div">) => <div {...props}>{children}</div>,
        },
    ),
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
    useReducedMotion: () => false,
}));

vi.mock("../../../lib/api", async () => {
    const actual = await vi.importActual<typeof import("../../../lib/api")>("../../../lib/api");
    return {
        ...actual,
        completeOnboarding: (...args: unknown[]) => completeOnboarding(...args),
    };
});

vi.mock("../../../lib/imageCompression", async () => {
    const actual = await vi.importActual<typeof import("../../../lib/imageCompression")>("../../../lib/imageCompression");
    return {
        ...actual,
        compressImageForAvatar: (...args: unknown[]) => compressImageForAvatar(...args),
    };
});

vi.mock("../../../lib/supabase", () => ({
    supabase: {
        storage: {
            from: (...args: unknown[]) => from(...args),
        },
    },
}));

describe("OnboardingWizard", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        completeOnboarding.mockResolvedValue({
            profile: {
                id: "user-1",
            },
        });
        compressImageForAvatar.mockResolvedValue(new Blob([new Uint8Array(1024)], { type: "image/jpeg" }));
        upload.mockResolvedValue({ error: null });
        getPublicUrl.mockReturnValue({ data: { publicUrl: "https://cdn.example.com/user-1/avatar.jpg" } });
        from.mockReturnValue({
            upload,
            getPublicUrl,
        });
    });

    it("submits 5-step onboarding and completes without avatar", async () => {
        const onComplete = vi.fn();

        render(
            <OnboardingWizard
                initialProfile={{
                    id: "user-1",
                    username: null,
                    nickname: "",
                    full_name: "",
                    avatar_url: null,
                    onboarding_completed_at: null,
                    phone: null,
                    job_type: null,
                    employment_kind: "employee",
                    trade_name: null,
                    invoice_registration_number: null,
                    bank_name: null,
                    branch_name: null,
                    account_type: null,
                    account_number: null,
                    account_holder_kana: null,
                    postal_code: null,
                    prefecture: null,
                    city: null,
                    address_line1: null,
                    address_line2: null,
                    emergency_contact_name: null,
                    emergency_phone: null,
                }}
                onComplete={onComplete}
            />,
        );

        const next = screen.getByRole("button", { name: "次へ" });
        expect(next).toBeDisabled();

        fireEvent.change(screen.getByLabelText("ニックネーム"), { target: { value: "ユト" } });
        await waitFor(() => {
            expect(screen.getByRole("button", { name: "次へ" })).toBeEnabled();
        });
        fireEvent.click(screen.getByRole("button", { name: "次へ" }));

        fireEvent.change(await screen.findByLabelText("本名"), { target: { value: "山田 太郎" } });
        fireEvent.click(screen.getByRole("button", { name: "次へ" }));

        fireEvent.click(screen.getByRole("radio", { name: /社員/ }));
        fireEvent.click(screen.getByRole("button", { name: "次へ" }));

        fireEvent.click(screen.getByRole("button", { name: "内装" }));
        fireEvent.click(screen.getByRole("button", { name: "次へ" }));

        fireEvent.click(await screen.findByRole("button", { name: "あとで設定" }));

        await waitFor(() => {
            expect(completeOnboarding).toHaveBeenCalledWith({
                nickname: "ユト",
                full_name: "山田 太郎",
                employment_kind: "employee",
                job_type: "内装",
                avatar_url: null,
            });
        });
        expect(onComplete).toHaveBeenCalled();
    });

    it("uploads avatar and sends avatar_url", async () => {
        render(
            <OnboardingWizard
                initialProfile={{
                    id: "user-1",
                    username: null,
                    nickname: "",
                    full_name: "",
                    avatar_url: null,
                    onboarding_completed_at: null,
                    phone: null,
                    job_type: null,
                    employment_kind: "employee",
                    trade_name: null,
                    invoice_registration_number: null,
                    bank_name: null,
                    branch_name: null,
                    account_type: null,
                    account_number: null,
                    account_holder_kana: null,
                    postal_code: null,
                    prefecture: null,
                    city: null,
                    address_line1: null,
                    address_line2: null,
                    emergency_contact_name: null,
                    emergency_phone: null,
                }}
                onComplete={vi.fn()}
            />,
        );

        fireEvent.change(screen.getByLabelText("ニックネーム"), { target: { value: "ユト" } });
        await waitFor(() => {
            expect(screen.getByRole("button", { name: "次へ" })).toBeEnabled();
        });
        fireEvent.click(screen.getByRole("button", { name: "次へ" }));
        fireEvent.change(await screen.findByLabelText("本名"), { target: { value: "山田 太郎" } });
        fireEvent.click(screen.getByRole("button", { name: "次へ" }));
        fireEvent.click(screen.getByRole("radio", { name: /社員/ }));
        fireEvent.click(screen.getByRole("button", { name: "次へ" }));
        fireEvent.click(screen.getByRole("button", { name: "内装" }));
        fireEvent.click(screen.getByRole("button", { name: "次へ" }));

        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
        const file = new File([new Uint8Array(1024)], "avatar.jpg", { type: "image/jpeg" });
        fireEvent.change(fileInput, {
            target: {
                files: [file],
            },
        });

        await waitFor(() => {
            expect(upload).toHaveBeenCalledWith("user-1/avatar.jpg", expect.any(Blob), {
                upsert: true,
                contentType: "image/jpeg",
            });
        });

        fireEvent.click(screen.getByRole("button", { name: "はじめる ✨" }));

        await waitFor(() => {
            expect(completeOnboarding).toHaveBeenCalledWith(
                expect.objectContaining({
                    avatar_url: "https://cdn.example.com/user-1/avatar.jpg",
                }),
            );
        });
    });
});
