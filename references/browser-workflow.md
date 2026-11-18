# 浏览器操作与故障经验

优先使用环境提供的浏览器工具连接用户现有已登录标签页。当前会话使用 `mcp__cua_repl` 的 `cua.getTab`、`click`、`setValue`、`getAXState` 和 `getScreenshot`，按工具实际文档操作；其他人的环境需自行确认可用工具，不假设安装了同一扩展。

## 已验证步骤

1. 打开达人搜索页，确认国家及“仅看带货达人”开关。
2. 打开“粉丝数 不限”，观察最小值、最大值及确认按钮。
3. 分别填写 `20000` 和 `100000`，读回输入框值。
4. 点击“确定”，观察条件变为 `20000-100000`，结果表刷新。
5. 此次成功后的页面为 `https://www.fastmoss.com/zh/influencer/search?shop_window=1&follower=20000%2C100000&page=1`。这是已观察到的参数例子；其他筛选参数需先通过实际页面获取，不猜测。

## 本次连接经验

- 单次操作约21秒，页面状态读取约43秒。把多次操作与读状态塞入30或60秒调用，曾导致整次调用超时并丢失会话变量。
- 后来逐次调用点击、填写、观察，给单次调用足够时间，成功完成筛选。这只是本环境的经验，不是平台固定性能。
- 超时不等于点击失败：前面点击已实际展开筛选框，必须重新观察后继续。
- 曾出现无法附着浏览器调试连接；后来恢复。不能断言仅靠切前台或重新授权就必然解决。
- 若工具明确要求本轮停止，立即停止，不换控制方式绕过。记录准确阻碍，不把未验证动作说成成功。
- 已观察的URL、标签页ID、控件编号都可能变化。新会话重新发现，禁止硬编码本人的标签页、账号或联系方式。

每个阶段保存足以核实筛选和结果的截图到当前任务输出目录（工具支持时），不要重复收集无关页面。

## 箱包组合筛选（2026-11-09已验证）

保留粉丝区间，打开“带货分类 全部”，选择“箱包”，页面条件显示箱包并刷新结果。实际观察参数为 `sale_category_l1=7`。第一页10条已读取。列表可能包含众多跨类目达人，且总销量/GMV不是已验证的箱包销量/GMV；需详情证据判断类目垂直度与箱包实际表现。

## 国家站点切换（重要）

FastMoss 达人搜索默认美国站，国家切换通过右上角「国家按钮 → 弹层选国家」完成，**选择结果持久化到登录态（.browser-profile），URL 上不带 country 参数**，所以每次抓取前都要显式切一次（幂等，已是目标国则跳过）。

```bash
# 单独切站（持久化，供其他人先切站再用别的子命令）
node scripts/rpa/fastmoss-rpa.mjs country 泰国      # 泰国站，币种自动切 THB
node scripts/rpa/fastmoss-rpa.mjs country 美国      # 回美国站，USD

# 抓取时顺带切站（推荐，一条命令搞定）
node scripts/rpa/fastmoss-rpa.mjs pipeline --country 泰国 --follower 2000,50000 --category 7 --pages 60 --top 10
node scripts/rpa/fastmoss-rpa.mjs search --country 印尼 --follower 5000,50000 --category 7 --pages 30
node scripts/rpa/fastmoss-rpa.mjs detail --country 越南 --ids-file ids.json
```

> **pipeline 品类通用化**：pipeline 默认筛「箱包」达人；找其他品类达人时用 `--category-keyword "运动鞋,sneakers,รองเท้า"`（逗号分隔的多语关键词），无需改代码。


支持国家与币种（可用别名以 scripts/rpa/lib/config.mjs 的 COUNTRIES 为准）：美国(us/USD)、泰国(th/THB)、印尼(IDR)、越南(VND)、马来西亚(MYR)、菲律宾(PHP)、日本(JPY)、新加坡(SGD)、英国(USD)、德国(USD)、法国(USD)、西班牙(USD)、意大利(USD)、墨西哥(MXN)、巴西(BRL)。币种会自动写入产物 meta（`candidates.json` / `details.json` 的 `meta.currency`、`meta.country`），`analyze.mjs` 会读取该币种自动切换报告金额符号（`$`/`฿`/`Rp`/`₫` 等），也可显式 `--currency THB` 覆盖。

> **泰国站注意**：金额单位是泰铢 `฿`，脚本 `MV` 与 `analyze.mjs` 的 `num()` 金额解析对「万」和「฿」符号都兼容（`num()` 会剥离 `$`/`+`/空格，泰国站列表金额形如 `฿424.17万` 会被正确解析为 424.17 万泰铢）。
