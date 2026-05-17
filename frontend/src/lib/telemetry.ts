export type TelemetryEvent =
    | { type: "money.fab.clicked"; from_tab: string }
    | { type: "money.fab.option_clicked"; option: "expense" | "sale" | "invoice" }
    | { type: "money.reward_card.tapped"; is_self: boolean; status: string }
    | { type: "money.invoice.issued"; from: "own_reward_modal" | "fab" }
    | { type: "money.month_close.completed"; duration_ms: number; members_count: number }
    | { type: "money.month_close.cta_seen"; from: "bell" | "url_param" }
    | { type: "money.invoice.paid"; from: "bell" | "partner_drawer" }
    | { type: "money.shield.opened" }
    | { type: "money.partner_tab.filter_changed"; bucket: "overdue" | "this_week" | "draft" | "all" };

export function track(event: TelemetryEvent): void {
    if (import.meta.env.DEV) {
        console.debug("[telemetry]", event);
    }
    // production: future backend integration
}
