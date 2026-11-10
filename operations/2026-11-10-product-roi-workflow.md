# 商品 ROI 接入共享执行流程 · 2026-11-10

用户要求将已确认的商品 ROI 路径写进项目流程，方便同事复用。本次沿用现有 `product-roi` 命令及后台启动器，没有增加重复采集器、依赖或安装入口。

## 共享流程

- `SKILL.md`：按任务分流；商品 ROI 直接进入 `product-roi`，命令内完成计算和报告。Codex、Claude Code、WorkBuddy 的现有入口均读取该文件。
- `references/fast-execution.md`：补充各任务入口、首次登录、后台运行、报告检查；移除“当前环境没有 cua_repl”的过时说明，并将原有达人专用细节明确限定为达人任务。
- `README.md`：提供从项目根目录可直接复制的准备、登录、后台采集示例，以及自然语言使用示例。
- `references/natural-language.md` / `references/product-workflow.md`：补充销量分析后再采集选中商品 ROI 的步骤，分别披露销量榜和投流数据的周期。

## 实际代码衔接

原 `analyze-product.mjs` 的 `topProducts` 未输出商品ID和详情链接，无法作为 `product-roi --ids-file brand-comparison.json` 的输入。现在增加 `id` 和 `source_url` 字段，原分析字段保持兼容。没有来源的历史记录保留 null，不通过商品名称推测ID。

新增回归检查使用相同显示名称、不同字符串ID的两个商品，先运行真实销量分析脚本选择销售额Top1，再把生成的 `brand-comparison.json` 交给 ROI 参数解析，确认按选中的准确ID与链接衔接。修改前该检查报“商品ID缺失或与详情链接不一致”，修改后通过。

旧报告缺ID时，可先用原始 `products.json` 重跑离线销量分析，无需重新登录；原始商品文件也缺ID和链接时才需重新采集。

## 验证范围

本次未访问真实 FastMoss、未开启前台采集窗口、未操作鼠标或焦点。真实网站的完整后台批量采集仍未实测；此前单商品前台验证与本地无界面测试的范围不扩大。

工作区原本已有修改和删除，均予保留。CRG 未索引未跟踪的商品分析模块，相关定位使用 `rg`、源码和实际产物衔接检查作为补充。

VERDICT:
retry_budget: 3 remaining: 2
FILES_REVIEWED:
  - scripts/rpa/analyze-product.mjs: lines 220-232 (changed: export product identity)
  - scripts/rpa/product-roi.test.mjs: lines 57-76 (changed: sales-to-ROI handoff regression)
  - scripts/rpa/product-roi.mjs: lines 1-41 (reviewed: accepted input contract)
  - SKILL.md / README.md / references/fast-execution.md / references/natural-language.md / references/product-workflow.md (changed: shared workflow)
CHECKS:
  - PASS: node --test scripts/rpa/cli.test.mjs scripts/rpa/data-rules.test.mjs scripts/rpa/lifecycle.test.mjs scripts/rpa/product-roi.test.mjs (16/16)
  - PASS: node --check scripts/rpa/analyze-product.mjs
  - PASS: python -X utf8 C:/Users/Administrator/.codex/skills/.system/skill-creator/scripts/quick_validate.py D:/code/codeMy/fassmoss-skill
  - PASS: git diff --check
CODE:
  > id: p.id ?? null, source_url: p.source_url ?? null,
VALIDATION:
  APPROVED — score: 1.0, complete: true, missing: []
  Scope: shared workflow, additive product identity export, and offline handoff validation; no claim of new live background validation.
