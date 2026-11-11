# 代码规范化重构（2026-11-10）

## 背景

用户要求「检查后规范化，不要屎山和不好维护的项」。审视 shop-insight 等新增代码，发现 3 类问题。

## 发现的问题

1. **命令间互相依赖**：`resolveShopId`、`makeTracker`、`waitTracked`、`grabShopOverview` 从 `shop-trend.mjs` 导出，被 shop-compare/shop-authors/shop-insight import。这违反架构文档里「commands 之间不互相依赖」的原则（commands 应只依赖 lib）。

2. **报告工具函数重复**：`cell`/`money`/`short` 在 shop-trend/shop-compare/shop-authors/shop-insight 共 4 处重复（实现一模一样）。

3. **tracker 重复**：`makeTracker`（shop-trend）与 `makeMultiTracker`（shop-insight）功能类似，散落两处。

## 重构方案

新建 3 个 lib 模块，commands 只从 lib import：

| 新模块 | 内容 |
|---|---|
| `lib/report.mjs` | `cell`（md 单元格转义）、`short`（截断）、`money(n, currency)`（金额格式化）、`pct`（百分比） |
| `lib/tracker.mjs` | `makeTracker`、`makeMultiTracker`、`waitTracked`（接口响应跟踪） |
| `lib/shop.mjs` | `resolveShopId`、`grabShopOverview`（店铺共享函数） |

改造：
- `money` 统一为 `money(n, currency)` 参数签名，各命令用 `moneyOf = (n) => money(n, r.currency)` 闭包。
- 4 个命令删除本地重复定义，改为 import lib。

## 验证

- 全量语法检查 OK。
- 16/16 测试通过。
- shop-insight 真实命令验证：六维数据（category/author/sale/price/video/live）全部正常。

## 结果

- commands 之间零依赖（都只依赖 lib）。
- 报告工具函数、tracker、店铺共享函数各只有一份。
- 依赖方向保持单向：入口 → commands → lib。
