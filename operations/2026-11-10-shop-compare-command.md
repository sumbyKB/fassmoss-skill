# 新增 shop-compare 命令（2026-11-10）

## 背景

用户要「某类目（运动鞋）GMV 前 N 店铺逐个对比：GMV / 爆款价格 / 达人数量 / 佣金率，找可借鉴 vs 学不了」。此前靠临时 node 脚本 + 手动组合 product/shop-detail 命令完成，未固化。

## 实现

`commands/shop-compare.mjs` + 注册到 `fastmoss-rpa.mjs` HANDLERS + `run-background.mjs` 白名单。

- 流程：抓类目商品榜（精确到二级分类 l2_cid）→ 按店铺聚合 GMV → 取前 N → 逐个搜店铺名抓达人数量 → 出对比报告。
- **变量（搜索条件全部变量化）**：`--country`、`--category`（类目名，自动匹配 l2_cid）、`--category-id`/`--category-id2`、`--top`（前N）、`--days`（榜单周期）、`--pages`（商品榜页数）、`--benchmark`（基准店铺）、`--sort`。
- **复用**：从 `product.mjs` 导出 `dateTypeOf`/`buildProductUrl`/`grabProductPage`；从 `shop-trend.mjs` 导出 `grabShopOverview`/`resolveShopId`。

## 关键口径

- GMV = 商品榜（二级类目）按店铺聚合，非店铺整体 GMV。
- 达人数量 = 店铺详情页「带货达人数」（累计口径）。
- 佣金 = 上榜商品平均佣金。
- 价格区间 = 过滤鞋垫等配件后（价格 ≥ 50 且排除配件关键词）。

## 验证

- 运动鞋前 5 店实测跑通，结果与手动分析一致。
- 16/16 测试通过，语法检查 OK。
- 已清理测试产物（shop-compare-test.json/md）。
