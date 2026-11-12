---
name: fassmoss-skill
description: 用大白话操作已登录的 FastMoss，抓取 TikTok 达人历史带货、商品销售与商品详情投流ROI、店铺数据和分类树。适用于 FastMoss 网页操作，不接入 FastMoss API。
---

# FastMoss 数据助手（大白话驱动）

正常采集默认后台无界面运行。需进程脱离当前终端时使用 `node scripts/rpa/run-background.mjs <子命令及参数>`，返回PID和日志路径；启动成功仅表示进程已创建，任务完成以日志及输出文件核验。首次登录或登录过期时运行 `node scripts/rpa/login-window.mjs` 完成人工登录，关闭登录窗口后再采集。同一 `.browser-profile` 同时只运行一个采集或登录进程。调试可显式传 `--headed true` 打开采集窗口。

**业务说大白话，本技能拆解成命令抓数据。** 先读 [references/natural-language.md](references/natural-language.md) 的「大白话 → 命令」路由表，识别用户要的是**达人 / 商品 / 店铺 / 分类**哪类数据，再执行对应子命令。

默认按 [references/fast-execution.md](references/fast-execution.md) 的任务入口执行 RPA：`scripts/rpa/fastmoss-rpa.mjs` 采集落盘。商品 ROI 的 `product-roi` 命令内含计算和报告；其它任务按入口表运行对应 `analyze*.mjs`。速度不能替代数据核验。

## 任务入口一览

| 要什么 | 抓取命令 | 分析脚本 | 产出 |
|---|---|---|---|
| 达人（搜索/详情/历史带货） | `search` / `pipeline` / `detail` | `analyze.mjs` | 推荐名单 + 多维度报告 |
| 商品榜（品类/品牌/价格带） | `product` | `analyze-product.mjs` | brand-comparison.md |
| 新品榜（近期上架商品，三日销量口径） | `new-products` | 列表自带；近7天/趋势需进详情补抓 | new-products.json |
| 商品投流 ROI | `product-roi` | 命令内计算并出报告 | product-roi.json / product-roi.md |
| 品类 ROI 一条龙（榜→过滤→ROI→优势报告） | `category-roi` | 命令内计算并出报告 | 前NROI.json / 前NROI.md |
| 店铺榜（品牌/分类/评分） | `shop` | `analyze-shop.mjs` | shop-analysis.md |
| 店铺详情（搜索→详情→报告） | `shop-detail` / `shop-detail-report` | `analyze-shop-detail.mjs` | 店铺详情分析.md |
| 店铺趋势涨跌（近N天 vs 上个N天 + 商品归因） | `shop-trend` | 命令内计算并出报告 | shop-trend.json / shop-trend.md |
| 店铺对比（某类目GMV前N店铺，对比GMV/价格/佣金/达人） | `shop-compare` | 命令内聚合并出报告 | shop-compare.json / shop-compare.md |
| 店铺达人挖取（竞品店铺带货达人清单） | `shop-authors` | 命令内聚合出报告 | shop-authors.json / shop-authors.md |
| 店铺洞察（品类结构/达人结构/成交结构/价格分布/爆款视频/爆款直播） | `shop-insight` | 命令内聚合出报告 | shop-insight.json / shop-insight.md |
| 分类树（分类名→ID） | `categories` | — | categories.json |

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


支持国家与币种（中文名或英文/ISO 代码均可）：美国(us/USD)、泰国(th/THB)、印尼(IDR)、越南(VND)、马来西亚(MYR)、菲律宾(PHP)、日本(JPY)、新加坡(SGD)、英国(USD)、德国(USD)、法国(USD)、西班牙(USD)、意大利(USD)、墨西哥(MXN)、巴西(BRL)。币种会自动写入产物 meta（`candidates.json` / `details.json` 的 `meta.currency`、`meta.country`），`analyze.mjs` 会读取该币种自动切换报告金额符号（`$`/`฿`/`Rp`/`₫` 等），也可显式 `--currency THB` 覆盖。

> **泰国站注意**：金额单位是泰铢 `฿`，脚本 `MV` 与 `analyze.mjs` 的 `num()` 金额解析对「万」和「฿」符号都兼容（`num()` 会剥离 `$`/`+`/空格，泰国站列表金额形如 `฿424.17万` 会被正确解析为 424.17 万泰铢）。

## 商品销售分析（细分品类 / 品牌对比 / 价格带）

用户要「看细分品类销售、和竞品品牌对比、分价格带」时，执行 [references/product-workflow.md](references/product-workflow.md)。**业务说大白话，本技能拆解成变量 → 填进命令执行**。核心三步：

```bash
# 1. 抓一级分类映射（分类名 → l1_cid，含二级分类 ID，一次抓全）
node scripts/rpa/fastmoss-rpa.mjs categories --country 泰国 --out outputs/categories.json

# 2. 抓商品榜（--category 直接传大白话分类名，自动匹配分类 ID，无需手动查 ID）
node scripts/rpa/fastmoss-rpa.mjs product --country 泰国 --days 14 --category 跑步鞋 --pages 20 --out outputs/<批次>/products.json

# 3. 分析：二级细分品类 + 本品牌 vs 排名相近竞品 + 价格带分档
node scripts/rpa/analyze-product.mjs --dir outputs/<批次> --category 跑步鞋 --brand 品牌名 --top 20
```

变量清单（改一个词即复用）：

| 变量 | 参数 | 说明 |
|---|---|---|
| 国家 | `--country` | 自动切站+币种 |
| 分类 | `--category` | 大白话分类名（跑步鞋/护肤品/衣服），**自动匹配分类 ID** |
| 时间 | `--days 1/7/14/30` | 日/周/月榜 |
| 本品牌 | `--brand` | =所属店铺名 |
| 竞品范围 | `--nearby 5` | 前后各 N 名 |
| 价格带 | 内置 `TIERS` | 低价/中价/中高价/高价 |

产出 `brand-comparison.md`（按销售金额排序的品类榜 + 品牌对比 + 价格带分档）+ `brand-comparison.json`。

> **分类自动匹配**：`--category 跑步鞋` 会自动读 `categories.json`（完整分类树，含一二级 ID），先走同义词归一（跑步鞋→运动鞋、护肤品→美容护肤、衣服→女装、包包→箱包…），再精确/模糊匹配到一级 `l1_cid` 或二级 `l2_cid`。匹配不到时回退「抓全量 + 关键词过滤」。也支持显式 `--category-id <一级ID>` `--category-id2 <二级ID>` 跳过自动匹配。
>
> 存在完整分类树时，「跑步鞋」优先精确匹配三级；旧分类树缺三级时才通过别名匹配二级运动鞋。分类树接口 `/api/shop/V3/categoryInfo` 返回 30 个一级 + 249 个二级，稳定可靠。
>
> **三级分类筛选**：`categories` 命令从 `/api/live/filterInfo` 的 `data.product_category` 一次性抓全 **30 个一级 + 247 个二级 + 2370 个三级**（全带 ID），存 `categories.json` 的 `l3_categories`，和一二级一样「提前抓取、自动匹配」。商品榜 `product`、新品榜 `new-products`、视频商品榜 `hot-video` 都支持 `--category-id3 <三级ID>`（URL 参数 `l3_cid`），`--category <三级名>` 自动匹配（如「手机壳」→ 保护壳、屏幕保护膜、皮肤=601925；「移动电源」→ 910728）：
>
> ```bash
> node scripts/rpa/fastmoss-rpa.mjs product --country 美国 --category 手机壳 --days 7 --pages 20 --out outputs/x/products.json
> node scripts/rpa/fastmoss-rpa.mjs new-products --country 美国 --category 手机壳 --pages 20 --out outputs/x/newproducts.json
> node scripts/rpa/fastmoss-rpa.mjs hot-video --country 美国 --category 手机壳 --pages 20 --out outputs/x/hotvideo.json
> ```
>
> 也可显式传 ID 跳过自动匹配：`--category-id 16 --category-id2 909064 --category-id3 601925`。

## 新品榜（近期上架商品，三日销量口径）

用户要「看某类目最近上架的商品、追踪新品爬坡」时，用 `new-products` 子命令抓 FastMoss「新品榜」`/zh/e-commerce/newProducts`（导航「商品 → 新品榜」，副标题「追踪近期上架的商品」）：

```bash
# 美区手机配件（二级分类）新品榜，抓 20 页
node scripts/rpa/fastmoss-rpa.mjs new-products --country 美国 --category-id 16 --category-id2 909064 --pages 20 --out outputs/<批次>/newproducts.json

# 分类自动匹配（--category 大白话，同 product）
node scripts/rpa/fastmoss-rpa.mjs new-products --country 美国 --category 手机配件 --pages 20 --out outputs/<批次>/newproducts.json
```

抓取字段：商品ID、名称、售价区间、上架时间、店铺、分类、佣金、三日销量/销售额、累计销量/销售额及详情链接。名称与价格/日期分开保存；按商品ID去重，`observed_position` 为本次读取顺序，原始排名另存。可用 `--top N` 限制数量。空页结束、重复页标部分结果；阻挡或筛选失效时停止并保留已抓清单。输出 `meta.status/pages_visited/pages_ok/page_errors`，不能把请求页数当作实际成功页数。

> **口径（重要）**：新品榜固定「三日销量」排名，**无 `date_type`/`date_value`（不支持日/周/月切换）、无「销量环比」列**。列表「商品分类」列只显示一级分类（如「手机与数码」），不显示三级细分；分类筛选走 `--category-id`/`--category-id2`（`l1_cid`/`l2_cid` URL 参数，已验证生效，分类按钮会显示目标二级分类名）。
>
> 未提供显式分类ID时，分类名匹配失败会报错，不默默扩大为全站；显式分类ID决定页面范围，名称不作为商品全文筛选词。仅传二级ID时必须从有效分类树补齐一级ID，否则要求显式提供一级ID。新品榜不支持 `--days/--period/--date-type/--date-value`，传入会报错，不伪装为其它周期。
>
> **近7天与趋势需详情补抓**：`analyze-phonecase-trend.mjs --dir <输入目录> --top 50` 默认后台运行，读取该目录 `saleslist.json/newproducts.json`，输出 `result.json`；也可用 `--sales/--new-products/--out` 显式指定文件。仅在详情 `#overview` 确认近7天并收到同商品、同周期逐日数据后，计算该序列的最近3日与之前4日。不得用榜单三日数与另一天抓取的7日数直接相减；缺日期/指标保持未知，不根据“7日≈3日”断言商品年龄。配套Markdown/HTML报告用 `--file result.json` 或 `--dir <目录>`，共用同一趋势规则、实际样本数与元数据。

## 店铺榜分析（品牌 / 分类 / 评分）

用户要「看某类店铺销售榜、品牌对比、评分筛选」时，用 `shop` 子命令 + `analyze-shop.mjs`：

```bash
# 抓店铺榜（国家 + 分类 + 评分筛选）
node scripts/rpa/fastmoss-rpa.mjs shop --country 泰国 --category 箱包 --pages 10 --out outputs/<批次>/shops.json

# 分析：销售榜 + 分类分布 + 品牌对比
node scripts/rpa/analyze-shop.mjs --dir outputs/<批次> --category 箱包 --brand 品牌名 --top 20
```

店铺榜字段：店铺名（≈品牌）、分类、评分、近7天销量/GMV、总销量/GMV、在售商品数、带货达人数。产出 `shop-analysis.md` + `shop-analysis.json`。

> 店铺详情 URL 是 `/zh/shop-marketing/detail/<seller_id>`；「店铺名」≈品牌名（泰国品牌名常=店铺名）；金额泰铢 ฿ + 美元 $ 双币种。
> 店铺榜分类筛选用 `l1_cid`（`--category-id`），不是 `category` query；传中文分类名（`--category 运动与户外`）会自动匹配 ID。

## 店铺详情（搜索店铺名 → 进详情页 → 抓数据）

用户要「搜索某个店铺、进详情页看它的商品/达人/价格带/总览数据」时，用 `shop-detail` 子命令，一条命令完成「搜索 → 进详情 → 抓数据 → 落盘」：

```bash
# 搜索店铺名进入详情页抓数据（默认后台无界面，自动切站）
node scripts/rpa/fastmoss-rpa.mjs shop-detail --shop Steapex.Malaysia --country 马来西亚 --out outputs/<批次>/<店铺名>_detail.json

# 已知店铺 ID 直接抓（跳过搜索）
node scripts/rpa/fastmoss-rpa.mjs shop-detail --shop-id 7494233487112177345 --out xxx.json

# 一条龙：搜索 → 抓详情 → 自动生成分析报告（推荐，后续直接跑这个）
node scripts/rpa/fastmoss-rpa.mjs shop-detail-report --shop Steapex.Malaysia --country 马来西亚 --out outputs/<批次>/xxx.json
#   → 产出 JSON 数据 + 同目录 <shop名>_店铺详情分析.md

# 离线分析（对已抓的 JSON 单独出报告）
node scripts/rpa/analyze-shop-detail.mjs --file outputs/<批次>/<店铺名>_detail.json --top 20
```

抓取字段：店铺名、评分、商品价格分布、收录时间、店铺类型、TikTok账号；总览 8 项（总销量/总销售额/在售商品数/全国排名/带货直播数/带货视频数/带货达人数/分类排名）；价格带分布（0-15/15-30/30-45/45-60/60-75/>75）；商品列表（售价/分类/上架时间/佣金/近28天销量/GMV）；商品分析（在售商品数口径、品类分布、成交渠道占比、销售方式分布）。

> **商品列表口径**：默认抓「近28天有动销」的商品（含售价/分类/上架时间/佣金/销量/GMV）；店铺历史上架/在售总数另存为 `on_sell_count` 与 `product_count_note`（如"历史上架14个、当前在售14个"）。近28天无销量的商品不在列表内。

> **分析报告**：`analyze-shop-detail.mjs` 从详情 JSON 生成结构化报告，五部分：①店铺总览（8项+评分+基础信息）②商品排行（按GMV降序）③价格带分布 ④品类/成交渠道/销售方式 ⑤核心洞察（评分、销售额冠军、价格跨度、达人/视频占比，自动生成）。`shop-detail-report` 命令把抓取+分析串成一条龙。

> **注意**：采集默认无界面。出现访问验证时停止并提示用户人工处理，不自动切前台或抢焦点。只有用户明确要求演示或调试时才传 `--headed true`。

## 店铺趋势涨跌（近N天 vs 上个N天 + 商品归因）

用户要「某店铺最近 N 天总销量/GMV、跟上个 N 天比涨还是跌、哪些商品下跌/上涨」时，用 `shop-trend`。读取页面自然返回的店铺/商品近90天逐日数据，按同一截止日比较两个完整、连续、等长周期；缺日期或指标时保持未知。`--days` 为1到45的整数，默认30；店铺名、国家和天数均为变量：

```bash
# 泰国 Steapex 店铺，近30天 vs 上个30天涨跌 + 商品归因
node scripts/rpa/fastmoss-rpa.mjs shop-trend --shop Steapex --country 泰国 --days 30 --out outputs/<批次>/shop-trend.json

# 已知店铺 ID 直接抓（跳过搜索）
node scripts/rpa/fastmoss-rpa.mjs shop-trend --shop-id 7495956634965609461 --country 泰国 --days 30 --out xxx.json
```

产出 JSON + 同名 `.md`，包含真实比较日期、店铺涨跌、商品涨跌及覆盖范围。商品清单保留当前销量为0的条目，按独立商品表分页，`--pages` 是最多采集的商品页数（默认100）。能在商品表确认近90天时才按90天标记；否则保留页面实际周期。页面可见历史清单或趋势不完整时标为 `partial`，不能当作全店归因。

> **实现要点**：监听必须在页面请求发出前建立，切换商品/页码/周期前 `reset`，按ID、周期和请求代次隔离响应；不主动调用接口。命中登录、验证或权限阻挡时停止并保存已有结果，不在后台空等人工、不自动打开前台窗口。用户单独完成人工登录/验证后可重跑。

## 店铺对比（某类目 GMV 前 N 店铺逐个对比）

用户要「某类目（如运动鞋）GMV 排名前 N 的店铺，逐个对比 GMV / 爆款价格区间 / 达人数量 / 平均佣金率，找出可借鉴 vs 学不了」时，用 `shop-compare`。它抓类目商品榜（精确到二级分类 l2_cid）→ 按店铺聚合 GMV → 取前 N → 逐个搜店铺名抓达人数量 → 出对比报告。国家/类目/前N/天数/基准店铺均为变量：

```bash
# 泰国运动鞋类目，近30天 GMV 前10店铺，跟 Steapex 对比
node scripts/rpa/fastmoss-rpa.mjs shop-compare --country 泰国 --category 运动鞋 --top 10 --days 30 --benchmark Steapex --out xxx.json
```

产出 JSON + 同名 `.md`（前N店铺对比表：GMV / 价格区间 / 平均佣金 / 达人数量 / 分类排名）。

> **口径**：GMV 是已采集榜单商品的店铺汇总，周期以页面 `date_type/date_value` 为准；金额缺失的店铺不参加排名。默认不设置最低价格、不按运动鞋规则过滤其它品类。需要限制时显式传 `--min-price 50`（站点币种）或 `--exclude-keywords 鞋垫,鞋带,insole`。达人数量为店铺累计口径，佣金为已知上榜商品平均。

## 店铺达人挖取（从竞品店铺挖带货达人）

用户要「从某店铺/竞品店铺挖带货达人清单，看谁在给它带货、贡献多少」时，用 `shop-authors`。数据源是店铺详情页 `/api/shop/v3/author` 接口（返回达人昵称/粉丝/贡献GMV/销量/GPM），按贡献 GMV 排序。店铺名/国家/前N均为变量：

```bash
# 挖 Steapex 的带货达人前20（BD 挖人直接对标）
node scripts/rpa/fastmoss-rpa.mjs shop-authors --shop Steapex --country 泰国 --top 20 --out xxx.json
```

产出 JSON + 同名 `.md`（达人清单：粉丝 / 贡献GMV / 销量 / 带货商品数 / 视频GPM / 直播GPM + 达人主页链接）。

> **口径**：达人 GMV/销量为该店铺内的贡献口径（非达人全平台）；GPM 为视频/直播千次播放销售额区间。作者接口每页 5 个达人，命令会自动翻页取前 N。

## 店铺洞察（一次抓全店铺 6 大维度）

用户要「全面看透一家店铺：主营什么品类、用什么达人、怎么成交、价格怎么分布、哪些视频/直播爆款」时，用 `shop-insight`。它一次打开店铺详情页，抓 6 个分析接口，输出综合洞察报告。店铺名/国家均为变量：

```bash
node scripts/rpa/fastmoss-rpa.mjs shop-insight --shop Steapex --country 泰国 --out xxx.json
```

产出 JSON + 同名 `.md`，六部分：①品类结构（二级/三级分类销量占比）②达人结构（粉丝区间/达人类型分布）③成交结构（渠道/内容形式占比）④价格分布（商品价格分档）⑤爆款视频（含 AD 标记）⑥爆款直播（含店铺自播标记）。

> **实现要点**：6 个接口（goodsStats/authorAnalysis/saleAnalysis/priceRange/videoAnalysis/liveAnalysis）需逐个点对应 tab + 滚动触发懒加载；视频/直播接口 URL 用「?」精确匹配以排除 Summary 汇总接口；价格带接口只有档位定义无占比，故用 goods 商品价格自行分档。

## 直播搜索（按关键词搜直播 / 抓直播大盘）

用户要「看某店铺/达人的直播、直播大盘」时，用 `live` 子命令，搜索直播标题/达人昵称/ID 并抓直播列表落盘：

```bash
# 按关键词（达人昵称/标题/ID）搜直播
node scripts/rpa/fastmoss-rpa.mjs live --keyword steapex --country 马来西亚 --pages 3 --out outputs/<批次>/lives.json

# 不搜关键词，抓直播大盘
node scripts/rpa/fastmoss-rpa.mjs live --country 马来西亚 --pages 10 --out outputs/<批次>/lives.json
```

抓取字段（每条直播）：直播间标题、分类、主播（达人昵称+粉丝数+国家）、开播时间、结束时间、直播时长、累计观看人次、直播商品数、总销量、总销售额、UV价值、直播详情链接。

> 直播搜索页 `/zh/live/search` 搜索框 placeholder「请输入直播标题相关内容/达人昵称/ID」，搜索后 URL 带 `words=<关键词>`。筛选维度：达人分类/商品分类/直播类型/是否直播中/粉丝数/累计观看人次/带货销量；时间：近7/28/90天 + 自定义起止日期。

## 直播详情（抓单场直播数据总览 + 商品列表）

用户要「看某场直播的详细数据、带货商品」时，用 `live-detail` 子命令抓单场直播详情：

```bash
# 抓单场直播详情
node scripts/rpa/fastmoss-rpa.mjs live-detail --id 7705217919278762773 --country 马来西亚 --out xxx.json

# 批量抓多场（从 live 命令产出的 lives.json 取 id）
node scripts/rpa/fastmoss-rpa.mjs live-detail --id-file lives.json --top 5 --out-dir outputs/<批次>
```

抓取字段：
- **头部**：标题、直播时间、时长、类型（店铺播/达人播）、主播、主推品类
- **数据总览 13 项**：累计观看人次、人数峰值、增粉数、粉丝增长率、本场总销量、销量/小时、本场总销售额、销售额/小时、UV价值、平均成交单价、上架商品数、销售转化率、GPM（千次观看成交额）
- **直播带货商品列表**：商品（含售价）、所属店铺、销量、销售额、佣金比例
- **Top3 商品**：本场直播销量 Top3

> 直播详情页 `/zh/live/detail/<live_id>`。数据总览的值在标签**前面**（如「43.96万 累计观看人次」），且多个值挤在一起（「/小时」是小时指标、「个动销」是动销数），提取需精确锚定。

## 视频搜索（搜带货视频 + TikTok 链接）

用户要「看某类商品的热门带货视频、要视频链接」时，用 `video` 子命令，搜索关键词抓视频列表 + 逐条进详情页拿 TikTok 链接 + 视频类型：

```bash
# 搜索带货视频（按关键词），抓列表 + TikTok 链接 + 视频类型
node scripts/rpa/fastmoss-rpa.mjs video --keyword "phone case" --country 美国 --pages 2 --top 10 --out outputs/<批次>/videos.json
```

抓取字段（每条视频）：标题（含 AD 标记）、达人、达人粉丝数、发布时间、播放量、点赞数、互动率、视频类型（带货视频/未带货）、**TikTok 原视频链接**（`tiktok.com/@<达人>/video/<id>`）。

> 视频搜索页 `/zh/media-source/video`（导航「视频&素材」→ 热门视频），搜索框 placeholder「热门视频」，搜索后 URL 带 `words=<关键词>`。视频详情页 `/zh/media-source/video/<id>` 含「进入TikTok官方视频主页」链接。`--top N` 限制进详情页抓链接的条数（默认 10，串行约 3.5s/条）。

## 商品投流 ROI（逐个商品进入投流分析）

用户要商品 ROI / 商品投产 / GMV ÷ 广告花费时，执行 `product-roi`，沿「商品搜索 → 逐个商品详情 → 投流分析」读取页面。公式为 **投流分析模块的销售额（GMV）÷ 同模块、同周期、同币种的广告消耗**。完整参数和口径见 [references/product-workflow.md](references/product-workflow.md#商品投流-roi)。

```bash
# 搜索商品并逐个进入详情抓投流数据
node scripts/rpa/fastmoss-rpa.mjs product-roi --country 美国 --keyword earbuds --pages 1 --top 10 --period 28 --out outputs/<批次>/product-roi.json

# 已有商品名单（按ID去重，未传 --top 时采集全部）
node scripts/rpa/fastmoss-rpa.mjs product-roi --country 美国 --ids-file outputs/<批次>/products.json --period 28 --out outputs/<批次>/product-roi.json

# 独立后台进程
node scripts/rpa/run-background.mjs product-roi --country 美国 --ids 1732198421819330715 --period 28 --out outputs/<批次>/product-roi.json
```

同时输出同名 Markdown 报告。保存原始金额、计算 ROI、平台显示 ROAS、所选周期、来源链接和采集状态；每个商品完成即落盘。页面金额有万/亿缩写，重算结果可能与平台 ROAS 有舍入差异，两者分列保留。缺字段、分母为0、币种或周期未确认时保持未知。

支持近7/28/90天，近30天不可悄悄换成近28天。**不使用商品总览/搜索榜总GMV混算，不使用广告创意中心数据替代商品投流数据，不从 ROAS × 花费反推 GMV。** 用户要求前台示范时先展示这条路径，普通采集默认后台运行。

`ad` 命令仍用于「广告创意中心的单条广告案例」采样（`roas`、`estimate_cost`、广告主、文案、投放起止日期等），不作为商品 ROI 路径。其日期过滤表示在该区间投放过，不代表该周期的商品累计投产。

## 品类 ROI 一条龙（榜单 → 过滤目标品类 → 逐个投流ROI → 优势报告）

用户要「某国家、某类目、排名前N 的产品 ROI + 各自优势 + 链接」时，直接用 `category-roi` 一条命令跑完整链路，无需再手动拼「product 抓榜 → 过滤 → product-roi 抓投流」三步。以后只需改几个变量即可复用。

```bash
# 美区耳机前10：影音设备(909320)榜单内按「耳机」过滤，近7天榜，抓近28天投流ROI
node scripts/rpa/fastmoss-rpa.mjs category-roi --country 美国 --category-id2 909320 --category 耳机 --top 10 --days 7 --pages 6 --period 28 --out outputs/<批次>/耳机前10ROI.json
```

变量清单（改一个词即复用）：

| 变量 | 参数 | 默认 | 说明 |
|---|---|---|---|
| 国家 | `--country` | 美国 | 自动切站+币种 |
| 榜单层级 | `--category-id` / `--category-id2` | 无 | 一级/二级分类 ID，限定榜单范围（耳机→影音设备 909320） |
| 目标品类 | `--category` | 无 | 榜内按 category 字段+商品名过滤的关键词（如「耳机」）；能命中分类树时自动用作榜单筛选 |
| 取前N | `--top` | 10 | 目标品类前 N 名 |
| 榜单周期 | `--days` | 7 | 1/7/14/30（日/周/月榜） |
| 抓几页 | `--pages` | 6 | 榜单页数，需足够凑齐 N 个目标品类 |
| ROI 周期 | `--period` | 28 | 7/28/90 |
| 排序 | `--sort` | gmv | 榜单排序 |

产出 JSON + 同名 `.md`。报告使用当前样本可计算的ROI区间、规模、榜单销量、标价与店铺分布生成标签，并保留商品详情链接；不由这些字段推断利润、行业竞争阶段或固定的低价/高价路线。显式 `--date-value` 必须在页面生效，否则停止；榜单与ROI周期分别披露。

> **注意**：投流 ROI 默认串行、无界面；只有用户明确要求前台演示或调试时才加 `--headed true`。同一 `.browser-profile` 同时只跑一个进程，不能通过切换工具或窗口绕过站点验证或权限限制。

本地建库、检索和档案工具见 [references/local-pool.md](references/local-pool.md)。自然语言由本技能拆解并在网页核验，脚本的有限规则解析不替代全条件验证。每批网页证据转为标准JSON后入库，保留历史快照和缺失字段。

通过用户已登录的浏览器操作 FastMoss，不要求 API。先读当前页面，再填写筛选条件，验证生效后整理结果。不要把页面可读误报为自动搜索已经完成。

## 文件归属

所有相关操作记录、下载、名单、报告、脚本与后续改进都保存在本技能目录内。以本文件所在目录为根，保证复制给其他人后仍可使用；本次维护位置为 `D:\code\codeMy\fassmoss-skill`。

- 每次实际执行在 `operations/` 下记录日期、条件、完成范围、结果与阻碍。
- 产生名单或下载时使用 `outputs/<日期-任务>/`，保留来源、采集时间、地区、币种和数据周期。
- 不将凭证、Cookie、令牌或完整浏览器个人资料写入文件。

## 执行流程

先按任务入口选择流程。商品投流 ROI 直接用 `product-roi`，无需执行达人 `pipeline` 或达人分析脚本；需要同时分析商品销量时，先 `product` → `analyze-product.mjs`，再将 `brand-comparison.json` 作为 `product-roi --ids-file` 输入，逐个采集该分析结果中的商品。

用户要求历史带货、挂车效果、直播拆解、竞品推广或投产潜力时，执行 [references/history-workflow.md](references/history-workflow.md)：从详情逐模块采集网页证据，再运行 `scripts/history_analysis.py` 生成分析JSON与报告。第二项建库/飞书不作为此流程的前置条件。

直播场景另读 [references/live-workflow.md](references/live-workflow.md)，按用户白话问题选择达人列表→场次详情→场内商品→商品/店铺核验路径。优先取本场商品效果，不用全场或店铺累计数据替代。平台显示转化率与自己计算的比例分别标注，保留来源和定义。

1. 解析对象、国家、所需指标和时间。达人任务另解析类目、粉丝、预算币种、合作形式和人数；商品 ROI 解析关键词/商品ID/清单、数量和投流周期。保留明确条件；示例条件不作为所有任务的默认值。未指定国家时可沿用页面站点，但须说明。
2. 连接用户当前 FastMoss 标签页，复用登录状态。标签页和控件编号必须从当前观察获得，不复用历史编号。
3. 将需求分成网页硬筛选与后续分析条件。粉丝数、类目、GMV等按当前页面支持填写；测评风格、稳定出单等需内容或历史证据；报价无来源时写未知。
4. 操作后观察最新页面。以已选条件、输入框值、URL参数或刷新后的结果证明生效。遇到超时先检查当前状态，避免重复提交。
5. 按入口表运行采集与报告。达人列表可用 `--concurrency 6`，达人详情默认串行；商品 ROI 逐个商品串行读取投流模块并自动保存报告。按稳定ID去重，披露实际页数、条数和失败项。后台启动返回 PID 后还须核对日志及产物，才可报告任务完成。
6. 输出条件、名单、推荐依据、未满足或未验证的条件。第一页不称全量；仅硬筛选通过不称最终适配名单。

## 多维度分析报告（统一标准）

`scripts/rpa/analyze.mjs` 跑完后，除了 JSON 产物，还会在输出目录生成 `多维度分析报告.md`，**任何人拿到数据都能得到结构完全一致的分析**。报告固定六个部分：

1. **筛选口径核对** —— 先对齐哪些条件可硬筛、哪些只能推断、哪些无来源；
2. **候选人类型结构** —— 直播型/视频型/混合型 + 测评属性盘点；
3. **综合打分推荐名单** —— 按「箱包垂直度(25)+GPM(20)+包GMV(25)+客单价(10)+测评(10)+佣金(10)」百分制可复现打分排序；
4. **维度拆解** —— 箱包垂直度 / 带货GPM / 历史GMV / 客单价 / 测评属性 / 共同推广店铺覆盖 / 指定竞品推广频次 / 投产潜力，各一张表；
5. **缺口清单** —— 报价、退货率、评论舆情、转化率等无法获取的字段诚实标注；
6. **行动建议** —— 基于数据自动生成（首推纯箱包达人 / 测评降级 / 共享推广店铺 / 报价核实）。

**报告规则**：数字全部从数据算出来，不硬编码；定性分级（纯箱包/半箱包/附带、直播/视频/混合、投产高/中/低）用规则函数判定，不是手写结论；「估算/推断」处明确标注，未知字段用「未知」不用 0 顶替。

浏览器操作与连接故障经验见 [references/browser-workflow.md](references/browser-workflow.md)。制作档案、历史分析或后续建库方案时读 [references/data-and-roadmap.md](references/data-and-roadmap.md)。

## 数据与操作边界

- 近28天不等于近30天；无法得到精确周期时明确披露，不悄悄替换。
- GMV不等于转化率、净利润或合作ROI。退货率、点击转化率、真实报价缺少来源时保留未知。
- 每项结论区分平台显示数据、用户内部实绩、计算结果和AI推断；推断附依据及不确定性。
- 观察到竞品商品/挂车不证明付费合作；统计为竞品推广记录，商业合作另需证据。
- 只使用当前账号可访问页面和允许的导出；不绕过验证码、付费权限或平台限制。遵守实际浏览器工具的停止和确认规则。
- 搜索和整理不包含发送邀约、联系达人、购买服务、开通套餐或发布内容。定期任务仅在用户明确要求后创建。

分析时可用 `--competitor-products 123,456` 指定竞品商品 ID。频次按已观察到商品链接的视频或直播 ID 去重。历史批次没有记录商品链接或周期时，结果标为未知。

## 当前验证范围

2026-11-11 新品榜与配套趋势/报告脚本完成代码核对和修复：ID去重、分类/周期参数核验、分页停止、部分结果保存、详情近7天确认及同窗口逐日趋势。临时检查仅在内存和本地拦截页面执行，没有新增测试文件，也没有重新采集真实站点。详见 [新品榜维护记录](operations/2026-11-11-new-products-fixes.md)。

2026-11-11 修正响应隔离、周期完整性、零销量商品归因、商品榜显式日期、跨品类筛选、报告固定结论及重复等待。新增回归使用本地拦截页面与无界面浏览器，不访问真实FastMoss；本轮未追加真实站点批量验证。修改与数据字段约定见 [operations/2026-11-11-review-fixes.md](operations/2026-11-11-review-fixes.md)。

2026-11-10 前台核对美国站商品 `1732198421819330715` 的近28天投流分析：销售额 $6.11万、广告消耗 $2.76万，计算 ROI 约2.21，平台 ROAS 2.22。新增命令的本地无界面页面测试覆盖模块取值、切周期刷新和相同金额；这不等于真实网站批量后台采集已经实测。

2026-11-09 已跑通完整 RPA 链路（美国站、箱包类目、粉丝 5000–50000）：

- 列表 60 页 600 位达人 → 含包 35 位 → 详情 18 位，18/18 全有数据、0 空表。
- 离线分析产出 `creators-final.json` / `final-top.json` / `competitor-shops.json` / `evidence/*.json` / `多维度分析报告.md`。
- 详情页 4 张表是懒加载，串行 + 监听接口响应是唯一可靠路径（并发丢数据）。
- 详见 [operations/2026-11-09-us-bags-review.md](operations/2026-11-09-us-bags-review.md)。

### 三级分类参数规则

商品榜、品类ROI、新品榜与视频商品榜共用父子分类校验。仅传 `--category-id3` 时从分类缓存补齐父级；未知三级需同时提供正确的一二级ID。名称与显式ID冲突会报错，不静默覆盖。分类采集失败或降级为两级时保留已有完整缓存。
