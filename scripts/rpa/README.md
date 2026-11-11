# FastMoss RPA 代码架构说明

本目录是 FastMoss 网页数据采集的 RPA 实现，通过已登录的浏览器操作页面 DOM，不接入 FastMoss API、不导出 Cookie。

## 一、分层架构

```
scripts/rpa/
├── fastmoss-rpa.mjs      # 入口层：命令行入口 + 命令分发（不写业务逻辑）
├── lib/                  # 基础设施层：可复用的通用能力（不涉及具体页面）
└── commands/             # 业务层：各业务域的命令（只依赖 lib 与同层工具）
```

**依赖方向是单向的**：`fastmoss-rpa.mjs → commands/ → lib/`。lib 不依赖 commands，commands 之间不互相依赖（各自独立），这是保证「不屎山」的核心约束。

## 二、目录职责

### 入口 `fastmoss-rpa.mjs`（124 行）

- 顶部 `/** ... */` 注释块是 `help` 命令的输出内容（所有命令的用法说明），改命令时同步更新这里。
- `HANDLERS` 映射表登记「命令名 → 处理函数」。
- `main()` 负责：解析参数 → 查表分发 → `finally` 统一关闭所有浏览器上下文（防资源泄漏）。

### 基础设施 `lib/`

| 文件 | 职责 | 关键导出 |
|---|---|---|
| `config.mjs` | 路径常量、国家/币种映射、region 映射 | `BASE` `SKILL_ROOT` `PROFILE_DIR` `COUNTRIES` `COUNTRY_LABELS` `REGION_BY_LABEL` `resolveCountry` |
| `cli.mjs` | 命令行参数解析、时间戳日志 | `parseArgs` `log` |
| `browser.mjs` | 浏览器生命周期、登录检测、国家切换 | `openBrowser` `safeEval` `assertLoggedIn` `switchCountry` `activeContexts` `enableImages` |
| `pool.mjs` | 并发执行池（通用 + 页面复用） | `pool` `poolWithPage` |
| `categories.mjs` | 分类名 → 分类 ID 匹配 | `CATEGORY_ALIASES` `resolveCategoryId` |
| `report.mjs` | 报告工具函数（markdown 转义/金额/百分比） | `cell` `short` `money` `pct` |
| `tracker.mjs` | 接口响应跟踪（监听签名接口数据） | `makeTracker` `makeMultiTracker` `waitTracked` |
| `shop.mjs` | 店铺共享函数（搜索拿ID/抓总览8项） | `resolveShopId` `grabShopOverview` |

### 业务 `commands/`

| 文件 | 命令 | 说明 |
|---|---|---|
| `product.mjs` | `product` `product-roi` `category-roi` | 商品榜 / 商品投流ROI / 品类ROI一条龙 |
| `influencer.mjs` | `search` `detail` `pipeline` | 达人搜索 / 达人详情 / 达人一条龙 |
| `shop.mjs` | `shop` `shop-detail` `shop-detail-report` | 店铺榜 / 店铺详情 / 店铺详情报告 |
| `shop-trend.mjs` | `shop-trend` | 店铺近N天 vs 上个N天涨跌 + 商品归因 |
| `shop-compare.mjs` | `shop-compare` | 某类目GMV前N店铺对比（GMV/价格/佣金/达人） |
| `shop-authors.mjs` | `shop-authors` | 竞品店铺带货达人挖取（粉丝/GMV/GPM） |
| `shop-insight.mjs` | `shop-insight` | 店铺六维洞察（品类/达人/成交/价格/视频/直播） |
| `live.mjs` | `live` `live-detail` | 直播搜索 / 直播详情 |
| `video.mjs` | `video` | 视频搜索（含 TikTok 链接） |
| `ad.mjs` | `ad` | 广告创意中心采样 |
| `categories.mjs` | `categories` | 分类树抓取 |
| `country.mjs` | `country` | 独立国家切换 |

### 其他

- `product-roi.mjs`：商品 ROI 的纯函数（参数解析、DOM 快照、计算、报告渲染），被 `commands/product.mjs` 复用。
- `data-rules.mjs`：通用数据规则（金额解析、箱包正则、模块加载判定），无业务依赖。
- `analyze*.mjs`：离线分析脚本（读已抓取的 JSON 出报告），不启动浏览器。
- `login-window.mjs` / `run-background.mjs` / `setup.mjs`：登录窗口、后台启动器、playwright 安装器。

## 三、新增一个命令的步骤（只改一处）

命令清单以 `fastmoss-rpa.mjs` 的 `HANDLERS` 为**唯一权威来源**，`run-background.mjs` 和测试都从它 import `COMMAND_NAMES`，不用重复维护清单。

1. 在对应业务的 `commands/*.mjs` 里写 `export async function cmdXxx(opts) {...}`。
   - 浏览器统一用 `openBrowser({ headed: opts.headed === true || opts.headed === 'true' })`（必须显式 headed 开关）。
   - 登录检测、国家切换、并发池、报告工具分别从 `lib/browser.mjs`、`lib/pool.mjs`、`lib/report.mjs` 复用，不要重写。
2. 在 `fastmoss-rpa.mjs` 的 `HANDLERS` 里登记 `xxx: cmdXxx`（`COMMAND_NAMES` 自动同步）。
3. 更新 `fastmoss-rpa.mjs` 顶部 `/** */` 注释块里的命令说明（否则 help 里看不到）。

搜索条件一律写成 `opts.xxx`（变量），不要硬编码店铺名/类目/国家/日期/数量。

## 四、关键约定（务必遵守）

1. **无界面采集必须显式 `--headed` opt-in**：所有 `openBrowser` 调用必须写成 `headed: opts.headed === true || opts.headed === 'true'`（有测试强制约束）。
2. **浏览器上下文统一关闭**：命令函数自己 `await context.close()` 关闭（正常路径），`main` 的 `finally` 兜底关闭所有存活上下文。
3. **并发要克制**：列表页可高并发（数据量小、SPA 缓存）；详情页（达人 4 表、商品投流）必须串行——后台 tab 被 Chromium 降频会导致懒加载丢数据，实测并发 3 丢约 40%。
4. **金额解析**：页面金额有万/亿缩写，用 `parseAmount`（`data-rules.mjs`）；计算 ROI 与平台 ROAS 分别保留，不反推。
5. **登录态是共享的**：`.browser-profile` 同一时间只跑一个进程；反复启停后登录态可能失效，重跑 `login-window.mjs`。

## 五、测试

```
node --test scripts/rpa/*.test.mjs
```

| 测试文件 | 覆盖 |
|---|---|
| `data-rules.test.mjs` | 金额解析、模块加载判定 |
| `product-roi.test.mjs` | ROI 计算、参数校验、真实 headless DOM、批量持久化/风控停止 |
| `lifecycle.test.mjs` | 命令登记覆盖、headed opt-in、资源关闭 |
| `cli.test.mjs` | 参数校验在浏览器启动前失败 |

改代码后先 `node --check` 再跑测试，保证不回归。

## 六、搜索条件变量规范（通用化原则）

**所有搜索条件都是变量，禁止写死。** 命令里凡涉及"搜什么、在哪搜、搜多少"，一律走 `--参数`，不得硬编码店铺名/类目/国家/日期/数量。

### 通用参数（所有命令一致）

| 参数 | 含义 |
|---|---|
| `--country` | 国家站点（泰国/美国/印尼…，中英文名均可） |
| `--headed` | 是否可见窗口（`true`/`false`，默认无界面） |
| `--out` | 输出 JSON 路径（缺省自动生成到 outputs/） |

### 各搜索条件对应参数（按语义）

| 搜索条件 | 参数 | 示例 |
|---|---|---|
| 店铺 | `--shop` / `--shop-id` | `--shop Steapex` |
| 类目 | `--category`（中文名自动匹配 ID）/ `--category-id` / `--category-id2` | `--category 运动鞋` |
| 国家 | `--country` | `--country 泰国` |
| 前 N 名 | `--top` | `--top 10` |
| 周期天数 | `--days` / `--period` | `--days 30` |
| 页数 | `--pages` | `--pages 15` |
| 关键词 | `--keyword`（别名 `--words`/`--kw`） | `--keyword earbuds` |
| 粉丝区间 | `--follower` | `--follower 20000,100000` |
| 日期范围 | `--start` / `--end` | `--start 2026-10-09 --end 2026-11-09` |
| 排序 | `--sort` | `--sort gmv` |
| 品类关键词（pipeline 达人筛选） | `--category-keyword`（默认箱包，可传任意品类多语关键词） | `--category-keyword "运动鞋,sneakers,รองเท้า"` |
| 基准店铺（对比） | `--benchmark` | `--benchmark Steapex` |
| 并发数 | `--concurrency` / `--detail-concurrency` | `--concurrency 6` |

### 换搜索条件 = 改参数，不改代码

同一个命令，换国家/类目/前N 只改变量即可。例：

```bash
# 查运动鞋前10店铺
... shop-compare --category 运动鞋 --country 泰国 --top 10
# 换箱包前20，只改参数
... shop-compare --category 箱包 --country 泰国 --top 20
# pipeline 挖箱包达人 → 换运动鞋达人，只加品类关键词
... pipeline --category-keyword "运动鞋,sneakers,รองเท้า"
```

### 新增命令时

搜索条件一律写成 `opts.xxx`（或 `opts['xxx']`），在文件顶部注释里写明参数含义与示例；错误提示用占位符 `<店铺名>` 而非具体值。
