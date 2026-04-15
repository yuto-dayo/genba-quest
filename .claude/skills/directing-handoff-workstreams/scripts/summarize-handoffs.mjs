#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const PLACEHOLDER_PATTERNS = [
  '次の優先タスクを記載',
  '現セッションの最優先タスクを記載',
  'Remaining を確認して次アクションを決定',
];

const MEANINGFUL_RISK_EXCLUDE = ['docs/DESIGN_PHILOSOPHY.md'];

const BLOCK_KEYWORDS = [
  'block',
  'blocked',
  'fail',
  'error',
  'enotfound',
  '未実施',
  '必要',
  '要対応',
  '未デプロイ',
  'リスク',
];

const DESTRUCTIVE_KEYWORDS = [
  'rm ',
  'reset --hard',
  'checkout --',
  'drop table',
  'truncate',
  'delete from',
  '本番削除',
  '破壊',
  'wipe',
  'force-push',
];

const WRITE_KEYWORDS = [
  'migration',
  'deploy',
  'apply',
  'implement',
  'edit',
  'refactor',
  'update',
  'create',
  'fix',
  '追加',
  '変更',
  '修正',
  '適用',
  '実装',
  '作成',
];

const READ_ONLY_KEYWORDS = [
  'investigate',
  'inspect',
  'review',
  'audit',
  'verify',
  'validate',
  'check',
  '調査',
  '確認',
  '可視化',
  '証跡',
  '分析',
];

const SHARED_WORK_KEYWORDS = [
  'migration',
  'policy',
  'integration',
  'schema',
  'shared',
  '共通',
  '依存',
  '解除',
  'gateway',
];

const IMPACT_KEYWORDS = [
  'revenue',
  'billing',
  'ledger',
  'approval',
  'proposal',
  'webhook',
  '請求',
  '経費',
  '承認',
];

function usage() {
  console.log(`Usage: node summarize-handoffs.mjs [--json] [--cwd <path>]\n\nOptions:\n  --json        Output JSON\n  --cwd <path>  Workspace root (default: current directory)`);
}

function normalizePath(p) {
  return p.replace(/\\\\/g, '/');
}

function mergeLower(...parts) {
  return parts
    .flat()
    .filter((v) => typeof v === 'string' && v.length > 0)
    .join(' | ')
    .toLowerCase();
}

function hasAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseArgs(argv) {
  let cwd = process.cwd();
  let json = false;

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--cwd') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('--cwd requires a path');
      }
      cwd = path.resolve(next);
      i += 1;
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      usage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { cwd, json };
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walkMarkdownFiles(rootDir) {
  const results = [];

  async function walk(current) {
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return results;
}

function extractSection(lines, headerRegex) {
  const section = [];
  let inSection = false;

  for (const line of lines) {
    if (!inSection && headerRegex.test(line)) {
      inSection = true;
      continue;
    }

    if (inSection && line.startsWith('## ')) {
      break;
    }

    if (inSection) {
      section.push(line);
    }
  }

  return section;
}

function cleanInlineMarkdown(text) {
  let out = text.trim();
  out = out.replace(/`/g, '');
  out = out.replace(/\*\*/g, '');
  out = out.replace(/^\[ \]\s*/, '');
  out = out.replace(/^\[x\]\s*/, '');
  return out.trim();
}

function normalizeP0Text(text) {
  let out = text.trim();
  out = out.replace(/^(P\d:\s*)+/i, '');
  return out.trim();
}

function extractNextCmd(content) {
  const match = content.match(/^- NEXT_CMD:\s*`([^`]+)`/m);
  return match ? match[1].trim() : '';
}

function extractLastTimestamp(content) {
  const incremental = content.match(/^##\s+1[13]\.\s+Incremental Updates[\s\S]*$/m);
  if (!incremental) return '';

  const timestamps = [...incremental[0].matchAll(/^###\s+(.+)$/gm)].map((m) => m[1].trim());
  if (timestamps.length === 0) return '';
  return timestamps[timestamps.length - 1];
}

function extractRemainingItems(lines) {
  const remainingLines = extractSection(lines, /^##\s+4\.\s+Remaining/);

  return remainingLines
    .filter((line) => /^- \[ \]/.test(line))
    .map((line) => {
      const cleaned = cleanInlineMarkdown(line.replace(/^- \[ \]\s*/, ''));
      if (/^P0:/i.test(cleaned)) {
        return `P0: ${normalizeP0Text(cleaned)}`;
      }
      return cleaned;
    });
}

function extractCompletedCount(lines) {
  const completedLines = extractSection(lines, /^##\s+3\.\s+Completed/);
  return completedLines.filter((line) => /^- \[x\]/.test(line)).length;
}

function extractRisks(lines) {
  const riskLines = extractSection(lines, /^##\s+9\.\s+Risks\s*\/\s*Blockers/);
  return riskLines
    .filter((line) => /^-\s+/.test(line))
    .map((line) => line.replace(/^-\s+/, '').trim())
    .filter(Boolean);
}

function getMeaningfulRisks(risks) {
  return risks.filter((risk) => !MEANINGFUL_RISK_EXCLUDE.some((exclude) => risk.includes(exclude)));
}

function isPlaceholder(text) {
  if (!text) return true;
  return PLACEHOLDER_PATTERNS.some((pattern) => text.includes(pattern));
}

function deriveDomain(fileRelPath) {
  if (fileRelPath === 'HANDOFF.md') {
    return 'root';
  }

  const normalized = normalizePath(fileRelPath);
  const trimmed = normalized.replace(/^handoff\//, '').replace(/\.md$/, '');
  return trimmed || 'unknown';
}

function isBlocked(risks) {
  const meaningfulRisks = getMeaningfulRisks(risks);
  if (meaningfulRisks.length === 0) return false;

  const merged = meaningfulRisks.join(' | ').toLowerCase();
  return BLOCK_KEYWORDS.some((keyword) => merged.includes(keyword));
}

function classifyRiskLevel({ p0, nextCmd, risks, domain }) {
  const meaningfulRisks = getMeaningfulRisks(risks);
  const merged = mergeLower(p0, nextCmd, meaningfulRisks, domain);

  if (hasAny(merged, DESTRUCTIVE_KEYWORDS)) {
    return 'destructive';
  }

  if (hasAny(merged, WRITE_KEYWORDS)) {
    return 'bounded-write';
  }

  if (hasAny(merged, READ_ONLY_KEYWORDS)) {
    return 'safe-read';
  }

  if (meaningfulRisks.length > 0) {
    return 'bounded-write';
  }

  return nextCmd || p0 ? 'bounded-write' : 'safe-read';
}

function buildApprovalGate(riskLevel) {
  return riskLevel === 'destructive' ? 'required' : 'not_required';
}

function buildRetryPolicy(riskLevel) {
  const maxRetries = riskLevel === 'destructive' ? 1 : 2;
  return {
    maxRetries,
    failFastOn: ['policy_conflict', 'permission_denied', 'approval_required'],
  };
}

function daysSince(isoDate) {
  if (!isoDate) return null;
  const timestamp = Date.parse(isoDate);
  if (Number.isNaN(timestamp)) return null;

  const diffMs = Date.now() - timestamp;
  return Math.max(0, diffMs / (1000 * 60 * 60 * 24));
}

function getSpecificityScore(text) {
  if (!text || isPlaceholder(text)) return 0;
  const normalized = text.trim();
  const tokens = normalized.split(/\s+/).filter(Boolean).length;
  const punctuationBonus = /[()\-:]/.test(normalized) ? 1 : 0;
  return clamp(tokens + punctuationBonus, 0, 20);
}

function computeDirectorScore({
  domain,
  p0,
  nextCmd,
  risks,
  blocked,
  actionableP0,
  lastUpdateIso,
  riskLevel,
}) {
  const merged = mergeLower(domain, p0, nextCmd, risks);

  let impact = 1;
  if (domain === 'root') {
    impact = 3;
  } else if (domain.startsWith('server') || domain.startsWith('integration')) {
    impact = 2;
  }
  if (hasAny(merged, IMPACT_KEYWORDS)) {
    impact = clamp(impact + 1, 1, 3);
  }

  const ageDays = daysSince(lastUpdateIso);
  let urgency = 1;
  if (ageDays !== null) {
    if (ageDays >= 7) urgency = 3;
    else if (ageDays >= 2) urgency = 2;
  }

  let unblockLeverage = blocked ? 2 : 1;
  if (hasAny(merged, SHARED_WORK_KEYWORDS)) {
    unblockLeverage = clamp(unblockLeverage + 1, 1, 3);
  }

  let readiness = 0;
  if (actionableP0) {
    readiness = blocked ? 1 : 2;
    if (nextCmd && !isPlaceholder(nextCmd)) {
      readiness = clamp(readiness + 1, 0, 3);
    }
  }

  let riskPenalty = 0;
  if (riskLevel === 'bounded-write') riskPenalty = 1;
  if (riskLevel === 'destructive') riskPenalty = 2;
  if (blocked) riskPenalty = clamp(riskPenalty + 1, 0, 3);

  const total = (3 * impact) + (2 * urgency) + (2 * unblockLeverage) + readiness - (2 * riskPenalty);

  return {
    total,
    impact,
    urgency,
    unblockLeverage,
    readiness,
    riskPenalty,
    specificity: getSpecificityScore(p0),
  };
}

function toIsoDate(dateText) {
  if (!dateText) return '';

  const normalized = dateText
    .replace(/\s\+\d{4}$/, '')
    .replace(/\//g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString();
}

function computeState({ actionableP0, blocked, nextCmd }) {
  if (!actionableP0 && !nextCmd) return 'needs-next-step';
  if (blocked) return 'blocked';
  if (!actionableP0) return 'needs-detail';
  return 'active';
}

function choosePrimaryRecommendation(streams) {
  const actionable = streams.filter((s) => s.actionableP0);
  if (actionable.length === 0) return null;

  const unblocked = actionable.filter((s) => !s.blocked);
  const pool = unblocked.length > 0 ? unblocked : actionable;

  const sorted = [...pool].sort((a, b) => {
    const scoreDiff = b.directorScore.total - a.directorScore.total;
    if (scoreDiff !== 0) return scoreDiff;

    const leverageDiff = b.directorScore.unblockLeverage - a.directorScore.unblockLeverage;
    if (leverageDiff !== 0) return leverageDiff;

    const aTime = a.lastUpdateIso || '9999-12-31T23:59:59.999Z';
    const bTime = b.lastUpdateIso || '9999-12-31T23:59:59.999Z';
    if (aTime !== bTime) return aTime.localeCompare(bTime);

    const specificityDiff = b.directorScore.specificity - a.directorScore.specificity;
    if (specificityDiff !== 0) return specificityDiff;

    return a.domain.localeCompare(b.domain);
  });

  return sorted[0] || null;
}

function buildSessionStartCommand(domain) {
  if (!domain || domain === 'root') {
    return 'scripts/session/session-start.sh --agent codex';
  }
  return `scripts/session/session-start.sh --agent codex --domain ${domain}`;
}

function formatMarkdownReport(payload) {
  const lines = [];
  lines.push('# Handoff Director Snapshot');
  lines.push('');
  lines.push(`- Generated: ${payload.generatedAt}`);
  lines.push(`- Workspace: ${payload.workspace}`);
  lines.push(`- Streams: ${payload.streams.length}`);
  lines.push('');

  if (payload.streams.length === 0) {
    lines.push('No handoff files found.');
    return lines.join('\n');
  }

  lines.push('## Workstream Status');
  lines.push('');
  lines.push('| Stream | State | Score | Risk | Approval | Last Update | P0 | NEXT_CMD | File |');
  lines.push('| ------ | ----- | ----- | ---- | -------- | ----------- | -- | -------- | ---- |');

  for (const stream of payload.streams) {
    const p0 = stream.p0 || '(none)';
    const next = stream.nextCmd || '(none)';
    const last = stream.lastUpdate || '(none)';
    lines.push(
      `| ${stream.domain} | ${stream.state} | ${stream.directorScore.total} | ${stream.riskLevel} | ${stream.approvalRequired} | ${last} | ${p0} | ${next} | ${stream.file} |`,
    );
  }

  lines.push('');
  lines.push('## Director Recommendation');
  lines.push('');

  if (!payload.primaryRecommendation) {
    lines.push('- Primary: actionable P0 が見つからないため、各 handoff の P0 を具体化してください。');
  } else {
    lines.push(`- Primary: \`${payload.primaryRecommendation.domain}\` を進める（${payload.primaryRecommendation.file}）`);
    lines.push(`- Next Task: ${payload.primaryRecommendation.p0}`);
    lines.push(`- Suggested Command: \`${payload.primaryRecommendation.sessionStartCommand}\``);
    lines.push(`- Reason: ${payload.primaryReason}`);
    lines.push(`- Director Score: ${payload.primaryRecommendation.directorScore.total}`);
    lines.push(`- Directive Contract: risk_tier=\`${payload.primaryRecommendation.riskLevel}\`, approval_gate=\`${payload.primaryRecommendation.approvalRequired}\`, retry_budget=${payload.primaryRecommendation.retryPolicy.maxRetries}`);
  }

  if (payload.blockedStreams.length > 0) {
    lines.push('');
    lines.push('## Blocked / Risky Streams');
    lines.push('');
    for (const blocked of payload.blockedStreams) {
      lines.push(`- ${blocked.domain} (${blocked.riskLevel}, approval=${blocked.approvalRequired}): ${blocked.risks.join(' / ')}`);
    }
  }

  lines.push('');
  lines.push('## Evaluation Targets');
  lines.push('');
  lines.push(`- Command Executable Rate: ${payload.evaluationContract.commandExecutableRateTarget}`);
  lines.push(`- First-Pass Acceptance: ${payload.evaluationContract.firstPassAcceptanceTarget}`);
  lines.push(`- Handoff Accuracy: ${payload.evaluationContract.handoffAccuracyTarget}`);

  return lines.join('\n');
}

async function loadHandoffStreams(workspaceRoot) {
  const files = new Set();
  const rootHandoff = path.join(workspaceRoot, 'HANDOFF.md');
  const handoffDir = path.join(workspaceRoot, 'handoff');

  if (await fileExists(rootHandoff)) {
    files.add(rootHandoff);
  }

  if (await fileExists(handoffDir)) {
    const handoffFiles = await walkMarkdownFiles(handoffDir);
    for (const file of handoffFiles) {
      files.add(file);
    }
  }

  const streams = [];

  for (const filePath of files) {
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    if (content.includes('## Active Domains') && !content.includes('## 3. Completed')) {
      continue;
    }

    const relPath = normalizePath(path.relative(workspaceRoot, filePath));
    const domain = deriveDomain(relPath);
    const remainingItems = extractRemainingItems(lines);
    const rawP0 = remainingItems.find((item) => item.startsWith('P0:')) || remainingItems[0] || '';
    const p0 = normalizeP0Text(rawP0);
    const nextCmd = extractNextCmd(content);
    const risks = extractRisks(lines);
    const blocked = isBlocked(risks);
    const actionableP0 = !!p0 && !isPlaceholder(p0);
    const lastUpdate = extractLastTimestamp(content);
    const lastUpdateIso = toIsoDate(lastUpdate);
    const riskLevel = classifyRiskLevel({ p0, nextCmd, risks, domain });
    const approvalRequired = buildApprovalGate(riskLevel);
    const retryPolicy = buildRetryPolicy(riskLevel);
    const directorScore = computeDirectorScore({
      domain,
      p0,
      nextCmd,
      risks,
      blocked,
      actionableP0,
      lastUpdateIso,
      riskLevel,
    });

    streams.push({
      domain,
      file: relPath,
      nextCmd,
      p0,
      sessionStartCommand: buildSessionStartCommand(domain),
      remainingItems,
      completedCount: extractCompletedCount(lines),
      lastUpdate,
      lastUpdateIso,
      risks,
      blocked,
      actionableP0,
      riskLevel,
      approvalRequired,
      retryPolicy,
      directorScore,
      state: computeState({ actionableP0, blocked, nextCmd }),
    });
  }

  streams.sort((a, b) => a.domain.localeCompare(b.domain));
  return streams;
}

async function main() {
  try {
    const { cwd, json } = parseArgs(process.argv);
    const streams = await loadHandoffStreams(cwd);
    const primaryRecommendation = choosePrimaryRecommendation(streams);
    const blockedStreams = streams.filter((s) => s.blocked);

    const payload = {
      generatedAt: new Date().toISOString(),
      workspace: cwd,
      streams,
      blockedStreams,
      primaryRecommendation,
      primaryReason: primaryRecommendation
        ? (primaryRecommendation.blocked
            ? '高スコアかつ解除レバレッジが高く、ブロッカー解消を先に進めるべきため'
            : '高スコアかつ未ブロックで、最短で成果に繋がるワークストリームのため')
        : 'no actionable stream',
      evaluationContract: {
        commandExecutableRateTarget: '>=0.95',
        firstPassAcceptanceTarget: '>=0.70',
        handoffAccuracyTarget: '>=0.90',
      },
    };

    if (json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(formatMarkdownReport(payload));
  } catch (error) {
    console.error(`summarize-handoffs: ${error.message}`);
    process.exit(1);
  }
}

main();
