import iconv from "iconv-lite";
import { generateEtaxCsvSjis, generateEtaxCsvUtf8 } from "../../lib/etax-csv-generator";

describe("etax-csv-generator", () => {
  it("generates 53-column CRLF records for 報酬支払調書 309", () => {
    const csv = generateEtaxCsvUtf8([
      {
        fiscalYear: 2026,
        payerAddress: "東京都渋谷区1-2-3",
        payerName: "ゲンバ建設",
        payerPhone: "03-1234-5678",
        recipientAddress: "東京都新宿区4-5-6",
        recipientName: "山田内装",
        paymentAmount: 600000,
        withholdingAmount: 61260,
        note: "T番号 T1234567890123",
      },
    ]);

    expect(csv.endsWith("\r\n")).toBe(true);
    const fields = csv.trimEnd().split(",");
    expect(fields).toHaveLength(53);
    expect(fields[0]).toBe("309");
    expect(fields[10]).toBe("08");
    expect(fields[16]).toBe("600000");
    expect(fields[18]).toBe("61260");
  });

  it("encodes output as Shift_JIS", () => {
    const buffer = generateEtaxCsvSjis([
      {
        fiscalYear: 2026,
        payerAddress: "東京都",
        payerName: "ゲンバ建設",
        payerPhone: null,
        recipientAddress: "大阪府",
        recipientName: "山田内装",
        paymentAmount: 500001,
        withholdingAmount: 0,
      },
    ]);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(iconv.decode(buffer, "Shift_JIS")).toContain("山田内装");
  });
});
