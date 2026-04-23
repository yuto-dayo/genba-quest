import "@testing-library/jest-dom/vitest";

Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    }),
});

class MockResizeObserver {
    observe() {}
    disconnect() {}
    unobserve() {}
}

Object.defineProperty(window, "ResizeObserver", {
    writable: true,
    value: MockResizeObserver,
});

Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
    writable: true,
    value: () => {},
});
