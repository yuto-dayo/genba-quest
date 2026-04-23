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

interface LabeledSegment {
  label: string;
  value: string;
  lineIndex: number;
}

const orderParser = new OrderParser();

const FULL_DATE_PATTERN =
  /(\d{4})\s*(?:年|\/|-)\s*(\d{1,2})\s*(?:月|\/|-)\s*(\d{1,2})\s*日?/g;
const PARTIAL_DATE_PATTERN =
  /(^|[^\d])(\d{1,2})\s*(?:月|\/|-)\s*(\d{1,2})\s*日?(?!\s*(?:\/|-)\s*\d)(?=[^\d]|$)/g;
const INLINE_FIELD_LABELS = [
  "現場名",
  "工事名",
  "案件名",
  "物件名",
  "件名",
  "プロジェクト名",
  "住所",
  "所在地",
  "現場住所",
  "工事場所",
  "取引先",
  "元請",
  "発注者",
  "施主",
  "依頼主",
  "依頼者",
  "お客様",
  "クライアント",
  "工期",
  "期間",
  "開始",
  "完了",
  "終了",
  "予定",
  "注意事項",
  "注意",
  "留意事項",
  "留意",
  "要確認",
  "作業内容",
  "工事項目",
  "内容",
] as const;
const CAUTION_LABELS = ["注意事項", "注意", "留意事項", "留意", "要確認"] as const;
const CAUTION_KEYWORDS = /(注意|留意|要確認|安全|搬入|駐車|近隣|騒音|連絡先|夜間|立入|ヘルメット|在宅|荷物)/;
const LINE_ITEM_LABELS = ["作業内容", "工事項目", "内容"] as const;
const SEGMENT_LABEL_PATTERN = new RegExp(
  `(${[...INLINE_FIELD_LABELS].sort((a, b) => b.length - a.length).join("|")})\\s*[：:]\\s*`,
  "g"
);
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

function splitIntoFragments(lines: string[]): string[] {
  return lines
    .flatMap((line) => line.split(/[。\n]/))
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length > 0);
}

function extractLabeledSegments(lines: string[]): LabeledSegment[] {
  const segments: LabeledSegment[] = [];

  lines.forEach((line, lineIndex) => {
    const matches = Array.from(line.matchAll(SEGMENT_LABEL_PATTERN));
    if (matches.length === 0) {
      return;
    }

    matches.forEach((match, index) => {
      const label = match[1];
      const nextIndex = matches[index + 1]?.index ?? line.length;
      const valueStart = (match.index ?? 0) + match[0].length;
      const rawValue = line.slice(valueStart, nextIndex);
      const value = sanitizeInlineValue(rawValue);

      if (!value) {
        return;
      }

      segments.push({
        label,
        value,
        lineIndex,
      });
    });
  });

  return segments;
}

function toIsoDate(year: number, month: number, day: number): string | null {
  const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = new Date(`${candidate}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(candidate)
    ? null
    : candidate;
}

function toUtcDateParts(date: Date): { year: number; month: number; day: number } {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function inferFirstPartialDateYear(
  month: number,
  day: number,
  referenceDate: Date
): number {
  const { year: referenceYear } = toUtcDateParts(referenceDate);
  const currentYearDate = toIsoDate(referenceYear, month, day);

  if (!currentYearDate) {
    return referenceYear;
  }

  const candidate = parseIsoDate(currentYearDate);
  const differenceMs = candidate.getTime() - Date.UTC(
    referenceYear,
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate()
  );
  const oneDayMs = 24 * 60 * 60 * 1000;

  // 新規現場作成では近い未来日付のほうが自然なので、半年以上過去なら翌年へ寄せる。
  return differenceMs < -183 * oneDayMs ? referenceYear + 1 : referenceYear;
}

function inferPartialDates(lines: string[], referenceDate: Date): string[] {
  const dates: string[] = [];
  let currentYear: number | null = null;
  let previousDate: Date | null = null;

  for (const line of lines) {
    const matches = Array.from(line.matchAll(PARTIAL_DATE_PATTERN));
    if (matches.length === 0) {
      continue;
    }

    const hasDateContext = /(工期|期間|日程|開始|着工|完了|終了|予定|から|まで|〜|~)/.test(line);
    if (!hasDateContext && matches.length < 2) {
      continue;
    }

    for (const match of matches) {
      const month = Number(match[2]);
      const day = Number(match[3]);

      if (!currentYear) {
        currentYear = inferFirstPartialDateYear(month, day, referenceDate);
      }

      let candidate = toIsoDate(currentYear, month, day);
      if (!candidate) {
        continue;
      }

      let candidateDate = parseIsoDate(candidate);
      while (previousDate && candidateDate < previousDate) {
        currentYear += 1;
        candidate = toIsoDate(currentYear, month, day);
        if (!candidate) {
          break;
        }
        candidateDate = parseIsoDate(candidate);
      }

      if (!candidate) {
        continue;
      }

      dates.push(candidate);
      previousDate = candidateDate;
    }
  }

  return dates;
}

function extractLabeledValue(lines: string[], labels: readonly string[], segments: LabeledSegment[]): string | null {
  const fromSegments = segments.find((segment) => labels.includes(segment.label));
  if (fromSegments) {
    return fromSegments.value;
  }

  for (const line of lines) {
    for (const label of labels) {
      const match = line.match(new RegExp(`(?:^|\\s)${label}\\s*[：:]\\s*(.+)$`));
      if (match?.[1]) {
        const value = sanitizeInlineValue(trimAtNextInlineLabel(match[1]));
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

function trimAtNextInlineLabel(value: string): string {
  let endIndex = value.length;

  for (const label of INLINE_FIELD_LABELS) {
    const pattern = new RegExp(`\\s+(?=${label}\\s*[：:])`);
    const match = pattern.exec(value);
    if (match && match.index < endIndex) {
      endIndex = match.index;
    }
  }

  return value.slice(0, endIndex).trim();
}

function extractSiteName(lines: string[], segments: LabeledSegment[], fallback: string | null): string | null {
  const labeled = extractLabeledValue(lines, [
    "現場名",
    "工事名",
    "案件名",
    "物件名",
    "件名",
    "プロジェクト名",
  ], segments);
  if (labeled) {
    return labeled;
  }

  if (fallback) {
    return fallback;
  }

  for (const line of lines) {
    const residenceMatch = line.match(/([^\d\s、。\-－−]{1,20}邸)/u);
    if (residenceMatch?.[1]) {
      return residenceMatch[1];
    }
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

function extractAddress(lines: string[], segments: LabeledSegment[], fallback: string | null): string | null {
  const labeled = extractLabeledValue(lines, ["住所", "所在地", "現場住所", "工事場所"], segments);
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

  const localAddressPattern = /([^\s、。]*?(?:町|市|区|村)\d+(?:[-－−]\d+){1,3})/u;
  for (const line of lines) {
    const match = line.match(localAddressPattern);
    if (match?.[1]) {
      return sanitizeInlineValue(match[1]);
    }
  }

  return null;
}

function extractClientName(lines: string[], segments: LabeledSegment[], fallback: string | null): string | null {
  const labeled = extractLabeledValue(lines, [
    "取引先",
    "元請",
    "発注者",
    "施主",
    "依頼主",
    "依頼者",
    "お客様",
    "クライアント",
  ], segments);
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

  const partialDates = Array.from(new Set(inferPartialDates(splitLines(text), new Date()))).sort((a, b) =>
    a.localeCompare(b)
  );
  if (partialDates.length >= 2) {
    return {
      startedAt: partialDates[0],
      expectedCompletionAt: partialDates[partialDates.length - 1],
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

function extractCautions(lines: string[], segments: LabeledSegment[]): string | null {
  const segmentedCautions = segments
    .filter((segment) => CAUTION_LABELS.includes(segment.label as typeof CAUTION_LABELS[number]))
    .map((segment) => segment.value);

  const cautionLines = [
    ...segmentedCautions,
    ...splitIntoFragments(lines)
    .map((line) => {
      for (const label of CAUTION_LABELS) {
        const match = line.match(new RegExp(`(?:^|\\s)${label}\\s*[：:]\\s*(.+)$`));
        if (match?.[1]) {
          return sanitizeInlineValue(trimAtNextInlineLabel(match[1]));
        }
      }

      const keywordMatch = line.match(CAUTION_KEYWORDS);
      if (!keywordMatch || keywordMatch.index === undefined) {
        return null;
      }

      return sanitizeInlineValue(trimAtNextInlineLabel(line.slice(keywordMatch.index)));
    })
    .filter((line): line is string => Boolean(line)),
  ];

  const uniqueCautionLines = Array.from(new Set(cautionLines));

  if (uniqueCautionLines.length === 0) {
    return null;
  }

  return uniqueCautionLines.map((line) => sanitizeInlineValue(line)).filter(Boolean).join("\n");
}

function extractLineItems(lines: string[], segments: LabeledSegment[]): SiteDraftLineItem[] {
  const items: SiteDraftLineItem[] = [];
  const segmentCandidates = segments
    .filter((segment) => LINE_ITEM_LABELS.includes(segment.label as typeof LINE_ITEM_LABELS[number]))
    .map((segment) => ({
      candidate: segment.value,
      startsAsLineItem: true,
    }));
  const lineCandidates = splitIntoFragments(lines).map((line) => ({
    candidate: line
      .replace(/^[・\-●■]+/, "")
      .replace(/^(作業内容|工事項目|内容)\s*[：:]/, "")
      .trim(),
    startsAsLineItem: /^[・\-●■]/.test(line) || /^(作業内容|工事項目|内容)\s*[：:]/.test(line),
  }));

  for (const { candidate, startsAsLineItem } of [...segmentCandidates, ...lineCandidates]) {
    const normalizedCandidate = candidate
      .replace(/^\d+(?:[.・、,]\d+)+日?に/u, "")
      .replace(/お願いします.*$/u, "")
      .replace(/です.*$/u, "")
      .trim();

    if (!normalizedCandidate || normalizedCandidate.length > 80) {
      continue;
    }

    const itemName = normalizedCandidate
      .replace(/^約/u, "約")
      .replace(/数量\s*[:：]?\s*[\d.,]+.*/u, "")
      .replace(/単価\s*[:：]?\s*[\d,]+円?.*/u, "")
      .replace(/@\s*[\d,]+円?/u, "")
      .trim();

    if (!itemName || /(住所|所在地|現場名|工期|元請|発注者|取引先|注意)/.test(itemName)) {
      continue;
    }

    const hasStructuredMetrics =
      /(\d+(?:\.\d+)?)\s*(人工|日|式|台|本|枚|m2|m²|㎡|平米|m|箇所|か所|ヶ所|セット|件|回)/u.test(normalizedCandidate) ||
      /(?:単価|@)\s*[:：]?\s*([\d,]+)\s*円?/u.test(normalizedCandidate);

    if (!startsAsLineItem && !hasStructuredMetrics) {
      continue;
    }

    if (!/(工事|作業|施工|張替|貼替|張り|貼り|撤去|塗装|防水|交換|設置|取付|補修|養生|クリーニング|内装)/.test(itemName)) {
      continue;
    }

    const quantityMatch = normalizedCandidate.match(/(\d+(?:\.\d+)?)\s*(人工|日|式|台|本|枚|m2|m²|㎡|平米|m|箇所|か所|ヶ所|セット|件|回)/u);
    const unitPriceMatch = normalizedCandidate.match(/(?:単価|@)\s*[:：]?\s*([\d,]+)\s*円?/u);

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
  const segments = extractLabeledSegments(lines);
  const parsedOrder = orderParser.parseOcrText(normalizedText, {
    suppressIncompleteWarning: true,
  });

  const name = extractSiteName(lines, segments, parsedOrder?.siteName || null);
  const address = extractAddress(lines, segments, parsedOrder?.address || null);
  const clientName = extractClientName(lines, segments, parsedOrder?.clientName || null);
  const { startedAt, expectedCompletionAt } = extractDates(normalizedText, parsedOrder
    ? { startDate: parsedOrder.startDate, endDate: parsedOrder.endDate }
    : null);
  const workingWeekdays = inferWorkingWeekdays(normalizedText);
  const scheduleMode = workingWeekdays.length > 0 ? "weekdays" : null;
  const cautions = extractCautions(lines, segments);
  const lineItems = extractLineItems(lines, segments);

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
