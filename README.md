# FlightHub — 飞猪旅行综合查询 Skill

OpenClaw Skill，基于飞猪 MCP 接口，提供机票、酒店、门票、景点等一站式旅行搜索能力。

## 功能

- ✈️ **机票查询** — 支持直达/中转、时间筛选、价格排序、自适应时间切片突破 10 条 API 限制
- 🏨 **酒店搜索** — 按城市、日期、星级、价格范围搜索
- 🎫 **景点门票** — POI/景点搜索及门票查询
- 🚂 **火车票** — 跨平台火车票查询
- 🔍 **关键词搜索** — 自然语言一站式搜索酒店、机票、门票、演出等
- 🤖 **AI 语义搜索** — 理解复杂自然语言意图的智能搜索
- 🏰 **万豪酒店** — 万豪集团酒店及套餐专属搜索

## 机票自适应时间切片

飞猪 MCP 接口单次查询硬限制返回 10 条结果。本 Skill 采用**自适应二分时间切片策略**突破此限制：

1. 首次查询全时间段，若返回 10 条则继续细分
2. 按 6h → 3h → 1.5h 递进细分，密集时段自动切更细
3. 所有窗口去重合并，按出发时间排序展示
4. 默认只查直达航班，中转航班按需查询

## 底层依赖

本 Skill 基于飞猪官方项目 [alibaba-flyai/flyai-skill](https://github.com/alibaba-flyai/flyai-skill) 的 CLI 工具 `@fly-ai/flyai-cli`，在其基础上增加了自适应查询策略和展示优化。

## 安装

将 `SKILL.md`、`_meta.json`、`references/` 目录放置到 OpenClaw workspace 的 `skills/flyai/` 下即可。

CLI 安装：`npm i -g @fly-ai/flyai-cli`

## 低价机票监控

本项目内置广东 ↔ 新疆低价航班监控脚本，基于 FlyAI skill 的自适应时间切片策略查询飞猪实时数据。

### 监控航线

| 方向 | 日期 | 航线 |
|------|------|------|
| 去程 | 9/30 - 10/1 | 深圳/广州 → 乌鲁木齐、伊犁（伊宁）、阿勒泰、石河子 |
| 返程 | 10/7 - 10/8 | 乌鲁木齐、伊犁（伊宁）、阿勒泰、石河子、博乐 → 深圳/广州 |

无直飞时自动查询中转航班。

### 配置与重置

监控参数保存在 `config/monitor-config.json`，支持修改/重置出发返程日期、出发地、目的地：

```bash
npm run monitor:config          # 查看当前配置

# 修改
npm run monitor:set -- --outbound-dates 2026-11-01,2026-11-02
npm run monitor:set -- --return-dates 2026-11-08,2026-11-09
npm run monitor:set -- --origins 深圳,广州
npm run monitor:set -- --destinations 乌鲁木齐,伊宁,阿勒泰

# 重置为默认值（config/monitor-defaults.json）
npm run monitor:reset                              # 全部重置
node scripts/monitor-config.js reset --outbound-dates   # 仅重置去程日期
node scripts/monitor-config.js reset --return-dates     # 仅重置返程日期
node scripts/monitor-config.js reset --origins            # 仅重置出发地
node scripts/monitor-config.js reset --destinations     # 仅重置目的地
```

| 配置项 | 说明 |
|--------|------|
| `origins` | 出发地（去程出发 / 返程到达），如 深圳、广州 |
| `destinations` | 目的地（去程到达 / 返程出发），如 乌鲁木齐、伊宁 |
| `outboundDates` | 去程日期列表（YYYY-MM-DD） |
| `returnDates` | 返程日期列表（YYYY-MM-DD） |
| `directOnlyAirports` | 仅查直达的机场（默认乌鲁木齐） |

### 运行监控

**推荐：聚焦盯票（伊宁↔广州，读 `config/trip-profile.json`）**

```bash
npm install
npm run monitor:preset -- xinjiang-focus-yining
npm run skill:return      # 返程 + 酒店 + 决策简报 + 飞书
```

**全量扫描（5 城 × 多日期，API 用量大）**

```bash
npm run monitor:preset -- xinjiang-full
npm run skill:outbound
# 等待 ≥30 分钟
npm run skill:return
```

报告输出：
- `reports/xinjiang-flights-brief.md` — **决策简报**（10/7 vs 10/8、5人合计、场景推荐）
- `reports/xinjiang-flights-ranked.md` — TOP3 评分（family_elder 等画像）
- `reports/xinjiang-flights-latest.md` — 全量价格
- `reports/price-history.jsonl` — 每日最低价变动

```bash
npm run monitor:hotels      # 酒店刷新
npm run monitor:resume      # 451 失败航线重试
npm run monitor:presets     # 列出 preset
```

### 脚本说明

| 脚本 | 功能 |
|------|------|
| `scripts/monitor-xinjiang.sh` | 批量查询所有航线日期并生成报告 |
| `scripts/flyai-adaptive-search.sh` | 单航线自适应时间切片查询 |
| `scripts/flyai-dedup.js` | 航班结果去重合并 |
| `scripts/format-xinjiang-report.js` | 格式化全量 Markdown 报告 |
| `scripts/format-ranked-report.js` | 每日 TOP3 评分排名与扣分项 |
| `scripts/feishu-notify.js` | 飞书交互卡片推送（借鉴 daily_stock_analysis） |
| `scripts/format-travel-brief.js` | 一页决策简报（10/7 vs 10/8、酒店、价格变动） |
| `scripts/monitor-hotels.js` | 按 trip-profile 查询酒店 |
| `scripts/monitor-resume.js` | 451 失败航线重试 |
| `scripts/price-history.js` | 每日最低价快照 |
| `scripts/scoring-profiles.js` | 评分画像（default / family_elder / budget） |
| `scripts/load-monitor-config.js` | 配置加载模块（脚本内部使用） |

### 飞书卡片通报

借鉴 [daily_stock_analysis](https://github.com/zjk1984/daily_stock_analysis) 的方案：监控完成后将报告以**飞书交互卡片**（`lark_md`）推送到群聊。

**一键配置：**

```bash
# 方式 1：Open API 应用机器人（推荐）
bash scripts/setup-feishu.sh --app cli_xxx <app-secret> oc_xxxxxxxx

# 方式 2：交互式 Webhook
npm run setup:feishu

# 方式 3：直接传入 Webhook
bash scripts/setup-feishu.sh "https://open.feishu.cn/open-apis/bot/v2/hook/你的key" ranked
```

配置写入 `.env`（已加入 `.gitignore`，不会提交到仓库）。

**获取 Webhook：** 飞书群 → 设置 → 群机器人 → 添加机器人 → **自定义机器人** → 复制 Webhook 地址

**配置（Open API 应用机器人，推荐）：**

```bash
./scripts/setup-feishu.sh --app cli_xxx <app-secret> oc_xxxxxxxx
npm run notify:feishu:test   # 发送测试消息
```

**或 Webhook 模式：**

```bash
./scripts/setup-feishu.sh https://open.feishu.cn/open-apis/bot/v2/hook/...
```

**测试推送 / 监控推送：**

```bash
npm run notify:feishu:test   # 发送测试消息
npm run notify:feishu        # 推送当前 TOP3 报告
npm run monitor:ranked       # 查询 + 生成报告 + 自动推送飞书
```

**环境变量（`.env`）：**

| 变量 | 说明 | 默认 |
|------|------|------|
| `FEISHU_APP_ID` + `FEISHU_APP_SECRET` + `FEISHU_CHAT_ID` | Open API 应用机器人（推荐） | — |
| `FEISHU_WEBHOOK_URL` | 自定义机器人 Webhook（二选一） | — |
| `FEISHU_WEBHOOK_SECRET` | Webhook 签名校验密钥 | 空 |
| `FEISHU_REPORT` | `brief` / `ranked` / `latest` / `both` / `all` | `brief` |
| `FEISHU_MAX_BYTES` | 单条消息最大字节，超长分批 | `20000` |

## 旅迹 AI 规划应用（lvji-travel）

[旅迹](apps/lvji/) 已合并到本仓库，机票/酒店查询复用根目录 FlyAI skill（`SKILL.md`、`references/`、`scripts/flyai-*.sh|js`），不再维护独立 skill 副本。

```bash
cd apps/lvji && pnpm install && pnpm dev   # http://127.0.0.1:4173
# 或从仓库根目录：
pnpm --dir apps/lvji dev
```

Docker 构建（需在仓库根目录执行）：

```bash
docker build -f apps/lvji/Dockerfile -t lvji-travel .
```

MIT
