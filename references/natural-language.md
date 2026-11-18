# 大白话到命令

只加载本任务相关参考，先保留用户的国家、人数、周期和条件。命令示例从技能根目录运行；文件路径换成用户本批次路径。不要把一句业务话拆成不存在的 CLI 参数。

## 场景路由

| 用户原话/目标 | 入口与参数示例 | 交付或后续 |
|---|---|---|
| 美国包包达人、粉丝5000到5万、推荐10人 | `pipeline --country 美国 --follower 5000,50000 --category 7 --top 10 --out-dir outputs/creators` | 运行 `analyze.mjs --dir outputs/creators --top 10`；只对已核实条件给推荐，未核实报价单列 |
| 已有达人ID，要看历史表现 | `detail --country 美国 --ids <字符串ID> --out outputs/creators/details.json` | [历史证据](history-workflow.md)，不要把 details.json 直接当 evidence.json |
| 这款商品适合哪些达人 | `product-creators --country 美国 --url <商品详情链接> --follower 5000,50000 --top 20` | 指定竞品加peer-ids；页面原始口径，报价未知 |
| 箱包最近有哪些新品起量 | `new-opportunities --country 美国 --category 箱包 --scan 30 --top 10` | 任意类目近7天趋势与规则分；不是爆款概率 |
| 竞品店铺比上次新增/调价了什么 | `competitor-diff --country 美国 --shop-id <店铺ID> --pages 3` | 首次建采样基线，后续自动对照；不将未观察当下架 |
| 美区手机壳新品榜10个 | `new-products --country 美国 --category 手机壳 --pages 3 --out outputs/new-cases/newproducts.json` | 三级分类匹配，名称复核后取10；不足则按本任务范围继续翻页并披露实际数量 |
| 上述新品还要近7天销量趋势 | `analyze-phonecase-trend.mjs --dir outputs/new-cases --new-only --top 10` | 逐个详情补抓，随后 `render-phonecase-report.mjs --file outputs/new-cases/result.json`；不额外要求销量榜 |
| 手机壳销量榜和新品榜一起比较 | `product --country 美国 --category 手机壳 --days 7 --out outputs/cases/saleslist.json` + `new-products ... --out outputs/cases/newproducts.json` | 两榜齐全后 `analyze-phonecase-trend.mjs --dir outputs/cases`，只适用手机壳 |
| 某分类销售、竞品品牌、价格带 | `product --country 泰国 --category 跑步鞋 --days 7 --out outputs/sales/products.json` | `analyze-product.mjs --dir outputs/sales --category 跑步鞋 --brand <店铺名>`；按实际榜单周期交付 |
| 搜商品投流ROI、GMV除广告费 | `product-roi --country 美国 --keyword earbuds --top 5 --period 28 --out outputs/roi/product-roi.json` | 自动出JSON与同名Markdown；只读商品投流分析模块 |
| 已有商品名单要投流ROI | `product-roi --country 美国 --ids-file products.json --period 28` | 支持字符串ID；文件输入未给top时采全部 |
| 某类目榜单前10的投流ROI | `category-roi --country 美国 --category 手机壳 --top 10 --period 28 --days 7` | 榜单周期和投流周期分别披露，已匹配平台分类不再用中文词排掉英文商品 |
| 精确近30天投流ROI | 暂不执行28天替代 | 告知页面支持7/28/90，询问用户选择；未答复不做依赖该选择的采集 |
| 哪些商品最近带货视频多 | `hot-video --country 美国 --category 手机壳 --pages 3 --out outputs/video/hotvideo.json` | `render-hot-video-report.mjs --file outputs/video/hotvideo.json --top 10`；仅样本内排序 |
| 找某类热门视频和TikTok链接 | `video --country 美国 --keyword "phone case" --top 10 --out outputs/video/videos.json` | 单条视频明细；与按商品汇总的hot-video区分 |
| 店铺榜、评分4.5以上 | `shop --country 泰国 --category 箱包 --rating 4.5 --out outputs/shops/shops.json` | `analyze-shop.mjs --dir outputs/shops --min-rating 4.5` |
| 某店铺全面看一遍 | `shop-detail-report --country 泰国 --shop <店铺名> --out outputs/shop/detail.json` | 搜索→详情→报告；已知ID可用shop-id跳过搜索 |
| 店铺近30天对上30天涨跌 | `shop-trend --country 泰国 --shop <店铺名> --days 30 --out outputs/shop/trend.json` | 两个完整等长周期才比较；受阻保留已读商品和覆盖状态 |
| 同品类前10店铺比较 | `shop-compare --country 泰国 --category 运动鞋 --top 10` | 样本商品汇总GMV，不能声称全站店铺排名 |
| 挖竞品店铺带货达人 | `shop-authors --country 泰国 --shop <店铺名> --top 20` | 店铺内贡献口径，不等于全平台表现 |
| 店铺品类、达人和成交结构 | `shop-insight --country 泰国 --shop <店铺名>` | 多模块各自披露口径和缺项 |
| 搜直播、看单场商品 | `live --country 美国 --keyword <关键词>` → `live-detail --country 美国 --id <直播ID>` | [直播流程](live-workflow.md)；不把全场GMV分摊给未知商品 |
| 广告创意案例 | `ad --country 美国 --start <起始日期> --end <结束日期>` | 广告案例数据，不能替代商品ROI |
| 切站或获取分类树 | `country 泰国` / `categories --country 泰国 --out outputs/categories.json` | 只有任务需要时运行，实际数量来自本次页面 |

采集命令统一打开项目独立 Chrome。

## 不能直接硬筛的条件

- 测评/开箱：从内容或视频证据判断；不能仅凭昵称贴标签。
- 近30天挂车转化不错：先核实能否获取精确周期、订单/点击分母；GMV、销量或GPM仅能证明相应指标。
- 人民币预算8000、视频和直播两种合作：分别核实报价来源、币种、形式和日期。无报价保持未知，不填估算作硬通过；换汇需注明来源与时间。
- 竞品没给：可以先整理商品/店铺推广记录并请求目标品牌或ID，不自行指定竞品、不宣称付费合作。
- 报价、点击转化、退货率、评论正文等缺失不会自动变成0；仍可交付已核实候选及待核实清单。

## 分类和周期

分类匹配以 `lib/categories.mjs` 和本机当前 `categories.json` 为准：精确名称（包括三级）优先，别名其次；多个模糊候选不猜。仅给三级ID时补父级；冲突明确报错。分类缓存缺失且任务需要它才抓树。手机壳已有核验别名，但平台范围也可能含屏幕膜，纯手机壳再用名称规则复核。

商品榜 `--days 1/7/14/30` 对应平台自然日/周/月榜，14和30都映射月榜，不是精确滚动天数。新品榜只有三日；商品投流 `--period 7/28/90`；店铺趋势 `--days 1..45`。不能将同名的days参数跨命令照搬。

国家支持键和币种读取 `scripts/rpa/lib/config.mjs`，不要扩展出脚本不支持的缩写或将币种覆盖当作金额换算。每次采集确认实际站点；报告以本次元数据和页面币种为准。
