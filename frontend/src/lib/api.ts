import { getAuthToken } from "./supabase";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4001";

export const api = async <T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> => {
    const token = await getAuthToken();

    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...options.headers,
        },
    });

    if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
    }

    return response.json();
};

// パーティステータス
export const fetchPartyStatus = () => api<PartyStatus>("/api/v1/party/status");

// 現場
export const fetchSites = () => api<Site[]>("/api/v1/sites");
export const fetchSite = (id: string) => api<Site>(`/api/v1/sites/${id}`);
export const createSite = (site: Partial<Site>) =>
    api<Site>("/api/v1/sites", { method: "POST", body: JSON.stringify(site) });
export const updateSite = (id: string, site: Partial<Site>) =>
    api<Site>(`/api/v1/sites/${id}`, { method: "PUT", body: JSON.stringify(site) });
export const completeSite = (id: string) =>
    api<Site>(`/api/v1/sites/${id}/complete`, { method: "POST" });

// パーク
export const fetchPerkDefinitions = () => api<PerkDefinition[]>("/api/v1/perks/definitions");
export const fetchPerkState = (userId: string) => api<PerkState>(`/api/v1/perks/state/${userId}`);
export const applyForPerk = (perkId: string, reason: string) =>
    api("/api/v1/perks/apply", { method: "POST", body: JSON.stringify({ perk_id: perkId, reason }) });
export const voteForPerk = (applicationId: string, vote: "approve" | "reject") =>
    api("/api/v1/perks/vote", { method: "POST", body: JSON.stringify({ application_id: applicationId, vote }) });

// スタミナ
export const fetchStamina = (userId: string) => api<StaminaData>(`/api/v1/stamina/${userId}`);
export const updateStamina = (delta: number, reason: string) =>
    api("/api/v1/stamina/update", { method: "POST", body: JSON.stringify({ delta, reason }) });
export const takeHoliday = (days: number) =>
    api("/api/v1/stamina/holidays/take", { method: "POST", body: JSON.stringify({ days }) });

// シェルパ
export const chatWithSherpa = (message: string, context?: ChatMessage[]) =>
    api<{ reply: string }>("/api/v1/sherpa/chat", { method: "POST", body: JSON.stringify({ message, context }) });
export const checkExpense = (description: string, amount: number, category: string) =>
    api<ExpenseCheck>("/api/v1/sherpa/expense-check", { method: "POST", body: JSON.stringify({ description, amount, category }) });

// 型定義
export interface PartyStatus {
    members: PartyMember[];
    guildSummary: {
        totalMembers: number;
        totalSales: number;
        avgStamina: number;
    };
}

export interface PartyMember {
    id: string;
    name: string;
    stamina: number;
    staminaStatus: "good" | "warning" | "critical";
    currentSite: { id: string; name: string; status: string } | null;
    isOnHoliday: boolean;
    holidayDays: number;
    holidayTarget: number;
    holidayPace: "on_track" | "behind";
    perkCount: number;
}

export interface Site {
    id: string;
    name: string;
    address?: string;
    area_sqm?: number;
    work_types?: string[];
    estimated_hours?: number;
    actual_hours?: number;
    revenue?: number;
    status: string;
    client_id?: string;
    client?: { id: string; name: string };
    created_at: string;
    completed_at?: string;
}

export interface PerkDefinition {
    id: string;
    category: string;
    label: string;
    percentage: number;
    description?: string;
}

export interface PerkState {
    user_id: string;
    state: Record<string, boolean>;
}

export interface StaminaData {
    stamina: number;
    holiday_days: number;
    holiday_target: number;
    current_site_id?: string;
}

export interface ChatMessage {
    role: "user" | "assistant";
    content: string;
}

export interface ExpenseCheck {
    suspicious: boolean;
    reason: string;
    suggestion: string;
}
