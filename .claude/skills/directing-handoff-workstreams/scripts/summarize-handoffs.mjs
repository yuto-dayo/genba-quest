#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const PLACEHOLDER_PATTERNS = [
  '次の優先タスクを記載',
  '現セッションの最優先タスクを記載',
  'Remaining を確認して次アクションを決定',
];

function usage() {
  console.log(`Usage: node summarize-handoffs.mjs [--json] [--cwd <path>]\n\nOptions:\n  --json        Output JSON\n  --cwd <path>  Workspace root (default: current directory)`);
}

function normalizePath(p) {
  return p.replace(/\\\\/g, '/');
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
  out = out.replace(/^P0:\s*/i, '');
  out = out.replace(/^P0:\s*/i, '');
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
  const meaningfulRisks = risks.filter((r) => !r.includes('docs/DESIGN_PHILOSOPHY.md'));
  if (meaningfulRisks.length === 0) return false;

  const keywords = ['block', 'blocked', 'fail', 'error', 'ENOTFOUND', '未実施', '必要', '要対応', '未デプロイ', 'リスク'];
  const merged = meaningfulRisks.join(' | ').toLowerCase();
  return keywords.some((k) => merged.includes(k.toLowerCase()));
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
    const aTime = a.lastUpdateIso || '9999-12-31T23:59:59.999Z';
    const bTime = b.lastUpdateIso || '9999-12-31T23:59:59.999Z';
    if (aTime !== bTime) return aTime.localeCompare(bTime);
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
  lines.push('| Stream | State | Last Update | P0 | NEXT_CMD | File |');
  lines.push('| ------ | ----- | ----------- | -- | -------- | ---- |');

  for (const stream of payload.streams) {
    const p0 = stream.p0 || '(none)';
    const next = stream.nextCmd || '(none)';
    const last = stream.lastUpdate || '(none)';
    lines.push(`| ${stream.domain} | ${stream.state} | ${last} | ${p0} | ${next} | ${stream.file} |`);
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
  }

  if (payload.blockedStreams.length > 0) {
    lines.push('');
    lines.push('## Blocked / Risky Streams');
    lines.push('');
    for (const blocked of payload.blockedStreams) {
      lines.push(`- ${blocked.domain}: ${blocked.risks.join(' / ')}`);
    }
  }

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
    const rawP0 = remainingItems.find((item) => item.startsWith('P0:') || item.includes('P0')) || remainingItems[0] || '';
    const p0 = normalizeP0Text(rawP0);
    const nextCmd = extractNextCmd(content);
    const risks = extractRisks(lines);
    const blocked = isBlocked(risks);
    const actionableP0 = !!p0 && !isPlaceholder(p0);
    const lastUpdate = extractLastTimestamp(content);
    const lastUpdateIso = toIsoDate(lastUpdate);

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
            ? 'actionable P0 の中で最も古く、かつブロッカー解消が必要なため'
            : 'actionable P0 の中で最も古く、未ブロックのワークストリームを優先するため')
        : 'no actionable stream',
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
