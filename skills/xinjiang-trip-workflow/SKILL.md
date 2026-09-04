---
name: xinjiang-trip-workflow
display_name: "伊犁行程决策工作流（去程→返程→计划→酒店）"
description: 按严格优先级执行旅行 Skill：1 去程 2 返程 3 Plan A/B 4 酒店。Agent 不得跳步（例如去程未确认时不查酒店）。
homepage: https://github.com/zjk1984/flighthub-travel-skill
metadata:
  version: 1.0.0
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
4. **确认酒店** — `npm run skill:hotels`（仅 activeVariant 对应酒店段）

```bash
npm run skill:workflow:status
npm run skill:workflow          # 从当前阶段顺序执行
```

状态字段：`config/trip-profile.json` → `workflow.confirmed`
