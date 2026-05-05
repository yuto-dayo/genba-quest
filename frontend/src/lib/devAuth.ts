export type DevAuthUserKey = "yuto" | "jay" | "teru" | "daito";

export interface DevAuthUserOption {
    key: DevAuthUserKey;
    label: string;
}

export const DEV_AUTH_USER_OPTIONS: DevAuthUserOption[] = [
    { key: "yuto", label: "ユウト" },
    { key: "jay", label: "ジェイ" },
    { key: "teru", label: "テル" },
    { key: "daito", label: "ダイト" },
];

export const DEV_AUTH_USER_STORAGE_KEY = "genba-quest.dev-user-key";

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

export function setDevAuthUserKey(value: DevAuthUserKey): void {
    if (!isDevAuthUiEnabled() || typeof window === "undefined") {
        return;
    }

    window.localStorage.setItem(DEV_AUTH_USER_STORAGE_KEY, value);
}
