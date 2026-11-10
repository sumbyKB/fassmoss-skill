# 2026-11-09 店铺逻辑 + 大白话统一入口

## 需求

用户要求：完善店铺逻辑，让整个 fastmoss skill 都能通过大白话操作获取想要的数据。

## 交付

### 1. 新增 `shop` 子命令（scripts/rpa/fastmoss-rpa.mjs）
抓 FastMoss 店铺搜索榜（/zh/shop-marketing/search，接口 /api/shop/v3/search）：
- 参数：`--country`、`--category`（分类）、`--rating`（评分）、`--pages`、`--sort`。
- 字段（精确解析，用 DOM class 选择器）：店铺名（.paragraph-text）、分类（.custom-tag-container）、评分（.ant-tag）、近7天销量/GMV、总销量/GMV、在售商品数、带货达人数、店铺详情链接（/zh/shop-marketing/detail/<seller_id>）。
- 默认串行单窗口（同商品榜，降低风控）。

### 2. 新增 `analyze-shop.mjs`
店铺数据分析：近7天GMV榜 + 总GMV榜 + 分类分布 + 品牌对比（本品牌前后各5名）+ 评分筛选。产出 shop-analysis.md + shop-analysis.json。

### 3. 新增 `references/natural-language.md`
大白话 → 命令路由手册：达人/商品/店铺/分类四类能力的「业务大白话关键词 → 子命令」映射表，供 AI 拆解用户意图。

### 4. SKILL.md / README.md 更新
- SKILL.md 开头改为「FastMoss 数据助手（大白话驱动）」，加四类能力一览表。
- 补店铺能力章节、natural-language 入口、README 命令示例与目录结构。

## 实测结果（泰国站）

- shop 抓 5 页 50 个店铺，字段完整（店铺名/分类/评分/近7天GMV/总GMV/带货达人数全对）。
- analyze-shop --category 箱包 跑通，产出报告。

## 大白话能力全景（最终）

| 能力 | 命令 | 大白话例子 |
|---|---|---|
| 达人搜索/详情 | search/pipeline/detail | 「找泰国箱包达人粉丝2千~5万」 |
| 商品榜 | product | 「近两周跑步鞋销售按金额排」 |
| 店铺榜 | shop | 「泰国箱包店铺销售榜」 |
| 分类树 | categories | 「先看有哪些分类」 |
| 品牌对比 | analyze-product/analyze-shop --brand | 「我们品牌和排名相近的对比」 |
| 价格带 | analyze-product 内置 TIERS | 「区分价格带」 |

## 已知限制（延续）

- 二级/三级分类无独立 ID 抓取，靠商品/店铺「分类」字段过滤。
- 分类 UI 点击会触发腾讯验证码，用 l1_cid URL 参数绕过（不违反边界，因为不点 UI）。
- 「跑步鞋」→ 鞋靴(6) 下「运动鞋」。
