const REWARD_PARAM_KEYS = ["member", "period", "site"] as const;

type RewardParamKey = (typeof REWARD_PARAM_KEYS)[number];

export interface MoneyRewardLinkParams {
    member?: string | null;
    period?: string | null;
    site?: string | null;
}

function appendIfPresent(params: URLSearchParams, key: RewardParamKey, value: string | null | undefined) {
    const normalized = value?.trim();
    if (normalized) {
        params.set(key, normalized);
    }
}

export function buildMoneyRewardSearchParams(values: MoneyRewardLinkParams): URLSearchParams {
    const params = new URLSearchParams();
    params.set("modal", "reward");
    appendIfPresent(params, "member", values.member);
    appendIfPresent(params, "period", values.period);
    appendIfPresent(params, "site", values.site);
    return params;
}

export function buildMoneyRewardHref(values: MoneyRewardLinkParams): string {
    return `/money?${buildMoneyRewardSearchParams(values).toString()}`;
}

function hasRewardIntent(searchParams: URLSearchParams): boolean {
    return (
        searchParams.has("reward") ||
        searchParams.get("tab") === "reward" ||
        searchParams.has("member") ||
        searchParams.has("site")
    );
}

export function buildMoneyRedirectFromLegacyRoute(searchParams: URLSearchParams): string {
    const target = new URLSearchParams();

    if (hasRewardIntent(searchParams)) {
        target.set("modal", "reward");
        for (const key of REWARD_PARAM_KEYS) {
            const value = searchParams.get(key);
            if (value) {
                target.set(key, value);
            }
        }
        const query = target.toString();
        return `/money${query ? `?${query}` : ""}`;
    }

    const proposal = searchParams.get("proposal");
    if (proposal) {
        target.set("proposal", proposal);
    }

    const period = searchParams.get("period");
    if (period) {
        target.set("period", period);
    }

    const query = target.toString();
    return `/money${query ? `?${query}` : ""}`;
}
