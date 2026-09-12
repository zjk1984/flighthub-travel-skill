---
name: travel-trip-workflow
display_name: "通用旅行决策工作流（机酒→待办）"
description: 可复用于任意目的地的五阶段旅行 Skill：1 去程 2 返程 3 计划 4 酒店 5 门票/预约/路况待办。机酒全订后进入 feishuTodosOnly，FlyAI 只维护 booking-schedule 未完成项。Agent 不得跳步。
homepage: https://github.com/zjk1984/flighthub-travel-skill
metadata:
  version: 1.1.0
  agent:
    type: tool
    runtime: node
  openclaw:
    emoji: "🗺️"
    priority: 91
    patterns:
      - "(旅行|行程|出游|度假).*(规划|计划|决策|工作流|skill)"
      - "(去程|返程|酒店|民宿).*(确认|查询|刷新|监控)"
      - "(trip|travel|itinerary).*(workflow|plan|skill|monitor)"
      - "新建.*目的地.*(skill|行程|监控)"
      - "复制.*(伊犁|新疆).*(skill|工作流)"
---

# 通用旅行决策工作流

本 Skill 从「伊犁 8 天自驾」实践中抽象，适用于**任意目的地**的多日行程：

**决策期（FlyAI）**：机票盯票 → 返程比价 → 主/备路线 → 分段酒店  
**运维期（待办）**：景区门票、通行预约、路况查询、租车还车等 — 由 `booking-schedule.json` + 每日飞书 digest 驱动，**不再** fly.ai 查已订机酒

**参考实现**：`skills/xinjiang-trip-workflow/SKILL.md`（新疆伊犁 Plan B · 机酒已订）  
**配置模板**：`config/trip-profile.template.json`

---

## 五阶段优先级（铁律）

| 阶段 | 目标 | FlyAI | 确认字段 | 典型命令 |
|------|------|-------|----------|----------|
| **1 去程** | 选定出发航班/车次 | `search-flight` | `bookedOutbound` | `npm run skill:outbound` |
| **2 返程** | 选定返程（多机场/多日期） | `search-flight` | `bookedReturn` | `npm run skill:return:flights` |
| **3 计划** | 确认主方案或备选 | — | `workflow.confirmed.plan` | `npm run skill:plan` |
| **4 酒店** | 按 activeVariant 查各段住宿 | `search-hotel` | `workflow.confirmed.hotels: true` | `npm run skill:hotels` |
| **5 待办** | 门票/预约/路况/活动 | **不查** | `booking-schedule.json` → `booked: false` | `npm run remind:bookings` |

```bash
npm run skill:workflow:status    # 阶段 1–4 进度（全完成后 currentPhase = done）
npm run skill:workflow           # 从当前阶段顺序执行到酒店
npm run remind:bookings:dry      # 预览阶段 5 每日 digest
npm run remind:bookings          # 推送阶段 5 飞书提醒
```

**禁止跳步**：阶段 1–3 未确认时，不要跑全量酒店查询或推送机酒 TOP3。

门禁逻辑（阶段 1–4）：`scripts/trip-workflow.js` → `assertPhaseGate()`

### 机酒已订 → `feishuTodosOnly` 模式

当 `bookedOutbound` + `bookedReturn` + 全部酒店段 `hotelOverrides.*.booked`（且通常 `skipMonitor: true`）时：

| 行为 | 决策期 | 运维期 |
|------|--------|--------|
| fly.ai 查机票 | ✅ | ❌ `buildReturnTasks()` 空 |
| fly.ai 查酒店 | ✅ | ❌ 只写 override，不 search-hotel |
| 飞书 | TOP3 / 比价简报 | **仅** `booking-reminders` digest |
| 行程简报 | 含评分明细 | 待办来自 schedule，无 TOP3 |

检测：`load-trip-profile.js` → `feishuTodosOnly(trip)`；shell 用 `feishu_todos_only()`（`scripts/feishu-env.sh`）。

---

## 新目的地 Bootstrap（10 步）

为新目的地（如云南、川西、海南）启用本工作流：

### 1. 复制配置模板

```bash
cp config/trip-profile.template.json config/trip-profile.json
# 或独立命名：config/trip-profile-yunnan.json
```

替换占位符：`{{TRIP_LABEL}}`、`{{HOME_CITY}}`、`{{DEST_CITY}}`、`{{OUTBOUND_DATE}}`、`{{RETURN_DATE}}` 等。

### 2. 绑定监控配置

编辑 `config/monitor-config.json`：

| 字段 | 说明 |
|------|------|
| `routeLabel` | 报告标题，如「云南 7 天 · 10/1–10/7」 |
| `origins` / `destinations` | 去程出发/到达城市 |
| `outboundDates` / `returnDates` | 日期列表 |
| `tripProfilePath` | 指向你的 profile，如 `config/trip-profile-yunnan.json` |
| `scoring.profile` | `default` \| `family_elder` 等评分画像 |
| `scoring.destinationScores` | 返程多机场权重（可选） |

```bash
npm run monitor:set -- --origins 广州 --destinations 丽江,昆明
npm run monitor:set -- --outbound-dates 2026-11-01 --return-dates 2026-11-08
```

### 3. 填写行程 `days`

在 `itineraryVariants.primary.itinerary.days` 写每日卡片：

```json
{
  "cardId": "D3",
  "date": "2026-11-03",
  "title": "大理 → 丽江",
  "activity": "**10:00 后** 退房 → 洱海东线 → 赴丽江",
  "drive": "约 2.5h",
  "stay": "丽江古城",
  "note": "可选约束：每日尽量 10:00 后上路"
}
```

### 4. 配置主/备方案

- `activeVariant: "primary"` — 当前生效方案
- `itineraryVariants.primary` — 主路线
- `itineraryVariants.fallback` — 封路/天气/闭园备选

命名不限于 `primary/fallback`；伊犁实例用 `duku` / `planb`，逻辑相同。

### 5. 配置酒店段 `hotels`

每段对应一晚或多晚连住：

```json
{
  "segment": "D2 泸沽湖",
  "destName": "宁蒗",
  "checkIn": "2026-11-02",
  "checkOut": "2026-11-03",
  "maxPrice": 800,
  "topN": 12,
  "scenicHomestay": true,
  "scenicPoi": "泸沽湖",
  "extraKeywordSearches": [{ "keyWords": "里格 民宿", "poiName": "泸沽湖" }],
  "keyWords": "湖景 民宿",
  "preferHomestay": true
}
```

### 6. 设置 `itineraryConstraints`

末段与返程衔接（还车、退房、到机场）：

```json
"itineraryConstraints": {
  "byDate": {
    "2026-11-08": {
      "minDepartureTime": "12:00",
      "activity": "上午短逛 → 机场还车",
      "note": "以 bookedReturn 订单时间为准"
    }
  }
}
```

### 7. 可选：创建目的地 Skill 壳

复制并改写参考实现：

```bash
cp -r skills/xinjiang-trip-workflow skills/yunnan-trip-workflow
# 编辑 SKILL.md：填入该目的地快照、选型表、已知 API 缺口
```

通用逻辑留本 Skill；目的地细节放子 Skill。

### 8. 按阶段执行

```bash
npm run skill:outbound          # 阶段 1
# 用户确认后写入 bookedOutbound
npm run skill:return:flights      # 阶段 2
npm run skill:plan                # 阶段 3 卡片
npm run skill:hotels              # 阶段 4
```

### 9. 报告输出约定

建议统一前缀 `reports/{{slug}}-*`，或在现有脚本中用 `--profile` / `--out` 参数：

| 产物 | 命令 |
|------|------|
| 航班 JSONL | 各 monitor 脚本追加 `reports/xinjiang-results.jsonl` |
| 酒店 JSON | `node scripts/monitor-hotels.js --profile config/trip-profile.json` |
| 酒店 TOP3 | `node scripts/format-hotels-ranked.js reports/...json` |
| 行程卡片 | `node scripts/format-travel-cards.js --variant primary --out reports/...md` |
| 决策简报 | `node scripts/format-travel-brief.js reports/...jsonl > reports/...md` |

### 10. 确认 workflow 状态

```json
"workflow": {
  "confirmed": {
    "outbound": true,
    "return": true,
    "plan": "primary",
    "hotels": true
  }
}
```

### 11. 配置阶段 5：`booking-schedule.json`

机酒确认后，复制并改写 `config/booking-schedule.json`（或按目的地新建 `config/booking-schedule-{{slug}}.json` 并在脚本中指向）：

```json
{
  "label": "云南7天 · 待办",
  "timezone": "Asia/Shanghai",
  "dailyDigestHour": 7,
  "remindDaysBefore": 1,
  "lookAheadDays": 7,
  "items": [
    {
      "id": "d3-jade-dragon-ticket",
      "eventDate": "2026-11-03",
      "bookByDate": "2026-11-02",
      "category": "ticket",
      "title": "D3 玉龙雪山门票",
      "detail": "官方小程序 · 分时预约",
      "booked": false,
      "action": "提前1天购票"
    },
    {
      "id": "d1-flight-out",
      "eventDate": "2026-11-01",
      "category": "flight",
      "title": "D1 去程 CA1234",
      "booked": true
    }
  ]
}
```

| `category` | 典型内容 | digest 行为 |
|------------|----------|-------------|
| `flight` / `hotel` | 已订机酒 | `booked: true` → **不展示** |
| `ticket` | 景区门票、自驾票 | 按 `bookFromDate` / `bookByDate` 提醒 |
| `reservation` | 通行预约、分时入园 | 含 `appointmentTime` |
| `road` | 路况查询（封路改线） | 行程日前提醒 |
| `car` / `activity` | 租车/还车、当日活动 | 按需 |

酒店项可通过 `profileCheckIn` 与 `hotelOverrides` 自动同步名称与 `booked` 状态（`booking-reminders.js` → `mergeProfileHotels`）。

---

## `trip-profile.json` 字段速查

| 区块 | 字段 | 用途 |
|------|------|------|
| 画像 | `partySize`, `roomCount`, `scoringProfile` | 人数、间数、评分画像 |
| 工作流 | `workflow.confirmed`, `activeVariant` | 阶段门禁 + 当前方案 |
| 已订 | `bookedOutbound`, `bookedReturn` | 跳过重复查票 |
| 聚焦 | `focusRoutes`, `returnDateCompare` | 只查关键航线/日期 |
| 衔接 | `itineraryConstraints.byDate` | 末段与返程约束 |
| 行程 | `itineraryVariants.*.itinerary.days` | 每日卡片 |
| 酒店 | `itineraryVariants.*.hotels` | 分段查询参数 |
| 覆盖 | `itineraryVariants.*.hotelOverrides` | 人工精选 TOP（按 checkIn 日期） |

`load-trip-profile.js` 会根据 `activeVariant` 自动合并 variant 下的 `itinerary` / `hotels` / `hotelOverrides`。

---

## 酒店段高级配置

### 景区民宿优先

| 字段 | 作用 |
|------|------|
| `scenicHomestay: true` | 忽略 maxPrice；评分加权民宿；多轮 POI 搜索 |
| `scenicPoi` | 锚定 `--poi-name` |
| `extraKeywordSearches` | 补搜目标民宿名 |
| `preferHomestay: true` | 非 scenic 段也优先民宿类型 |
| `hotelOverrides[checkIn]` | API 未返回目标时人工指定 TOP |

### 查询命令

```bash
npm run monitor:hotels              # 全量（activeVariant 全部段）
npm run monitor:hotels:scenic         # 仅 scenicHomestay 段（省 API）
npm run monitor:hotels:ranked         # 生成 TOP3 评分 MD
```

### `hotelOverrides` 示例

```json
"2026-11-03": {
  "name": "泸沽湖某湖景民宿",
  "price": "¥580/间",
  "note": "API 常返回连锁；用户指定时用此覆盖"
}
```

注入：`format-travel-cards.js`、`format-travel-brief.js`、`format-hotels-ranked.js`、`monitor-hotels.js`（补搜关键词）。

---

## 修改行程后的报告再生链

编辑 profile 后**必须**按序再生，避免卡片/简报/酒店价不一致：

```bash
source scripts/load-env.sh

# 1. 酒店
node scripts/monitor-hotels.js
node scripts/format-hotels-ranked.js reports/xinjiang-hotels-latest.json

# 2. 卡片 + 简报（--variant 与 activeVariant 一致）
node scripts/format-travel-cards.js --variant primary --out reports/travel-cards-primary.md
node scripts/format-travel-brief.js reports/xinjiang-results.jsonl > reports/travel-brief.md
```

**合并冲突经验**：保留 profile 逻辑 + 重跑再生链；勿手工拼 reports。

手维文档（逐时指南、含链接完整版）无自动生成器，Agent 按 profile 同步改写。

---

## API 风控（fly.ai / 飞猪 MCP）

### 机票

- 并发 1、请求间隔 3s、连续 3 次 451 熔断
- 去程与返程 Skill **分时段运行**，间隔 ≥30 分钟
- 失败航线：`npm run monitor:resume`（读 `reports/failed-tasks.json`）
- 自适应切片突破单次 10 条限制：见根目录 `SKILL.md`

### 酒店（比机票更严）

- 段间 sleep 2.5–3s；scenic 关键词批内 2.5s
- 451 → 等 45s 重试一次
- 连续失败：等 30–60min，或只跑 `monitor:hotels:scenic`

### 配置入口

`config/monitor-config.json` → `search.*`：`requestDelayMs`、`circuitBreaker`、`resumeAfter451`

---

## 通知推送（飞书）

| 阶段 | 推送 | 命令 |
|------|------|------|
| 1–2 | 机票 TOP3 / 简报 | `skill:outbound` / `skill:return:flights` |
| 4 | 酒店 TOP3 + 行程简报 | `skill:hotels` |
| **5** | **待办 digest（机酒已订后默认）** | `remind:bookings` |

```bash
npm run setup:feishu
npm run skill:hotels              # 决策期：酒店 TOP3 + 简报
npm run remind:bookings:dry       # 运维期：预览待办 digest
npm run remind:bookings           # 运维期：发送（07:00 cron）
FEISHU_SKIP=1 npm run skill:hotels
```

Cron：`0 7 * * * TZ=Asia/Shanghai npm run remind:bookings`  
GitHub Actions：`.github/workflows/booking-reminders.yml`

机酒已订时，`monitor-xinjiang.sh` / `monitor-hotels-phase.sh` / `monitor-return.sh` 检测到 `feishuTodosOnly` 后**自动改推** `booking-reminders.js`，不再推 TOP3 评分明细。

---

## 顾问式选型（不写进脚本）

用户问「A/B/C 怎么选」时：

1. **不要**擅自改已确认 `workflow.confirmed.plan`
2. 用表格列出：选项 / 适合人群 / 体力 / 时间 / 住宿难度
3. 给出「时间紧选 1，宽松可选 2」结论
4. 若用户确认切换，再改 profile 并重跑再生链

伊犁实例见 `skills/xinjiang-trip-workflow/SKILL.md` 末节。

---

## Agent 检查清单

**阶段 1–4（机酒决策）**

- [ ] `monitor-config.json` 的 `tripProfilePath` 指向正确 profile
- [ ] `activeVariant` 与 `workflow.confirmed.plan` 一致
- [ ] `days` / `hotels` / `hotelOverrides` 日期对齐
- [ ] 四阶段顺序执行，未确认不查酒店
- [ ] 451 连续失败时降频或 scenic 单段刷新

**阶段 5（待办运维）**

- [ ] `booking-schedule.json` 覆盖全部需预订项（机酒/门票/预约/路况）
- [ ] 已订项 `booked: true`；digest 只展示 `booked: false`
- [ ] 改待办后 `npm run remind:bookings:dry` 验证
- [ ] 机酒已订后**不**再 fly.ai 全量查机酒或推 TOP3 明细
- [ ] 每日 7:00 `remind:bookings` cron 或 GitHub Actions 已启用

**通用**

- [ ] 改 profile/schedule 后跑再生链
- [ ] 合并冲突后重跑，不保留半成品 reports
- [ ] 用户要求推送：`remind:bookings --force` 或决策期 `skill:hotels`

---

## 与现有 Skills 关系

```text
travel-trip-workflow（本 Skill，通用五阶段框架）
├── xinjiang-trip-workflow（伊犁 Plan B 参考 · 含 booking-schedule 实例）
├── xinjiang-outbound-monitor（去程盯票）
├── xinjiang-return-monitor（返程盯票）
└── booking-reminders.js + booking-schedule.json（阶段 5 待办，通用）
```

新目的地推荐：

1. 读本 Skill 完成 bootstrap
2. 参考 `xinjiang-trip-workflow` 填目的地细节
3. 根目录 `SKILL.md` 提供 fly.ai CLI 与机票切片能力
