export interface StructuredAddressInput {
    postal_code?: string | null;
    prefecture?: string | null;
    city?: string | null;
    address_line1?: string | null;
    address_line2?: string | null;
}

function normalizeText(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

export function normalizePostalCode(value: unknown): string | null {
    const normalized = normalizeText(value);
    if (!normalized) {
        return null;
    }

    const digits = normalized.replace(/[^\d]/g, "");
    if (digits.length === 7) {
        return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    }

    return normalized;
}

export function composeStructuredAddress(address: StructuredAddressInput): string | null {
    const postalCode = normalizePostalCode(address.postal_code);
    const prefecture = normalizeText(address.prefecture);
    const city = normalizeText(address.city);
    const addressLine1 = normalizeText(address.address_line1);
    const addressLine2 = normalizeText(address.address_line2);

    const postalSegment = postalCode ? `〒${postalCode}` : null;
    const addressSegment = [prefecture, city, addressLine1, addressLine2].filter(Boolean).join("");
    const segments = [postalSegment, addressSegment || null].filter(Boolean);

    return segments.length > 0 ? segments.join(" ") : null;
}

