# 代码规范化/组件化重构（2026-11-10）

## 目标

消除 2394 行的「上帝文件」`fastmoss-rpa.mjs`，按职责拆分成可维护的模块。

## 拆分结果

```
scripts/rpa/
├── fastmoss-rpa.mjs      # 纯入口：头部注释(help) + HANDLERS 映射表 + main 分发 + finally 关闭 context（124 行）
├── lib/                  # 共享基础设施
│   ├── config.mjs        # 路径常量、COUNTRIES、COUNTRY_LABELS、REGION_BY_LABEL、resolveCountry
│   ├── cli.mjs           # parseArgs、log
│   ├── browser.mjs       # loadPlaywright、openBrowser、safeEval、assertLoggedIn、switchCountry、activeContexts
│   ├── pool.mjs          # pool、poolWithPage
│   └── categories.mjs    # CATEGORY_ALIASES、resolveCategoryId
└── commands/             # 业务命令（按域拆分）
    ├── product.mjs       # product / product-roi / category-roi（+ renderCategoryRoiReport）
    ├── influencer.mjs    # search / detail / pipeline
    ├── shop.mjs          # shop / shop-detail / shop-detail-report
    ├── live.mjs          # live / live-detail
    ├── video.mjs         # video
    ├── ad.mjs            # ad
    ├── categories.mjs    # categories
    └── country.mjs       # country
```

## 规范化改进

1. **消除重复**：`region` 映射（国家→region 参数）在多处重复，提取为 `config.mjs` 的 `REGION_BY_LABEL`；`switchCountry` 里硬编码的国家列表改为 `COUNTRY_LABELS`。
2. **单一职责入口**：命令分发从 15 个 if 分支改为 `HANDLERS` 映射表，新增命令只需登记一处。
3. **修复回归**：`cmdProductRoi` 之前改 `poolWithPage` 时丢失了「遇到风控停止后续访问」的 break 语义，已恢复（worker 里 `if (meta.stopped_reason) return`）。
4. **补漏**：`run-background.mjs` 命令白名单补充 `category-roi`。

## 验证

- 全量语法检查：14 个文件全部通过 `node --check`。
- 测试：16/16 通过（data-rules 2 + lifecycle 3 + product-roi 13 中 13 + cli 3）。
- 入口：help 输出、未知命令报错、参数校验（浏览器启动前失败）均正常。
- 测试适配：`lifecycle.test.mjs` 改为跨 `commands/*.mjs` 检查 headed opt-in + HANDLERS 覆盖；`product-roi.test.mjs` 测试 13 改从 `commands/product.mjs` 提取 `cmdProductRoi`。

## 说明

- 命令调用方式完全不变（`node scripts/rpa/fastmoss-rpa.mjs <cmd> ...`）。
- 分析脚本（analyze*.mjs）和 python 脚本（creator_pool.py / history_analysis.py）未动，它们本就 <600 行、职责清晰。
