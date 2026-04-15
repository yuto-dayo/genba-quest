import type { Site } from "./api";

export type SiteScheduleMode = "continuous" | "weekdays" | "custom";

export const SITE_SCHEDULE_MODE_OPTIONS: Array<{
    value: SiteScheduleMode;
    label: string;
    description: string;
}> = [
    {
        value: "continuous",
        label: "連続施工",
        description: "期間内を連続で施工します",
    },
    {
        value: "weekdays",
        label: "曜日施工",
        description: "選んだ曜日だけ施工します",
    },
    {
        value: "custom",
        label: "個別日施工",
        description: "実際に入る日だけ個別に登録します",
    },
];

export const WEEKDAY_OPTIONS = [
    { value: 0, shortLabel: "日", label: "日曜" },
    { value: 1, shortLabel: "月", label: "月曜" },
    { value: 2, shortLabel: "火", label: "火曜" },
    { value: 3, shortLabel: "水", label: "水曜" },
    { value: 4, shortLabel: "木", label: "木曜" },
    { value: 5, shortLabel: "金", label: "金曜" },
    { value: 6, shortLabel: "土", label: "土曜" },
] as const;

export function normalizeSiteScheduleMode(value: unknown): SiteScheduleMode {
    if (value === "weekdays" || value === "custom") {
        return value;
    }
    return "continuous";
}

export function normalizeWeekdays(value: unknown): number[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return Array.from(
        new Set(
            value
                .map((item) => (typeof item === "number" ? item : Number(item)))
                .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6)
        )
    ).sort((a, b) => a - b);
}

export function normalizeDateList(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return Array.from(
        new Set(
            value.filter((item): item is string => (
                typeof item === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.trim())
            )).map((item) => item.trim())
        )
    ).sort((a, b) => a.localeCompare(b));
}

export function formatSiteDateRange(start?: string, end?: string): string {
    const format = (value: string) =>
        new Date(value).toLocaleDateString("ja-JP", { month: "short", day: "numeric" });

    if (start && end) {
        return `${format(start)}〜${format(end)}`;
    }
    if (start) {
        return `${format(start)}〜`;
    }
    if (end) {
        return `〜${format(end)}`;
    }
    return "";
}

export function formatWeekdaySummary(weekdays: number[]): string {
    if (weekdays.length === 0) {
        return "曜日未設定";
    }

    return weekdays
        .map((weekday) => WEEKDAY_OPTIONS.find((option) => option.value === weekday)?.shortLabel)
        .filter((label): label is NonNullable<typeof label> => Boolean(label))
        .join("・");
}

export function formatSiteSchedulePattern(site: Pick<Site, "schedule_mode" | "working_weekdays" | "custom_work_dates">): string {
    const scheduleMode = normalizeSiteScheduleMode(site.schedule_mode);
    const weekdays = normalizeWeekdays(site.working_weekdays);
    const customDates = normalizeDateList(site.custom_work_dates);

    if (scheduleMode === "weekdays") {
        return `施工日: ${formatWeekdaySummary(weekdays)}`;
    }

    if (scheduleMode === "custom") {
        return customDates.length > 0 ? `施工日: ${customDates.length}日登録` : "施工日: 個別指定";
    }

    return "施工日: 連続";
}
