# FastMoss RPA 代码架构说明

本目录是 FastMoss 网页数据采集的 RPA 实现，通过已登录的浏览器操作页面 DOM，不接入 FastMoss API、不导出 Cookie。

## 一、分层架构

```
scripts/rpa/
├── fastmoss-rpa.mjs      # 入口层：命令行入口 + 命令分发（不写业务逻辑）
├── lib/                  # 复用层：浏览器、页面数据跟踪、店铺读取、纯日期比较等
└── commands/             # 业务层：各业务域的命令（只依赖 lib 与同层工具）
```

**依赖方向**：入口调用业务命令，命令复用 `lib/` 与数据规则；lib 不调用完整业务命令。需要共享商品榜等读取能力时可以复用领域采集函数，避免互相启动完整命令、重复创建浏览器。

## 二、目录职责

### 入口 `fastmoss-rpa.mjs`

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
| `shop.mjs` | 店铺名核验、总览、页面可见商品清单与分页 | `resolveShopId` `grabShopOverview` `collectShopProducts` |
| `trend.mjs` | 日期连续性与两个等长周期比较（无浏览器依赖） | `validateCompareDays` `comparePeriod` |

### 业务 `commands/`

| 文件 | 命令 | 说明 |
|---|---|---|
| `product.mjs` | `product` `product-roi` `category-roi` | 商品榜 / 商品投流ROI / 品类ROI一条龙 |
| `new-products.mjs` | `new-products` | 新品榜三日数据，ID去重、分页状态、分类核验与部分结果保存 |
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
- 多数 `analyze*.mjs` 为离线分析脚本（读已抓取的JSON出报告）；需要补抓的脚本在下方单独注明。
- `analyze-phonecase-trend.mjs`：包含详情补抓，默认使用无界面浏览器，不能当纯离线脚本；输入目录可配置。`lib/product-trend.mjs` 为它与两种报告共用的纯趋势规则。
- `render-phonecase-report*.mjs`：读取 `--file` 或 `--dir` 指定的结果，动态生成报告；导入模块不会执行CLI或开启浏览器。
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

1. **默认无界面，前台须显式选择**：所有 `openBrowser` 调用写成 `headed: opts.headed === true || opts.headed === 'true'`。验证、登录和权限阻挡快速报错并保存可用进度，不在后台等待人工或自动打开窗口。
2. **浏览器上下文统一关闭**：命令函数自己 `await context.close()` 关闭（正常路径），`main` 的 `finally` 兜底关闭所有存活上下文。
3. **并发要克制**：列表页可高并发（数据量小、SPA 缓存）；详情页（达人 4 表、商品投流）必须串行——后台 tab 被 Chromium 降频会导致懒加载丢数据，实测并发 3 丢约 40%。
4. **金额解析**：页面金额有万/亿缩写，用 `parseAmount`（`data-rules.mjs`）；计算 ROI 与平台 ROAS 分别保留，不反推。
5. **登录态是共享的**：`.browser-profile` 同一时间只跑一个进程；反复启停后登录态可能失效，重跑 `login-window.mjs`。
6. **跟踪页面自然请求**：先建立 `makeTracker(page, endpoint, params)` 再导航或点击；换商品/页码/周期前 `reset(nextParams)`。代次在 request 事件绑定，过期响应、失败HTTP响应和同名Summary端点不能写入当前结果。`dispose` 解除 request/response 监听。不得主动重发签名接口请求。
7. **先验证口径再计算**：`comparePeriod` 按日期排序，只有连续完整的两个周期才计算，数据不足时 `complete=false`、数值为null；产品沿用店铺截止日。商品清单中零销量不能提前过滤，分页与历史覆盖单独记录。
8. **复用已加载首屏**：商品榜统一 `openProductBoard`，显式日期未生效即失败；首屏直接提取，后续页才用 `grabProductPage`。店铺搜索复用当前页面，按新搜索响应和店铺名确认结果，不固定睡眠再取第一条。

## 五、测试

```
node --test scripts/rpa/cli.test.mjs scripts/rpa/data-rules.test.mjs scripts/rpa/lifecycle.test.mjs scripts/rpa/product-roi.test.mjs scripts/rpa/tracker.test.mjs scripts/rpa/shop-analysis.test.mjs scripts/rpa/workflow.test.mjs
```

| 测试文件 | 覆盖 |
|---|---|
| `data-rules.test.mjs` | 金额解析、模块加载判定 |
| `product-roi.test.mjs` | ROI 计算、参数校验、真实 headless DOM、批量持久化/风控停止 |
| `lifecycle.test.mjs` | 所有命令延迟成功/失败后再关闭上下文、headed opt-in |
| `cli.test.mjs` | 参数校验在浏览器启动前失败 |
| `tracker.test.mjs` | 请求代次、旧响应乱序、目标参数、关闭后的响应及HTTP失败 |
| `shop-analysis.test.mjs` | 完整日期窗口、零销量下跌、跨品类门槛、未知金额、样本结论和部分结果保存 |
| `workflow.test.mjs` | 本地页面实测首屏只访问一次、日期生效、店铺名核验、商品分页、后台验证码中止 |

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
| 店铺对比最低售价（默认不限） | `--min-price`（站点币种） | `--min-price 50` |
| 显式排除商品词（默认不排除） | `--exclude-keywords` | `--exclude-keywords 鞋垫,鞋带,insole` |

`shop-trend --days` 只支持1到45；`--pages` 在此命令表示商品分页上限。结果 `status=partial` 或 `coverage.comparison_complete=false` 时，只能给已采集样本结论。即使页面可见90天清单完整，也不声称包含平台未展示的历史商品。旧的 `sold_28d/amount_28d` 字段仅在商品清单周期确认为28天时填写，其余周期用 `listed_units/listed_gmv/listing_period_days`。

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
