#!/usr/bin/env node
/**
 * Push updated itinerary map summary + poster image + route video to Feishu.
 *
 * Usage: node scripts/feishu-send-map.js [--dry-run]
 */
const fs = require("fs");
const path = require("path");

const { resolveFeishuTransport, sendFeishuReport } = require("./feishu-notify");
const { loadConfig } = require("./load-monitor-config");
const { loadTripProfile } = require("./load-trip-profile");

const ROOT = path.join(__dirname, "..");
const MAPS = path.join(ROOT, "reports/maps");
const POSTER = path.join(MAPS, "xinjiang-itinerary-9-16.png");
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

function buildMarkdown(trip, routeMeta) {
  const overrides = trip.hotelOverrides || {};
  const dates = Object.keys(overrides).sort();
  const lines = [
    "**动线图与行程视频已更新**（已对齐定稿酒店与 D6–D8 赛湖/喀兰朵动线）",
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
    "**附件**",
    "• 9:16 竖版动线海报（图片消息）",
    "• 16:9 动态路线视频 45s（视频文件）",
    "",
    "**仓库路径**（便于下载/转发）",
    `• [交互地图 HTML](${REPO}/reports/maps/itinerary_map.html)`,
    `• [16:9 视频 MP4](${REPO}/reports/maps/xinjiang-itinerary-16-9.mp4)`,
    `• [9:16 海报 PNG](${REPO}/reports/maps/xinjiang-itinerary-9-16.png)`,
  );
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
  const form = new FormData();
  form.append("file_type", "stream");
  form.append("file_name", path.basename(filePath));
  form.append("file", new Blob([buf], { type: "video/mp4" }), path.basename(filePath));
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

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const transport = resolveFeishuTransport();
  if (!transport) {
    console.error("Feishu not configured");
    process.exit(1);
  }
  if (transport.mode !== "app") {
    console.error("Map assets require FEISHU_APP_ID + FEISHU_APP_SECRET + FEISHU_CHAT_ID (file upload)");
    process.exit(1);
  }

  for (const f of [POSTER, VIDEO, HTML]) {
    if (!fs.existsSync(f)) {
      console.error(`Missing: ${f}`);
      process.exit(1);
    }
  }

  const cfg = loadConfig();
  const trip = loadTripProfile(cfg);
  const routeMeta = loadRouteMeta();
  const title = `${cfg.routeLabel || "新疆"} 动线图与行程视频（已定稿酒店）`;
  const markdown = buildMarkdown(trip, routeMeta);

  if (dryRun) {
    console.log(title);
    console.log(markdown);
    return;
  }

  await sendFeishuReport(transport, markdown, { title });
  console.error("Feishu summary card sent");

  const token = await getTenantAccessToken(transport.appId, transport.appSecret);
  const imageKey = await uploadImage(token, POSTER);
  await sendMedia(token, transport.chatId, "image", { image_key: imageKey });
  console.error("Feishu poster image sent");

  const fileKey = await uploadFile(token, VIDEO);
  await sendMedia(token, transport.chatId, "file", { file_key: fileKey });
  console.error("Feishu route video sent");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
