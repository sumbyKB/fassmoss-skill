# 单次调用采完多页：把21秒/页压到2.4秒/3页

问题：本技能每次浏览器工具调用约21秒，翻页由助手逐页点击，5页任务光往返就100秒以上。

## 测量（同一已登录标签页，不调 FastMoss API）

| 项目 | 耗时 |
| --- | --- |
| 空表达式 `1+1` 往返 | 0.37s |
| 整表读取（11行12列） | 0.10s |
| 3页连采（页内循环） | 2.4s |

结论：21秒花在「一次工具调用=一个模型回合」，不是DOM。所以优化方向是把回合数压到1，而不是把单次调用调快。

## 三种等待策略实测（达人带货榜，3页）

| 策略 | 墙钟 | 唯一达人ID |
| --- | --- | --- |
| 每页固定等4.2s | 8.5s | 30 |
| 轮询首行ID变化（采用） | 2.4s | 30 |
| 完全不等待 | 0.5s | 10（三页同一页） |

**等待判据必须是稳定ID**：翻页瞬间先渲染骨架，innerText 150ms 内就变但数据未到；用文本当信号会立刻抓走旧数据，产生「快但错」。采用「首行 detail 链接ID变化 + 连续两次轮询不变」，实测每页0.8–1.0秒。

## 改动

- 新增 `scripts/collect-pages.mjs`：`pagesScript({maxPages,pollMs,timeoutMs})` 返回一段JS，一次调用完成多页点击→稳定等待→提取→按ID去重→返回单载荷；`toPoolRecords(payload)` 转成入库记录，附 `coverage/pages_read/raw_rows/unique_ids/rows_without_id/waits`。同ID字段冲突直接报错，无ID行单独计数不猜。
- 新增 `scripts/test-collect-pages.mjs`：3 个测试（跨页去重、无ID计数、脚本生成参数与可解析性）。
- `references/fast-execution.md`：新增「单次调用采完多页」章节；修订「减少调用」第2条与「时延预算」，明确21秒属往返成本、翻页交 `pagesScript()`。
- `SKILL.md` 第5步、`README.md`（自检与脚本说明）同步。

## 验证

- 真实页面：`pagesScript({maxPages:3})` → 3页、30个唯一ID、2.4秒、`stop_reason=maxPages`、每页等待818/933ms且 `settled=true`。
- 自检：`python -m unittest discover -s scripts -p "test_*.py"` 9/9；`node scripts/test-bulk-page.mjs` 1/1；`node scripts/test-collect-pages.mjs` 3/3。
- 未验证：详情页（视频/直播/商品模块）尚未改为单次调用；导出按钮路径未测；账号额度限制仍在（cid=41 达人分类）。

VERDICT:
FILES_REVIEWED:
  - scripts/collect-pages.mjs: 全文件（新增）
  - scripts/test-collect-pages.mjs: 全文件（新增）
  - references/fast-execution.md: 相关章节（修改）
  - SKILL.md: 第5步（修改）
  - README.md: 自检命令与脚本说明（修改）
CHECKS:
  - node scripts/test-collect-pages.mjs: PASS (3/3)
  - python unittest discover: PASS (9/9)
  - 真实页面3页采集: PASS，30个唯一ID，2.4秒
  - 不等待对照: FAIL 预期失败，仅10个唯一ID（说明稳定等待不可省）
CODE:
  > const payload = await evaluateInTab(pagesScript({maxPages: 5}));
  > const {records, meta} = toPoolRecords(payload);
VALIDATION:
  APPROVED — score: 1.0, complete: false, missing: [详情页单次调用, 导出路径实测]
retry_budget: 3 remaining: 3
