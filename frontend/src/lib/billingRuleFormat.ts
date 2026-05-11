import type { BillingRuleRecord } from "./api";

export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export function describeRule(rule: BillingRuleRecord): string {
    return `${describeClosing(rule)} / ${describePayment(rule)}`;
}

export function describeClosing(rule: BillingRuleRecord): string {
    const cr = rule.closing_rule;
    switch (rule.billing_cycle) {
        case "monthly": {
            if (typeof cr.day !== "number") return "月次（締め日不明）";
            return cr.day === 99 ? "月末締め" : `毎月${cr.day}日締め`;
        }
        case "weekly": {
            const w = typeof cr.weekday === "number" ? WEEKDAYS[cr.weekday] : "?";
            return `毎週${w}曜締め`;
        }
        case "biweekly": {
            const w = typeof cr.weekday === "number" ? WEEKDAYS[cr.weekday] : "?";
            return `隔週${w}曜締め`;
        }
        case "custom":
            return "カスタム";
        default:
            return "周期不明";
    }
}

export function describePayment(rule: BillingRuleRecord): string {
    const pr = rule.payment_rule;
    if (typeof pr.days === "number") {
        return `${pr.days}日後払い`;
    }
    if (typeof pr.month_offset === "number" && typeof pr.day === "number") {
        const month =
            pr.month_offset === 0 ? "当月" : pr.month_offset === 1 ? "翌月" : `${pr.month_offset}ヶ月後`;
        const day = pr.day === 99 ? "末日" : `${pr.day}日`;
        return `${month}${day}払い`;
    }
    return "支払条件不明";
}

export function formatDateJa(iso: string): string {
    const [, m, d] = iso.split("-").map(Number);
    if (Number.isNaN(m) || Number.isNaN(d)) return iso;
    return `${m}/${d}`;
}
