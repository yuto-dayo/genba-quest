/**
 * Webhook エンドポイント (Phase 0)
 * Gmail Pub/Sub通知を受信して書類を自動分類・ルーティング
 */

import { createHash } from "crypto";
import express, { Request, Response } from 'express';
import { createGmailWatcher } from '../services/GmailWatcher';
import { analyzeDocument, OcrResult } from '../services/ocrService';
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
import { getDriveStorageService } from "../services/DriveStorageService";

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
const APPROVAL_REQUIRED_NOTIFICATION_TYPE = "approval_required";
const GMAIL_MESSAGE_PROCESSING_TABLE = "gmail_message_processing";
const OCR_CACHE_TABLE = "ocr_cache";
const PROCESSING_LOCK_TTL_MS = parsePositiveInt(
  process.env.GMAIL_WEBHOOK_PROCESSING_LOCK_TTL_MS,
  5 * 60 * 1000,
);
const LLM_RATE_LIMIT_PER_MINUTE = parsePositiveInt(process.env.GMAIL_LLM_RATE_LIMIT_PER_MINUTE, 4);
const LLM_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const LLM_RETRY_MAX_ATTEMPTS = parsePositiveInt(process.env.GMAIL_LLM_RETRY_MAX_ATTEMPTS, 3);
const LLM_RETRY_BASE_DELAY_MS = parsePositiveInt(process.env.GMAIL_LLM_RETRY_BASE_DELAY_MS, 10_000);
const UNKNOWN_AUTO_EXPENSE_CONFIDENCE_THRESHOLD = parsePositiveInt(
  process.env.GMAIL_UNKNOWN_AUTO_EXPENSE_CONFIDENCE_THRESHOLD,
  85,
);
const UNKNOWN_MANUAL_REASON_HINTS = [
  "業務書類ではない",
  "スキップ",
  "判別不能",
  "判定できない",
  "not enough",
  "unable to classify",
];
const DOCUMENT_OCR_MIN_TEXT_LENGTH = 50;
const OCR_SUPPORTED_EXACT_MIME_TYPES: ReadonlySet<string> = new Set([
  "application/pdf",
]);
const OCR_SUPPORTED_PREFIXES = ["image/"];
const SUPPORTED_ATTACHMENT_MIME_TYPES: ReadonlySet<string> = new Set([
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
]);
const SITE_INFERENCE_MIN_SCORE = parsePositiveInt(process.env.GMAIL_SITE_INFERENCE_MIN_SCORE, 90);
const SITE_INFERENCE_TOP_MATCH_LIMIT = parsePositiveInt(process.env.GMAIL_SITE_INFERENCE_TOP_MATCH_LIMIT, 3);

type MessageProcessingStatus = "processing" | "processed" | "error";
type LlmRequestType = "ocr" | "classifier";
type RoutingMode = "proposal" | "manual_review";

interface MessageProcessingRecord {
  message_id: string;
  history_id: string;
  status: MessageProcessingStatus;
  retry_count: number | null;
  updated_at: string | null;
}

interface OcrCacheRecord {
  hash: string;
  extracted_text: string;
  ocr_result: unknown;
  hit_count?: number;
}

interface RoutingDecision {
  mode: RoutingMode;
  proposalType: ProposalType;
  reason: string;
}

interface MailboxAttachment {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size?: number;
}

interface StoredDocumentRecord {
  id: string;
  org_id?: string | null;
  site_id: string | null;
  drive_file_id: string | null;
  drive_file_url: string | null;
  drive_folder_id: string | null;
  mime_type: string | null;
  original_filename: string | null;
  sha256: string | null;
}

interface SiteLookupRecord {
  id: string;
  org_id?: string | null;
  name: string | null;
  status: string | null;
}

interface SiteMatchRecord {
  siteId: string;
  siteName: string | null;
  candidate: string;
  score: number;
}

type SiteMatchDecisionReason = "matched" | "no_match" | "ambiguous" | "score_below_threshold";
type SiteInferenceReason =
  | SiteMatchDecisionReason
  | "no_candidates"
  | "site_lookup_failed"
  | "no_sites";

interface SiteMatchDecision {
  matched: SiteLookupRecord | null;
  reason: SiteMatchDecisionReason;
  bestScore: number;
  ambiguous: boolean;
  topMatches: SiteMatchRecord[];
}

interface SiteInferenceResult {
  inferredSiteId: string | null;
  inferredSiteName: string | null;
  reason: SiteInferenceReason;
  candidateCount: number;
  bestScore: number;
  ambiguous: boolean;
  topMatches: SiteMatchRecord[];
}

interface SiteInferenceContext {
  messageId: string;
  attachmentId: string;
  documentId: string;
  currentSiteId: string | null;
}

const llmRequestTimestamps: number[] = [];

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
  const notificationHistoryId = normalizeHistoryId(notification?.historyId);
  if (!notificationHistoryId) {
    console.warn("[WEBHOOK] historyId が不正な通知をスキップ");
    return;
  }

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
        value: notificationHistoryId,
        updated_at: new Date().toISOString()
      });
      return;
    }

    const previousHistoryId = normalizeString(config.value);
    if (!previousHistoryId) {
      console.warn('[WEBHOOK] gmail_history_id が空のため現在値で再同期');
      await supabaseAdmin.from('system_config').upsert({
        key: 'gmail_history_id',
        value: notificationHistoryId,
        updated_at: new Date().toISOString()
      });
      return;
    }

    // GmailWatcher初期化
    const watcher = createGmailWatcher();

    // 新着メッセージ取得
    const messages = await watcher.getNewMessages(previousHistoryId);

    console.log(`[WEBHOOK] 新着メッセージ: ${messages.length}件`);

    // PDF添付のあるメールを処理
    for (const msg of messages) {
      const messageHistoryId = normalizeHistoryId(msg.historyId) || notificationHistoryId;
      const lockAcquired = await acquireMessageProcessingLock(msg.id, messageHistoryId);
      if (!lockAcquired) {
        console.log("[WEBHOOK] 重複通知をスキップ:", { messageId: msg.id, historyId: messageHistoryId });
        continue;
      }

      try {
        const attachments = await watcher.listAttachments(msg.id);
        if (attachments.length > 0) {
          console.log('[WEBHOOK] 添付ファイル検知:', {
            messageId: msg.id,
            count: attachments.length,
          });

          for (const attachment of attachments) {
            await processDocumentEmail(msg.id, messageHistoryId, attachment);
          }
        } else {
          await processCommunicationEmail(msg.id);
        }

        await markMessageProcessingCompleted(msg.id, messageHistoryId);
      } catch (error: unknown) {
        await markMessageProcessingError(msg.id, messageHistoryId, error);
        console.error("[WEBHOOK] メッセージ処理失敗:", {
          messageId: msg.id,
          historyId: messageHistoryId,
          error: getErrorMessage(error),
        });
      }
    }

    // historyId更新
    await supabaseAdmin.from('system_config').upsert({
      key: 'gmail_history_id',
      value: notificationHistoryId,
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

function normalizeAttachmentMimeType(inputMimeType: string, filename: string): string {
  const normalizedMimeType = normalizeString(inputMimeType)?.toLowerCase();
  if (normalizedMimeType) {
    return normalizedMimeType;
  }

  const lowerFilename = filename.toLowerCase();
  if (lowerFilename.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (lowerFilename.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lowerFilename.endsWith(".xls")) {
    return "application/vnd.ms-excel";
  }
  if (lowerFilename.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lowerFilename.endsWith(".doc")) {
    return "application/msword";
  }
  if (lowerFilename.endsWith(".png")) {
    return "image/png";
  }
  if (lowerFilename.endsWith(".jpg") || lowerFilename.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  return "application/octet-stream";
}

function shouldAttemptOcr(mimeType: string, filename: string): boolean {
  const normalizedMimeType = normalizeAttachmentMimeType(mimeType, filename);

  if (OCR_SUPPORTED_EXACT_MIME_TYPES.has(normalizedMimeType)) {
    return true;
  }

  return OCR_SUPPORTED_PREFIXES.some((prefix) => normalizedMimeType.startsWith(prefix));
}

function normalizeSiteNameKey(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[　\s]/g, "")
    .replace(/[()（）【】［］\[\]「」『』]/g, "")
    .replace(/[・\-_]/g, "");

  const suffixes = [
    "新築工事",
    "改修工事",
    "内装工事",
    "建築工事",
    "リノベーション",
    "リノベ",
    "工事",
    "現場",
    "作業所",
  ];

  let current = normalized;
  for (const suffix of suffixes) {
    if (current.endsWith(suffix) && current.length > suffix.length) {
      current = current.slice(0, -suffix.length);
      break;
    }
  }

  return current;
}

function sanitizeSiteNameCandidate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .replace(/\s+/g, " ")
    .replace(/[　]/g, " ")
    .trim();

  if (normalized.length < 2) {
    return null;
  }

  return normalized;
}

function collectSiteNameCandidates(extractedData: unknown): string[] {
  if (!extractedData || typeof extractedData !== "object") {
    return [];
  }

  const record = extractedData as Record<string, unknown>;
  const candidates: string[] = [];
  const directKeys = ["site_name", "siteName", "project_name", "projectName", "construction_site", "constructionSite"];

  for (const key of directKeys) {
    const value = sanitizeSiteNameCandidate(record[key]);
    if (value) {
      candidates.push(value);
    }
  }

  const nestedEntries = [record.site, record.project];
  for (const entry of nestedEntries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const nestedRecord = entry as Record<string, unknown>;
    const nestedKeys = ["name", "site_name", "siteName", "project_name", "projectName"];
    for (const nestedKey of nestedKeys) {
      const value = sanitizeSiteNameCandidate(nestedRecord[nestedKey]);
      if (value) {
        candidates.push(value);
      }
    }
  }

  const deduped = new Set<string>();
  for (const candidate of candidates) {
    deduped.add(candidate);
  }

  return Array.from(deduped);
}

function getSiteMatchScore(candidate: string, site: SiteLookupRecord): number {
  const siteName = sanitizeSiteNameCandidate(site.name);
  if (!siteName) {
    return 0;
  }

  const candidateKey = normalizeSiteNameKey(candidate);
  const siteKey = normalizeSiteNameKey(siteName);
  if (!candidateKey || !siteKey) {
    return 0;
  }

  let score = 0;
  if (candidateKey === siteKey) {
    score = 120;
  } else if (candidateKey.length >= 5 && siteKey.includes(candidateKey)) {
    score = 90;
  } else if (siteKey.length >= 5 && candidateKey.includes(siteKey)) {
    score = 85;
  } else {
    return 0;
  }

  if ((site.status || "").toLowerCase() === "in_progress") {
    score += 2;
  }

  return score;
}

function resolveSiteMatchDecision(candidates: string[], sites: SiteLookupRecord[]): SiteMatchDecision {
  let best: SiteLookupRecord | null = null;
  let bestScore = 0;
  let ambiguous = false;
  const bestMatchBySiteId = new Map<string, SiteMatchRecord>();

  for (const candidate of candidates) {
    for (const site of sites) {
      const score = getSiteMatchScore(candidate, site);
      if (score <= 0) {
        continue;
      }

      const previousMatch = bestMatchBySiteId.get(site.id);
      if (!previousMatch || score > previousMatch.score) {
        bestMatchBySiteId.set(site.id, {
          siteId: site.id,
          siteName: site.name,
          candidate,
          score,
        });
      }

      if (score > bestScore) {
        best = site;
        bestScore = score;
        ambiguous = false;
        continue;
      }

      if (score === bestScore && best && site.id !== best.id) {
        ambiguous = true;
      }
    }
  }

  const topMatches = Array.from(bestMatchBySiteId.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, SITE_INFERENCE_TOP_MATCH_LIMIT);

  if (!best) {
    return {
      matched: null,
      reason: "no_match",
      bestScore,
      ambiguous,
      topMatches,
    };
  }

  if (ambiguous) {
    return {
      matched: null,
      reason: "ambiguous",
      bestScore,
      ambiguous,
      topMatches,
    };
  }

  if (bestScore < SITE_INFERENCE_MIN_SCORE) {
    return {
      matched: null,
      reason: "score_below_threshold",
      bestScore,
      ambiguous,
      topMatches,
    };
  }

  return {
    matched: best,
    reason: "matched",
    bestScore,
    ambiguous,
    topMatches,
  };
}

function selectBestSiteMatch(candidates: string[], sites: SiteLookupRecord[]): SiteLookupRecord | null {
  return resolveSiteMatchDecision(candidates, sites).matched;
}

function logSiteInferenceMetric(
  stage: string,
  context: SiteInferenceContext,
  payload: Record<string, unknown>,
): void {
  console.log("[SITE_INFERENCE_METRIC]", {
    stage,
    messageId: context.messageId,
    attachmentId: context.attachmentId,
    documentId: context.documentId,
    currentSiteId: context.currentSiteId,
    ...payload,
  });
}

async function inferSiteIdForAttachment(
  extractedData: unknown,
  context: SiteInferenceContext,
): Promise<SiteInferenceResult> {
  const candidates = collectSiteNameCandidates(extractedData);
  if (candidates.length === 0) {
    logSiteInferenceMetric("no_candidates", context, {
      candidateCount: 0,
    });
    return {
      inferredSiteId: null,
      inferredSiteName: null,
      reason: "no_candidates",
      candidateCount: 0,
      bestScore: 0,
      ambiguous: false,
      topMatches: [],
    };
  }

  const { data, error } = await supabaseAdmin
    .from("sites")
    .select("id,org_id,name,status")
    .limit(200);

  if (error) {
    console.warn("[DOC_PROCESS] 現場候補の取得に失敗:", getErrorMessage(error));
    logSiteInferenceMetric("site_lookup_failed", context, {
      reason: "site_lookup_failed",
      candidateCount: candidates.length,
      error: getErrorMessage(error),
    });
    return {
      inferredSiteId: null,
      inferredSiteName: null,
      reason: "site_lookup_failed",
      candidateCount: candidates.length,
      bestScore: 0,
      ambiguous: false,
      topMatches: [],
    };
  }

  const sites = (data || []) as SiteLookupRecord[];
  if (sites.length === 0) {
    logSiteInferenceMetric("no_sites", context, {
      reason: "no_sites",
      candidateCount: candidates.length,
    });
    return {
      inferredSiteId: null,
      inferredSiteName: null,
      reason: "no_sites",
      candidateCount: candidates.length,
      bestScore: 0,
      ambiguous: false,
      topMatches: [],
    };
  }

  const decision = resolveSiteMatchDecision(candidates, sites);
  if (!decision.matched) {
    logSiteInferenceMetric("unresolved", context, {
      reason: decision.reason,
      candidateCount: candidates.length,
      siteCount: sites.length,
      bestScore: decision.bestScore,
      ambiguous: decision.ambiguous,
      threshold: SITE_INFERENCE_MIN_SCORE,
      topMatches: decision.topMatches,
    });
    return {
      inferredSiteId: null,
      inferredSiteName: null,
      reason: decision.reason,
      candidateCount: candidates.length,
      bestScore: decision.bestScore,
      ambiguous: decision.ambiguous,
      topMatches: decision.topMatches,
    };
  }

  const matched = decision.matched;
  console.log("[DOC_PROCESS] site推定:", {
    siteId: matched.id,
    siteName: matched.name,
    candidateCount: candidates.length,
  });
  logSiteInferenceMetric("matched", context, {
    reason: "matched",
    candidateCount: candidates.length,
    siteCount: sites.length,
    inferredSiteId: matched.id,
    inferredSiteName: matched.name,
    bestScore: decision.bestScore,
    topMatches: decision.topMatches,
  });

  return {
    inferredSiteId: matched.id,
    inferredSiteName: matched.name,
    reason: "matched",
    candidateCount: candidates.length,
    bestScore: decision.bestScore,
    ambiguous: decision.ambiguous,
    topMatches: decision.topMatches,
  };
}

async function applyInferredSiteToDocument(
  storedDocument: StoredDocumentRecord,
  extractedData: unknown,
  driveStorage: ReturnType<typeof getDriveStorageService>,
  context: SiteInferenceContext,
): Promise<StoredDocumentRecord> {
  const inference = await inferSiteIdForAttachment(extractedData, context);
  if (!inference.inferredSiteId) {
    return storedDocument;
  }

  if (inference.inferredSiteId === storedDocument.site_id) {
    logSiteInferenceMetric("same_as_existing", context, {
      reason: inference.reason,
      inferredSiteId: inference.inferredSiteId,
      inferredSiteName: inference.inferredSiteName,
      bestScore: inference.bestScore,
    });
    return storedDocument;
  }

  const inferredSiteId = inference.inferredSiteId;
  let nextDriveFolderId = storedDocument.drive_folder_id;
  if (storedDocument.drive_file_id) {
    try {
      nextDriveFolderId = await driveStorage.moveFileToSiteInbox(
        storedDocument.drive_file_id,
        inferredSiteId,
        storedDocument.drive_folder_id || undefined,
      );
    } catch (error: unknown) {
      console.warn("[DOC_PROCESS] Driveのsiteフォルダ移動に失敗。metadataのみ更新します:", {
        documentId: storedDocument.id,
        driveFileId: storedDocument.drive_file_id,
        siteId: inferredSiteId,
        error: getErrorMessage(error),
      });
      logSiteInferenceMetric("drive_move_failed", context, {
        inferredSiteId,
        driveFileId: storedDocument.drive_file_id,
        previousDriveFolderId: storedDocument.drive_folder_id,
        error: getErrorMessage(error),
      });
    }
  }

  const { data: inferredSite } = await supabaseAdmin
    .from("sites")
    .select("org_id")
    .eq("id", inferredSiteId)
    .maybeSingle();

  const { data, error } = await supabaseAdmin
    .from("documents")
    .update({
      org_id: inferredSite?.org_id || storedDocument.org_id,
      site_id: inferredSiteId,
      drive_folder_id: nextDriveFolderId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", storedDocument.id)
    .select("id, org_id, site_id, drive_file_id, drive_file_url, drive_folder_id, mime_type, original_filename, sha256")
    .single();

  if (error || !data) {
    console.warn("[DOC_PROCESS] documents.site_id 更新失敗:", {
      documentId: storedDocument.id,
      siteId: inferredSiteId,
      error: getErrorMessage(error),
    });
    logSiteInferenceMetric("document_update_failed", context, {
      inferredSiteId,
      inferredSiteName: inference.inferredSiteName,
      bestScore: inference.bestScore,
      previousSiteId: storedDocument.site_id,
      nextDriveFolderId,
      error: getErrorMessage(error),
    });
    return {
      ...storedDocument,
      site_id: inferredSiteId,
      drive_folder_id: nextDriveFolderId,
    };
  }

  logSiteInferenceMetric("document_updated", context, {
    inferredSiteId,
    inferredSiteName: inference.inferredSiteName,
    bestScore: inference.bestScore,
    previousSiteId: storedDocument.site_id,
    nextDriveFolderId,
  });

  return data as StoredDocumentRecord;
}

async function upsertAttachmentDocument(input: {
  messageId: string;
  attachment: MailboxAttachment;
  mimeType: string;
  fileSize: number;
  hash: string;
  siteId: string | null;
  driveFileId: string;
  driveFileUrl: string;
  driveFolderId: string;
}): Promise<StoredDocumentRecord> {
  const { data, error } = await supabaseAdmin
    .from("documents")
    .upsert(
      {
        doc_type: "other",
        storage_path: `drive://${input.driveFileId}`,
        original_filename: input.attachment.filename,
        mime_type: input.mimeType,
        file_size: input.fileSize,
        sha256: input.hash,
        uploaded_by: null,
        site_id: input.siteId,
        client_id: null,
        gmail_message_id: input.messageId,
        gmail_attachment_id: input.attachment.attachmentId,
        drive_file_id: input.driveFileId,
        drive_file_url: input.driveFileUrl,
        drive_folder_id: input.driveFolderId,
      },
      { onConflict: "gmail_message_id,gmail_attachment_id" },
    )
    .select("id, org_id, site_id, drive_file_id, drive_file_url, drive_folder_id, mime_type, original_filename, sha256")
    .single();

  if (error || !data) {
    throw new Error(`DOCUMENT_UPSERT_FAILED:${getErrorMessage(error)}`);
  }

  return data as StoredDocumentRecord;
}

function buildOcrFieldProvenance(ocrResult: OcrResult): Record<string, { source: "ocr"; at: string }> {
  const timestamp = new Date().toISOString();
  const provenance: Record<string, { source: "ocr"; at: string }> = {};
  const fields = ocrResult.ocr_fields || {};
  for (const key of Object.keys(fields)) {
    provenance[key] = { source: "ocr", at: timestamp };
  }
  return provenance;
}

async function updateDocumentOcrResult(documentId: string, ocrResult: OcrResult): Promise<void> {
  const { error } = await supabaseAdmin
    .from("documents")
    .update({
      ocr_provider: ocrResult.provider,
      ocr_blocks: ocrResult.ocr_blocks,
      ocr_fields: ocrResult.ocr_fields,
      ocr_text: ocrResult.raw_text,
      field_provenance: buildOcrFieldProvenance(ocrResult),
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId);

  if (error) {
    console.warn("[DOC_PROCESS] documents OCR更新失敗:", {
      documentId,
      error: getErrorMessage(error),
    });
  }
}

function mapClassificationToAccountingDocType(type: DocumentType): "receipt" | "invoice" | "purchase_order" | "delivery_note" | "other" {
  switch (type) {
    case "invoice":
      return "invoice";
    case "delivery_slip":
      return "delivery_note";
    case "order":
    case "quotation":
    case "estimate_request":
    case "change_order":
      return "purchase_order";
    default:
      return "other";
  }
}

async function updateDocumentClassification(documentId: string, type: DocumentType): Promise<void> {
  const { error } = await supabaseAdmin
    .from("documents")
    .update({
      doc_type: mapClassificationToAccountingDocType(type),
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId);

  if (error) {
    console.warn("[DOC_PROCESS] documents classification更新失敗:", {
      documentId,
      error: getErrorMessage(error),
    });
  }
}

async function processDocumentEmail(
  messageId: string,
  historyId: string,
  attachment: MailboxAttachment,
) {
  let storedDocument: StoredDocumentRecord | null = null;

  try {
    console.log('[DOC_PROCESS] 開始:', {
      messageId,
      attachmentId: attachment.attachmentId,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
    });

    const watcher = createGmailWatcher();
    const driveStorage = getDriveStorageService();
    const normalizedMimeType = normalizeAttachmentMimeType(attachment.mimeType, attachment.filename);
    const supportedMime = SUPPORTED_ATTACHMENT_MIME_TYPES.has(normalizedMimeType);
    if (!supportedMime) {
      console.log("[DOC_PROCESS] 未定義MIMEをbinaryとして保存:", {
        messageId,
        attachmentId: attachment.attachmentId,
        mimeType: normalizedMimeType,
      });
    }

    // 1. 添付バイナリを取得してDriveに保存
    const attachmentBase64 = await watcher.downloadAttachment(messageId, attachment.attachmentId);
    const fileBuffer = Buffer.from(attachmentBase64, "base64");
    const contentHash = buildAttachmentHash(fileBuffer);
    const siteId: string | null = null;
    const driveFile = await driveStorage.uploadAttachmentToDrive(
      fileBuffer,
      attachment.filename,
      normalizedMimeType,
      siteId,
    );

    storedDocument = await upsertAttachmentDocument({
      messageId,
      attachment,
      mimeType: normalizedMimeType,
      fileSize: fileBuffer.length,
      hash: contentHash,
      siteId,
      driveFileId: driveFile.fileId,
      driveFileUrl: driveFile.url,
      driveFolderId: driveFile.folderId,
    });

    console.log("[DOC_PROCESS] Drive保存完了:", {
      messageId,
      attachmentId: attachment.attachmentId,
      driveFileId: driveFile.fileId,
      documentId: storedDocument.id,
      mimeType: normalizedMimeType,
    });

    if (!shouldAttemptOcr(normalizedMimeType, attachment.filename)) {
      await createManualReviewProposal(
        messageId,
        attachment.filename,
        "OCR未対応のファイル形式のため、原本のみDrive保管しました。",
        {
          attachmentId: attachment.attachmentId,
          historyId,
          stage: "stored_without_ocr",
          documentId: storedDocument.id,
          siteId: storedDocument.site_id,
          additionalPayload: {
            source_mime_type: normalizedMimeType,
            drive_file_id: storedDocument.drive_file_id,
            drive_file_url: storedDocument.drive_file_url,
            drive_folder_id: storedDocument.drive_folder_id,
          },
        },
      );
      return;
    }

    // 2. OCR実行（キャッシュ優先）
    let ocrResult = await getCachedOcrResult(contentHash);
    if (!ocrResult) {
      ocrResult = await executeLlmStepWithRetry("ocr", () => analyzeDocument(attachmentBase64, normalizedMimeType));
      await upsertOcrCache(contentHash, ocrResult, messageId, attachment.attachmentId);
    } else {
      console.log("[DOC_PROCESS] OCRキャッシュ利用:", {
        messageId,
        attachmentId: attachment.attachmentId,
        hash: contentHash,
      });
    }

    await updateDocumentOcrResult(storedDocument.id, ocrResult);

    if (!ocrResult.raw_text || ocrResult.raw_text.length < DOCUMENT_OCR_MIN_TEXT_LENGTH) {
      console.warn('[DOC_PROCESS] OCRテキストが不十分 - 手動確認へ');
      await createManualReviewProposal(messageId, attachment.filename, 'OCRテキスト抽出失敗', {
        attachmentId: attachment.attachmentId,
        historyId,
        stage: "ocr",
        documentId: storedDocument.id,
        siteId: storedDocument.site_id,
        additionalPayload: {
          source_mime_type: normalizedMimeType,
          drive_file_id: storedDocument.drive_file_id,
          drive_file_url: storedDocument.drive_file_url,
          drive_folder_id: storedDocument.drive_folder_id,
        },
      });
      return;
    }

    console.log('[DOC_PROCESS] OCR完了:', ocrResult.raw_text.length, '文字');

    // 3. 書類分類
    const classifier = getDocumentClassifier();
    const classificationResult = await executeLlmStepWithRetry("classifier", () =>
      classifier.classify(ocrResult.raw_text),
    );

    console.log('[DOC_PROCESS] 分類結果:', {
      type: classificationResult.type,
      confidence: classificationResult.confidence,
      model: classificationResult.model_used,
      reasoning: classificationResult.reasoning
    });

    storedDocument = await applyInferredSiteToDocument(
      storedDocument,
      classificationResult.extracted_data,
      driveStorage,
      {
        messageId,
        attachmentId: attachment.attachmentId,
        documentId: storedDocument.id,
        currentSiteId: storedDocument.site_id,
      },
    );

    await updateDocumentClassification(storedDocument.id, classificationResult.type);

    // 4. タイプに応じてルーティング
    await routeDocument(
      messageId,
      historyId,
      attachment,
      classificationResult,
      ocrResult.raw_text,
      contentHash,
      storedDocument,
    );

  } catch (error: unknown) {
    const message = getErrorMessage(error);
    console.error('[DOC_PROCESS] エラー:', message);
    await createManualReviewProposal(messageId, attachment.filename, message, {
      attachmentId: attachment.attachmentId,
      historyId,
      stage: "ocr_or_classification",
      documentId: storedDocument?.id,
      siteId: storedDocument?.site_id,
      additionalPayload: {
        source_mime_type: normalizeAttachmentMimeType(attachment.mimeType, attachment.filename),
        drive_file_id: storedDocument?.drive_file_id,
        drive_file_url: storedDocument?.drive_file_url,
        drive_folder_id: storedDocument?.drive_folder_id,
      },
    });
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

function parseCommunicationContact(sender: string): { displayName: string; email: string | null } {
  const normalizedSender = normalizeString(sender) || "送信者不明";
  const emailMatch = normalizedSender.match(/<([^>]+)>/);
  const email = emailMatch?.[1]?.trim() || null;
  const displayName = normalizedSender.replace(/\s*<[^>]+>\s*$/, "").trim() || email || normalizedSender;
  return { displayName, email };
}

function buildConversationNextAction(analysis: CommunicationAnalysis): string | null {
  const firstTask = analysis.tasks[0];
  if (firstTask?.title) {
    return firstTask.title;
  }
  return analysis.summary || null;
}

function normalizeConversationDueDate(value?: string): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function normalizeTimestampOrNow(value?: string | null): string {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

async function ensureCommunicationParticipant(input: {
  orgId: string;
  conversationId: string;
  participantKind: "client" | "internal" | "integration";
  displayName: string;
  email?: string | null;
  isPrimary?: boolean;
}) {
  const normalizedEmail = normalizeString(input.email);
  let query = supabaseAdmin
    .from("communication_participants")
    .select("id")
    .eq("org_id", input.orgId)
    .eq("conversation_id", input.conversationId)
    .eq("participant_kind", input.participantKind);

  if (normalizedEmail) {
    query = query.eq("email", normalizedEmail);
  } else {
    query = query.eq("display_name", input.displayName);
  }

  const { data: existing, error: existingError } = await query.maybeSingle();
  if (existingError) {
    throw existingError;
  }

  const payload = {
    org_id: input.orgId,
    conversation_id: input.conversationId,
    participant_kind: input.participantKind,
    display_name: input.displayName,
    email: normalizedEmail || null,
    is_primary: Boolean(input.isPrimary),
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await supabaseAdmin
      .from("communication_participants")
      .update(payload)
      .eq("id", existing.id);

    if (error) {
      throw error;
    }
    return;
  }

  const { error } = await supabaseAdmin
    .from("communication_participants")
    .insert({
      ...payload,
      created_at: new Date().toISOString(),
    });

  if (error) {
    throw error;
  }
}

async function ensureCommunicationConversationFromEmail(input: {
  orgId: string;
  messageId: string;
  threadId: string;
  subject: string;
  sender: string;
  receivedAt: string;
  bodyPreview: string;
  bodyFull: string;
  analysis: CommunicationAnalysis;
}): Promise<{ conversationId: string; logId: string | null }> {
  const nextAction = buildConversationNextAction(input.analysis);
  const dueDate = normalizeConversationDueDate(input.analysis.dueDate);
  const receivedAt = normalizeTimestampOrNow(input.receivedAt);
  const contact = parseCommunicationContact(input.sender);

  const { data: existingConversation, error: existingError } = await supabaseAdmin
    .from("communication_conversations")
    .select("id,status,next_action")
    .eq("org_id", input.orgId)
    .eq("source_channel", "gmail")
    .eq("external_thread_key", input.threadId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  let conversationId: string;

  if (existingConversation) {
    const { error: updateError } = await supabaseAdmin
      .from("communication_conversations")
      .update({
        title: input.subject,
        last_channel: "gmail",
        client_name_snapshot: contact.displayName,
        client_email_snapshot: contact.email,
        ai_summary: input.analysis.summary,
        ai_priority: input.analysis.priority,
        next_action: existingConversation.next_action || nextAction,
        next_action_due_date: existingConversation.next_action ? undefined : dueDate,
        last_activity_at: receivedAt,
        last_message_preview: input.bodyPreview,
        status: existingConversation.status === "resolved" ? "waiting_internal" : existingConversation.status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingConversation.id);

    if (updateError) {
      throw updateError;
    }

    conversationId = existingConversation.id as string;
  } else {
    const { data: createdConversation, error: createError } = await supabaseAdmin
      .from("communication_conversations")
      .insert({
        org_id: input.orgId,
        title: input.subject,
        status: "waiting_internal",
        source_channel: "gmail",
        last_channel: "gmail",
        external_thread_key: input.threadId,
        client_name_snapshot: contact.displayName,
        client_email_snapshot: contact.email,
        ai_summary: input.analysis.summary,
        ai_priority: input.analysis.priority,
        next_action: nextAction,
        next_action_due_date: dueDate,
        last_activity_at: receivedAt,
        last_message_preview: input.bodyPreview,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (createError) {
      throw createError;
    }

    conversationId = createdConversation.id as string;
  }

  let logId: string | null = null;
  try {
    const { data: createdLog, error: createLogError } = await supabaseAdmin
      .from("communication_logs")
      .insert({
        org_id: input.orgId,
        conversation_id: conversationId,
        channel: "gmail",
        direction: "inbound",
        log_kind: "message",
        subject: input.subject,
        body: input.bodyFull || input.bodyPreview || input.subject,
        summary: input.analysis.summary,
        occurred_at: receivedAt,
        created_by_type: "integration",
        created_by_name_snapshot: INTEGRATION_NAME,
        external_source: "gmail",
        external_id: input.messageId,
        metadata: {
          source_message_id: input.messageId,
          source_thread_id: input.threadId,
          source_message_subject: input.subject,
          source_message_from: input.sender,
          source_message_date: input.receivedAt,
          analysis_version: COMMUNICATION_ANALYSIS_VERSION,
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (createLogError) {
      throw createLogError;
    }

    logId = createdLog.id as string;
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const { data: existingLog, error: existingLogError } = await supabaseAdmin
        .from("communication_logs")
        .select("id")
        .eq("external_source", "gmail")
        .eq("external_id", input.messageId)
        .maybeSingle();

      if (existingLogError) {
        throw existingLogError;
      }

      logId = existingLog?.id || null;
    } else {
      throw error;
    }
  }

  await ensureCommunicationParticipant({
    orgId: input.orgId,
    conversationId,
    participantKind: "client",
    displayName: contact.displayName,
    email: contact.email,
    isPrimary: true,
  });

  return { conversationId, logId };
}

async function linkCommunicationProposal(input: {
  orgId: string;
  conversationId: string;
  proposalId: string;
  logId?: string | null;
}) {
  const { error } = await supabaseAdmin
    .from("communication_links")
    .upsert(
      {
        id: buildDeterministicUuid(`communication-link:${input.conversationId}:${input.proposalId}`),
        org_id: input.orgId,
        conversation_id: input.conversationId,
        link_type: "proposal",
        proposal_id: input.proposalId,
        log_id: input.logId || null,
        created_at: new Date().toISOString(),
      },
      {
        onConflict: "conversation_id,link_type,proposal_id",
      }
    );

  if (error) {
    throw error;
  }
}

async function processCommunicationEmail(messageId: string): Promise<void> {
  try {
    console.log("[COMMUNICATION] 開始:", messageId);

    const watcher = createGmailWatcher();
    const message = await watcher.getMessage(messageId);
    const threadId = normalizeString((message as { threadId?: unknown }).threadId) || messageId;
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
    const orgId = DEFAULT_ORG_ID;
    const communicationRecord = await ensureCommunicationConversationFromEmail({
      orgId,
      messageId,
      threadId,
      subject,
      sender: from,
      receivedAt: receivedAt || new Date().toISOString(),
      bodyPreview,
      bodyFull,
      analysis,
    });

    const parentPayload: Record<string, unknown> = {
      title: `メール要点確認: ${subject}`,
      category: "communication",
      conversation_id: communicationRecord.conversationId,
      source: INTEGRATION_SOURCE,
      source_message_id: messageId,
      source_thread_id: threadId,
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
    await linkCommunicationProposal({
      orgId,
      conversationId: communicationRecord.conversationId,
      proposalId: parentResult.proposalId,
      logId: communicationRecord.logId,
    });

    for (const task of analysis.tasks) {
      const taskDescription = buildCommunicationTaskDescription(task, analysis.summary);
      const taskResult = await createOrReuseIntegrationProposal({
        type: "communication.task",
        payload: {
          title: task.title,
          category: "communication",
          description: taskDescription,
          conversation_id: communicationRecord.conversationId,
          task_kind: task.kind,
          priority: task.priority,
          due_date: task.dueDate,
          suggested_reply: task.replyDraft || null,
          parent_proposal_id: parentResult.proposalId,
          source: INTEGRATION_SOURCE,
          source_message_id: messageId,
          source_thread_id: threadId,
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
      await linkCommunicationProposal({
        orgId,
        conversationId: communicationRecord.conversationId,
        proposalId: taskResult.proposalId,
        logId: communicationRecord.logId,
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
  historyId: string,
  attachment: MailboxAttachment,
  result: ClassificationResult,
  rawText: string,
  contentHash: string,
  storedDocument: StoredDocumentRecord,
) {
  const { type, confidence, reasoning, extracted_data, model_used } = result;
  const amount = extractAmountFromDocumentData(extracted_data);
  const routingDecision = buildRoutingDecision(result, amount);

  console.log(`[ROUTER] ${type} -> ${routingDecision.proposalType} (${routingDecision.mode})`);

  if (routingDecision.mode === "manual_review") {
    await createManualReviewProposal(messageId, attachment.filename, routingDecision.reason, {
      attachmentId: attachment.attachmentId,
      historyId,
      stage: "routing",
      documentId: storedDocument.id,
      siteId: storedDocument.site_id,
      additionalPayload: {
        source: INTEGRATION_SOURCE,
        source_message_id: messageId,
        source_attachment_id: attachment.attachmentId,
        source_filename: attachment.filename,
        source_mime_type: storedDocument.mime_type,
        document_id: storedDocument.id,
        drive_file_id: storedDocument.drive_file_id,
        drive_file_url: storedDocument.drive_file_url,
        drive_folder_id: storedDocument.drive_folder_id,
        document_type: type,
        pdf_hash: contentHash,
        content_hash: contentHash,
        classification: {
          confidence,
          reasoning,
          model_used,
        },
        raw_text_preview: rawText.slice(0, 500),
      },
    });
    return;
  }

  const proposalType = routingDecision.proposalType;
  const proposalTitle = generateProposalTitle(type, extracted_data);
  const proposalDescription = generateProposalDescription(type, extracted_data, reasoning);


  const payload: Record<string, unknown> = {
    title: proposalTitle,
    category: type === "order" ? "construction" : "document",
    description: proposalDescription,
    document_type: type,
    source: INTEGRATION_SOURCE,
    source_message_id: messageId,
    source_attachment_id: attachment.attachmentId,
    source_filename: attachment.filename,
    source_mime_type: storedDocument.mime_type,
    source_history_id: historyId,
    pdf_hash: contentHash,
    content_hash: contentHash,
    document_id: storedDocument.id,
    site_id: storedDocument.site_id,
    drive_file_id: storedDocument.drive_file_id,
    drive_file_url: storedDocument.drive_file_url,
    drive_folder_id: storedDocument.drive_folder_id,
    extracted_data,
    classification: {
      confidence,
      reasoning,
      model_used,
    },
    routing: {
      mode: routingDecision.mode,
      reason: routingDecision.reason,
      proposal_type: proposalType,
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
    documentId: storedDocument.id,
    siteId: storedDocument.site_id,
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

function buildRoutingDecision(result: ClassificationResult, amount: number | null): RoutingDecision {
  const proposalType = getIntegrationProposalType(result.type);

  if (result.type !== "unknown") {
    return {
      mode: "proposal",
      proposalType,
      reason: "classified_document_type",
    };
  }

  const confidenceTooLow = result.confidence < UNKNOWN_AUTO_EXPENSE_CONFIDENCE_THRESHOLD;
  const reasoning = (result.reasoning || "").toLowerCase();
  const reasoningSuggestsManual = UNKNOWN_MANUAL_REASON_HINTS.some((hint) =>
    reasoning.includes(hint.toLowerCase()),
  );
  const missingAmount = amount === null || amount <= 0;

  if (confidenceTooLow || reasoningSuggestsManual || missingAmount) {
    const reasons: string[] = [];
    if (confidenceTooLow) {
      reasons.push(`confidence=${result.confidence} below ${UNKNOWN_AUTO_EXPENSE_CONFIDENCE_THRESHOLD}`);
    }
    if (reasoningSuggestsManual) {
      reasons.push("reasoning suggests non-actionable document");
    }
    if (missingAmount) {
      reasons.push("amount not extracted");
    }

    return {
      mode: "manual_review",
      proposalType: "expense.create",
      reason: `unknown classification fallback (${reasons.join(", ")})`,
    };
  }

  return {
    mode: "proposal",
    proposalType,
    reason: "unknown_high_confidence_with_amount",
  };
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

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function normalizeHistoryId(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
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

function parseTimestampMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? null : ts;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(0, maxLength);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function isLikelyRateLimitError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return /429|quota|rate limit|too many requests|resource has been exhausted|limit exceeded/.test(message);
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function tryReserveLlmRequestSlot(requestType: LlmRequestType): boolean {
  const now = Date.now();
  while (llmRequestTimestamps.length > 0 && now - llmRequestTimestamps[0] > LLM_RATE_LIMIT_WINDOW_MS) {
    llmRequestTimestamps.shift();
  }

  if (llmRequestTimestamps.length >= LLM_RATE_LIMIT_PER_MINUTE) {
    console.warn("[WEBHOOK] LLM rate limit guard hit:", {
      requestType,
      windowUsage: llmRequestTimestamps.length,
      limitPerMinute: LLM_RATE_LIMIT_PER_MINUTE,
    });
    return false;
  }

  llmRequestTimestamps.push(now);
  return true;
}

async function executeLlmStepWithRetry<T>(requestType: LlmRequestType, operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= LLM_RETRY_MAX_ATTEMPTS; attempt += 1) {
    if (!tryReserveLlmRequestSlot(requestType)) {
      throw new Error(`LLM_RATE_LIMIT_GUARD:${requestType}`);
    }

    try {
      return await operation();
    } catch (error: unknown) {
      if (!isLikelyRateLimitError(error)) {
        throw error;
      }

      if (attempt >= LLM_RETRY_MAX_ATTEMPTS) {
        throw error;
      }

      const delayMs = LLM_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn("[WEBHOOK] LLM rate limit detected. retrying with backoff:", {
        requestType,
        attempt,
        delayMs,
      });
      await sleep(delayMs);
    }
  }

  throw new Error(`LLM_RETRY_EXHAUSTED:${requestType}`);
}

function buildAttachmentHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function toCachedOcrResult(record: OcrCacheRecord): OcrResult | null {
  const ocrPayload = record.ocr_result;
  if (ocrPayload && typeof ocrPayload === "object") {
    const candidate = ocrPayload as Partial<OcrResult>;
    if (typeof candidate.raw_text === "string" && candidate.raw_text.length > 0) {
      return {
        ocr_blocks: (Array.isArray(candidate.ocr_blocks) ? candidate.ocr_blocks : []) as OcrResult["ocr_blocks"],
        ocr_fields: (
          candidate.ocr_fields && typeof candidate.ocr_fields === "object" ? candidate.ocr_fields : {}
        ) as OcrResult["ocr_fields"],
        raw_text: candidate.raw_text,
        provider: (
          typeof candidate.provider === "string" ? candidate.provider : "gemini"
        ) as OcrResult["provider"],
      };
    }
  }

  const extractedText = normalizeString(record.extracted_text);
  if (!extractedText) {
    return null;
  }

  return {
    ocr_blocks: [],
    ocr_fields: {},
    raw_text: extractedText,
    provider: "gemini",
  };
}

async function getCachedOcrResult(hash: string): Promise<OcrResult | null> {
  const { data, error } = await supabaseAdmin
    .from(OCR_CACHE_TABLE)
    .select("hash, extracted_text, ocr_result, hit_count")
    .eq("hash", hash)
    .maybeSingle();

  if (error) {
    console.warn("[DOC_PROCESS] OCRキャッシュ参照失敗:", getErrorMessage(error));
    return null;
  }

  if (!data) {
    return null;
  }

  const record = data as OcrCacheRecord;
  const cached = toCachedOcrResult(record);
  if (!cached) {
    return null;
  }

  const previousHit = typeof record.hit_count === "number" ? record.hit_count : 1;
  const nextHit = Math.max(1, previousHit) + 1;

  const { error: touchError } = await supabaseAdmin
    .from(OCR_CACHE_TABLE)
    .update({
      hit_count: nextHit,
      last_hit_at: new Date().toISOString(),
    })
    .eq("hash", hash);

  if (touchError) {
    console.warn("[DOC_PROCESS] OCRキャッシュ更新失敗:", getErrorMessage(touchError));
  }

  return cached;
}

async function upsertOcrCache(
  hash: string,
  ocrResult: OcrResult,
  messageId: string,
  attachmentId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from(OCR_CACHE_TABLE)
    .upsert(
      {
        hash,
        extracted_text: ocrResult.raw_text,
        ocr_result: ocrResult as unknown as Record<string, unknown>,
        source_message_id: messageId,
        source_attachment_id: attachmentId,
        hit_count: 1,
        last_hit_at: now,
      },
      { onConflict: "hash" },
    );

  if (error) {
    console.warn("[DOC_PROCESS] OCRキャッシュ保存失敗:", getErrorMessage(error));
  }
}

async function acquireMessageProcessingLock(messageId: string, historyId: string): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const { error: insertError } = await supabaseAdmin
    .from(GMAIL_MESSAGE_PROCESSING_TABLE)
    .insert({
      message_id: messageId,
      history_id: historyId,
      status: "processing",
      retry_count: 0,
      last_error: null,
      processed_at: null,
      updated_at: nowIso,
    });

  if (!insertError) {
    return true;
  }

  if (!isDuplicateKeyError(insertError)) {
    throw new Error(`PROCESSING_LOCK_INSERT_FAILED:${getErrorMessage(insertError)}`);
  }

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from(GMAIL_MESSAGE_PROCESSING_TABLE)
    .select("message_id, history_id, status, retry_count, updated_at")
    .eq("message_id", messageId)
    .eq("history_id", historyId)
    .maybeSingle();

  if (fetchError || !existing) {
    throw new Error(`PROCESSING_LOCK_FETCH_FAILED:${getErrorMessage(fetchError)}`);
  }

  const record = existing as MessageProcessingRecord;
  if (record.status === "processed") {
    return false;
  }

  const updatedAtMs = parseTimestampMs(record.updated_at);
  const stale =
    record.status !== "processing" ||
    updatedAtMs === null ||
    Date.now() - updatedAtMs > PROCESSING_LOCK_TTL_MS;

  if (!stale) {
    return false;
  }

  const nextRetry = (record.retry_count ?? 0) + 1;
  const { error: updateError } = await supabaseAdmin
    .from(GMAIL_MESSAGE_PROCESSING_TABLE)
    .update({
      status: "processing",
      retry_count: nextRetry,
      last_error: null,
      updated_at: nowIso,
    })
    .eq("message_id", messageId)
    .eq("history_id", historyId);

  if (updateError) {
    throw new Error(`PROCESSING_LOCK_UPDATE_FAILED:${getErrorMessage(updateError)}`);
  }

  return true;
}

async function markMessageProcessingCompleted(messageId: string, historyId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from(GMAIL_MESSAGE_PROCESSING_TABLE)
    .update({
      status: "processed",
      last_error: null,
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("message_id", messageId)
    .eq("history_id", historyId);

  if (error) {
    console.warn("[WEBHOOK] 処理完了ステータス更新失敗:", {
      messageId,
      historyId,
      error: getErrorMessage(error),
    });
  }
}

async function markMessageProcessingError(
  messageId: string,
  historyId: string,
  error: unknown,
): Promise<void> {
  const errorMessage = truncateText(getErrorMessage(error), 2000);
  const { error: updateError } = await supabaseAdmin
    .from(GMAIL_MESSAGE_PROCESSING_TABLE)
    .update({
      status: "error",
      last_error: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq("message_id", messageId)
    .eq("history_id", historyId);

  if (updateError) {
    console.warn("[WEBHOOK] 処理失敗ステータス更新失敗:", {
      messageId,
      historyId,
      error: getErrorMessage(updateError),
    });
  }
}

function buildDeterministicUuid(seed: string): string {
  const hash = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hash[12] = "4";
  hash[16] = ((parseInt(hash[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hash.slice(0, 8).join("")}-${hash.slice(8, 12).join("")}-${hash.slice(12, 16).join("")}-${hash.slice(16, 20).join("")}-${hash.slice(20, 32).join("")}`;
}

function isDuplicateKeyError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.message.includes("duplicate key value") || err.message.includes("23505");
  }

  if (typeof err !== "object" || err === null) {
    return false;
  }

  const message = "message" in err ? String((err as { message: unknown }).message) : "";
  const code = "code" in err ? String((err as { code: unknown }).code) : "";
  return code === "23505" || message.includes("duplicate key value") || message.includes("23505");
}

async function createOrReuseIntegrationProposal(input: {
  type: ProposalType;
  payload: Record<string, unknown>;
  description: string;
  source: string;
  externalId: string;
  integrationName: string;
  orgId?: string;
  documentId?: string | null;
  siteId?: string | null;
  submit?: boolean;
}): Promise<IntegrationProposalResult> {
  const normalizedSource = normalizeString(input.source);
  const normalizedExternalId = normalizeString(input.externalId);
  const normalizedDescription = normalizeString(input.description);
  const normalizedDocumentId = normalizeString(input.documentId);
  const normalizedSiteId = normalizeString(input.siteId);

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
    document_id: normalizedDocumentId,
    site_id: normalizedSiteId,
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
  await notifyAdminsForApprovalRequired({
    proposalId,
    proposalType: "communication.review",
    title: `メール対応提案の承認が必要です（${priority}）`,
    message: `件名「${subject}」の要点確認と対応タスク提案を確認してください。`,
    data: {
      priority,
    },
  });
}

async function notifyAdmins(docType: DocumentType, proposalId: string, extractedData: any) {
  const siteName = extractedData.site_name || extractedData.vendor_name || '不明';
  await notifyAdminsForApprovalRequired({
    proposalId,
    proposalType: getIntegrationProposalType(docType),
    title: `${getDocumentTypeLabel(docType)}の承認が必要です`,
    message: `「${siteName}」の書類解析から作成された提案を確認してください。`,
    data: {
      document_type: docType,
    },
  });
}

async function notifyAdminsForApprovalRequired(input: {
  proposalId: string;
  proposalType: ProposalType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
}) {
  const { data: admins, error: adminError } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .in("role", ["admin", "manager"]);

  if (adminError) {
    console.warn(`[WEBHOOK] Failed to fetch admin recipients: ${adminError.message}`);
    return;
  }

  if (!admins || admins.length === 0) {
    return;
  }

  const notifications = admins.map((admin: { id: string }) => ({
    user_id: admin.id,
    type: APPROVAL_REQUIRED_NOTIFICATION_TYPE,
    title: input.title,
    message: input.message,
    data: {
      proposal_id: input.proposalId,
      proposal_type: input.proposalType,
      ...input.data,
    },
  }));

  const { error: insertError } = await supabaseAdmin
    .from("notifications")
    .insert(notifications);

  if (insertError) {
    console.warn(`[WEBHOOK] Failed to create approval_required notifications: ${insertError.message}`);
  }
}

interface ManualReviewOptions {
  attachmentId?: string;
  historyId?: string;
  stage?: string;
  externalIdSuffix?: string;
  documentId?: string;
  siteId?: string | null;
  additionalPayload?: Record<string, unknown>;
}

async function createManualReviewProposal(
  messageId: string,
  filename: string,
  errorReason: string,
  options?: ManualReviewOptions,
) {
  try {
    const normalizedReason = truncateText(errorReason, 1000);
    const stageLine = options?.stage ? `\n処理ステージ: ${options.stage}` : "";
    const historyLine = options?.historyId ? `\nHistory ID: ${options.historyId}` : "";
    const description = `Gmail添付ファイル「${filename}」の自動解析に失敗しました。\n\n**エラー理由**: ${normalizedReason}${stageLine}\n\n手動で確認してください。\n\nGmail Message ID: ${messageId}${historyLine}`;
    const externalId =
      options?.externalIdSuffix
        ? `${messageId}:manual-review:${options.externalIdSuffix}`
        : options?.attachmentId
          ? `${messageId}:${options.attachmentId}:manual-review`
          : `${messageId}:manual-review:${filename}`;
    const result = await createOrReuseIntegrationProposal({
      type: "expense.create",
      payload: {
        title: "書類の手動確認が必要",
        category: "document",
        description,
        parse_error: true,
        error_reason: normalizedReason,
        source_history_id: options?.historyId,
        source_attachment_id: options?.attachmentId,
        processing_stage: options?.stage,
        document_id: options?.documentId,
        site_id: options?.siteId ?? null,
        source: INTEGRATION_SOURCE,
        source_message_id: messageId,
        source_filename: filename,
        ...(options?.additionalPayload || {}),
      },
      description,
      source: INTEGRATION_SOURCE,
      externalId,
      integrationName: INTEGRATION_NAME,
      documentId: options?.documentId || null,
      siteId: options?.siteId || null,
      submit: true,
    });

    console.log("[MANUAL_REVIEW] 手動確認提案作成:", {
      proposal_id: result.proposalId,
      deduplicated: result.deduplicated,
      status: result.status,
    });

  } catch (error: unknown) {
    console.error('[MANUAL_REVIEW] エラー:', getErrorMessage(error));
  }
}

export const __webhooksTestables = {
  getIntegrationProposalType,
  buildRoutingDecision,
  normalizeSiteNameKey,
  collectSiteNameCandidates,
  selectBestSiteMatch,
  extractAmountFromDocumentData,
  extractMessageBody,
  analyzeCommunicationEmail,
  normalizeString,
  normalizeHistoryId,
  isLikelyRateLimitError,
  buildDeterministicUuid,
  isDuplicateKeyError,
  createOrReuseIntegrationProposal,
};

export default router;
