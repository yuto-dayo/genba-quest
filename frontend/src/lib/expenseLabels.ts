/**
 * 職人語マッピング (UI表示の正本).
 * 内部コード値 → UI表示文字列。
 * 設計原則: 一般的な職人が一読してわかる日本語にする。
 * 詳細: docs/MONEY_EXPENSE_FLOW.md §11
 */

export type ExpenseScope = "job" | "job_advance" | "stockpile" | "overhead" | "unassigned";
export type ExpenseLifecycleState = "captured" | "classified" | "verified" | "posted" | "closed";
export type ExpenseFlag =
    | "missing_job"
    | "missing_receipt"
    | "missing_invoice_number"
    | "duplicate_suspected"
    | "billable_candidate"
    | "asset_candidate"
    | "advance_stale"
    | "allocation_pending"
    | "budget_overrun"
    | "out_of_pattern";

export type BucketKey =
    | "unassigned"
    | "needs_review"
    | "awaiting_verify"
    | "posted"
    | "asset_candidates"
    | "advance_stale";

export const EXPENSE_SCOPE_LABEL: Record<ExpenseScope, string> = {
    job: "現場",
    job_advance: "先行仕入れ",
    stockpile: "共通在庫",
    overhead: "本部・会社",
    unassigned: "未割当",
};

export const EXPENSE_LIFECYCLE_LABEL: Record<ExpenseLifecycleState, string> = {
    captured: "登録した",
    classified: "現場決め済み",
    verified: "確認済み",
    posted: "帳簿入り",
    closed: "月締め済み",
};

export const EXPENSE_FLAG_LABEL: Record<ExpenseFlag, string> = {
    missing_job: "現場が未決",
    missing_receipt: "レシートなし",
    missing_invoice_number: "インボイス番号なし",
    duplicate_suspected: "重複かも",
    billable_candidate: "お客さんに請求？",
    asset_candidate: "高額な工具",
    advance_stale: "90日以上動いてない",
    allocation_pending: "配分待ち",
    budget_overrun: "儲け薄くなりそう",
    out_of_pattern: "要確認",
};

export const EXPENSE_FLAG_TONE: Record<ExpenseFlag, "warn" | "bad" | "info"> = {
    missing_job: "bad",
    missing_receipt: "warn",
    missing_invoice_number: "warn",
    duplicate_suspected: "bad",
    billable_candidate: "info",
    asset_candidate: "info",
    advance_stale: "bad",
    allocation_pending: "warn",
    budget_overrun: "warn",
    out_of_pattern: "warn",
};

export const BUCKET_LABEL: Record<BucketKey, string> = {
    unassigned: "未割当",
    needs_review: "要確認",
    awaiting_verify: "確認待ち",
    posted: "帳簿入り",
    asset_candidates: "高額な工具",
    advance_stale: "先行仕入れ・古い",
};

/** 各バケットの補助説明 (空でない時のみ下に出す) */
export const BUCKET_HINT: Record<BucketKey, string> = {
    unassigned: "あとで決める分",
    needs_review: "見直しが要る",
    awaiting_verify: "締め前に見ておく",
    posted: "帳簿に入った",
    asset_candidates: "10万円超 ・ 資産扱いの候補",
    advance_stale: "着工してない",
};

/** バケットの色トーン (アラート度) */
export const BUCKET_TONE: Record<BucketKey, "warn" | "bad" | "good" | "neutral"> = {
    unassigned: "warn",
    needs_review: "warn",
    awaiting_verify: "neutral",
    posted: "good",
    asset_candidates: "neutral",
    advance_stale: "bad",
};
