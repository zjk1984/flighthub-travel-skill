#!/usr/bin/env node
/**
 * flyai-dedup.js — 飞猪航班查询结果去重合并工具
 *
 * 用法：将多次 flyai search-flight 的 JSON 输出合并后通过 stdin 传入
 *   flyai search-flight ... 2>/dev/null > /tmp/r1.json
 *   flyai search-flight ... 2>/dev/null > /tmp/r2.json
 *   cat /tmp/r1.json /tmp/r2.json | node flyai-dedup.js
 *
 * 或直接管道：
 *   (flyai search-flight ... 2>/dev/null && flyai search-flight ... 2>/dev/null) | node flyai-dedup.js
 *
 * 输出：去重后的 JSON 数组，按出发时间排序
 */
const fs = require("fs");
const input = fs.readFileSync("/dev/stdin", "utf8").trim();

// 支持多个 JSON 对象拼接（每个查询一行 JSON）
const lines = input.split("\n").filter(Boolean);
const seen = new Map(); // key: "depDateTime|marketingTransportNo" → item
let totalCount = 0;

for (const line of lines) {
  try {
    const j = JSON.parse(line);
    const items = j.data?.itemList || [];
    totalCount += items.length;
    for (const item of items) {
      for (const journey of item.journeys) {
        // 构建航段唯一标识
        const segs = journey.segments;
        const key = segs.map(s => `${s.depDateTime}|${s.marketingTransportNo}`).join("|");
        if (!seen.has(key)) {
          seen.set(key, {
            depDateTime: segs[0].depDateTime,
            arrDateTime: segs[segs.length - 1].arrDateTime,
            depStation: segs[0].depStationShortName || segs[0].depStationName,
            arrStation: segs[segs.length - 1].arrStationShortName || segs[segs.length - 1].arrStationName,
            depStationCode: segs[0].depStationCode,
            arrStationCode: segs[segs.length - 1].arrStationCode,
            flightNo: segs.map(s => s.marketingTransportNo).join(" / "),
            airline: segs.map(s => s.marketingTransportName).join(" / "),
            journeyType: journey.journeyType,
            duration: journey.totalDuration || "",
            price: item.ticketPrice || item.adultPrice || "",
            jumpUrl: item.jumpUrl || "",
          });
        }
      }
    }
  } catch (e) {
    // 跳过解析失败的行
  }
}

const result = [...seen.values()].sort((a, b) => a.depDateTime.localeCompare(b.depDateTime));

// 输出统计信息到 stderr
process.stderr.write(`去重: ${totalCount} → ${result.length} 条\n`);

// 输出 JSON 到 stdout
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
