export type DevAuthUserKey = "yuto" | "jay" | "teru" | "daito";

export interface DevAuthUserOption {
    key: DevAuthUserKey;
    label: string;
    id: string;
    email: string;
    role: "admin" | "member";
}

export const DEV_AUTH_USER_OPTIONS: DevAuthUserOption[] = [
    {
        key: "yuto",
        label: "ユウト",
        id: "e93f3438-ae73-4c55-b2ab-a370d096bde0",
        email: "yuto@genba-quest.test",
        role: "admin",
    },
    {
        key: "jay",
        label: "ジェイ",
        id: "22222222-2222-4222-8222-0000000000a2",
        email: "jay@genba-quest.test",
        role: "member",
    },
    {
        key: "teru",
        label: "テル",
        id: "33333333-3333-4333-8333-0000000000a3",
        email: "teru@genba-quest.test",
        role: "member",
    },
    {
        key: "daito",
        label: "ダイト",
        id: "44444444-4444-4444-8444-0000000000a4",
        email: "daito@genba-quest.test",
        role: "member",
    },
];

export const DEV_AUTH_USER_STORAGE_KEY = "genba-quest.dev-user-key";
export const DEV_AUTH_SESSION_STORAGE_KEY = "genba-quest.dev-auth-session";

function isKnownDevAuthUserKey(value: string | null): value is DevAuthUserKey {
    return DEV_AUTH_USER_OPTIONS.some((option) => option.key === value);
}

export function isDevAuthUiEnabled(): boolean {
    return import.meta.env.DEV;
}

export function getDevAuthUserKey(): DevAuthUserKey | null {
    if (!isDevAuthUiEnabled() || typeof window === "undefined") {
        return null;
    }

    const storedValue = window.localStorage.getItem(DEV_AUTH_USER_STORAGE_KEY);
    return isKnownDevAuthUserKey(storedValue) ? storedValue : "yuto";
}

export function getDevAuthUserOption(): DevAuthUserOption | null {
    const userKey = getDevAuthUserKey();
    return DEV_AUTH_USER_OPTIONS.find((option) => option.key === userKey) ?? null;
}

export function setDevAuthUserKey(value: DevAuthUserKey): void {
    if (!isDevAuthUiEnabled() || typeof window === "undefined") {
        return;
    }

    window.localStorage.setItem(DEV_AUTH_USER_STORAGE_KEY, value);
}

export function isDevAuthSessionActive(): boolean {
    if (!isDevAuthUiEnabled() || typeof window === "undefined") {
        return false;
    }

    return window.localStorage.getItem(DEV_AUTH_SESSION_STORAGE_KEY) === "true";
}

export function setDevAuthSessionActive(): void {
    if (!isDevAuthUiEnabled() || typeof window === "undefined") {
        return;
    }

    window.localStorage.setItem(DEV_AUTH_SESSION_STORAGE_KEY, "true");
}

export function clearDevAuthSession(): void {
    if (typeof window === "undefined") {
        return;
    }

    window.localStorage.removeItem(DEV_AUTH_SESSION_STORAGE_KEY);
}
