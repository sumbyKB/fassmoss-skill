# 新增 category-roi 命令 + 提速优化（2026-11-10）

## 目标

把「抓商品榜 → 过滤目标品类前N → 逐个投流ROI → 优势报告」整条链路固化成一个命令，以后只改变量即可复用。

## 改动

1. **新增 `category-roi` 子命令**（`scripts/rpa/fastmoss-rpa.mjs`）：
   - `cmdCategoryRoi`：串行抓榜 → 按 `--category` 关键词过滤 → 取前 `--top` → 逐个抓投流 ROI → 出报告。
   - `renderCategoryRoiReport`：数据驱动报告，自动生成优势标签（投流效率冠军/投流规模最大/周销量冠军/高客单/低价走量/品牌矩阵）+ 类目洞察（ROI 区间、品牌格局、路线分化），全部由数据算出，不硬编码。
   - `parsePriceMid`：价格区间取中位数。
   - **自动补 l1_cid**：只给 `--category-id2` 时，从 categories.json 查 parent_code 自动补一级 ID（FastMoss 的 l2_cid 筛选缺 l1_cid 会翻页失效，实测只抓到 10 个而非 60 个）。

2. **提速优化**（`product-roi.mjs`）：
   - 砍掉 `waitProductAds` 的「连续两次快照相同」稳定等待，首次读到 gmv+ad_spend 即返回。
   - 超时 15s→8s、轮询间隔 200ms→100ms。
   - `scrapeProductRoi` 点击「投流分析」前先等 h1 渲染，点击后 waitForFunction 等 `#putData label[aria-label]` 出现（修复 SPA 时序 bug）。

3. **并发能力**：`cmdProductRoi` 支持 `--concurrency N`（复用 `poolWithPage`），默认 1 串行。**实测并发 4 会丢 1 个（后台 tab 降频），商品 ROI 建议保持串行**。

## 用法

```bash
node scripts/rpa/fastmoss-rpa.mjs category-roi --country 美国 --category-id2 909320 --category 耳机 --top 10 --days 7 --pages 6 --period 28 --headed true --out outputs/xxx/耳机前10ROI.json
```

## 验证

- 美区耳机前10：`--category-id2 909320 --category 耳机`（自动补 l1_cid=16），榜单抓 59 个、命中耳机 28 个、取前 10，10/10 ROI 全部 ok，与之前手动流程结果完全一致（ROI 2.14～2.27）。
- 全程 32 秒（抓榜 + 过滤 + 10 个商品 ROI）。
- 报告自动识别：周销量冠军 HTC NE76、投流效率冠军 HTC NE79 短柄、投流规模最大 Monster AC530、低价走量 CCSales、品牌矩阵 SoundWave×2。

## 环境坑（复现确认）

- headless 触发风控，必须 `--headed true`。
- 同一 `.browser-profile` 反复启停后登录态易失效，报「未登录」，需重新 `login-window.mjs` 登录。
- `switchCountry` 读国家按钮无重试，`/e-commerce/search` 页面渲染慢时偶发「找不到国家切换按钮」，重试即可。
