import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Plus } from "lucide-react";
import { FloatingActionButton } from "./FloatingActionButton";

vi.mock("framer-motion", () => ({
    motion: new Proxy(
        {},
        {
            get:
                (_target, tag: string) =>
                (motionProps: ComponentProps<"div"> & {
                    initial?: unknown;
                    animate?: unknown;
                    exit?: unknown;
                    transition?: unknown;
                    whileHover?: unknown;
                    whileTap?: unknown;
                }) => {
                    const { children, ...props } = motionProps;
                    const domProps = { ...props } as Record<string, unknown>;

                    ["initial", "animate", "exit", "transition", "whileHover", "whileTap"].forEach((prop) => {
                        delete domProps[prop];
                    });

                    return createElement(tag, domProps, children);
                },
        },
    ),
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe("FloatingActionButton", () => {
    beforeEach(() => {
        Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 390 });
        Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: 844 });
    });

    it("anchors the draggable menu inside the same fixed FAB container", async () => {
        const onOpen = vi.fn();
        render(
            <FloatingActionButton
                behavior="draggable"
                onOpen={onOpen}
                items={[
                    {
                        id: "add",
                        label: "追加する",
                        icon: <Plus size={18} />,
                        onClick: vi.fn(),
                    },
                ]}
            />,
        );

        await waitFor(() => {
            const fabButton = screen.getByRole("button", { name: "メニューを開く" });
            const fixedContainer = fabButton.parentElement;

            // FAB_MARGIN_BOTTOM = 92 (clears bottom tab bar where 🔔 chip lives)
            // top = innerHeight - FAB_SIZE - FAB_MARGIN_BOTTOM = 844 - 56 - 92 = 696
            expect(fixedContainer).toHaveStyle({
                left: "326px",
                top: "696px",
                width: "56px",
                height: "56px",
            });
        });

        const fabButton = screen.getByRole("button", { name: "メニューを開く" });
        const fixedContainer = fabButton.parentElement;

        expect(fabButton).not.toHaveStyle({ right: "8px" });
        expect(fabButton).not.toHaveStyle({ bottom: "16px" });

        fireEvent.click(fabButton);

        expect(onOpen).toHaveBeenCalledTimes(1);
        const menuItem = screen.getByRole("button", { name: "追加する" });
        const menu = menuItem.parentElement;

        expect(menu?.parentElement).toBe(fixedContainer);
        expect(menu?.getAttribute("style")).toBeNull();
    });
});
