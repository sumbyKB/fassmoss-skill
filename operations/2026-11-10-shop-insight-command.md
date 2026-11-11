# 新增 shop-insight 命令（2026-11-10）

## 背景

用户要求「基于页面 tabs 多点一下，看看可以拓展」，探索店铺详情页所有 tab，发现 6 个未被现有代码利用的分析接口，逐个实现并验证（用户要求「一个一个做一个一个检查」）。

## 探索结论（tab → 接口映射）

| tab | 接口 | 数据 |
|---|---|---|
| 成交分析 | `saleAnalysis` | 成交渠道分布 + 内容分布 |
| 商品分析 | `goodsStats` + `priceRange` | 二级/三级分类占比 + 价格带定义 |
| 达人分析 | `authorAnalysis` | 达人粉丝区间 + 类型分布 |
| 视频 | `videoAnalysis` | 视频明细（含 AD/销量/GMV） |
| 直播 | `liveAnalysis` | 直播明细（含店铺自播/观看） |

## 实现

`commands/shop-insight.mjs` + 注册 HANDLERS + 白名单 + SKILL.md/README。

- 一次打开店铺详情页，监听 6 个接口（makeMultiTracker），逐个点 tab + 滚动触发懒加载，输出六维综合报告。
- 变量：`--shop`/`--shop-id`、`--country`。
- 复用 `resolveShopId`（shop-trend）。

## 关键坑

1. **video/live 接口 URL 用「?」精确匹配**，排除 Summary 汇总接口（否则捕获到 241 字节 summary 而非 8556 字节明细）。
2. **视频/直播需滚动触发懒加载**，点 tab 不稳定。
3. **priceRange 只有档位定义、无占比**，改用 goods 商品价格自行分档（泰铢 5 档）。
4. **渠道名英文 key 需映射中文**（common.goods.affiliate=达人带货 等）。

## 验证

- 6 个数据源逐个实现 + 逐个验证（跑 Steapex 泰国站）。
- 实测：纯运动鞋店（跑步鞋 98.59% 销量）、达人 12558、达人带货 78%、直播 66%、爆款视频 5 条、爆款直播 5 条。
- 16/16 测试通过，语法 OK。
