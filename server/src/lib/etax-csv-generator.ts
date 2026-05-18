import iconv from "iconv-lite";

export interface EtaxSubmissionRow {
  fiscalYear: number;
  payerAddress: string | null;
  payerName: string | null;
  payerPhone: string | null;
  payerCorporateNumber?: string | null;
  recipientAddress: string | null;
  recipientName: string | null;
  recipientMyNumber?: string | null;
  paymentCategory?: string | null;
  paymentDetail?: string | null;
  paymentAmount: number;
  unpaidAmount?: number;
  withholdingAmount: number;
  uncollectedWithholdingAmount?: number;
  note?: string | null;
}

const ETAX_RECORD_FIELD_COUNT = 53;

function toReiwaYear(year: number): string {
  const reiwa = year - 2018;
  if (!Number.isInteger(year) || reiwa <= 0 || reiwa > 99) {
    throw new Error("LEGAL_RECORD_YEAR_UNSUPPORTED_FOR_ETAX");
  }
  return String(reiwa).padStart(2, "0");
}

function trimForEtax(value: string | null | undefined, maxLength: number): string {
  return (value ?? "")
    .replace(/,/g, "，")
    .replace(/[\r\n\t]/g, " ")
    .trim()
    .slice(0, maxLength);
}

function money(value: number | undefined): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    throw new Error("LEGAL_RECORD_AMOUNT_INVALID");
  }
  return String(Math.round(amount));
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildFields(row: EtaxSubmissionRow): string[] {
  const fields = Array.from({ length: ETAX_RECORD_FIELD_COUNT }, () => "");
  fields[0] = "309";
  fields[3] = trimForEtax(row.payerAddress, 60);
  fields[4] = trimForEtax(row.payerName, 30);
  fields[5] = trimForEtax(row.payerPhone, 15);
  fields[9] = "0";
  fields[10] = toReiwaYear(row.fiscalYear);
  fields[11] = trimForEtax(row.recipientAddress, 60);
  fields[12] = "0";
  fields[13] = trimForEtax(row.recipientName, 30);
  fields[14] = trimForEtax(row.paymentCategory ?? "報酬", 10);
  fields[15] = trimForEtax(row.paymentDetail ?? "内装施工", 20);
  fields[16] = money(row.paymentAmount);
  fields[17] = money(row.unpaidAmount);
  fields[18] = money(row.withholdingAmount);
  fields[19] = money(row.uncollectedWithholdingAmount);
  fields[50] = trimForEtax(row.note, 100);
  fields[51] = trimForEtax(row.payerCorporateNumber, 13);
  fields[52] = trimForEtax(row.recipientMyNumber, 13) || " ";
  return fields;
}

export function generateEtaxCsvUtf8(rows: EtaxSubmissionRow[]): string {
  return rows
    .map((row) => buildFields(row).map(csvEscape).join(","))
    .join("\r\n") + "\r\n";
}

export function generateEtaxCsvSjis(rows: EtaxSubmissionRow[]): Buffer {
  return iconv.encode(generateEtaxCsvUtf8(rows), "Shift_JIS");
}
