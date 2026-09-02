---
name: xinjiang-outbound-monitor
display_name: "广东→新疆 去程机票监控"
description: 独立运行广东出发至新疆各目的地的低价航班监控与 TOP3 评分报告。仅查去程，不查返程，降低 fly.ai API 风控风险。需与 xinjiang-return-monitor 分时段配合使用。
homepage: https://github.com/zjk1984/flighthub-travel-skill
metadata:
  version: 1.0.0
  agent:
    type: tool
    runtime: node
    context_isolation: execution
  openclaw:
    emoji: "🛫"
    priority: 85
    requires:
      bins:
        - node
        - bash
    intents:
      - flight_search
      - price_comparison
      - trip_planning
    patterns:
      - "(去程|出发|广东.*新疆|深圳.*新疆|广州.*新疆).*(机票|航班|监控|低价|查询)"
      - "(monitor|search).*(outbound|去程).*(xinjiang|新疆|flight)"
      - "执行去程.*skill|运行去程监控|查去程航班"
---

# 广东 → 新疆 去程监控 Skill

独立 Skill，**只跑广东 → 新疆去程 + 去程自定义中转**（主查询 <3 条时经西安/兰州拼接），不与返程同批调用 API。

## 何时使用

- 用户要求查/监控**去程**、广东飞新疆、9/28–10/1 等去程日期
- 用户说「执行去程 skill」「运行去程监控」
- **不要**在本 Skill 中查询返程；返程使用 `xinjiang-return-monitor`

## 前置条件

```bash
npm install
flyai config set FLYAI_API_KEY "your-key"   # 或写入 .env
```

## 执行命令

```bash
npm run skill:outbound
# 等价
bash scripts/monitor-outbound.sh
```

## 输出

| 文件 | 说明 |
|------|------|
| `reports/xinjiang-results.jsonl` | 去程原始数据（返程 Skill 会追加） |
| `reports/xinjiang-outbound-latest.md` | 去程全量价格报告 |
| `reports/xinjiang-outbound-ranked.md` | 去程 TOP3 + **自定义中转 TOP3** 评分报告 |

## 与返程 Skill 配合

1. 运行本 Skill（去程）
2. **等待 ≥30 分钟**（若出现 apiError/451 则等更久）
3. 运行 `xinjiang-return-monitor` Skill（返程 + 合并报告）

## 配置

与主监控共用 `config/monitor-config.json`：

```bash
npm run monitor:config
npm run monitor:set -- --outbound-dates 2026-09-28,2026-09-29
```

## 风控说明

- 并发 1、请求间隔 3s、连续 3 次 451 熔断
- 报告含 `apiError` 的航线表示 API 失败，非无航班
- 去程完成后勿立即跑返程
