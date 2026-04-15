import { OrderParser } from "./OrderParser";

export interface SiteDraftLineItem {
  item_name: string;
  quantity: number | null;
  unit_name: string | null;
  unit_price: number | null;
}

export interface SiteDraftFromTextResult {
  name: string | null;
  address: string | null;
  client_name: string | null;
  started_at: string | null;
  expected_completion_at: string | null;
  schedule_mode: "continuous" | "weekdays" | "custom" | null;
  working_weekdays: number[];
  cautions: string | null;
  line_items: SiteDraftLineItem[];
  detected_fields: number;
  confidence: number;
}

const orderParser = new OrderParser();

const FULL_DATE_PATTERN =
  /(\d{4})\s*(?:年|\/|-)\s*(\d{1,2})\s*(?:月|\/|-)\s*(\d{1,2})\s*日?/g;
const WEEKDAY_MAP: Array<{ label: string; value: number }> = [
  { label: "日", value: 0 },
  { label: "月", value: 1 },
  { label: "火", value: 2 },
  { label: "水", value: 3 },
  { label: "木", value: 4 },
  { label: "金", value: 5 },
  { label: "土", value: 6 },
];

function normalizeInput(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\u3000/g, " ").trim();
}

function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function toIsoDate(year: number, month: number, day: number): string | null {
  const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = new Date(`${candidate}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(candidate)
    ? null
    : candidate;
}

function extractLabeledValue(lines: string[], labels: string[]): string | null {
  for (const line of lines) {
    for (const label of labels) {
      const match = line.match(new RegExp(`(?:^|\\s)${label}\\s*[：:]\\s*(.+)$`));
      if (match?.[1]) {
        const value = sanitizeInlineValue(match[1]);
        if (value) {
          return value;
        }
      }
    }
  }

  return null;
}

function sanitizeInlineValue(value: string): string | null {
  const sanitized = value
    .replace(/^[・\-●■]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized || null;
}

function extractSiteName(lines: string[], fallback: string | null): string | null {
  const labeled = extractLabeledValue(lines, [
    "現場名",
    "工事名",
    "案件名",
    "物件名",
    "件名",
    "プロジェクト名",
  ]);
  if (labeled) {
    return labeled;
  }

  if (fallback) {
    return fallback;
  }

  for (const line of lines) {
    if (line.length > 40) {
      continue;
    }

    if (/(工事|改修|新築|内装|塗装|防水|解体|修繕|リノベ)/.test(line)) {
      return sanitizeInlineValue(line);
    }
  }

  return null;
}

function extractAddress(lines: string[], fallback: string | null): string | null {
  const labeled = extractLabeledValue(lines, ["住所", "所在地", "現場住所", "工事場所"]);
  if (labeled) {
    return labeled;
  }

  if (fallback) {
    return fallback;
  }

  const addressPattern = /(東京都|北海道|(?:京都|大阪)府|.{2,3}県).+/;
  for (const line of lines) {
    const match = line.match(addressPattern);
    if (match?.[0]) {
      return sanitizeInlineValue(match[0]);
    }
  }

  return null;
}

function extractClientName(lines: string[], fallback: string | null): string | null {
  const labeled = extractLabeledValue(lines, [
    "取引先",
    "元請",
    "発注者",
    "施主",
    "依頼主",
    "依頼者",
    "お客様",
    "クライアント",
  ]);
  if (labeled) {
    return labeled.replace(/(御中|様)$/u, "").trim();
  }

  if (fallback && fallback !== "不明") {
    return fallback;
  }

  for (const line of lines) {
    if (/御中|様/u.test(line) && line.length <= 40) {
      return line.replace(/(御中|様)/gu, "").trim();
    }
  }

  return null;
}

function extractDates(text: string, fallback: { startDate: Date; endDate: Date } | null): {
  startedAt: string | null;
  expectedCompletionAt: string | null;
} {
  const dates: string[] = [];
  const normalizedText = text.replace(/\s/g, "");
  const matches = normalizedText.matchAll(FULL_DATE_PATTERN);

  for (const match of matches) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = toIsoDate(year, month, day);
    if (date) {
      dates.push(date);
    }
  }

  const uniqueDates = Array.from(new Set(dates)).sort((a, b) => a.localeCompare(b));
  if (uniqueDates.length >= 2) {
    return {
      startedAt: uniqueDates[0],
      expectedCompletionAt: uniqueDates[uniqueDates.length - 1],
    };
  }

  if (fallback) {
    return {
      startedAt: toIsoDate(
        fallback.startDate.getFullYear(),
        fallback.startDate.getMonth() + 1,
        fallback.startDate.getDate()
      ),
      expectedCompletionAt: toIsoDate(
        fallback.endDate.getFullYear(),
        fallback.endDate.getMonth() + 1,
        fallback.endDate.getDate()
      ),
    };
  }

  return {
    startedAt: null,
    expectedCompletionAt: null,
  };
}

function inferWorkingWeekdays(text: string): number[] {
  if (/平日/.test(text)) {
    return [1, 2, 3, 4, 5];
  }

  const found = WEEKDAY_MAP
    .filter(({ label }) => new RegExp(`(?:毎週|各週|\\b)${label}曜`).test(text))
    .map(({ value }) => value);

  return Array.from(new Set(found)).sort((a, b) => a - b);
}

function extractCautions(lines: string[]): string | null {
  const cautionLines = lines.filter((line) =>
    /(注意|留意|要確認|安全|搬入|駐車|近隣|騒音|連絡先|夜間|立入|ヘルメット)/.test(line)
  );

  if (cautionLines.length === 0) {
    return null;
  }

  return cautionLines.map((line) => sanitizeInlineValue(line)).filter(Boolean).join("\n");
}

function extractLineItems(lines: string[]): SiteDraftLineItem[] {
  const items: SiteDraftLineItem[] = [];

  for (const line of lines) {
    const startsAsLineItem = /^[・\-●■]/.test(line) || /^(作業内容|工事項目|内容)\s*[：:]/.test(line);
    const candidate = line
      .replace(/^[・\-●■]+/, "")
      .replace(/^(作業内容|工事項目|内容)\s*[：:]/, "")
      .trim();

    if (!candidate || candidate.length > 80) {
      continue;
    }

    const itemName = candidate
      .replace(/数量\s*[:：]?\s*[\d.,]+.*/u, "")
      .replace(/単価\s*[:：]?\s*[\d,]+円?.*/u, "")
      .replace(/@\s*[\d,]+円?/u, "")
      .trim();

    if (!itemName || /(住所|所在地|現場名|工期|元請|発注者|取引先|注意)/.test(itemName)) {
      continue;
    }

    const hasStructuredMetrics =
      /(\d+(?:\.\d+)?)\s*(人工|日|式|台|本|枚|m2|m²|㎡|m|箇所|か所|ヶ所|セット|件|回)/u.test(candidate) ||
      /(?:単価|@)\s*[:：]?\s*([\d,]+)\s*円?/u.test(candidate);

    if (!startsAsLineItem && !hasStructuredMetrics) {
      continue;
    }

    if (!/(工事|作業|施工|張替|貼替|張り|貼り|撤去|塗装|防水|交換|設置|取付|補修|養生|クリーニング|内装)/.test(itemName)) {
      continue;
    }

    const quantityMatch = candidate.match(/(\d+(?:\.\d+)?)\s*(人工|日|式|台|本|枚|m2|m²|㎡|m|箇所|か所|ヶ所|セット|件|回)/u);
    const unitPriceMatch = candidate.match(/(?:単価|@)\s*[:：]?\s*([\d,]+)\s*円?/u);

    items.push({
      item_name: itemName,
      quantity: quantityMatch ? Number(quantityMatch[1]) : null,
      unit_name: quantityMatch?.[2] || null,
      unit_price: unitPriceMatch ? Number(unitPriceMatch[1].replace(/,/g, "")) : null,
    });
  }

  return items.filter(
    (item, index, array) =>
      array.findIndex((other) => other.item_name === item.item_name) === index
  );
}

export function extractSiteDraftFromText(text: string): SiteDraftFromTextResult {
  const normalizedText = normalizeInput(text);
  const lines = splitLines(normalizedText);
  const parsedOrder = orderParser.parseOcrText(normalizedText);

  const name = extractSiteName(lines, parsedOrder?.siteName || null);
  const address = extractAddress(lines, parsedOrder?.address || null);
  const clientName = extractClientName(lines, parsedOrder?.clientName || null);
  const { startedAt, expectedCompletionAt } = extractDates(normalizedText, parsedOrder
    ? { startDate: parsedOrder.startDate, endDate: parsedOrder.endDate }
    : null);
  const workingWeekdays = inferWorkingWeekdays(normalizedText);
  const scheduleMode = workingWeekdays.length > 0 ? "weekdays" : null;
  const cautions = extractCautions(lines);
  const lineItems = extractLineItems(lines);

  const detectedFields = [
    name,
    address,
    clientName,
    startedAt,
    expectedCompletionAt,
    cautions,
    lineItems.length > 0 ? "line_items" : null,
    scheduleMode,
  ].filter(Boolean).length;

  const confidence = Math.min(1, Number((detectedFields / 7).toFixed(2)));

  return {
    name,
    address,
    client_name: clientName,
    started_at: startedAt,
    expected_completion_at: expectedCompletionAt,
    schedule_mode: scheduleMode,
    working_weekdays: workingWeekdays,
    cautions,
    line_items: lineItems,
    detected_fields: detectedFields,
    confidence,
  };
}
