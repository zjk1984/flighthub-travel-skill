#!/usr/bin/env node
/**
 * Feishu (Lark) interactive card notification — adapted from daily_stock_analysis.
 * Sends markdown reports via custom bot webhook (lark_md card, chunked if needed).
 *
 * Usage:
 *   FEISHU_WEBHOOK_URL=https://... node feishu-notify.js reports/xinjiang-flights-ranked.md
 *   node feishu-notify.js --title "标题" path/to/report.md
 */
const fs = require("fs");
const path = require("path");

function loadEnvFile() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile();

const DEFAULT_MAX_BYTES = parseInt(process.env.FEISHU_MAX_BYTES || "20000", 10);
let DEFAULT_TITLE = "广东 ↔ 新疆 每日 TOP3 航班推荐";
try {
  const { loadConfig } = require("./load-monitor-config");
  DEFAULT_TITLE = `${loadConfig().routeLabel} 每日 TOP3 航班推荐`;
} catch {
  /* optional */
}

function parseArgs(argv) {
  const args = { title: DEFAULT_TITLE, file: null, webhook: process.env.FEISHU_WEBHOOK_URL || "" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--title" && argv[i + 1]) args.title = argv[++i];
    else if (a === "--webhook" && argv[i + 1]) args.webhook = argv[++i];
    else if (a === "--max-bytes" && argv[i + 1]) args.maxBytes = parseInt(argv[++i], 10);
    else if (!a.startsWith("-")) args.file = a;
  }
  args.maxBytes = args.maxBytes || DEFAULT_MAX_BYTES;
  return args;
}

function byteLength(str) {
  return Buffer.byteLength(str, "utf8");
}

function truncateToBytes(str, maxBytes) {
  if (byteLength(str) <= maxBytes) return str;
  let lo = 0;
  let hi = str.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (byteLength(str.slice(0, mid)) <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return str.slice(0, lo);
}

function flushTableRows(buffer, output) {
  if (!buffer.length) return;
  const rows = [];
  for (const raw of buffer) {
    if (/^\s*\|?\s*[:-]+\s*(\|\s*[:-]+\s*)+\|?\s*$/.test(raw)) continue;
    const cells = raw.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim()).filter(Boolean);
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return;
  const header = rows[0];
  const dataRows = rows.length > 1 ? rows.slice(1) : [];
  for (const row of dataRows) {
    const pairs = row.map((cell, idx) => {
      const key = header[idx] || `列${idx + 1}`;
      return `${key}：${cell}`;
    });
    output.push(`• ${pairs.join(" | ")}`);
  }
}

/** Convert generic markdown to Feishu lark_md friendly text. */
function formatFeishuMarkdown(content) {
  const lines = [];
  let tableBuffer = [];

  for (const rawLine of content.split("\n")) {
    let line = rawLine.replace(/\s+$/, "");

    if (line.trim().startsWith("|")) {
      tableBuffer.push(line);
      continue;
    }

    if (tableBuffer.length) {
      flushTableRows(tableBuffer, lines);
      tableBuffer = [];
    }

    if (/^#{1,6}\s+/.test(line)) {
      const title = line.replace(/^#{1,6}\s+/, "").trim();
      line = title ? `**${title}**` : "";
    } else if (line.startsWith("> ")) {
      const quote = line.slice(2).trim();
      line = quote ? `💬 ${quote}` : "";
    } else if (line.trim() === "---") {
      line = "────────";
    } else if (line.startsWith("- ")) {
      line = `• ${line.slice(2).trim()}`;
    }

    lines.push(line);
  }

  if (tableBuffer.length) flushTableRows(tableBuffer, lines);
  return lines.join("\n").trim();
}

function buildCardPayload(title, content) {
  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: "plain_text", content: title },
      },
      elements: [
        {
          tag: "div",
          text: { tag: "lark_md", content },
        },
      ],
    },
  };
}

function buildTextPayload(content) {
  return {
    msg_type: "text",
    content: { text: content },
  };
}

async function postPayload(webhookUrl, payload) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  if (res.status !== 200) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const code = body.code ?? body.StatusCode;
  if (code !== 0 && code !== undefined) {
    const msg = body.msg || body.StatusMessage || "unknown error";
    throw new Error(`Feishu error [code=${code}]: ${msg}`);
  }
  return true;
}

async function sendFeishuMessage(webhookUrl, title, content) {
  try {
    await postPayload(webhookUrl, buildCardPayload(title, content));
    return true;
  } catch (cardErr) {
    console.error(`Feishu card failed, fallback to text: ${cardErr.message}`);
    await postPayload(webhookUrl, buildTextPayload(content));
    return true;
  }
}

function splitSections(content) {
  if (content.includes("\n---\n")) {
    return { sections: content.split("\n---\n"), separator: "\n---\n" };
  }
  if (content.includes("\n### ")) {
    const parts = content.split("\n### ");
    return {
      sections: [parts[0], ...parts.slice(1).map(p => `### ${p}`)],
      separator: "\n",
    };
  }
  return null;
}

async function sendFeishuChunked(webhookUrl, title, content, maxBytes) {
  const split = splitSections(content);
  if (!split) return sendFeishuForceChunked(webhookUrl, title, content, maxBytes);

  const { sections, separator } = split;
  const sepBytes = byteLength(separator);
  const chunks = [];
  let current = [];
  let currentBytes = 0;

  for (const section of sections) {
    const sectionBytes = byteLength(section) + sepBytes;
    if (sectionBytes > maxBytes) {
      if (current.length) {
        chunks.push(current.join(separator));
        current = [];
        currentBytes = 0;
      }
      chunks.push(truncateToBytes(section, maxBytes - 200) + "\n\n...(本段内容过长已截断)");
      continue;
    }
    if (currentBytes + sectionBytes > maxBytes && current.length) {
      chunks.push(current.join(separator));
      current = [section];
      currentBytes = sectionBytes;
    } else {
      current.push(section);
      currentBytes += sectionBytes;
    }
  }
  if (current.length) chunks.push(current.join(separator));

  let ok = true;
  for (let i = 0; i < chunks.length; i++) {
    const marker = chunks.length > 1 ? `\n\n📄 (${i + 1}/${chunks.length})` : "";
    const chunkTitle = chunks.length > 1 ? `${title} (${i + 1}/${chunks.length})` : title;
    try {
      await sendFeishuMessage(webhookUrl, chunkTitle, chunks[i] + marker);
      console.error(`Feishu chunk ${i + 1}/${chunks.length} sent`);
    } catch (e) {
      console.error(`Feishu chunk ${i + 1}/${chunks.length} failed: ${e.message}`);
      ok = false;
    }
    if (i < chunks.length - 1) await sleep(1000);
  }
  return ok;
}

async function sendFeishuForceChunked(webhookUrl, title, content, maxBytes) {
  const lines = content.split("\n");
  const chunks = [];
  let current = "";

  for (const line of lines) {
    const test = current ? `${current}\n${line}` : line;
    if (byteLength(test) > maxBytes - 100) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = test;
    }
  }
  if (current) chunks.push(current);

  let ok = true;
  for (let i = 0; i < chunks.length; i++) {
    const marker = chunks.length > 1 ? `\n\n📄 (${i + 1}/${chunks.length})` : "";
    const chunkTitle = chunks.length > 1 ? `${title} (${i + 1}/${chunks.length})` : title;
    try {
      await sendFeishuMessage(webhookUrl, chunkTitle, chunks[i] + marker);
    } catch (e) {
      console.error(`Feishu force chunk ${i + 1} failed: ${e.message}`);
      ok = false;
    }
    if (i < chunks.length - 1) await sleep(1000);
  }
  return ok;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendFeishuReport(webhookUrl, markdown, options = {}) {
  const title = options.title || DEFAULT_TITLE;
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
  const formatted = formatFeishuMarkdown(markdown);

  if (byteLength(formatted) <= maxBytes) {
    await sendFeishuMessage(webhookUrl, title, formatted);
    return true;
  }
  console.error(`Feishu content ${byteLength(formatted)} bytes > ${maxBytes}, chunking...`);
  return sendFeishuChunked(webhookUrl, title, formatted, maxBytes);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.webhook) {
    console.error("FEISHU_WEBHOOK_URL not set. Configure custom bot webhook in Feishu group.");
    process.exit(1);
  }
  if (!args.file) {
    console.error("Usage: node feishu-notify.js [--title TITLE] [--webhook URL] report.md");
    process.exit(1);
  }

  const filePath = path.resolve(args.file);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const markdown = fs.readFileSync(filePath, "utf8");
  await sendFeishuReport(args.webhook, markdown, { title: args.title, maxBytes: args.maxBytes });
  console.error(`Feishu notification sent: ${filePath}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = {
  formatFeishuMarkdown,
  sendFeishuReport,
  buildCardPayload,
};
