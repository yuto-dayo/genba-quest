import { create } from "zustand";

const ACTIVE_ORG_STORAGE_KEY = "genbaquest.activeOrgId";

export interface ActiveOrgMembership {
    org_id: string;
    user_id?: string;
    role: "admin" | "member";
    status?: "active" | "suspended" | "removed";
    title?: string | null;
    approval_limit?: number | null;
    joined_at?: string | null;
}

export interface ActiveOrgSummary {
    id: string;
    name: string;
    slug?: string | null;
    status?: "active" | "suspended";
}

export interface ActiveOrgOption {
    org: ActiveOrgSummary;
    membership: ActiveOrgMembership;
}

interface ActiveOrgState {
    activeOrgId: string | null;
    options: ActiveOrgOption[];
    setOptions: (options: ActiveOrgOption[]) => void;
    setActiveOrgId: (orgId: string | null) => void;
    clear: () => void;
}

function readStoredActiveOrgId(): string | null {
    if (typeof window === "undefined") {
        return null;
    }

    const value = window.localStorage.getItem(ACTIVE_ORG_STORAGE_KEY);
    return value?.trim() || null;
}

function writeStoredActiveOrgId(orgId: string | null): void {
    if (typeof window === "undefined") {
        return;
    }

    if (orgId) {
        window.localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, orgId);
        return;
    }

    window.localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
}

function isValidActiveOrgId(options: ActiveOrgOption[], orgId: string | null): orgId is string {
    return Boolean(orgId) && options.some((option) => option.org.id === orgId);
}

export const useActiveOrgStore = create<ActiveOrgState>((set, get) => ({
    activeOrgId: readStoredActiveOrgId(),
    options: [],
    setOptions: (options) => {
        const currentActiveOrgId = get().activeOrgId;
        const nextActiveOrgId = isValidActiveOrgId(options, currentActiveOrgId) ? currentActiveOrgId : null;

        writeStoredActiveOrgId(nextActiveOrgId);
        set({
            options,
            activeOrgId: nextActiveOrgId,
        });
    },
    setActiveOrgId: (orgId) => {
        const nextActiveOrgId = isValidActiveOrgId(get().options, orgId) ? orgId : null;
        writeStoredActiveOrgId(nextActiveOrgId);
        set({ activeOrgId: nextActiveOrgId });
    },
    clear: () => {
        writeStoredActiveOrgId(null);
        set({
            activeOrgId: null,
            options: [],
        });
    },
}));

export function getActiveOrgId(): string | null {
    return useActiveOrgStore.getState().activeOrgId;
}
