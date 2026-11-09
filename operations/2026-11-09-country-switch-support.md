# 2026-11-09 国家站点切换支持 + 币种/金额解析修复

## 需求

用户要求把「切换国家」的能力写进 `scripts/rpa/fastmoss-rpa.mjs`，方便其他人切换国家站点（本次目标是泰国站，币种泰铢 THB）。

## 改动清单

### 1. `scripts/rpa/fastmoss-rpa.mjs`
- 新增 `COUNTRIES` 映射表：国家名（中文/英文/ISO 代码）→ `{label, currency}`，覆盖美/泰/印尼/越南/马来/菲律宾/日本/新加坡/英/德/法/西/意/墨西哥/巴西。
- 新增 `resolveCountry(raw)`：解析 `--country` 参数，未知国家抛错并列出支持列表。
- 新增 `switchCountry(page, countryKey)`：点右上角国家按钮 → 弹层点目标国 → 轮询确认生效，幂等（已是目标国则跳过）。国家选择持久化到 profile，URL 不带 country 参数，故每次抓取前显式切一次。
- 新增独立子命令 `country`：`node scripts/rpa/fastmoss-rpa.mjs country 泰国`，单独切站并持久化。
- `search` / `detail` / `pipeline` 三个子命令均接入 `--country`，自动切站并把 `meta.country` / `meta.currency` 写入产物。
- 修复 `MV()`：金额剥离货币符号（原只剥 `$`，泰铢 `฿424.17万` 解析失败），现兼容 `฿`/`Rp`/`₫`/`₱`/`¥`/`€`/`£` 等。
- `parseArgs` 支持位置参数（`opts._`），`country 泰国` 可直接传。

### 2. `scripts/rpa/analyze.mjs`
- 新增 `--currency` 参数；默认自动读 `details.json`/`candidates.json` 的 `meta.currency`，兜底 USD。
- 新增 `CURRENCY_SYMBOL` 映射与 `symbolOf()`，报告金额符号随币种切换（`$`/`฿`/`Rp`/`₫` 等）。
- 修复 `num()` / `priceMid()`：剥离全部货币符号，泰国站金额正确解析。
- evidence 里的 `currency` 字段改为实际币种，不再硬编码 USD。

### 3. 文档
- `SKILL.md` 新增「国家站点切换」章节（命令示例 + 支持国家/币种表 + 泰国站注意）。
- `README.md` 常用命令补充 `country` 子命令与 `--country` 示例。

## 验证

- `node scripts/rpa/fastmoss-rpa.mjs country 泰国` → 「已切换到泰国站（币种 THB）」，美国↔泰国双向切换均验证通过。
- 金额解析：`฿424.17万` → `4241700`，`$83.27万` → `832700`，`฿1,234` → `1234`。
- 两个脚本 `node --check` 语法通过。

## 泰国站关键事实（实测）

- 泰国站 URL 仍是 `www.fastmoss.com/zh/influencer/search?...`，`/th` 只是泰语界面语言；国家站点通过右上角国家按钮切换，选择持久化到登录态（profile），URL 不带 country 参数。
- 箱包类目泰国站同样用 `sale_category_l1=7`（已实测生效，筛选面板显示「箱包」）。
- 泰国站金额单位泰铢 `฿`，列表列结构与美国站完全一致（达人信息/带货品类/近28天总销量/近28天总销售额/近28天销量趋势/近28天视频平均播放量/粉丝数/近28天涨粉数/互动率/赞粉比/首次视频发布时间/操作）。
- 泰国站达人 ID 为字符串（如 `jornormode`、`babykuzbell`），不是纯数字，详情 URL 仍为 `/influencer/detail/<id>`。
