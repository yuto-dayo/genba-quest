import fs from "node:fs";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

export interface LegalRecordPdfInput {
  fiscalYear: number;
  payerName: string;
  payerAddress: string;
  recipientName: string;
  recipientAddress: string;
  invoiceRegistrationNo: string | null;
  payoutTotal: number;
  rewardTotal: number;
  correctionTotal: number;
  withholdingTotal: number;
  generatedAt: string;
}

const FONT_CANDIDATES = [
  process.env.LEGAL_RECORD_PDF_FONT_PATH,
  "/System/Library/Fonts/Hiragino Sans GB.ttc",
  "/Library/Fonts/NotoSansJP-Regular.otf",
  "/Library/Fonts/NotoSansCJKjp-Regular.otf",
].filter(Boolean) as string[];

function formatYen(value: number): string {
  return `JPY ${Math.round(value).toLocaleString("ja-JP")}`;
}

async function loadFont(pdfDoc: PDFDocument): Promise<PDFFont> {
  pdfDoc.registerFontkit(fontkit);
  const fontPath = FONT_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (fontPath) {
    const fontBytes = fs.readFileSync(fontPath);
    return pdfDoc.embedFont(fontBytes, { subset: true });
  }
  return pdfDoc.embedFont(StandardFonts.Helvetica);
}

export async function generateLegalRecordMemberPdf(input: LegalRecordPdfInput): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await loadFont(pdfDoc);
  const page = pdfDoc.addPage([595.28, 841.89]);
  const { width } = page.getSize();
  const left = 56;
  let y = 780;

  const draw = (text: string, size = 11, x = left) => {
    page.drawText(text, { x, y, size, font, color: rgb(0.12, 0.13, 0.15) });
    y -= size + 10;
  };
  const line = () => {
    y -= 4;
    page.drawLine({
      start: { x: left, y },
      end: { x: width - left, y },
      thickness: 0.7,
      color: rgb(0.78, 0.80, 0.84),
    });
    y -= 20;
  };

  page.drawRectangle({
    x: 0,
    y: 0,
    width,
    height: 841.89,
    color: rgb(0.98, 0.98, 0.96),
  });

  draw(`${input.fiscalYear} 年分 支払調書 本人交付控`, 20);
  draw("報酬、料金、契約金及び賞金の支払調書", 12);
  line();
  draw(`支払者: ${input.payerName}`, 12);
  draw(`支払者住所: ${input.payerAddress || "-"}`);
  draw(`支払を受ける者: ${input.recipientName}`, 12);
  draw(`住所: ${input.recipientAddress || "-"}`);
  draw(`登録番号: ${input.invoiceRegistrationNo || "-"}`);
  line();
  draw(`支払金額: ${formatYen(input.payoutTotal)}`, 14);
  draw(`報酬: ${formatYen(input.rewardTotal)}`);
  draw(`補正: ${formatYen(input.correctionTotal)}`);
  draw(`源泉徴収税額: ${formatYen(input.withholdingTotal)}`);
  line();
  draw(`生成日時: ${input.generatedAt}`);
  draw("このPDFはGENBA QUESTの年次集計から生成された本人交付用控です。", 10);

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
