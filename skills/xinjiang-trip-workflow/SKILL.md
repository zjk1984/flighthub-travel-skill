---
name: xinjiang-trip-workflow
display_name: "伊犁行程决策工作流（去程→返程→计划→酒店）"
description: 按严格优先级执行旅行 Skill：1 去程 2 返程 3 Plan A/B 4 酒店。含 Plan B 玉湖+喀拉峻+独库百里画廊+赛湖 最新路线、10:00 后出发、景区民宿优先与报告再生链。Agent 不得跳步。
homepage: https://github.com/zjk1984/flighthub-travel-skill
metadata:
  version: 1.1.0
  agent:
    type: tool
    runtime: node
  openclaw:
    emoji: "📋"
    priority: 92
---

# 伊犁行程决策工作流

## 优先级（铁律）

1. **确认去程航班** — `npm run skill:outbound` → `bookedOutbound`
2. **确认返程航班** — `npm run skill:return:flights` → `workflow.confirmed.return: true`
3. **确认旅行计划** — `npm run skill:plan` → Plan A（独库 `duku`）/ Plan B（`planb`）
4. **确认酒店** — `npm run skill:hotels`（仅 `activeVariant` 对应酒店段）

```bash
npm run skill:workflow:status
npm run skill:workflow          # 从当前阶段顺序执行
```

状态字段：`config/trip-profile.json` → `workflow.confirmed`

**禁止跳步**：去程/返程/计划未确认时，不要跑全量酒店查询或推送飞书。

---

## 当前已确认 Plan B 快照（2026-09 执行经验）

| 日 | 日期 | 路线 | 出发 | 住宿 |
|----|------|------|------|------|
| D1 | 10/1 | 伊宁落地 23:10 | — | 机场附近 |
| D2 | 10/2 | 伊宁→玉湖 | **10:00 后** | 玉湖民宿 🏡 |
| D3 | 10/3 | 玉湖→**喀拉峻**（不经特克斯过夜） | **10:00 后** | 喀拉峻民宿 🏡 |
| D4 | 10/4 | 喀拉峻慢玩第二日 | **10:00 后** | 喀拉峻民宿（连住） |
| D5 | 10/5 | 喀拉峻→**库尔德宁** 2–3h → 唐布拉 | **10:00 后** | 唐布拉 |
| D6 | 10/6 | 唐布拉→独库→赛湖南门→东门 | **10:00 后** | 赛湖东门 🏡 |
| D7 | 10/7 | 赛湖深度→博乐 | **10:00 后** | 博乐 |
| D8 | 10/8 | 博乐短逛→还车→MU6170 13:30 | **~11:30 出发** | — |

**行程原则（写入 `itineraryVariants.planb`）：**

- **全程尽量 10:00 后上路**；D8 为还车例外（11:30 前结束逛街出发）
- **D2 无需取车**：车辆已提前备好，10:00 后退房直接 G577 赴昭苏
- **D3 直赴喀拉峻**：跳过特克斯过夜
- **喀拉峻连住 2 晚**（D3–D4）
- **D5 库尔德宁轻游**（东沟 2–3h，16:30 前离园赴唐布拉）
- **D7 住博乐**（方便 D8 12:00 前阿拉山口还车）
- 独库 D5 晚 + D6 早查路况；果子沟导航**金顶**，禁止桥面停车

**已订航班（勿重复查）：**

- 去程：`bookedOutbound` CZ6888/CZ6827 10/1 广州→伊宁 23:10
- 返程：`bookedReturn` MU6170/MU2311 10/8 博乐 13:30→广州

---

## 修改行程后的报告再生链（必跑）

编辑 `config/trip-profile.json` 后，按顺序再生报告，避免卡片/简报与 profile 不一致：

```bash
# 1. 酒店实价（全量 6 段）
source scripts/load-env.sh
node scripts/monitor-hotels.js
node scripts/format-hotels-ranked.js reports/xinjiang-hotels-latest.json

# 2. 行程卡片 + 决策简报
node scripts/format-travel-cards.js --variant planb --out reports/xinjiang-travel-cards-planb.md
node scripts/format-travel-brief.js reports/xinjiang-results.jsonl > reports/xinjiang-travel-brief.md

# 3. 手动维护的逐时指南（Agent 按 profile 同步改写，无自动生成器）
#    reports/planb-complete-guide.md
#    reports/planb-daily-guide.md
#    reports/planb-complete-with-hotels.md
#    reports/scenic-homestay-top3.md
```

**PR 合并冲突经验**：若 `main` 与 feature 分支同时改了 `trip-profile.json` 和 `reports/*`，合并时**保留 profile 逻辑 + 分支侧最新酒店价**，然后**重新跑上述命令**覆盖 reports，不要手工拼 JSON/MD。

---

## 阶段 4：酒店查询

### 全量查询

```bash
npm run monitor:hotels              # → reports/xinjiang-hotels-latest.json
npm run monitor:hotels:ranked       # → reports/xinjiang-hotels-latest-ranked.md
npm run skill:hotels                # 阶段 4 门禁 + 酒店 + 简报 + 可选飞书
```

酒店段读取 `activeVariant` 下的 `itineraryVariants.planb.hotels`（Plan B 共 **6 段 7 晚**）。

### 景区民宿优先（`scenicHomestay: true`）

Plan B 景区段：**D2 玉湖**、**D3–D4 喀拉峻**、**D6 赛湖东门**。

段配置要点：

| 字段 | 作用 |
|------|------|
| `scenicHomestay: true` | 忽略 `maxPrice` 上限；评分加权民宿 |
| `scenicPoi` | `--poi-name` 锚定景区 |
| `extraKeywordSearches` | 多关键词补搜（如「别克波森」「望湖庄园」） |
| `preferHomestay: true` | 非 scenic 段也优先民宿类型 |

**仅刷新景区段**（省 API、降风控）：

```bash
npm run monitor:hotels:scenic       # refresh-scenic-homestays.js
```

脚本会：剔除 JSON 中 scenic 段 → 重查 → 合并 → 自动跑 `format-hotels-ranked.js`。

### `hotelOverrides`（人工精选覆盖）

当 API 评分把连锁酒店排到 TOP，但用户要景区民宿时，在 `itineraryVariants.planb.hotelOverrides` 按 **checkIn 日期** 写入：

```json
"2026-10-06": {
  "name": "赛湖高白鲑鱼坊",
  "price": "¥711/间",
  "note": "D6 赛湖景区内；API 未返回喜见/鲸语时用此覆盖"
}
```

覆盖会注入 `format-travel-cards.js`、`format-travel-brief.js`、`format-hotels-ranked.js` 的 TOP 展示；`monitor-hotels.js` 也会用名称关键词追加补搜。

### 已知 API 库存缺口（2026-09 实测）

| 段 | 现象 | 处理 |
|----|------|------|
| 喀拉峻 | 多关键词仍常只返回 **别克波森**；无垠之境/霍斯宝未命中 | 保留 `hotelOverrides`；可隔日再跑 scenic refresh |
| 赛湖 | **喜见/鲸语** 未返回；连锁如家 neo 评分更高 | 用 `hotelOverrides` 指定 **高白鲑鱼坊** 或用户指定名 |
| 全段 | HTTP **451** 风控 | 见下节 |

### 酒店 API 风控（比机票更严）

`monitor-hotels.js` 实测策略：

- 段与段之间 **sleep 2.5–3s**；scenic 批内关键词搜索间隔 **2.5s**
- 遇 **451** 等待 **45s** 重试一次；仍失败则该段空结果
- 连续 451 时：**不要**立刻跑全量；先用 `monitor:hotels:scenic` 单段重试，或等 **30–60 分钟**
- 机票 451 重试用 `npm run monitor:resume`（读 `reports/failed-tasks.json`）

---

## 输出文件地图

| 文件 | 生成方式 |
|------|----------|
| `reports/xinjiang-travel-cards-planb.md` | `format-travel-cards.js --variant planb` |
| `reports/xinjiang-travel-brief.md` | `format-travel-brief.js` |
| `reports/xinjiang-hotels-latest.json` | `monitor-hotels.js` |
| `reports/xinjiang-hotels-latest-ranked.md` | `format-hotels-ranked.js` |
| `reports/scenic-homestay-top3.md` | Agent 汇总 scenic 段 TOP（无专用脚本） |
| `reports/planb-complete-with-hotels.md` | Agent 合并指南 + 订房链接 |
| `reports/planb-complete-guide.md` | 逐时指南（手维，随 profile 同步） |

---

## 飞书推送

```bash
npm run setup:feishu              # 配置 FEISHU_WEBHOOK_URL
npm run skill:hotels              # 阶段 4 自动推酒店 TOP3 + 行程简报
FEISHU_SKIP=1 npm run skill:hotels  # 跳过推送
```

`skill:hotels` 推送：`xinjiang-hotels-latest-ranked.md` + `xinjiang-travel-brief.md`。

---

## 目的地选型参考（顾问式，非脚本）

用户问「怎么选」时用，**不要**擅自改已确认行程：

**昭苏片区三选一（通常选 1–2，难全包）：**

| 选项 | 适合 | 注意 |
|------|------|------|
| 恰甫其海 | 轻量摄影、老人 | 半日足够 |
| 夏塔 | 雪山+栈道 | 区间车+步行，体力要求高 |
| 玉湖 | 当前 Plan B 已选 | 海拔高，备外套；须提前订民宿 |

**特克斯片区四选一（时间紧选 1，松可选 2）：**

| 选项 | 适合 | 注意 |
|------|------|------|
| 喀拉峻 | 当前 Plan B 已选 ×2 晚 | 景区内民宿须提前订 |
| 特克斯八卦城/离街 | 文化打卡 | 半日 |
| 库尔德宁 | Plan B D5 路过 2–3h | 不走齐梦德长栈道 |
| 巩留野核桃沟 | 秋景备选 | 与库尔德宁方向近，通常二选一 |

**喀拉峻 2 晚 → 唐布拉，路过库尔德宁玩吗？** 可行：D5 10:00 后出发，库尔德宁东沟轻游 2–3h，16:30 前离园赴唐布拉（车程+游玩约 8–9h，日偏长但可执行）。

---

## Agent 检查清单

修改行程或酒店后：

- [ ] `activeVariant` 与 `workflow.confirmed.plan` 一致
- [ ] Plan B `days` / `hotels` / `hotelOverrides` 日期对齐
- [ ] 跑酒店查询 + ranked + cards + brief
- [ ] 同步 `planb-complete-guide.md` 等手维报告
- [ ] commit + push；合并冲突后**重跑再生链**，勿保留冲突半成品
- [ ] 用户要求推送时再跑 `skill:hotels` 或 `notify:feishu`
