#!/usr/bin/env node
/**
 * Feishu (Lark) interactive card notification — adapted from daily_stock_analysis.
 * Sends markdown reports via Open API app bot or custom bot webhook (lark_md card, chunked if needed).
 *
 * Usage:
 *   FEISHU_APP_ID + FEISHU_APP_SECRET + FEISHU_CHAT_ID  (preferred)
 *   FEISHU_WEBHOOK_URL=https://...                        (legacy webhook)
 *   node feishu-notify.js --test
 *   node feishu-notify.js [--title "标题"] path/to/report.md
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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
  const args = { title: DEFAULT_TITLE, file: null, test: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--title" && argv[i + 1]) args.title = argv[++i];
    else if (a === "--max-bytes" && argv[i + 1]) args.maxBytes = parseInt(argv[++i], 10);
    else if (a === "--test") args.test = true;
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

function buildInteractiveCard(title, content) {
  return {
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
  };
}

function buildCardPayload(title, content) {
  return {
    msg_type: "interactive",
    card: buildInteractiveCard(title, content),
  };
}

function buildTextPayload(content) {
  return {
    msg_type: "text",
    content: { text: content },
  };
}

function feishuSign(secret, timestamp) {
  const stringToSign = `${timestamp}\n${secret}`;
  return crypto.createHmac("sha256", stringToSign).update("").digest("base64");
}

function withFeishuAuth(payload) {
  const secret = process.env.FEISHU_WEBHOOK_SECRET || "";
  if (!secret) return payload;
  const timestamp = String(Math.floor(Date.now() / 1000));
  return { timestamp, sign: feishuSign(secret, timestamp), ...payload };
}

function resolveFeishuTransport() {
  const appId = process.env.FEISHU_APP_ID || "";
  const appSecret = process.env.FEISHU_APP_SECRET || "";
  const chatId = process.env.FEISHU_CHAT_ID || "";
  if (appId && appSecret && chatId) {
    return { mode: "app", appId, appSecret, chatId };
  }
  const webhook = process.env.FEISHU_WEBHOOK_URL || "";
  if (webhook) return { mode: "webhook", webhook };
  return null;
}

let tenantTokenCache = { token: "", expireAt: 0 };

async function getTenantAccessToken(appId, appSecret) {
  if (tenantTokenCache.token && Date.now() < tenantTokenCache.expireAt - 60_000) {
    return tenantTokenCache.token;
  }
  const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const body = await parseFeishuResponse(res);
  tenantTokenCache = {
    token: body.tenant_access_token,
    expireAt: Date.now() + (body.expire || 7200) * 1000,
  };
  return body.tenant_access_token;
}

async function parseFeishuResponse(res) {
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
  return body;
}

async function postAppMessage(transport, msgType, payload) {
  const token = await getTenantAccessToken(transport.appId, transport.appSecret);
  const body =
    msgType === "interactive"
      ? {
          receive_id: transport.chatId,
          msg_type: "interactive",
          content: JSON.stringify(buildInteractiveCard(payload.title, payload.content)),
        }
      : {
          receive_id: transport.chatId,
          msg_type: "text",
          content: JSON.stringify({ text: payload }),
        };
  const res = await fetch(
    "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }
  );
  await parseFeishuResponse(res);
  return true;
}

async function postPayload(webhookUrl, payload) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withFeishuAuth(payload)),
  });
  await parseFeishuResponse(res);
  return true;
}

async function sendFeishuMessage(transport, title, content) {
  if (transport.mode === "app") {
    try {
      await postAppMessage(transport, "interactive", { title, content });
      return true;
    } catch (cardErr) {
      console.error(`Feishu app card failed, fallback to text: ${cardErr.message}`);
      await postAppMessage(transport, "text", content);
      return true;
    }
  }
  try {
    await postPayload(transport.webhook, buildCardPayload(title, content));
    return true;
  } catch (cardErr) {
    console.error(`Feishu card failed, fallback to text: ${cardErr.message}`);
    await postPayload(transport.webhook, buildTextPayload(content));
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

async function sendFeishuChunked(transport, title, content, maxBytes) {
  const split = splitSections(content);
  if (!split) return sendFeishuForceChunked(transport, title, content, maxBytes);

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
      await sendFeishuMessage(transport, chunkTitle, chunks[i] + marker);
      console.error(`Feishu chunk ${i + 1}/${chunks.length} sent`);
    } catch (e) {
      console.error(`Feishu chunk ${i + 1}/${chunks.length} failed: ${e.message}`);
      ok = false;
    }
    if (i < chunks.length - 1) await sleep(1000);
  }
  return ok;
}

async function sendFeishuForceChunked(transport, title, content, maxBytes) {
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
      await sendFeishuMessage(transport, chunkTitle, chunks[i] + marker);
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

async function sendFeishuReport(transport, markdown, options = {}) {
  const title = options.title || DEFAULT_TITLE;
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
  const formatted = formatFeishuMarkdown(markdown);

  if (byteLength(formatted) <= maxBytes) {
    await sendFeishuMessage(transport, title, formatted);
    return true;
  }
  console.error(`Feishu content ${byteLength(formatted)} bytes > ${maxBytes}, chunking...`);
  return sendFeishuChunked(transport, title, formatted, maxBytes);
}

async function main() {
  const args = parseArgs(process.argv);
  const transport = resolveFeishuTransport();

  if (!transport) {
    console.error(
      "Feishu not configured. Set either:\n" +
        "  FEISHU_APP_ID + FEISHU_APP_SECRET + FEISHU_CHAT_ID\n" +
        "  or FEISHU_WEBHOOK_URL\n" +
        "Run: ./scripts/setup-feishu.sh --app <app-id> <app-secret> <chat-id>"
    );
    process.exit(1);
  }

  if (transport.mode === "app") {
    console.error(`[feishu] app mode → chat_id=${transport.chatId}`);
  }

  if (args.test) {
    await sendFeishuMessage(transport, "FlightHub 飞书通知测试", "✅ 若收到此消息，配置成功。");
    const chatHint = transport.chatId ? ` (群 ${transport.chatId})` : "";
    console.error(`Feishu test sent${chatHint}`);
    return;
  }

  if (!args.file) {
    console.error("Usage: node feishu-notify.js [--test] [--title TITLE] report.md");
    process.exit(1);
  }

  const filePath = path.resolve(args.file);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const markdown = fs.readFileSync(filePath, "utf8");
  await sendFeishuReport(transport, markdown, { title: args.title, maxBytes: args.maxBytes });
  const chatHint = transport.chatId ? ` (群 ${transport.chatId})` : "";
  console.error(`Feishu notification sent${chatHint}: ${filePath}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = {
  resolveFeishuTransport,
  formatFeishuMarkdown,
  sendFeishuReport,
  sendFeishuMessage,
  buildCardPayload,
};
