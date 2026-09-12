---
name: xinjiang-trip-workflow
display_name: "伊犁行程决策工作流（机酒→待办）"
description: 按严格优先级执行旅行 Skill：1 去程 2 返程 3 Plan A/B 4 酒店 5 门票/预约/路况待办。机酒全部确认后自动进入「仅待办」模式，FlyAI 不再查机酒比价，飞书只推 booking-schedule 未完成项。Agent 不得跳步。
homepage: https://github.com/zjk1984/flighthub-travel-skill
metadata:
  version: 1.2.0
  agent:
    type: tool
    runtime: node
  openclaw:
    emoji: "📋"
    priority: 92
---

# 伊犁行程决策工作流

> **通用框架**：可复用于其他目的地的五阶段工作流见 [`skills/travel-trip-workflow/SKILL.md`](skills/travel-trip-workflow/SKILL.md)；配置模板见 [`config/trip-profile.template.json`](config/trip-profile.template.json)。本文档为**伊犁 Plan B 参考实现**。

## 五阶段优先级（铁律）

| 阶段 | 目标 | FlyAI 能力 | 确认标志 | 命令 |
|------|------|------------|----------|------|
| **1 去程** | 选定出发航班 | `search-flight` | `bookedOutbound` | `npm run skill:outbound` |
| **2 返程** | 选定返程（多机场/多日期） | `search-flight` | `bookedReturn` | `npm run skill:return:flights` |
| **3 计划** | Plan A（独库）/ Plan B | — | `workflow.confirmed.plan: "planb"` | `npm run skill:plan` |
| **4 酒店** | 分段住宿（7 晚 5 段） | `search-hotel` | `hotelOverrides.*.booked` + `workflow.confirmed.hotels: true` | `npm run skill:hotels` |
| **5 待办** | 门票/预约/路况/活动 | **不查 fly.ai** | `booking-schedule.json` 中 `booked: false` | `npm run remind:bookings` |

```bash
npm run skill:workflow:status    # 查看阶段 1–4 进度（全完成后为 done）
npm run skill:workflow           # 从当前阶段顺序执行到酒店
npm run remind:bookings:dry      # 预览阶段 5 每日 digest
npm run remind:bookings          # 推送阶段 5 飞书提醒
```

状态字段：

- 阶段 1–4：`config/trip-profile.json` → `workflow.confirmed`
- 阶段 5：`config/booking-schedule.json` → 每项 `booked: true/false`

**禁止跳步**：去程/返程/计划未确认时，不要跑全量酒店查询或推送机酒 TOP3 飞书。

---

## 阶段 5：门票 · 预约 · 路况（机酒已订后）

当 **去程 + 返程 + 全部酒店段已订** 时，脚本自动进入 `feishuTodosOnly` 模式（`scripts/load-trip-profile.js`）：

| 行为 | 机酒决策期 | 机酒已订（当前） |
|------|------------|------------------|
| fly.ai 查机票 | ✅ 阶段 1–2 | ❌ `buildReturnTasks()` 返回空 |
| fly.ai 查酒店 | ✅ 阶段 4 | ❌ 各段 `skipMonitor: true`，只写 override |
| 飞书推送 | TOP3 / 比价简报 | **仅** `booking-reminders` digest |
| 行程简报 | 含评分明细 | 无 TOP3；待办来自 schedule |

### `config/booking-schedule.json`

Plan B 全部预订项（机酒 + 门票 + 预约 + 路况）统一维护在此文件：

| 字段 | 说明 |
|------|------|
| `id` | 唯一标识，如 `d7-sayram-ticket` |
| `category` | `flight` / `hotel` / `ticket` / `reservation` / `road` / `car` / `activity` |
| `eventDate` | 行程日 |
| `bookFromDate` | 开放预约日（可选） |
| `bookByDate` | 截止预订日（可选） |
| `bookTime` | 放票/截止时刻，如 `10:00` |
| `appointmentTime` / `appointmentEnd` | 分时入园/通行时段 |
| `booked` | `true` = 已订，digest **不展示** |
| `profileCheckIn` | 与 `hotelOverrides` 日期对齐，自动同步酒店名 |

**当前待办（9 项，`booked: false`）** — 2026-09-12 快照：

1. D2 玉湖门票+自驾票（`bookByDate` 10/1）
2. D2 伊昭公路路况（出发前查）
3. D3 喀拉峻门票 14:30 分时（提前 7 天可约）
4. D4 东喀拉峻全天
5. D5 晚查独库北段路况
6. D6 独库乔尔玛 14:00–16:00 通行预约
7. D6 早查独库路况
8. D7 赛里木湖自驾套票（每日 10:00 放票）
9. D7 东门进→逆时针→南门出→果子沟日落（活动提醒）

**已订（digest 过滤）**：D1/D8 航班、D1–D7 全部酒店、D2 租车、D8 还车。

### 每日 7:00 飞书 digest

```bash
npm run remind:bookings:dry                    # 预览
npm run remind:bookings:dry -- --date 2026-10-05
npm run remind:bookings                        # 发送（同日重复需 --force）
npm run remind:bookings:eve                      # 旧版：仅行程日前一天
```

Digest 分区（**只含 `booked: false`**）：

- 🔴 已逾期
- ⚡ 今日必办 / 明日行程准备
- 📅 预订窗口内（按剩余时间 ↑）
- 📋 全部待办
- 🌅 明日行程一览（仅未订项）

排序：`remainingDays()` — 未到开放日 → 距 `bookFromDate`；已开放 → 距 `bookByDate`；否则距 `eventDate`。

Cron / GitHub Actions：`0 7 * * * TZ=Asia/Shanghai npm run remind:bookings`（见 `.github/workflows/booking-reminders.yml`）。

### 标记已订

用户确认某待办完成后，改 schedule 对应项：

```json
{ "id": "d2-yuhu-ticket", "booked": true }
```

酒店已订同步：`trip-profile.json` → `hotelOverrides[checkIn].booked: true` + 对应 schedule 项 `booked: true`。

---

## 当前已确认 Plan B 快照（2026-09 执行经验）

| 日 | 日期 | 路线 | 出发 | 住宿 |
|----|------|------|------|------|
| D1 | 10/1 | 伊宁落地 23:10 | — | 全季机场 ✅ |
| D2 | 10/2 | 伊宁→玉湖 | **10:00 后** | 望湖庄园 ✅ |
| D3 | 10/3 | 玉湖→喀拉峻 | **10:00 后** | 山涧云海 ✅ |
| D4 | 10/4 | 喀拉峻慢玩 | **10:00 后** | 山涧云海（连住）✅ |
| D5 | 10/5 | 喀拉峻→唐布拉 | **10:00 后** | 小满民宿 ✅ |
| D6 | 10/6 | 独库→晚抵喀兰朵（**不入园**） | **10:00 后** | 喀兰朵 ✅ |
| D7 | 10/7 | 东门进→逆时针→南门出→果子沟日落 | **10:00 后** | 喀兰朵（连住）✅ |
| D8 | 10/8 | 喀兰朵→还车→MU6170 13:30 | **09:30 出发** | — |

**行程原则（`itineraryVariants.planb`）：**

- **全程尽量 10:00 后上路**；D8 还车例外（09:30 出发）
- **D2 无需取车**：车辆已提前备好
- **D3 直赴喀拉峻**；**喀拉峻连住 2 晚**
- **D6 不入园不购票**；**D7 东门进→逆时针→南门出→果子沟日落**
- **D6-D7 喀兰朵连住**；独库 D5 晚 + D6 早查路况

**已订航班（勿重复查 fly.ai）：**

- 去程：`bookedOutbound` CZ6888/CZ6827 10/1 广州→伊宁 23:10
- 返程：`bookedReturn` MU6170/MU2311 10/8 博乐 13:30→广州

**已订酒店（7 晚 · 5 段 · 各段 `skipMonitor: true`）：**

全季机场 · 望湖庄园 · 山涧云海×2 · 小满 · 喀兰朵×2

---

## 全流程执行图

```text
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ 1 去程机票   │ ──► │ 2 返程机票   │ ──► │ 3 Plan A/B  │ ──► │ 4 分段酒店   │
│ search-flight│     │ search-flight│     │ 卡片/指南    │     │ search-hotel │
│ bookedOutbound│    │ bookedReturn │     │ activeVariant│     │ hotelOverrides│
└─────────────┘     └─────────────┘     └─────────────┘     └──────┬──────┘
                                                                    │
                    feishuTodosOnly = 去程+返程+全部酒店已订          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 5 待办运维（门票/预约/路况）                                              │
│ · config/booking-schedule.json 维护 booked 状态                          │
│ · npm run remind:bookings 每日 7:00 飞书 digest                          │
│ · 不再 fly.ai 查机酒；monitor 脚本自动改推待办 digest                      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 修改行程后的报告再生链

编辑 `config/trip-profile.json` 或 `booking-schedule.json` 后：

### 机酒仍待决策时

```bash
source scripts/load-env.sh
node scripts/monitor-hotels.js
node scripts/format-hotels-ranked.js reports/xinjiang-hotels-latest.json
node scripts/format-travel-cards.js --variant planb --out reports/xinjiang-travel-cards-planb.md
node scripts/format-travel-brief.js reports/xinjiang-results.jsonl > reports/xinjiang-travel-brief.md
```

### 机酒已全部确认时（当前）

```bash
# 仅刷新简报 + 待办（不跑 fly.ai 全量酒店）
node scripts/monitor-hotels.js          # 只写 skipMonitor 段的 override
node scripts/format-travel-brief.js reports/xinjiang-results.jsonl > reports/xinjiang-travel-brief.md
npm run remind:bookings:dry             # 验证 digest
```

手维文档（无自动生成器，Agent 按 profile 同步）：

- `reports/planb-complete-guide.md`
- `reports/planb-daily-guide.md`
- `reports/planb-complete-with-hotels.md`

**PR 合并冲突**：保留 profile/schedule 逻辑 → 重跑再生链，勿手工拼 reports。

---

## 阶段 4：酒店查询（决策期）

机酒未全订时使用；当前各段已 `skipMonitor: true`，仅刷新 override JSON。

```bash
npm run monitor:hotels              # → reports/xinjiang-hotels-latest.json
npm run monitor:hotels:ranked       # → TOP3 评分 MD（决策期）
npm run monitor:hotels:scenic       # 仅 scenic 段（省 API）
npm run skill:hotels                # 门禁 + 酒店 + 简报 + 飞书
```

Plan B 景区段：**D2 玉湖**、**D3–D4 喀拉峻**、**D6-D7 赛湖东门**（`scenicHomestay: true`）。

`hotelOverrides` 按 **checkIn 日期** 写入已订名/价/链接；`booked: true` 后不再 fly.ai 补搜。

### 酒店 API 风控

- 段间 sleep 2.5–3s；451 → 等 45s 重试
- 连续 451：等 30–60min 或 `monitor:hotels:scenic` 单段重试
- 机票 451：`npm run monitor:resume`

---

## 飞书推送策略

| 场景 | 推送内容 | 命令 |
|------|----------|------|
| 阶段 1–2 决策 | 机票 TOP3 / 返程简报 | `skill:outbound` / `skill:return:flights` |
| 阶段 4 决策 | 酒店 TOP3 + 行程简报 | `skill:hotels` |
| **阶段 5 运维（当前）** | **仅待办 digest** | `remind:bookings` |
| 手动预览简报 | 无 TOP3 的行程+待办 | `monitor:brief` → `notify:feishu` |

```bash
npm run setup:feishu
FEISHU_SKIP=1 npm run skill:hotels     # 跳过推送
npm run remind:bookings -- --force     # 强制重发当日 digest
```

`feishu_todos_only()`（`scripts/feishu-env.sh`）：monitor 脚本检测后自动改推 `booking-reminders.js`，不再推 TOP3。

---

## 输出文件地图

| 文件 | 生成方式 | 阶段 |
|------|----------|------|
| `config/booking-schedule.json` | 手维 + Agent 同步 | 5 待办 |
| `reports/.booking-reminders-state.json` | 发送记录（防重复） | 5 |
| `reports/xinjiang-travel-brief.md` | `format-travel-brief.js` | 4/5 |
| `reports/xinjiang-travel-cards-planb.md` | `format-travel-cards.js --variant planb` | 3 |
| `reports/xinjiang-hotels-latest.json` | `monitor-hotels.js` | 4 |
| `reports/xinjiang-hotels-latest-ranked.md` | `format-hotels-ranked.js` | 4（决策期） |
| `reports/xinjiang-flights-ranked.md` | `monitor-run.js` | 1–2（决策期） |

---

## Agent 检查清单

### 阶段 1–4（机酒决策）

- [ ] `activeVariant` 与 `workflow.confirmed.plan` 一致
- [ ] Plan B `days` / `hotels` / `hotelOverrides` 日期对齐
- [ ] 四阶段顺序执行，未确认不查酒店
- [ ] 451 连续失败时降频或 scenic 单段刷新

### 阶段 5（待办运维 · 当前重点）

- [ ] `booking-schedule.json` 机酒项 `booked: true`，门票/预约/路况 `booked: false` 直到用户确认
- [ ] 新增/改期待办：同步 `eventDate`、`bookFromDate`、`bookByDate`、`appointmentTime`
- [ ] `npm run remind:bookings:dry` 验证 digest 无已订机酒
- [ ] 用户订票/预约成功后立即改 `booked: true` 并 commit
- [ ] **不要**在机酒已订后再跑 fly.ai 全量机酒或推 TOP3 评分明细
- [ ] 每日 7:00 cron / GitHub Actions 保持 `remind:bookings` 运行

### 通用

- [ ] 改 profile/schedule 后重跑再生链
- [ ] 合并冲突后重跑，不保留半成品 reports
- [ ] 用户要求推送时用 `remind:bookings --force` 或 `monitor:brief`

---

## 目的地选型参考（顾问式，非脚本）

用户问「怎么选」时用，**不要**擅自改已确认行程。详见历史版本选型表（昭苏/特克斯/库尔德宁等）。
