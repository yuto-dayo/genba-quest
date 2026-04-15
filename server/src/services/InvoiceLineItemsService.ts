export interface InvoiceResolvedLineItem {
    item_name: string;
    quantity: number | null;
    unit_name: string | null;
    unit_price: number | null;
    amount: number | null;
}

export interface InvoiceResolvedLineItemsResult {
    items: InvoiceResolvedLineItem[];
    hasExplicitOverride: boolean;
}

export interface InvoiceSourceTransactionLike {
    id: string;
    description?: string | null;
    amount_subtotal?: number | null;
    amount_total?: number | null;
    site?: { name?: string | null } | null;
}

export interface InvoiceSourceItemLike {
    transaction_id?: string | null;
    item_name?: string | null;
    quantity?: number | null;
    unit_name?: string | null;
    unit_price?: number | null;
    amount?: number | null;
}

function toOptionalFiniteNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hasOwnProperty(record: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(record, key);
}

export function normalizeInvoiceResolvedLineItem(value: unknown): InvoiceResolvedLineItem | null {
    if (!value || typeof value !== "object") {
        return null;
    }

    const candidate = value as Record<string, unknown>;
    const itemName = typeof candidate.item_name === "string"
        ? candidate.item_name.trim()
        : "";

    if (!itemName) {
        return null;
    }

    const quantity = toOptionalFiniteNumber(candidate.quantity);
    const unitPrice = toOptionalFiniteNumber(candidate.unit_price);
    const amount = toOptionalFiniteNumber(candidate.amount)
        ?? (quantity !== null && unitPrice !== null ? Math.round((quantity * unitPrice + Number.EPSILON) * 100) / 100 : null);

    return {
        item_name: itemName,
        quantity,
        unit_name: typeof candidate.unit_name === "string" && candidate.unit_name.trim()
            ? candidate.unit_name.trim()
            : null,
        unit_price: unitPrice,
        amount,
    };
}

export function resolveExplicitInvoiceLineItems(input: {
    documentType: string | null | undefined;
    eligibilitySnapshot: unknown;
}): InvoiceResolvedLineItemsResult {
    const snapshot = input.eligibilitySnapshot && typeof input.eligibilitySnapshot === "object"
        ? input.eligibilitySnapshot as Record<string, unknown>
        : null;

    if (!snapshot) {
        return { items: [], hasExplicitOverride: false };
    }

    const itemKey = input.documentType === "invoice_supplement"
        ? "supplement_line_items"
        : "corrected_line_items";

    if (hasOwnProperty(snapshot, itemKey) && Array.isArray(snapshot[itemKey])) {
        return {
            items: snapshot[itemKey]
                .map(normalizeInvoiceResolvedLineItem)
                .filter((item): item is InvoiceResolvedLineItem => item !== null),
            hasExplicitOverride: true,
        };
    }

    const lastCorrection = snapshot.last_correction;
    if (lastCorrection && typeof lastCorrection === "object") {
        const correctionRecord = lastCorrection as Record<string, unknown>;
        if (hasOwnProperty(correctionRecord, itemKey) && Array.isArray(correctionRecord[itemKey])) {
            return {
                items: correctionRecord[itemKey]
                    .map(normalizeInvoiceResolvedLineItem)
                    .filter((item): item is InvoiceResolvedLineItem => item !== null),
                hasExplicitOverride: true,
            };
        }
    }

    return { items: [], hasExplicitOverride: false };
}

export function buildInvoiceDisplayLineItems(input: {
    documentType: string | null | undefined;
    eligibilitySnapshot: unknown;
    sourceTransactions: InvoiceSourceTransactionLike[];
    itemRows: InvoiceSourceItemLike[];
}): InvoiceResolvedLineItemsResult {
    const explicit = resolveExplicitInvoiceLineItems({
        documentType: input.documentType,
        eligibilitySnapshot: input.eligibilitySnapshot,
    });

    if (explicit.hasExplicitOverride) {
        return explicit;
    }

    const itemRowsByTransactionId = new Map<string, InvoiceResolvedLineItem[]>();

    for (const row of input.itemRows) {
        const transactionId = typeof row.transaction_id === "string" ? row.transaction_id : "";
        if (!transactionId) {
            continue;
        }

        const normalized = normalizeInvoiceResolvedLineItem(row);
        if (!normalized) {
            continue;
        }

        const existing = itemRowsByTransactionId.get(transactionId) || [];
        existing.push(normalized);
        itemRowsByTransactionId.set(transactionId, existing);
    }

    const isMultiSource = input.sourceTransactions.length > 1;
    const fallbackItems: InvoiceResolvedLineItem[] = [];

    for (const transaction of input.sourceTransactions) {
        const transactionItems = itemRowsByTransactionId.get(transaction.id) || [];
        const siteName = transaction.site?.name || null;
        const transactionLabel = siteName || transaction.description || "請求項目";

        if (transactionItems.length > 0) {
            fallbackItems.push(
                ...transactionItems.map((item) => ({
                    ...item,
                    item_name: isMultiSource ? `${transactionLabel} / ${item.item_name}` : item.item_name,
                }))
            );
            continue;
        }

        const fallbackAmount = toOptionalFiniteNumber(transaction.amount_subtotal)
            ?? toOptionalFiniteNumber(transaction.amount_total)
            ?? 0;
        fallbackItems.push({
            item_name: transactionLabel,
            quantity: 1,
            unit_name: "式",
            unit_price: fallbackAmount,
            amount: fallbackAmount,
        });
    }

    return {
        items: fallbackItems,
        hasExplicitOverride: false,
    };
}
