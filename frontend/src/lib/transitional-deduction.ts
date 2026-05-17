export type InvoiceRegistrationStatus = "registered" | "exempt" | "transitional" | "unknown";
export type TransitionalPhase = "pre-introduction" | "phase1-80" | "phase2-50" | "phase3-0";

const PHASE1_START = "2026-10-01";
const PHASE2_START = "2029-10-01";
const PHASE3_START = "2032-10-01";

function toIsoDate(value: Date | string): string {
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
            throw new Error("INVALID_TRANSITIONAL_DATE");
        }
        return value.toISOString().slice(0, 10);
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error("INVALID_TRANSITIONAL_DATE");
    }
    if (Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) {
        throw new Error("INVALID_TRANSITIONAL_DATE");
    }
    return value;
}

export function classifyTransitionalPhase(date: Date | string): TransitionalPhase {
    const isoDate = toIsoDate(date);
    if (isoDate < PHASE1_START) return "pre-introduction";
    if (isoDate < PHASE2_START) return "phase1-80";
    if (isoDate < PHASE3_START) return "phase2-50";
    return "phase3-0";
}

export function calculateTransitionalDeductionRate(
    date: Date | string,
    status: InvoiceRegistrationStatus,
): number {
    if (status === "registered" || status === "unknown") return 1;

    const phase = classifyTransitionalPhase(date);
    if (phase === "pre-introduction") return 1;
    if (phase === "phase1-80") return 0.8;
    if (phase === "phase2-50") return 0.5;
    return 0;
}

export function nextTransitionalRateChange(date: Date | string): {
    date: string;
    fromRate: number;
    toRate: number;
} | null {
    const isoDate = toIsoDate(date);
    if (isoDate < PHASE1_START) return { date: PHASE1_START, fromRate: 1, toRate: 0.8 };
    if (isoDate < PHASE2_START) return { date: PHASE2_START, fromRate: 0.8, toRate: 0.5 };
    if (isoDate < PHASE3_START) return { date: PHASE3_START, fromRate: 0.5, toRate: 0 };
    return null;
}
