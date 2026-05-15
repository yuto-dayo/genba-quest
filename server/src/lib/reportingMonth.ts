const REPORTING_MONTH_PATTERN = /^\d{4}-\d{2}$/;

export type ReportingMonthValidation =
  | { ok: true; month: string; startDate: string; endDateExclusive: string }
  | { ok: false; status: 400; error: "invalid month" | "future month" | "out of range" };

function monthIndex(month: string): number {
  const [year, monthPart] = month.split("-").map(Number);
  return year * 12 + monthPart;
}

function currentMonthValue(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function nextMonthValue(month: string): string {
  const [year, monthPart] = month.split("-").map(Number);
  const next = new Date(year, monthPart, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
}

export function validateReportingMonth(value: unknown, now = new Date()): ReportingMonthValidation {
  if (typeof value !== "string" || !REPORTING_MONTH_PATTERN.test(value)) {
    return { ok: false, status: 400, error: "invalid month" };
  }

  const monthPart = Number(value.slice(5, 7));
  if (monthPart < 1 || monthPart > 12) {
    return { ok: false, status: 400, error: "invalid month" };
  }

  const currentMonth = currentMonthValue(now);
  const diff = monthIndex(currentMonth) - monthIndex(value);
  if (diff < 0) {
    return { ok: false, status: 400, error: "future month" };
  }
  if (diff > 24) {
    return { ok: false, status: 400, error: "out of range" };
  }

  return {
    ok: true,
    month: value,
    startDate: `${value}-01`,
    endDateExclusive: `${nextMonthValue(value)}-01`,
  };
}
