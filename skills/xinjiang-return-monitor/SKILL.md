---
name: xinjiang-return-monitor
display_name: "新疆→广东 返程机票监控"
description: 独立运行新疆各目的地至广东的低价航班监控，合并已有去程 JSONL，生成完整往返 TOP3 报告。需在去程 Skill 完成并冷却后再运行，降低 fly.ai API 风控风险。
homepage: https://github.com/zjk1984/flighthub-travel-skill
metadata:
  version: 1.0.0
  agent:
    type: tool
    runtime: node
    context_isolation: execution
  openclaw:
    emoji: "🛬"
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
      - "(返程|回来|新疆.*广东|新疆.*深圳|新疆.*广州).*(机票|航班|监控|低价|查询)"
      - "(monitor|search).*(return|返程|inbound).*(xinjiang|新疆|flight)"
      - "执行返程.*skill|运行返程监控|查返程航班"
---

# 新疆 → 广东 返程监控 Skill

独立 Skill，**只跑返程 + 可选自定义中转**，并合并 `xinjiang-results.jsonl` 生成完整报告。

## 何时使用

- 用户要求查/监控**返程**、新疆飞广东、10/6–10/8 等返程日期
- 用户说「执行返程 skill」「运行返程监控」
- 去程 Skill 已运行且 **API 已冷却**（建议间隔 ≥30 分钟）

## 前置条件

- 建议先运行 `xinjiang-outbound-monitor`（非必须；无 JSONL 时仅查返程）
- `FLYAI_API_KEY` 已配置

## 执行命令

```bash
npm run skill:return
# 等价
bash scripts/monitor-return.sh
```

## 输出

| 文件 | 说明 |
|------|------|
| `reports/xinjiang-results.jsonl` | 去程+返程合并数据 |
| `reports/xinjiang-flights-latest.md` | 完整全量报告 |
| `reports/xinjiang-flights-ranked.md` | 完整 TOP3 + 往返组合 |

## 推荐流程

```
T+0      npm run skill:outbound     # 去程 Skill
T+30min  测试单条 API 无 451
T+30min  npm run skill:return       # 本 Skill
```

## 配置

```bash
npm run monitor:config
npm run monitor:set -- --return-dates 2026-10-06,2026-10-07,2026-10-08
```

## 风控说明

- 若返程阶段触发熔断，会跳过剩余航线及 custom transfer
- 飞书推送默认发送完整 TOP3 报告（需配置 `FEISHU_WEBHOOK_URL`）
