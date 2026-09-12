#!/usr/bin/env node
/**
 * Push updated itinerary map summary + poster image + route video to Feishu.
 *
 * Usage:
 *   node scripts/feishu-send-map.js [--dry-run]
 *   node scripts/feishu-send-map.js --hd --poster-only   # 仅推送 4K 竖版动线图
 */
const fs = require("fs");
const path = require("path");

const { resolveFeishuTransport, sendFeishuReport, sendFeishuMessage } = require("./feishu-notify");
const { loadConfig } = require("./load-monitor-config");
const { loadTripProfile } = require("./load-trip-profile");

const ROOT = path.join(__dirname, "..");
const MAPS = path.join(ROOT, "reports/maps");
const POSTER = path.join(MAPS, "xinjiang-itinerary-9-16.png");
const POSTER_HD = path.join(MAPS, "xinjiang-itinerary-9-16-hd.png");
const VIDEO = path.join(MAPS, "xinjiang-itinerary-16-9.mp4");
const HTML = path.join(MAPS, "itinerary_map.html");

const REPO = "https://github.com/zjk1984/flighthub-travel-skill/blob/main";

function loadRouteMeta() {
  const p = path.join(ROOT, "data/route_data.json");
  if (!fs.existsSync(p)) return { totalKm: "—", dateRange: "2026.10.01–10.08" };
  const data = JSON.parse(fs.readFileSync(p, "utf8"));
  return {
    totalKm: data.total_distance_km,
    dateRange: data.date_range || "2026.10.01–10.08",
  };
}

function parseFlags(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
    hd: argv.includes("--hd"),
    posterOnly: argv.includes("--poster-only"),
  };
}

function buildMarkdown(trip, routeMeta, flags) {
  const overrides = trip.hotelOverrides || {};
  const dates = Object.keys(overrides).sort();
  const posterLabel = flags.hd ? "9:16 竖版动线海报 **4K HD**（2160×3840）" : "9:16 竖版动线海报（1080×1920）";
  const lines = [
    flags.posterOnly && flags.hd
      ? "**9:16 高清动线图（4K）** · 已定稿酒店与 D6–D8 赛湖/喀兰朵动线"
      : "**动线图与行程视频已更新**（已对齐定稿酒店与 D6–D8 赛湖/喀兰朵动线）",
    "",
    `全程自驾约 **${routeMeta.totalKm} km** · ${routeMeta.dateRange}`,
    "",
    "**已定夜宿**",
  ];

  for (const date of dates) {
    const h = overrides[date];
    const day = trip.itinerary?.days?.find((d) => d.date === date);
    const label = day?.label || date.slice(5);
    lines.push(`• **${label}** · ${h.name}${h.booked ? " ✅" : ""}`);
  }

  lines.push(
    "",
  );

  if (!flags.posterOnly) {
    lines.push(
      "",
      "**附件**",
      `• ${posterLabel}（图片消息）`,
      "• 16:9 动态路线视频 45s（视频文件）",
    );
  } else if (flags.hd) {
    lines.push("", `**附件**：${posterLabel}`);
  }

  lines.push(
    "",
    "**仓库路径**（便于下载/转发）",
    `• [交互地图 HTML](${REPO}/reports/maps/itinerary_map.html)`,
    `• [9:16 海报 4K HD](${REPO}/reports/maps/xinjiang-itinerary-9-16-hd.png)`,
    `• [9:16 海报标准](${REPO}/reports/maps/xinjiang-itinerary-9-16.png)`,
  );
  if (!flags.posterOnly) {
    lines.push(`• [16:9 视频 MP4](${REPO}/reports/maps/xinjiang-itinerary-16-9.mp4)`);
  }
  return lines.join("\n");
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
  const body = await res.json();
  if (body.code !== 0) throw new Error(`Feishu auth failed: ${body.msg}`);
  tenantTokenCache = {
    token: body.tenant_access_token,
    expireAt: Date.now() + (body.expire || 7200) * 1000,
  };
  return body.tenant_access_token;
}

async function uploadImage(token, filePath) {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("image_type", "message");
  form.append("image", new Blob([buf], { type: "image/png" }), path.basename(filePath));
  const res = await fetch("https://open.feishu.cn/open-apis/im/v1/images", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await res.json();
  if (body.code !== 0) throw new Error(`Image upload failed: ${body.msg}`);
  return body.data.image_key;
}

async function uploadFile(token, filePath) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime =
    ext === ".mp4" ? "video/mp4" : ext === ".png" ? "image/png" : "application/octet-stream";
  const form = new FormData();
  form.append("file_type", "stream");
  form.append("file_name", path.basename(filePath));
  form.append("file", new Blob([buf], { type: mime }), path.basename(filePath));
  const res = await fetch("https://open.feishu.cn/open-apis/im/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await res.json();
  if (body.code !== 0) throw new Error(`File upload failed: ${body.msg}`);
  return body.data.file_key;
}

async function sendMedia(token, chatId, msgType, content) {
  const res = await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      receive_id: chatId,
      msg_type: msgType,
      content: JSON.stringify(content),
    }),
  });
  const body = await res.json();
  if (body.code !== 0) throw new Error(`Send ${msgType} failed: ${body.msg}`);
}

async function sendPosterImage(transport, token, posterPath) {
  try {
    const imageKey = await uploadImage(token, posterPath);
    await sendMedia(token, transport.chatId, "image", { image_key: imageKey });
    console.error(`Feishu poster image sent: ${path.basename(posterPath)}`);
    return true;
  } catch (err) {
    console.error(`Image upload failed (${err.message}), trying file message...`);
    const fileKey = await uploadFile(token, posterPath);
    await sendMedia(token, transport.chatId, "file", { file_key: fileKey });
    console.error(`Feishu poster file sent: ${path.basename(posterPath)}`);
    return true;
  }
}

async function main() {
  const flags = parseFlags(process.argv);
  const transport = resolveFeishuTransport();
  if (!transport) {
    console.error("Feishu not configured");
    process.exit(1);
  }
  if (transport.mode !== "app") {
    console.error("Map assets require FEISHU_APP_ID + FEISHU_APP_SECRET + FEISHU_CHAT_ID (file upload)");
    process.exit(1);
  }

  const posterPath = flags.hd ? POSTER_HD : POSTER;
  const required = flags.posterOnly ? [posterPath, HTML] : [posterPath, VIDEO, HTML];
  for (const f of required) {
    if (!fs.existsSync(f)) {
      console.error(`Missing: ${f}`);
      process.exit(1);
    }
  }

  const cfg = loadConfig();
  const trip = loadTripProfile(cfg);
  const routeMeta = loadRouteMeta();
  const title = flags.hd && flags.posterOnly
    ? `${cfg.routeLabel || "新疆"} 9:16 高清动线图（4K · 已定稿酒店）`
    : `${cfg.routeLabel || "新疆"} 动线图与行程视频（已定稿酒店）`;
  const markdown = buildMarkdown(trip, routeMeta, flags);

  if (flags.dryRun) {
    console.log(title);
    console.log(markdown);
    console.log(`poster: ${posterPath}`);
    return;
  }

  if (flags.posterOnly) {
    await sendFeishuMessage(transport, title, markdown);
  } else {
    await sendFeishuReport(transport, markdown, { title });
  }
  console.error("Feishu summary card sent");

  const token = await getTenantAccessToken(transport.appId, transport.appSecret);
  await sendPosterImage(transport, token, posterPath);

  if (!flags.posterOnly) {
    const fileKey = await uploadFile(token, VIDEO);
    await sendMedia(token, transport.chatId, "file", { file_key: fileKey });
    console.error("Feishu route video sent");
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
