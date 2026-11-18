# 店铺榜、详情、趋势、对比与达人挖取

所有命令在技能根目录运行，使用项目独立 Chrome。显式设置国家，报告保留实际周期及覆盖范围。

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
# 搜索店铺名进入详情页抓数据（使用项目独立 Chrome，自动切站）
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

采集命令统一打开项目独立 Chrome。

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

