/**
 * Gmail監視サービス (Phase 0)
 * Gmail API + Pub/Sub を使用して新着メールを監視
 */

import { google } from 'googleapis';
import { supabaseAdmin } from '../lib/supabaseAdmin';

// ============================================================
// Types
// ============================================================

export interface GmailConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  topicName: string; // projects/PROJECT_ID/topics/gmail-notifications
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  historyId: string;
}

export interface GmailAttachment {
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  data?: string; // Base64エンコードされたデータ
}

type GmailApiErrorPayload = {
  error?: {
    errors?: Array<{ reason?: string }>;
  };
};

function isHistoryNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as {
    status?: number;
    code?: number;
    response?: {
      status?: number;
      data?: GmailApiErrorPayload;
    };
    errors?: Array<{ reason?: string }>;
  };

  const status = candidate.status ?? candidate.code ?? candidate.response?.status;
  const reason = candidate.errors?.[0]?.reason ?? candidate.response?.data?.error?.errors?.[0]?.reason;

  return status === 404 && reason === 'notFound';
}

// ============================================================
// Gmail Watcher Service
// ============================================================

export class GmailWatcher {
  private gmail: any;
  private config: GmailConfig;

  constructor(config: GmailConfig) {
    this.config = config;
    const oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret
    );
    oauth2Client.setCredentials({ refresh_token: config.refreshToken });
    this.gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  }

  /**
   * Gmail監視を開始（7日間有効）
   */
  async setupWatch(userEmail: string = 'me'): Promise<void> {
    try {
      const res = await this.gmail.users.watch({
        userId: userEmail,
        requestBody: {
          topicName: this.config.topicName,
          labelIds: ['INBOX'],
          labelFilterAction: 'include'
        }
      });

      const expiration = new Date(parseInt(res.data.expiration));
      console.log('[GMAIL_WATCH] 監視開始:', {
        email: userEmail,
        historyId: res.data.historyId,
        expiration: expiration.toISOString()
      });

      // SupabaseにhistoryId保存（次回の差分取得用）
      await supabaseAdmin.from('system_config').upsert({
        key: 'gmail_history_id',
        value: res.data.historyId,
        updated_at: new Date().toISOString()
      });

      await supabaseAdmin.from('system_config').upsert({
        key: 'gmail_watch_expiration',
        value: expiration.toISOString(),
        updated_at: new Date().toISOString()
      });

    } catch (error: any) {
      console.error('[GMAIL_WATCH] エラー:', error.message);
      throw error;
    }
  }

  /**
   * Watch更新（Cron jobで毎週実行）
   */
  async renewWatch(): Promise<void> {
    console.log('[GMAIL_WATCH] 更新中...');
    await this.setupWatch('me');
  }

  /**
   * 新着メッセージ取得（historyId差分）
   */
  async getNewMessages(startHistoryId: string): Promise<GmailMessage[]> {
    try {
      const res = await this.gmail.users.history.list({
        userId: 'me',
        startHistoryId: startHistoryId,
        historyTypes: ['messageAdded']
      });

      if (!res.data.history) {
        console.log('[GMAIL_WATCH] 新着メッセージなし');
        return [];
      }

      const messages: GmailMessage[] = [];
      for (const record of res.data.history) {
        if (record.messagesAdded) {
          for (const added of record.messagesAdded) {
            const msg = added.message;
            messages.push({
              id: msg.id,
              threadId: msg.threadId,
              labelIds: msg.labelIds || [],
              snippet: '',
              historyId: msg.historyId
            });
          }
        }
      }

      console.log(`[GMAIL_WATCH] 新着メッセージ: ${messages.length}件`);
      return messages;

    } catch (error: any) {
      if (isHistoryNotFoundError(error)) {
        console.warn(
          `[GMAIL_WATCH] 履歴ID ${startHistoryId} が無効または期限切れです。差分取得をスキップし、次の通知で再同期します。`
        );
        return [];
      }

      console.error('[GMAIL_WATCH] 履歴取得エラー:', error.message);
      throw error;
    }
  }

  /**
   * メッセージ詳細取得
   */
  async getMessage(messageId: string): Promise<any> {
    try {
      const res = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full'
      });

      return res.data;
    } catch (error: any) {
      console.error('[GMAIL_WATCH] メッセージ取得エラー:', error.message);
      throw error;
    }
  }

  /**
   * 添付ファイル一覧取得
   */
  async listAttachments(messageId: string): Promise<GmailAttachment[]> {
    try {
      const message = await this.getMessage(messageId);
      const attachments: GmailAttachment[] = [];

      if (!message.payload || !message.payload.parts) {
        return attachments;
      }

      this.collectAttachments(message.payload.parts, messageId, attachments);

      console.log(`[GMAIL_WATCH] 添付ファイル: ${attachments.length}件`);
      return attachments;

    } catch (error: any) {
      console.error('[GMAIL_WATCH] 添付ファイル取得エラー:', error.message);
      throw error;
    }
  }

  private collectAttachments(parts: any[], messageId: string, attachments: GmailAttachment[]): void {
    for (const part of parts) {
      if (!part || typeof part !== 'object') {
        continue;
      }

      if (part.filename && part.body && part.body.attachmentId) {
        attachments.push({
          messageId,
          attachmentId: part.body.attachmentId,
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream',
          size: part.body.size || 0,
        });
      }

      if (Array.isArray(part.parts) && part.parts.length > 0) {
        this.collectAttachments(part.parts, messageId, attachments);
      }
    }
  }

  /**
   * 添付ファイルダウンロード
   */
  async downloadAttachment(
    messageId: string,
    attachmentId: string
  ): Promise<string> {
    try {
      const res = await this.gmail.users.messages.attachments.get({
        userId: 'me',
        messageId: messageId,
        id: attachmentId
      });

      // Base64URLデコード
      const data = res.data.data;
      if (!data) {
        throw new Error('添付ファイルデータが空です');
      }

      // Base64URL → Base64
      const base64 = data.replace(/-/g, '+').replace(/_/g, '/');

      console.log(`[GMAIL_WATCH] 添付ファイルダウンロード成功: ${base64.length}文字`);
      return base64;

    } catch (error: any) {
      console.error('[GMAIL_WATCH] ダウンロードエラー:', error.message);
      throw error;
    }
  }

  /**
   * メッセージのヘッダー取得
   */
  getHeader(message: any, name: string): string | null {
    if (!message.payload || !message.payload.headers) {
      return null;
    }

    const header = message.payload.headers.find(
      (h: any) => h.name.toLowerCase() === name.toLowerCase()
    );

    return header?.value || null;
  }

  /**
   * 注文書メールかどうか判定
   */
  async isOrderEmail(messageId: string): Promise<boolean> {
    try {
      const message = await this.getMessage(messageId);

      // 件名チェック
      const subject = this.getHeader(message, 'Subject') || '';
      const orderKeywords = ['注文書', '発注書', '工事依頼', '見積依頼', 'order', 'purchase order'];

      const hasOrderKeyword = orderKeywords.some(keyword =>
        subject.toLowerCase().includes(keyword.toLowerCase())
      );

      // PDF添付ファイルチェック
      const attachments = await this.listAttachments(messageId);
      const hasPdf = attachments.some(att =>
        att.mimeType === 'application/pdf' || att.filename.toLowerCase().endsWith('.pdf')
      );

      const isOrder = hasOrderKeyword || hasPdf;

      console.log(`[GMAIL_WATCH] 注文書判定: ${isOrder} (件名: "${subject}", PDF: ${hasPdf})`);
      return isOrder;

    } catch (error: any) {
      console.error('[GMAIL_WATCH] 注文書判定エラー:', error.message);
      return false;
    }
  }
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * 環境変数からGmailWatcherインスタンスを生成
 */
export function createGmailWatcher(): GmailWatcher {
  const config: GmailConfig = {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN || '',
    topicName: process.env.GOOGLE_PUBSUB_TOPIC || ''
  };

  // 必須環境変数チェック
  if (!config.clientId || !config.clientSecret || !config.refreshToken) {
    throw new Error('Gmail設定が不足しています。GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKENを設定してください。');
  }

  if (!config.topicName) {
    throw new Error('Pub/Sub Topic名が設定されていません。GOOGLE_PUBSUB_TOPICを設定してください。');
  }

  return new GmailWatcher(config);
}
