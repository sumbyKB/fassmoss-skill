# 2026-11-09 逻辑通顺性检查 + 分类精确匹配重构 + 无用代码清理

## 需求

用户要求：多检查几次，确保大白话逻辑对各类输入（跑鞋、护肤品、衣服、不同店铺名）通顺，并移除无用代码。

## 关键突破：分类树接口 + 分类自动匹配

### 1. 找到完整分类树接口
`/api/shop/V3/categoryInfo`（店铺页）返回**完整分类树**：30 个一级分类 + 249 个二级分类，每个含 `c_code`（分类 ID）。这是决定性突破——之前用 UI 点击抓分类，只能稳定抓到 1-4 个，现在接口一次抓全。

### 2. 重写 `categories` 命令
从"UI 点击监听 l1_cid"改为"直接读 categoryInfo 接口"（page.on('response') 同步捕获 body，避开 SPA 二次跳转清理问题）。稳定输出 30 一级 + 249 二级。

### 3. 新增 `--category 分类名` 自动匹配
`resolveCategoryId()`：读 categories.json → 同义词归一（CATEGORY_ALIASES）→ 精确匹配一级 → 精确匹配二级 → 模糊匹配。返回 l1_cid 或 l2_cid。

### 4. 新增 `--category-id2`（l2_cid 二级分类筛选）
实测 saleRank 接口支持 l2_cid 参数（URL 直接传有效，前端点击二级不触发请求但 URL 参数有效）。

## 验证结果

### 分类自动匹配（25/27 常见词通过）
- 跑步鞋/跑鞋 → 运动鞋(二级 l2_cid=834696)，其下三级才叫"跑步鞋"
- 护肤品/护肤 → 美容护肤(二级)；化妆品 → 美妆(二级)
- 衣服/服装/女装 → 女装与女士内衣(一级)；男装、包包→箱包、鞋子→鞋靴、手机→手机与数码、家居→居家日用、食品→食品饮料、宠物→宠物用品 等全部精确匹配
- 帐篷/面膜（三级分类词）不在分类树一二级，回退"抓全量+关键词过滤"，可接受

### 端到端跑步鞋实测
`--category 跑步鞋` → 自动匹配"运动鞋"(l2_cid=834696) → 抓 100 商品（跑步鞋×24 等）→ analyze 出 40 跑步鞋商品、20 品牌（Mc Jeans/ONKE/Xtep特步/Steapex/CAMEL CROWN骆驼）、3 价格带。

### 品牌匹配
双向模糊（contains），短词/全名都能匹配；未匹配降级为全品牌榜，不报错。

## 无用代码清理

删除：
- `scripts/test-*.mjs` / `test_*.py`（5 个测试文件）
- `scripts/bulk-page.mjs` / `collect-pages.mjs`（已被 RPA 取代）
- `scripts/__pycache__/`
- 临时测试产物 `outputs/_test-*`

保留：`creator_pool.py`、`history_analysis.py`（达人池+历史分析，多处引用）、`rpa/` 全部。

## 最终架构（干净）

```
scripts/
  creator_pool.py          # 本地达人池
  history_analysis.py      # 历史带货分析
  rpa/
    fastmoss-rpa.mjs       # 主命令：search/detail/pipeline/product/shop/categories/country
    analyze.mjs            # 达人分析
    analyze-product.mjs    # 商品分析（品类/品牌/价格带）
    analyze-shop.mjs       # 店铺分析
    setup.mjs / login-window.mjs
references/
  natural-language.md      # 大白话路由
  product-workflow.md      # 商品分析手册
  ...（其余场景手册）
```
