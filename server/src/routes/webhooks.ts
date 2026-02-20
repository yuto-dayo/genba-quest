/**
 * Webhook エンドポイント (Phase 0)
 * Gmail Pub/Sub通知を受信して書類を自動分類・ルーティング
 */

import { createHash } from "crypto";
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
import { ProposalService } from "../services/ProposalService";
import { ActorRef, ProposalType } from "../services/PolicyEngine";

const router = express.Router();
const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID || "00000000-0000-0000-0000-000000000001";
const INTEGRATION_SOURCE = "gmail";
const INTEGRATION_NAME = "Gmail Watcher";

interface IntegrationProposalResult {
  proposalId: string;
  status: string;
  deduplicated: boolean;
  autoApproved: boolean;
  autoExecuted: boolean;
}

type TaskPriority = "high" | "medium" | "low";

interface CommunicationTaskSuggestion {
  taskId: string;
  kind: "review" | "reply" | "schedule" | "follow_up";
  title: string;
  description: string;
  priority: TaskPriority;
  dueDate?: string;
  replyDraft?: string;
}

interface CommunicationAnalysis {
  summary: string;
  priority: TaskPriority;
  dueDate?: string;
  tasks: CommunicationTaskSuggestion[];
}

interface ParsedMessageBody {
  text: string;
  html: string;
}

const COMMUNICATION_ANALYSIS_VERSION = "v1";
const COMMUNICATION_BODY_PREVIEW_LIMIT = 600;
const COMMUNICATION_BODY_FULL_LIMIT = 4000;

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
        continue;
      }

      await processCommunicationEmail(msg.id);
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
    await routeDocument(messageId, attachment, classificationResult, ocrResult.raw_text);

  } catch (error: any) {
    console.error('[DOC_PROCESS] エラー:', error.message);
    await createManualReviewProposal(messageId, attachment.filename, error.message);
  }
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64").toString("utf-8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function collectMessageTextParts(
  part: unknown,
  plainParts: string[],
  htmlParts: string[]
): void {
  if (!part || typeof part !== "object") {
    return;
  }

  const typedPart = part as {
    mimeType?: string;
    body?: { data?: string };
    parts?: unknown[];
  };

  const mimeType = (typedPart.mimeType || "").toLowerCase();
  const bodyData = typedPart.body?.data;
  if (typeof bodyData === "string" && bodyData.length > 0) {
    const decoded = decodeBase64Url(bodyData);
    if (decoded.trim()) {
      if (mimeType.startsWith("text/plain")) {
        plainParts.push(decoded);
      } else if (mimeType.startsWith("text/html")) {
        htmlParts.push(decoded);
      }
    }
  }

  if (Array.isArray(typedPart.parts)) {
    for (const child of typedPart.parts) {
      collectMessageTextParts(child, plainParts, htmlParts);
    }
  }
}

function extractMessageBody(message: unknown): ParsedMessageBody {
  const fallback = { text: "", html: "" };
  if (!message || typeof message !== "object") {
    return fallback;
  }

  const payload = (message as { payload?: unknown }).payload;
  const plainParts: string[] = [];
  const htmlParts: string[] = [];
  collectMessageTextParts(payload, plainParts, htmlParts);

  const plainText = plainParts.join("\n\n").trim();
  const htmlText = htmlParts.join("\n\n").trim();
  const normalizedHtml = htmlText ? stripHtml(htmlText) : "";

  return {
    text: plainText || normalizedHtml,
    html: normalizedHtml,
  };
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toPreviewText(text: string, maxLength: number): string {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function extractDueDate(text: string): string | undefined {
  const ymd = text.match(/\b(20\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})\b/);
  if (ymd) {
    const year = Number(ymd[1]);
    const month = Number(ymd[2]);
    const day = Number(ymd[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const md = text.match(/(\d{1,2})月(\d{1,2})日/);
  if (md) {
    const today = new Date();
    const year = today.getFullYear();
    const month = Number(md[1]);
    const day = Number(md[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return undefined;
}

function derivePriority(text: string): TaskPriority {
  const urgentKeywords = ["至急", "本日中", "緊急", "早急", "今すぐ", "本日", "urgent", "asap"];
  if (urgentKeywords.some((keyword) => text.toLowerCase().includes(keyword.toLowerCase()))) {
    return "high";
  }

  const mediumKeywords = ["明日", "今週", "期限", "対応", "確認", "ご都合", "schedule"];
  if (mediumKeywords.some((keyword) => text.toLowerCase().includes(keyword.toLowerCase()))) {
    return "medium";
  }

  return "low";
}

function summarizeBody(text: string): string {
  const lines = normalizeWhitespace(text)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return "本文の要約を生成できませんでした。";
  }

  return lines.slice(0, 3).join(" / ");
}

function toSenderName(fromHeader: string): string {
  const trimmed = fromHeader.trim();
  const match = trimmed.match(/^(.+?)\s*<.+>$/);
  if (match && match[1]) {
    return match[1].replace(/^"|"$/g, "").trim();
  }
  return trimmed;
}

function buildReplyDraft(sender: string, subject: string, summary: string, dueDate?: string): string {
  const senderName = toSenderName(sender);
  const dueLine = dueDate ? `\nご指定の期限（${dueDate}）に合わせて対応を進めます。` : "";
  return [
    `${senderName} 様`,
    "",
    "ご連絡ありがとうございます。",
    `内容を確認しました（要点: ${summary}）。${dueLine}`,
    "",
    "必要事項を社内確認の上、改めてご連絡いたします。",
    "",
    "よろしくお願いいたします。",
    "",
    `Re: ${subject}`,
  ].join("\n");
}

function analyzeCommunicationEmail(subject: string, bodyText: string, sender: string): CommunicationAnalysis {
  const normalized = `${subject}\n${bodyText}`;
  const dueDate = extractDueDate(normalized);
  const priority = derivePriority(normalized);
  const summary = summarizeBody(bodyText);

  const responseKeywords = ["返信", "回答", "返答", "ご確認ください", "ご対応", "お願いします", "依頼", "可否"];
  const scheduleKeywords = ["日程", "スケジュール", "工程", "予定", "延期", "前倒し", "開始", "完了", "調整"];
  const followUpKeywords = ["共有", "報告", "相談", "進捗", "確認"];

  const hasResponseNeed = responseKeywords.some((k) => normalized.includes(k));
  const hasScheduleContext = scheduleKeywords.some((k) => normalized.includes(k));
  const hasFollowUpNeed = followUpKeywords.some((k) => normalized.includes(k));

  const tasks: CommunicationTaskSuggestion[] = [];

  tasks.push({
    taskId: "review",
    kind: "review",
    title: `要点確認: ${subject || "件名なし"}`,
    description: `本文要点: ${summary}`,
    priority,
    dueDate,
  });

  if (hasResponseNeed) {
    tasks.push({
      taskId: "reply",
      kind: "reply",
      title: "返信文の確認と送信判断",
      description: "返信が必要と推定されます。ドラフトを確認して承認/修正してください。",
      priority: priority === "low" ? "medium" : priority,
      dueDate,
      replyDraft: buildReplyDraft(sender, subject, summary, dueDate),
    });
  }

  if (hasScheduleContext) {
    tasks.push({
      taskId: "schedule",
      kind: "schedule",
      title: "日程調整タスク",
      description: "スケジュール関連の連絡です。関係者調整・日程反映の提案を確認してください。",
      priority: priority === "low" ? "medium" : priority,
      dueDate,
    });
  } else if (hasFollowUpNeed && !hasResponseNeed) {
    tasks.push({
      taskId: "follow-up",
      kind: "follow_up",
      title: "フォローアップ要否の確認",
      description: "状況共有/確認依頼の可能性があります。必要な社内対応を判断してください。",
      priority,
      dueDate,
    });
  }

  return {
    summary,
    priority,
    dueDate,
    tasks: tasks.slice(0, 3),
  };
}

function buildCommunicationReviewDescription(
  subject: string,
  sender: string,
  analysis: CommunicationAnalysis
): string {
  const dueLine = analysis.dueDate ? `\n- 期限候補: ${analysis.dueDate}` : "";
  return [
    "📨 **業務連絡メールの要点確認**",
    "",
    `- 件名: ${subject}`,
    `- 送信者: ${sender}`,
    `- 優先度: ${analysis.priority}`,
    `${dueLine}`,
    "",
    `**要点**: ${analysis.summary}`,
    "",
    "下位タスク（返信・調整など）を確認し、承認/却下/指示を行ってください。",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

function buildCommunicationTaskDescription(task: CommunicationTaskSuggestion, summary: string): string {
  const dueLine = task.dueDate ? `\n期限候補: ${task.dueDate}` : "";
  const replyLine = task.replyDraft
    ? `\n\n返信ドラフト:\n${task.replyDraft}`
    : "";
  return `📌 ${task.title}\n\n${task.description}\n\n本文要点: ${summary}${dueLine}${replyLine}`;
}

async function processCommunicationEmail(messageId: string): Promise<void> {
  try {
    console.log("[COMMUNICATION] 開始:", messageId);

    const watcher = createGmailWatcher();
    const message = await watcher.getMessage(messageId);
    const subject = watcher.getHeader(message, "Subject") || "(件名なし)";
    const from = watcher.getHeader(message, "From") || "送信者不明";
    const receivedAt = watcher.getHeader(message, "Date");
    const parsedBody = extractMessageBody(message);
    const snippet = typeof (message as { snippet?: unknown }).snippet === "string"
      ? (message as { snippet: string }).snippet
      : "";
    const sourceText = normalizeWhitespace(parsedBody.text || snippet);

    if (!sourceText) {
      console.log("[COMMUNICATION] 本文が空のためスキップ:", messageId);
      return;
    }

    const analysis = analyzeCommunicationEmail(subject, sourceText, from);
    const bodyPreview = toPreviewText(sourceText, COMMUNICATION_BODY_PREVIEW_LIMIT);
    const bodyFull = toPreviewText(sourceText, COMMUNICATION_BODY_FULL_LIMIT);

    const parentPayload: Record<string, unknown> = {
      title: `メール要点確認: ${subject}`,
      category: "communication",
      source: INTEGRATION_SOURCE,
      source_message_id: messageId,
      source_message_subject: subject,
      source_message_from: from,
      source_message_date: receivedAt || new Date().toISOString(),
      source_message_body_preview: bodyPreview,
      source_message_body_full: bodyFull,
      analysis_version: COMMUNICATION_ANALYSIS_VERSION,
      summary: analysis.summary,
      priority: analysis.priority,
      due_date: analysis.dueDate,
      suggested_tasks: analysis.tasks,
      recorded_date: new Date().toISOString().slice(0, 10),
    };

    const parentDescription = buildCommunicationReviewDescription(subject, from, analysis);
    const parentResult = await createOrReuseIntegrationProposal({
      type: "communication.review",
      payload: parentPayload,
      description: parentDescription,
      source: INTEGRATION_SOURCE,
      externalId: `${messageId}:communication-review:${COMMUNICATION_ANALYSIS_VERSION}`,
      integrationName: INTEGRATION_NAME,
      submit: true,
    });

    for (const task of analysis.tasks) {
      const taskDescription = buildCommunicationTaskDescription(task, analysis.summary);
      await createOrReuseIntegrationProposal({
        type: "communication.task",
        payload: {
          title: task.title,
          category: "communication",
          description: taskDescription,
          task_kind: task.kind,
          priority: task.priority,
          due_date: task.dueDate,
          suggested_reply: task.replyDraft || null,
          parent_proposal_id: parentResult.proposalId,
          source: INTEGRATION_SOURCE,
          source_message_id: messageId,
          source_message_subject: subject,
          source_message_from: from,
          source_message_body_preview: bodyPreview,
          source_message_body_full: bodyFull,
          analysis_version: COMMUNICATION_ANALYSIS_VERSION,
          recorded_date: new Date().toISOString().slice(0, 10),
        },
        description: taskDescription,
        source: INTEGRATION_SOURCE,
        externalId: `${messageId}:communication-task:${task.taskId}:${COMMUNICATION_ANALYSIS_VERSION}`,
        integrationName: INTEGRATION_NAME,
        submit: true,
      });
    }

    await notifyAdminsAboutCommunication(parentResult.proposalId, subject, analysis.priority);

    console.log("[COMMUNICATION] 完了:", {
      message_id: messageId,
      parent_proposal_id: parentResult.proposalId,
      task_count: analysis.tasks.length,
    });
  } catch (error: any) {
    console.error("[COMMUNICATION] エラー:", error.message);
    await createManualReviewProposal(messageId, "email-body", error.message);
  }
}

// ============================================================
// Document Routing
// ============================================================

async function routeDocument(
  messageId: string,
  attachment: PdfAttachment,
  result: ClassificationResult,
  rawText: string
) {
  const { type, confidence, reasoning, extracted_data, model_used } = result;
  const proposalType = getIntegrationProposalType(type);
  const proposalTitle = generateProposalTitle(type, extracted_data);
  const proposalDescription = generateProposalDescription(type, extracted_data, reasoning);
  const amount = extractAmountFromDocumentData(extracted_data);

  console.log(`[ROUTER] ${type} → ${proposalType}`);

  const payload: Record<string, unknown> = {
    title: proposalTitle,
    category: type === "order" ? "construction" : "document",
    description: proposalDescription,
    document_type: type,
    source: INTEGRATION_SOURCE,
    source_message_id: messageId,
    source_attachment_id: attachment.attachmentId,
    source_filename: attachment.filename,
    extracted_data,
    classification: {
      confidence,
      reasoning,
      model_used,
    },
    raw_text_preview: rawText.slice(0, 500),
    recorded_date: new Date().toISOString().slice(0, 10),
  };

  if (amount !== null) {
    payload.amount = amount;
  }

  const integrationResult = await createOrReuseIntegrationProposal({
    type: proposalType,
    payload,
    description: proposalDescription,
    source: INTEGRATION_SOURCE,
    externalId: `${messageId}:${attachment.attachmentId}`,
    integrationName: INTEGRATION_NAME,
    submit: true,
  });

  console.log("[ROUTER] 提案作成完了:", {
    proposal_id: integrationResult.proposalId,
    status: integrationResult.status,
    deduplicated: integrationResult.deduplicated,
    auto_approved: integrationResult.autoApproved,
    auto_executed: integrationResult.autoExecuted,
  });

  // 管理者に通知
  await notifyAdmins(type, integrationResult.proposalId, extracted_data);
}

// ============================================================
// Helper Functions
// ============================================================

function getNotificationType(docType: DocumentType): string {
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

function getIntegrationProposalType(docType: DocumentType): ProposalType {
  if (docType === "order") {
    return "income.create";
  }

  return "expense.create";
}

function extractAmountFromDocumentData(data: unknown): number | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const record = data as Record<string, unknown>;
  const directAmount = record.amount;
  if (typeof directAmount === "number" && Number.isFinite(directAmount)) {
    return directAmount;
  }
  if (typeof directAmount === "string") {
    const normalized = Number(directAmount.replace(/[,\s¥￥]/g, ""));
    if (Number.isFinite(normalized)) {
      return normalized;
    }
  }

  if (directAmount && typeof directAmount === "object") {
    const amountValue = (directAmount as Record<string, unknown>).value;
    if (typeof amountValue === "number" && Number.isFinite(amountValue)) {
      return amountValue;
    }
  }

  const fallbackKeys = ["total", "amount_total", "total_amount"];
  for (const key of fallbackKeys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const normalized = Number(value.replace(/[,\s¥￥]/g, ""));
      if (Number.isFinite(normalized)) {
        return normalized;
      }
    }
  }

  return null;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function buildDeterministicUuid(seed: string): string {
  const hash = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hash[12] = "4";
  hash[16] = ((parseInt(hash[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hash.slice(0, 8).join("")}-${hash.slice(8, 12).join("")}-${hash.slice(12, 16).join("")}-${hash.slice(16, 20).join("")}-${hash.slice(20, 32).join("")}`;
}

function isDuplicateKeyError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }

  return err.message.includes("duplicate key value") || err.message.includes("23505");
}

async function createOrReuseIntegrationProposal(input: {
  type: ProposalType;
  payload: Record<string, unknown>;
  description: string;
  source: string;
  externalId: string;
  integrationName: string;
  orgId?: string;
  submit?: boolean;
}): Promise<IntegrationProposalResult> {
  const normalizedSource = normalizeString(input.source);
  const normalizedExternalId = normalizeString(input.externalId);
  const normalizedDescription = normalizeString(input.description);

  if (!normalizedSource || !normalizedExternalId || !normalizedDescription) {
    throw new Error("INVALID_INTEGRATION_INPUT");
  }

  const orgId = input.orgId || DEFAULT_ORG_ID;
  const proposalService = new ProposalService(orgId);
  const proposalId = buildDeterministicUuid(`${orgId}:${normalizedSource}:${normalizedExternalId}`);
  const integrationActor: ActorRef = {
    type: "integration",
    id: `integration:${normalizedSource}`,
    name: normalizeString(input.integrationName) || `Integration(${normalizedSource})`,
  };

  const createInput = {
    id: proposalId,
    type: input.type,
    payload: {
      ...input.payload,
      _integration: {
        source: normalizedSource,
        external_id: normalizedExternalId,
      },
    },
    description: normalizedDescription,
    created_by: integrationActor,
    org_id: orgId,
  };

  try {
    if (input.submit === false) {
      const proposal = await proposalService.create(createInput);
      return {
        proposalId: proposal.id,
        status: proposal.status,
        deduplicated: false,
        autoApproved: false,
        autoExecuted: false,
      };
    }

    const submitResult = await proposalService.createAndSubmit(createInput);
    return {
      proposalId: submitResult.proposal.id,
      status: submitResult.proposal.status,
      deduplicated: false,
      autoApproved: submitResult.autoApproved,
      autoExecuted: submitResult.autoExecuted,
    };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const existing = await proposalService.getById(proposalId);
      if (existing) {
        const autoExecuted = existing.status === "executed";
        const autoApproved = existing.status === "approved" || autoExecuted;
        return {
          proposalId: existing.id,
          status: existing.status,
          deduplicated: true,
          autoApproved,
          autoExecuted,
        };
      }
    }

    throw error;
  }
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

async function notifyAdminsAboutCommunication(
  proposalId: string,
  subject: string,
  priority: TaskPriority
) {
  const { data: admins } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .in("role", ["admin", "manager"]);

  if (!admins || admins.length === 0) return;

  const notifications = admins.map((admin: { id: string }) => ({
    user_id: admin.id,
    type: "approval_required",
    title: `メール対応提案が作成されました（${priority}）`,
    message: `件名「${subject}」の要点確認と対応タスクを提案しました。`,
    data: {
      proposal_id: proposalId,
      proposal_type: "communication.review",
      priority,
    },
  }));

  await supabaseAdmin.from("notifications").insert(notifications);
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
    type: getNotificationType(docType),
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
    const description = `Gmail添付ファイル「${filename}」の自動解析に失敗しました。\n\n**エラー理由**: ${errorReason}\n\n手動で確認してください。\n\nGmail Message ID: ${messageId}`;
    const result = await createOrReuseIntegrationProposal({
      type: "expense.create",
      payload: {
        title: "書類の手動確認が必要",
        category: "document",
        description,
        parse_error: true,
        error_reason: errorReason,
        source: INTEGRATION_SOURCE,
        source_message_id: messageId,
        source_filename: filename,
      },
      description,
      source: INTEGRATION_SOURCE,
      externalId: `${messageId}:manual-review:${filename}`,
      integrationName: INTEGRATION_NAME,
      submit: true,
    });

    console.log("[MANUAL_REVIEW] 手動確認提案作成:", {
      proposal_id: result.proposalId,
      deduplicated: result.deduplicated,
      status: result.status,
    });

  } catch (error: any) {
    console.error('[MANUAL_REVIEW] エラー:', error.message);
  }
}

export const __webhooksTestables = {
  getIntegrationProposalType,
  extractAmountFromDocumentData,
  extractMessageBody,
  analyzeCommunicationEmail,
  normalizeString,
  buildDeterministicUuid,
  isDuplicateKeyError,
  createOrReuseIntegrationProposal,
};

export default router;
