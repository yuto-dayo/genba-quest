/**
 * 発注書パーサー (Phase 0)
 * OCRテキストから発注書情報を抽出
 */

import { analyzeDocument, OcrResult } from './ocrService';

// ============================================================
// Types
// ============================================================

export interface ParsedOrder {
  siteName: string;
  address: string;
  clientName: string;
  contactPerson?: string;
  startDate: Date;
  endDate: Date;
  revenue: number;
  workTypes: string[];
  estimatedHours?: number;
  rawText?: string;
}

export interface OrderParseResult {
  success: boolean;
  order: ParsedOrder | null;
  confidence: number;
  errors: string[];
}

// ============================================================
// Order Parser
// ============================================================

export class OrderParser {
  /**
   * OCRテキストから発注書情報を抽出
   */
  parseOcrText(text: string): ParsedOrder | null {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    try {
      const siteName = this.extractSiteName(lines);
      const dates = this.extractDates(lines);

      if (!siteName || !dates) {
        console.warn('[ORDER_PARSER] 必須項目が見つかりません');
        return null;
      }

      return {
        siteName,
        address: this.extractAddress(lines) || '',
        clientName: this.extractClientName(lines) || '不明',
        contactPerson: this.extractContactPerson(lines),
        startDate: dates.start,
        endDate: dates.end,
        revenue: this.extractRevenue(lines) || 0,
        workTypes: this.extractWorkTypes(lines),
        estimatedHours: this.calculateEstimatedHours(dates.start, dates.end),
        rawText: text
      };
    } catch (error: any) {
      console.error('[ORDER_PARSER] パースエラー:', error.message);
      return null;
    }
  }

  /**
   * 画像から直接発注書を解析（OCR + パース）
   */
  async parseFromImage(
    imageBase64: string,
    mimeType: string
  ): Promise<OrderParseResult> {
    const errors: string[] = [];

    try {
      // OCR実行
      const ocrResult: OcrResult = await analyzeDocument(imageBase64, mimeType);

      if (!ocrResult.raw_text || ocrResult.raw_text.length === 0) {
        errors.push('OCRテキスト抽出失敗');
        return { success: false, order: null, confidence: 0, errors };
      }

      // パース
      const order = this.parseOcrText(ocrResult.raw_text);

      if (!order) {
        errors.push('発注書情報の抽出失敗');
        return { success: false, order: null, confidence: 0, errors };
      }

      // 信頼度計算
      const confidence = this.calculateConfidence(order);

      return {
        success: true,
        order,
        confidence,
        errors
      };

    } catch (error: any) {
      errors.push(error.message);
      return { success: false, order: null, confidence: 0, errors };
    }
  }

  // ============================================================
  // Private Extraction Methods
  // ============================================================

  private extractSiteName(lines: string[]): string | null {
    const keywords = ['工事名', '現場名', '件名', '物件名', '工事件名'];

    for (const line of lines) {
      for (const keyword of keywords) {
        if (line.includes(keyword)) {
          // 例: "工事名：〇〇ビル改修工事" → "〇〇ビル改修工事"
          const parts = line.split(/[:：]/);
          if (parts.length >= 2) {
            const name = parts.slice(1).join(':').trim();
            if (name.length > 0) {
              return name;
            }
          }
        }
      }
    }

    return null;
  }

  private extractAddress(lines: string[]): string | null {
    const keywords = ['住所', '所在地', '現場住所', '工事場所'];

    for (const line of lines) {
      for (const keyword of keywords) {
        if (line.includes(keyword)) {
          const parts = line.split(/[:：]/);
          if (parts.length >= 2) {
            return parts.slice(1).join(':').trim();
          }
        }
      }
    }

    // 住所パターンマッチング（都道府県から始まる）
    const addressPattern = /(東京都|北海道|(?:京都|大阪)府|.{2,3}県).+/;
    for (const line of lines) {
      const match = line.match(addressPattern);
      if (match) {
        return match[0];
      }
    }

    return null;
  }

  private extractClientName(lines: string[]): string | null {
    const keywords = ['発注者', 'クライアント', '注文者', '御中', '様'];

    for (const line of lines) {
      for (const keyword of keywords) {
        if (line.includes(keyword)) {
          // 「株式会社〇〇御中」→「株式会社〇〇」
          let name = line.replace(/御中|様/g, '').trim();

          // キーワードが含まれている場合は除去
          for (const kw of ['発注者', 'クライアント', '注文者']) {
            name = name.replace(kw, '').replace(/[:：]/g, '').trim();
          }

          if (name.length > 0) {
            return name;
          }
        }
      }
    }

    return null;
  }

  private extractContactPerson(lines: string[]): string | undefined {
    const keywords = ['担当', '担当者', 'ご担当'];

    for (const line of lines) {
      for (const keyword of keywords) {
        if (line.includes(keyword)) {
          const parts = line.split(/[:：]/);
          if (parts.length >= 2) {
            const person = parts.slice(1).join(':').trim();
            if (person.length > 0) {
              return person;
            }
          }
        }
      }
    }

    return undefined;
  }

  private extractDates(lines: string[]): { start: Date; end: Date } | null {
    // 「工期」「期間」などから日付抽出
    const datePattern = /(\d{4})[年\/\-](\d{1,2})[月\/\-](\d{1,2})/g;
    const allText = lines.join('\n');
    const matches = [...allText.matchAll(datePattern)];

    if (matches.length >= 2) {
      const [y1, m1, d1] = matches[0].slice(1, 4).map(Number);
      const [y2, m2, d2] = matches[1].slice(1, 4).map(Number);

      const start = new Date(y1, m1 - 1, d1);
      const end = new Date(y2, m2 - 1, d2);

      // 開始日が終了日より後の場合はスワップ
      if (start > end) {
        return { start: end, end: start };
      }

      return { start, end };
    }

    return null;
  }

  private extractRevenue(lines: string[]): number | null {
    // 「請負金額」「合計金額」「工事費」などから数値抽出
    const keywords = ['請負金額', '合計金額', '工事費', '契約金額'];
    const amountPattern = /[¥￥]?\s*([\d,]+)\s*円/;

    for (const line of lines) {
      for (const keyword of keywords) {
        if (line.includes(keyword)) {
          const match = line.match(amountPattern);
          if (match) {
            const amount = parseInt(match[1].replace(/,/g, ''), 10);
            if (!isNaN(amount)) {
              return amount;
            }
          }
        }
      }
    }

    return null;
  }

  private extractWorkTypes(lines: string[]): string[] {
    const workTypes: string[] = [];
    const keywords = ['工事種別', '工種', '作業内容', '工事内容'];

    // キーワードマッチング
    const typeKeywords = [
      { key: '塗装', value: 'painting' },
      { key: '防水', value: 'waterproofing' },
      { key: '足場', value: 'scaffolding' },
      { key: '解体', value: 'demolition' },
      { key: '電気', value: 'electrical' },
      { key: '配管', value: 'plumbing' },
      { key: '内装', value: 'interior' },
      { key: '外装', value: 'exterior' }
    ];

    const allText = lines.join('\n');

    for (const { key, value } of typeKeywords) {
      if (allText.includes(key)) {
        workTypes.push(value);
      }
    }

    // 見つからない場合はデフォルト
    if (workTypes.length === 0) {
      workTypes.push('construction');
    }

    return [...new Set(workTypes)]; // 重複除去
  }

  private calculateEstimatedHours(startDate: Date, endDate: Date): number {
    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    // 1日8時間 × 日数
    return days * 8;
  }

  /**
   * パース結果の信頼度を計算（0-100）
   */
  private calculateConfidence(order: ParsedOrder): number {
    let score = 0;

    if (order.siteName && order.siteName.length > 3) score += 30;
    if (order.address && order.address.length > 5) score += 20;
    if (order.startDate && order.endDate) score += 30;
    if (order.revenue > 0) score += 20;

    return score;
  }
}
