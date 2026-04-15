import type { Client } from "./api";

export interface StructuredAddressFields {
    postal_code: string;
    prefecture: string;
    city: string;
    address_line1: string;
    address_line2: string;
}

export const PREFECTURES = [
    "北海道",
    "青森県",
    "岩手県",
    "宮城県",
    "秋田県",
    "山形県",
    "福島県",
    "茨城県",
    "栃木県",
    "群馬県",
    "埼玉県",
    "千葉県",
    "東京都",
    "神奈川県",
    "新潟県",
    "富山県",
    "石川県",
    "福井県",
    "山梨県",
    "長野県",
    "岐阜県",
    "静岡県",
    "愛知県",
    "三重県",
    "滋賀県",
    "京都府",
    "大阪府",
    "兵庫県",
    "奈良県",
    "和歌山県",
    "鳥取県",
    "島根県",
    "岡山県",
    "広島県",
    "山口県",
    "徳島県",
    "香川県",
    "愛媛県",
    "高知県",
    "福岡県",
    "佐賀県",
    "長崎県",
    "熊本県",
    "大分県",
    "宮崎県",
    "鹿児島県",
    "沖縄県",
] as const;

function normalizeText(value?: string | null): string {
    return value?.trim() || "";
}

export function formatPostalCode(value: string): string {
    const digits = value.replace(/[^\d]/g, "");
    if (digits.length <= 3) {
        return digits;
    }

    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}`;
}

export function composeAddress(fields: StructuredAddressFields): string {
    const postal = formatPostalCode(fields.postal_code);
    const addressBody = [fields.prefecture, fields.city, fields.address_line1, fields.address_line2]
        .map(normalizeText)
        .filter(Boolean)
        .join("");

    return [postal ? `〒${postal}` : "", addressBody].filter(Boolean).join(" ").trim();
}

export function emptyStructuredAddress(): StructuredAddressFields {
    return {
        postal_code: "",
        prefecture: "",
        city: "",
        address_line1: "",
        address_line2: "",
    };
}

export function parseAddress(rawValue?: string | null): StructuredAddressFields {
    const result = emptyStructuredAddress();
    const raw = normalizeText(rawValue);

    if (!raw) {
        return result;
    }

    let remaining = raw.replace(/\s+/g, " ").trim();
    const postalMatch = remaining.match(/〒?\s*(\d{3}-?\d{4})/);
    if (postalMatch?.[1]) {
        result.postal_code = formatPostalCode(postalMatch[1]);
        remaining = remaining.replace(postalMatch[0], "").trim();
    }

    const prefecture = PREFECTURES.find((value) => remaining.startsWith(value));
    if (prefecture) {
        result.prefecture = prefecture;
        remaining = remaining.slice(prefecture.length).trim();
    }

    const parts = remaining.split(/\n+/).map((part) => part.trim()).filter(Boolean);
    const firstLine = parts.shift() || remaining;
    const cityMatch = firstLine.match(/^(.+?[市区町村])(.*)$/);
    if (cityMatch) {
        result.city = cityMatch[1].trim();
        result.address_line1 = cityMatch[2].trim();
    } else {
        result.city = firstLine.trim();
    }

    if (parts.length > 0) {
        result.address_line2 = parts.join(" ");
    }

    return result;
}

export function getClientPrimaryAddress(client: Client | null | undefined): StructuredAddressFields {
    if (!client) {
        return emptyStructuredAddress();
    }

    const parsed = parseAddress(client.address);
    return {
        postal_code: normalizeText(client.postal_code) || parsed.postal_code,
        prefecture: normalizeText(client.prefecture) || parsed.prefecture,
        city: normalizeText(client.city) || parsed.city,
        address_line1: normalizeText(client.address_line1) || parsed.address_line1,
        address_line2: normalizeText(client.address_line2) || parsed.address_line2,
    };
}

export function getClientBillingAddress(client: Client | null | undefined): StructuredAddressFields {
    if (!client) {
        return emptyStructuredAddress();
    }

    const parsed = parseAddress(client.billing_address);
    return {
        postal_code: normalizeText(client.billing_postal_code) || parsed.postal_code,
        prefecture: normalizeText(client.billing_prefecture) || parsed.prefecture,
        city: normalizeText(client.billing_city) || parsed.city,
        address_line1: normalizeText(client.billing_address_line1) || parsed.address_line1,
        address_line2: normalizeText(client.billing_address_line2) || parsed.address_line2,
    };
}

export function areAddressesEqual(a: StructuredAddressFields, b: StructuredAddressFields): boolean {
    return composeAddress(a) === composeAddress(b);
}
