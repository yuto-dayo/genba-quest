/**
 * Webhook エンドポイント (Phase 0)
 * Gmail Pub/Sub通知を受信して書類を自動分類・ルーティング
 */

import express, { Request, Response } from 'express';
import { createGmailWatcher } from '../services/GmailWatcher';
import { analyzeDocument } from '../services/ocrService';
import {
  getDocumentClassifier,
  ClassificationResult,
  DocumentType,
  OrderData,
  EstimateRequestData,
  InvoiceData,
  QuotationData,
  ChangeOrderData,
} from '../services/DocumentClassifier';
import { supabaseAdmin } from '../lib/supabaseAdmin';

const router = express.Router();

// ============================================================
// Gmail Pub/Sub Webhook
// ============================================================

/**
 * Gmail Pub/Sub通知エンドポイント
 * POST /api/v1/webhooks/gmail-notification
 */
router.post('/gmail-notification', async (req: Request, res: Response) => {
  try {
    // 1. Pub/Subメッセージをデコード
    const message = req.body.message;
    if (!message || !message.data) {
      console.warn('[WEBHOOK] Invalid message format');
      return res.status(400).send('Invalid message format');
    }

    const data = Buffer.from(message.data, 'base64').toString('utf-8');
    const notification = JSON.parse(data);

    console.log('[WEBHOOK] Gmail通知受信:', {
      emailAddress: notification.emailAddress,
      historyId: notification.historyId
    });

    // 2. ACKを即座に返す（5秒以内必須）
    res.status(200).send('OK');

    // 3. 非同期で処理（レスポンス後）
    processNotification(notification).catch(err => {
      console.error('[WEBHOOK] 処理エラー:', err);
    });

  } catch (error: any) {
    console.error('[WEBHOOK] パースエラー:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// Notification Processing
// ============================================================

async function processNotification(notification: any) {
  const { historyId } = notification;

  try {
    // 機能フラグチェック
    const { data: featureFlag } = await supabaseAdmin
      .from('feature_flags')
      .select('enabled')
      .eq('feature_key', 'gmail_auto_quest')
      .single();

    if (!featureFlag || !featureFlag.enabled) {
      console.log('[WEBHOOK] gmail_auto_quest機能が無効です');
      return;
    }

    // 前回のhistoryIdを取得
    const { data: config } = await supabaseAdmin
      .from('system_config')
      .select('value')
      .eq('key', 'gmail_history_id')
      .single();

    if (!config) {
      console.warn('[WEBHOOK] 初回実行 - historyId未保存');
      await supabaseAdmin.from('system_config').upsert({
        key: 'gmail_history_id',
        value: historyId,
        updated_at: new Date().toISOString()
      });
      return;
    }

    // GmailWatcher初期化
    const watcher = createGmailWatcher();

    // 新着メッセージ取得
    const messages = await watcher.getNewMessages(config.value);

    console.log(`[WEBHOOK] 新着メッセージ: ${messages.length}件`);

    // PDF添付のあるメールを処理
    for (const msg of messages) {
      const attachments = await watcher.listAttachments(msg.id);
      const pdfAttachment = attachments.find(
        att => att.mimeType === 'application/pdf' || att.filename.toLowerCase().endsWith('.pdf')
      );

      if (pdfAttachment) {
        console.log('[WEBHOOK] PDF検知:', msg.id, pdfAttachment.filename);
        await processDocumentEmail(msg.id, pdfAttachment);
      }
    }

    // historyId更新
    await supabaseAdmin.from('system_config').upsert({
      key: 'gmail_history_id',
      value: historyId,
      updated_at: new Date().toISOString()
    });

    console.log('[WEBHOOK] 処理完了');

  } catch (error: any) {
    console.error('[WEBHOOK] 処理エラー:', error.message);
    throw error;
  }
}

// ============================================================
// Document Processing with Classification
// ============================================================

interface PdfAttachment {
  attachmentId: string;
  filename: string;
  mimeType: string;
}

async function processDocumentEmail(messageId: string, attachment: PdfAttachment) {
  try {
    console.log('[DOC_PROCESS] 開始:', messageId, attachment.filename);

    const watcher = createGmailWatcher();

    // 1. PDF本体ダウンロード
    const pdfBase64 = await watcher.downloadAttachment(messageId, attachment.attachmentId);
    console.log('[DOC_PROCESS] PDFダウンロード完了');

    // 2. OCR実行
    const ocrResult = await analyzeDocument(pdfBase64, 'application/pdf');

    if (!ocrResult.raw_text || ocrResult.raw_text.length < 50) {
      console.warn('[DOC_PROCESS] OCRテキストが不十分 - 手動確認へ');
      await createManualReviewProposal(messageId, attachment.filename, 'OCRテキスト抽出失敗');
      return;
    }

    console.log('[DOC_PROCESS] OCR完了:', ocrResult.raw_text.length, '文字');

    // 3. 書類分類
    const classifier = getDocumentClassifier();
    const classificationResult = await classifier.classify(ocrResult.raw_text);

    console.log('[DOC_PROCESS] 分類結果:', {
      type: classificationResult.type,
      confidence: classificationResult.confidence,
      model: classificationResult.model_used,
      reasoning: classificationResult.reasoning
    });

    // 4. タイプに応じてルーティング
    await routeDocument(messageId, attachment.filename, classificationResult, ocrResult.raw_text);

  } catch (error: any) {
    console.error('[DOC_PROCESS] エラー:', error.message);
    await createManualReviewProposal(messageId, attachment.filename, error.message);
  }
}

// ============================================================
// Document Routing
// ============================================================

async function routeDocument(
  messageId: string,
  filename: string,
  result: ClassificationResult,
  rawText: string
) {
  const { type, confidence, reasoning, extracted_data, model_used } = result;

  console.log(`[ROUTER] ${type} → ${getProposalType(type)}`);

  // ai_proposalsに登録
  const { data: proposal, error } = await supabaseAdmin
    .from('ai_proposals')
    .insert({
      proposal_type: getProposalType(type),
      title: generateProposalTitle(type, extracted_data),
      description: generateProposalDescription(type, extracted_data, reasoning),
      proposal_data: {
        document_type: type,
        gmailMessageId: messageId,
        pdfFilename: filename,
        extracted_data,
        raw_text_preview: rawText.slice(0, 500),
      },
      ai_provider: 'anthropic',
      ai_model: model_used === 'haiku' ? 'claude-3-haiku' : 'claude-sonnet-4',
      ai_confidence: confidence / 100,
      status: 'pending',
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    })
    .select()
    .single();

  if (error) {
    console.error('[ROUTER] ai_proposals登録エラー:', error);
    throw error;
  }

  console.log('[ROUTER] 提案作成完了:', proposal.id);

  // 管理者に通知
  await notifyAdmins(type, proposal.id, extracted_data);
}

// ============================================================
// Helper Functions
// ============================================================

function getProposalType(docType: DocumentType): string {
  const mapping: Record<DocumentType, string> = {
    order: 'auto_quest',
    quotation: 'purchase_decision',
    estimate_request: 'estimate_task',
    invoice: 'accounting_invoice',
    delivery_slip: 'inspection',
    change_order: 'quest_update',
    drawing: 'document_storage',
    unknown: 'manual_review',
  };
  return mapping[docType];
}

function generateProposalTitle(docType: DocumentType, data: any): string {
  switch (docType) {
    case 'order':
      const orderData = data as OrderData;
      return `新規クエスト：${orderData.site_name || '現場名不明'}`;

    case 'quotation':
      const quotationData = data as QuotationData;
      return `見積書受領：${quotationData.vendor_name || '業者名不明'}`;

    case 'estimate_request':
      const estimateData = data as EstimateRequestData;
      return `見積依頼：${estimateData.site_name || '現場名不明'}`;

    case 'invoice':
      const invoiceData = data as InvoiceData;
      return `請求書：${invoiceData.vendor_name || '業者名不明'}`;

    case 'change_order':
      const changeData = data as ChangeOrderData;
      return `変更指示：${changeData.site_name || '現場名不明'}`;

    case 'drawing':
      return '図面・資料の保存';

    case 'delivery_slip':
      return '納品書の検収確認';

    default:
      return '書類の手動確認が必要';
  }
}

function generateProposalDescription(docType: DocumentType, data: any, reasoning: string): string {
  let description = `📄 **${getDocumentTypeLabel(docType)}が検知されました**\n\n`;
  description += `**AI判定理由**: ${reasoning}\n\n`;

  switch (docType) {
    case 'order':
      const orderData = data as OrderData;
      description += `**現場名**: ${orderData.site_name || '未記載'}\n`;
      description += `**クライアント**: ${orderData.client_name || '未記載'}\n`;
      if (orderData.period?.start_date && orderData.period?.end_date) {
        description += `**工期**: ${orderData.period.start_date} 〜 ${orderData.period.end_date}\n`;
      } else if (orderData.period?.duration_months) {
        description += `**工期**: ${orderData.period.duration_months}ヶ月\n`;
      }
      if (orderData.amount) {
        description += `**金額**: ¥${orderData.amount.value.toLocaleString()}${orderData.amount.tax_included ? '（税込）' : '（税抜）'}\n`;
      }
      if (orderData.work_types?.length) {
        description += `**工種**: ${orderData.work_types.join(', ')}\n`;
      }
      break;

    case 'quotation':
      const quotationData = data as QuotationData;
      description += `**業者名**: ${quotationData.vendor_name || '未記載'}\n`;
      description += `**現場名**: ${quotationData.site_name || '未記載'}\n`;
      if (quotationData.amount) {
        description += `**金額**: ¥${quotationData.amount.value.toLocaleString()}\n`;
      }
      if (quotationData.valid_until) {
        description += `**有効期限**: ${quotationData.valid_until}\n`;
      }
      break;

    case 'estimate_request':
      const estimateData = data as EstimateRequestData;
      description += `**依頼元**: ${estimateData.requester_name || '未記載'}\n`;
      description += `**現場名**: ${estimateData.site_name || '未記載'}\n`;
      if (estimateData.response_deadline) {
        description += `**回答期限**: ${estimateData.response_deadline}\n`;
      }
      if (estimateData.has_drawings) {
        description += `**図面**: 添付あり\n`;
      }
      break;

    case 'invoice':
      const invoiceData = data as InvoiceData;
      description += `**請求元**: ${invoiceData.vendor_name || '未記載'}\n`;
      if (invoiceData.amount) {
        description += `**請求金額**: ¥${invoiceData.amount.value.toLocaleString()}\n`;
      }
      if (invoiceData.due_date) {
        description += `**支払期限**: ${invoiceData.due_date}\n`;
      }
      break;

    case 'change_order':
      const changeData = data as ChangeOrderData;
      description += `**現場名**: ${changeData.site_name || '未記載'}\n`;
      description += `**変更種別**: ${changeData.change_type || '未記載'}\n`;
      if (changeData.description) {
        description += `**内容**: ${changeData.description}\n`;
      }
      break;
  }

  description += `\n⚠️ この提案はGmailから自動生成されました。内容を確認の上、承認/却下してください。`;

  return description.trim();
}

function getDocumentTypeLabel(docType: DocumentType): string {
  const labels: Record<DocumentType, string> = {
    order: '注文書・発注書',
    quotation: '見積書（受領）',
    estimate_request: '見積依頼',
    invoice: '請求書',
    delivery_slip: '納品書',
    change_order: '変更指示書',
    drawing: '図面・資料',
    unknown: '不明な書類',
  };
  return labels[docType];
}

async function notifyAdmins(docType: DocumentType, proposalId: string, extractedData: any) {
  const { data: admins } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .in('role', ['admin', 'manager']);

  if (!admins || admins.length === 0) return;

  const siteName = extractedData.site_name || extractedData.vendor_name || '不明';

  const notifications = admins.map((admin: { id: string }) => ({
    user_id: admin.id,
    type: getProposalType(docType),
    title: `${getDocumentTypeLabel(docType)}が自動検知されました`,
    message: `「${siteName}」の書類を自動解析しました。確認をお願いします。`,
    data: {
      proposal_id: proposalId,
      document_type: docType,
    }
  }));

  await supabaseAdmin.from('notifications').insert(notifications);
}

async function createManualReviewProposal(messageId: string, filename: string, errorReason: string) {
  try {
    const { data, error } = await supabaseAdmin
      .from('ai_proposals')
      .insert({
        proposal_type: 'manual_review',
        title: '書類の手動確認が必要',
        description: `Gmail添付ファイル「${filename}」の自動解析に失敗しました。\n\n**エラー理由**: ${errorReason}\n\n手動で確認してください。\n\nGmail Message ID: ${messageId}`,
        proposal_data: {
          gmailMessageId: messageId,
          pdfFilename: filename,
          parseError: true,
          errorReason,
        },
        ai_provider: 'anthropic',
        ai_model: 'document_classifier',
        ai_confidence: 0,
        status: 'pending',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    console.log('[MANUAL_REVIEW] 手動確認提案作成:', data.id);

  } catch (error: any) {
    console.error('[MANUAL_REVIEW] エラー:', error.message);
  }
}

export default router;
