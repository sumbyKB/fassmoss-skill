# 商品找达人、新品机会、竞品变化

采集命令统一打开项目独立 Chrome。

## 商品反查达人 product-creators

```text
node scripts/rpa/fastmoss-rpa.mjs product-creators --country 美国 --id 1732198421819330715 --follower 5000,50000 --top 20 --pages 5 --out outputs/product-creators/result.json
```

本品输入选一项：`--id` / `--ids 123,456`、`--ids-file products.json`、`--url FastMoss商品详情链接`。文件接受字符串ID、products或topProducts数组。指定竞品可加 `--peer-ids 123,456` 或 `--peer-file products.json`，两者不能混用；不擅自识别竞品，不用标题模糊匹配补ID。文件中有国家、币种时必须与当前任务一致。

读取每个商品的“商品关联达人”，按稳定达人ID跨商品去重，保留本品/指定竞品和逐条贡献原文。排序：本品覆盖 → 已确认同一日期窗口GMV → 本品表内顺序 → 指定竞品覆盖。粉丝硬筛缺值者进入 `pending_creators`，不冒充筛选通过；真实报价、粉丝画像、内容风格继续保留待核实。

`--pages` 为每个商品最多采集页数，`--top` 为最终推荐人数，达不到时给实际数量与覆盖范围。实站商品关联表显示“商品总销量”、销售额、开始带货时间和粉丝，未提供周期按钮时按页面原始口径保存。默认不假定近28天；可显式请求 `--period 7/28/90`，页面不能确认时标为partial，不将原始累计数据换成近期数据。

关联商品数不是推广视频/直播次数，也不证明付费合作。不同SKU的贡献数据只有同一日期窗口全部明确才汇总；否则逐商品原文保留，汇总GMV未知。输出指定JSON及同名Markdown，分页和每个商品完成后保存。

## 通用新品机会 new-opportunities

```text
# 采新品榜，再逐个确认详情近7天；无需销量榜文件
node scripts/rpa/fastmoss-rpa.mjs new-opportunities --country 美国 --category 箱包 --pages 3 --scan 30 --top 10 --out outputs/new-opportunities/result.json

# 复用已有新品榜，筛选英文/中文关键词；仅重采必要详情
node scripts/rpa/fastmoss-rpa.mjs new-opportunities --input outputs/newproducts.json --scan 20 --top 10 --include-keywords handbag,shoulder,手袋 --exclude-keywords strap,肩带 --out outputs/new-opportunities/result.json
```

支持所有分类，不含手机壳专用规则。分类名称/ID沿用新品榜三级校验；本机没有所需分类树时先运行 `categories`。`--input` 须为 `meta.period_days=3` 的新品榜JSON。在线运行会在报告旁保存 `.source.json` 原始列表。`--scan` 是最多进详情的候选数量，须不小于top；pages为榜单页数，数量不足不扩大为全站或凑条数。

可加 `--max-age-days 14`、`--min-units7d 10`。名称关键词为逗号分隔的字面包含匹配，不是语义识别；上架天数按采集日UTC与页面日期做日历差，日期缺失不能通过天数硬筛。

近7天销量来自详情总览已确认周期的完整连续逐日序列，趋势比较最近3日日均和之前4日日均。实站发现部分新品总览销量卡与该日期区间的逐日合计不同，因此两者分列：`units_7d` 为逐日合计，`card_units_raw/card_consistent/warning` 保留卡片原值与差异，不能反改序列或混算。

可选 `--with-roi` 在同一商品页补读近7天投流分析，不重复导航；广告成交占比只采用模块原文，不用总GMV减广告GMV反推自然流量。投流失败保留已有详情；验证阻挡立即停止。

观察名单使用公开的规则分：趋势分（上升60/新近起量55/稳定30/下滑5）+销量分 `min(40,10×log10(近7天销量+1))`。零销量0分；缺少完整逐日证据不评分。分数只对本批样本排序，不是爆款概率、合作ROI或净利润预测。原始序列、来源、日期、规则和缺项均随JSON与Markdown交付。

## 竞品变化 competitor-diff

```text
# 第一次保存采样基线；第二次自动读取上次成功采样并比较
node scripts/rpa/fastmoss-rpa.mjs competitor-diff --country 美国 --shop-id 7496301295491516571 --pages 3 --out outputs/competitor/latest.json

# 只看商品标价与佣金，减少页面读取
node scripts/rpa/fastmoss-rpa.mjs competitor-diff --country 美国 --shop 店铺全名 --sections products --pages 5 --out outputs/competitor/prices.json

# 离线比较两个已采集的快照，不启动浏览器、不改自动索引
node scripts/rpa/fastmoss-rpa.mjs competitor-diff --previous outputs/old.snapshot.json --current outputs/new.snapshot.json --out outputs/competitor/diff.json
```

在线需要country，以及shop-id或shop。`--sections` 可选 `products,creators,videos`，默认三个都采；pages为每个模块的页数上限。商品读取当前页面范围，不为调价对照强行切90天。自动索引按国家、稳定店铺ID分开存于 `outputs/competitor-baselines/`，禁止把out直接指向该目录。阻挡、模块错误时不覆盖历史索引；成功的有限采样也可成为基线，覆盖状态随快照保留。

输出：指定JSON和同名Markdown，以及 `.snapshot.json` 当前快照。首次没有历史时状态baseline；之后比较本次首次观察到的商品/达人/视频、同ID商品标价区间和佣金原文变化。两次国家、币种、店铺或时间顺序不兼容会拒绝比较。输入和历史基线不能被报告覆盖。

“首次观察”不等于新上架，“本次未见”不等于下架/取消合作，新增关联达人不证明付费合作。未请求模块不比较；缺价格不生成涨跌结论；两个滚动周期GMV差不作为期间新增GMV。需要精准上新时间或推广频次时另补页面证据，不用列表差集代替。

## 当前验证边界

已在用户可见的项目独立浏览器核对商品关联表、两类非手机壳新品的近7天逐日数据、店铺商品/达人/视频首屏，并运行借用该浏览器上下文的三条命令控制流。首屏样本均标partial。独立后台进程启动、完整多页、其他国家及不同电脑仍需各自核验，不能由前台首屏成功推出全量后台完成。

## 速度与采样范围

新品榜与详情共用一次浏览器、一次登录核验和一次站点切换，不再启动两次。关联表按目标行与对应响应就绪继续，不等待无关网络请求全部结束；空表、周期和分页核验继续保留。首个商品已由登录核验打开时直接复用页面。无分类任务不读取分类缓存。

要先看少量观察结果，可显式用 `--pages 1 --scan 10 --top 10`；排名仍只覆盖该样本。需要完整比较时再扩大pages/scan，不会为了提速悄悄减少用户指定范围、复用陈旧数据或提高详情并发。
