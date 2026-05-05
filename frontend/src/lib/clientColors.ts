export const CLIENT_COLOR_TOKENS = [
    "red",
    "pink",
    "purple",
    "indigo",
    "blue",
    "lightBlue",
    "cyan",
    "teal",
    "green",
    "amber",
    "orange",
    "deepOrange",
] as const;

export type ClientColorToken = (typeof CLIENT_COLOR_TOKENS)[number];

export interface ClientColorOption {
    token: ClientColorToken;
    label: string;
    bar: string;
    soft: string;
    text: string;
}

export const DEFAULT_CLIENT_COLOR_TOKEN: ClientColorToken = "teal";

export const CLIENT_COLOR_OPTIONS: ClientColorOption[] = [
    { token: "red", label: "赤", bar: "#C5221F", soft: "#FCE8E6", text: "#FFFFFF" },
    { token: "pink", label: "桃", bar: "#C2185B", soft: "#FCE4EC", text: "#FFFFFF" },
    { token: "purple", label: "紫", bar: "#7B1FA2", soft: "#F3E5F5", text: "#FFFFFF" },
    { token: "indigo", label: "藍", bar: "#3F51B5", soft: "#E8EAF6", text: "#FFFFFF" },
    { token: "blue", label: "青", bar: "#1A73E8", soft: "#E8F0FE", text: "#FFFFFF" },
    { token: "lightBlue", label: "水色", bar: "#0288D1", soft: "#E1F5FE", text: "#FFFFFF" },
    { token: "cyan", label: "シアン", bar: "#00838F", soft: "#E0F7FA", text: "#FFFFFF" },
    { token: "teal", label: "緑青", bar: "#00796B", soft: "#E0F2F1", text: "#FFFFFF" },
    { token: "green", label: "緑", bar: "#188038", soft: "#E6F4EA", text: "#FFFFFF" },
    { token: "amber", label: "琥珀", bar: "#9A6700", soft: "#FEF7E0", text: "#FFFFFF" },
    { token: "orange", label: "橙", bar: "#E8710A", soft: "#FFF3E0", text: "#FFFFFF" },
    { token: "deepOrange", label: "朱", bar: "#D84315", soft: "#FBE9E7", text: "#FFFFFF" },
];

const CLIENT_COLOR_BY_TOKEN = new Map(CLIENT_COLOR_OPTIONS.map((option) => [option.token, option]));

export function isClientColorToken(value: unknown): value is ClientColorToken {
    return typeof value === "string" && CLIENT_COLOR_TOKENS.includes(value as ClientColorToken);
}

export function resolveClientColorOption(value: unknown): ClientColorOption {
    if (isClientColorToken(value)) {
        return CLIENT_COLOR_BY_TOKEN.get(value) ?? CLIENT_COLOR_BY_TOKEN.get(DEFAULT_CLIENT_COLOR_TOKEN)!;
    }

    return CLIENT_COLOR_BY_TOKEN.get(DEFAULT_CLIENT_COLOR_TOKEN)!;
}

export function getStableClientColorToken(seed: string | null | undefined): ClientColorToken {
    const source = seed || "client";
    let hash = 0;
    for (let index = 0; index < source.length; index += 1) {
        hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
    }
    return CLIENT_COLOR_TOKENS[hash % CLIENT_COLOR_TOKENS.length];
}
