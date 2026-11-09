# 2026-11-09 美国站箱包测评达人筛选与历史拆解

## 条件与范围

用户要求：在美国站 FastMoss 找「粉丝 5,000–50,000、包包类目、常做测评、近30天挂车转化不错、报价 ≤8k」的达人，推荐 10 位；并对每人做历史带货拆解（客单价、转化率、退货率、评论舆情）、预测投产潜力、统计竞品合作频次与效果。

本次实操参数：
- 站点：美国站（用户确认；`button "united states 美国"` 生效，页面右上角显示"美国"）。
- 硬筛选：仅看带货达人（默认勾选）、`follower=5000,50000`、`sale_category_l1=7`（箱包）。
- 周期：平台默认「近 28 天」（无 30 天选项，已披露差异）；历史明细另改用「近 90 天」。
- 币种：USD（FastMoss 美国站口径）。

## 执行路径

1. 浏览器接入：本环境无 `mcp__cua_repl`；用户日常 Chrome（136+）默认 profile 的调试端口被平台安全策略拒绝（9222 端口 `/json/list` 返回 404/空），改为「独立 profile + playwright-cli headed」方案：`D:\code\codeMy\fassmoss-skill\.browser-profile`，用户手动登录一次（176****7298，旗舰版），后续全程复用登录态。playwright-cli 安装于 `D:\code\codeMy\fassmoss-skill\.tools`（本地，未污染全局）。
2. 筛选生效验证：URL `?follower=5000,50000&page=1&sale_category_l1=7`，筛选面板显示「粉丝数 5000-50000」「带货分类 箱包」；截图见 `outputs/2026-11-09-us-bags-review/evidence/search-filters-us-bags-5k-50k.png`。
3. 翻页采集：用 `scripts/collect-pages.mjs` 的同一就绪判据（首行稳定 ID 变化且连续两次不变），在单次浏览器调用内采 60 页 → 600 条唯一达人（`candidates-raw.json`，5 次翻页等待 0.76–1.06 秒）。
4. 箱包相关性：600 位中「带货品类」含包/箱的 35 位，取其中 GMV 靠前的 18 位做详情深采（总览 + 90 天视频/直播 + 商品 + TOP5 店铺）。
5. 证据落库：`build-evidence.js` 生成 10 位入围者的 `evidence/<id>.json`（视频/直播 ID + 链接 + GMV/销量/播放），再运行 `scripts/history_analysis.py` 逐人生成 `analysis/<id>/report.md` 与 `analysis.json`。
6. 报告：`outputs/2026-11-09-us-bags-review/REPORT.md`。

## 结果

- 推荐 10 位：Rachel C、Deniece、Rachel Forbes、katie、rose.shops、Treat Yoself by Kim、kay、Megan On The Run、camillelamadre、Is It Junk Or Not。
- 竞品密集度：PORTLAND LEATHER GOODS 同池命中 5 位；LOVEVOOK / IRIS & RAINBOW / Rustic Charm Bootic / COMBAT IRON 各命中 2 位。
- 投产测算：给出净贡献率与盈亏平衡 GMV 公式，按 10 位各自佣金率算出平衡 GMV（$4,783–$5,729，固定成本假设 $1,100≈¥8,000）。

## 阻碍与未验证

1. 「达人分类＝测评&产品教程」与「箱包 + 粉丝 5000–50000」组合返回 **0 结果**；单独「测评」分类在 5k–50k 美国站仅 1–2 条结果（`stop_reason: no next button`）。测评属性改由视频标题/时长/文案人工判断，报告中标为"内容推断"。
2. **报价无来源**：FastMoss 无报价字段，10 位全部"待询价"，未写成已满足 ≤8k。
3. **退货率、点击转化率**：平台不提供，保留未知；件均 GMV÷销量 与商品价格存在口径差异（如 Megan 的 $14.05 托特 GMV/销量≈$4.7），已在报告中标注为平台口径差异，不混用。
4. **评论舆情**：详情页与列表只显示评论数量，未获得正文，10 位均标记"未获得评论正文"，未做情绪比例推断。
5. 视频/直播样本为列表前 5 条（近 90 天），非全量；`products_complete` 未置 true，未将多商品场次 GMV 归因给单品。
6. 未执行任何邀约、私信、导出、付费或套餐动作。
