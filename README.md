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

## License

MIT
