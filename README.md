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
| 去程 | 9/28 - 10/1 | 深圳/广州 → 乌鲁木齐、伊犁（伊宁）、阿勒泰、石河子 |
| 返程 | 10/6 - 10/8 | 乌鲁木齐、伊犁（伊宁）、阿勒泰、石河子 → 深圳/广州 |

无直飞时自动查询中转航班。

### 运行监控

```bash
npm install
npm run monitor:xinjiang    # 全量价格报告
npm run monitor:ranked      # 全量 + 每日 TOP3 评分报告
```

报告输出：
- `reports/xinjiang-flights-latest.md` — 全量价格汇总
- `reports/xinjiang-flights-ranked.md` — 每日 TOP3 评分推荐（含扣分项）

### 脚本说明

| 脚本 | 功能 |
|------|------|
| `scripts/monitor-xinjiang.sh` | 批量查询所有航线日期并生成报告 |
| `scripts/flyai-adaptive-search.sh` | 单航线自适应时间切片查询 |
| `scripts/flyai-dedup.js` | 航班结果去重合并 |
| `scripts/format-xinjiang-report.js` | 格式化全量 Markdown 报告 |
| `scripts/format-ranked-report.js` | 每日 TOP3 评分排名与扣分项 |
| `scripts/feishu-notify.js` | 飞书交互卡片推送（借鉴 daily_stock_analysis） |

### 飞书卡片通报

借鉴 [daily_stock_analysis](https://github.com/zjk1984/daily_stock_analysis) 的方案：监控完成后将报告以**飞书交互卡片**（`lark_md`）推送到群聊。

**配置：**

1. 飞书群 → 设置 → 机器人 → 添加自定义机器人 → 复制 Webhook URL
2. 复制 `.env.example` 为 `.env`，填入 `FEISHU_WEBHOOK_URL`

```bash
export FEISHU_WEBHOOK_URL="https://open.feishu.cn/open-apis/bot/v2/hook/xxxx"
export FEISHU_REPORT=ranked   # ranked | latest | both
npm run monitor:ranked        # 查询 + 生成报告 + 自动推送飞书
```

**单独推送已有报告：**

```bash
npm run notify:feishu
# 或指定文件/标题
node scripts/feishu-notify.js --title "自定义标题" reports/xinjiang-flights-ranked.md
```

**说明：**
- 默认推送 TOP3 评分报告；全量报告约 80KB 会自动分批（每批间隔 1s）
- 卡片发送失败时自动回退为纯文本消息
- 未配置 `FEISHU_WEBHOOK_URL` 时跳过推送，不影响监控流程


MIT
