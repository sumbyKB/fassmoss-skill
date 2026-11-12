# 商品销售分析：大白话 → 变量 → 命令

用户想「看细分品类销售、和竞品品牌对比、分价格带」，用大白话描述即可，本技能负责拆解成**变量**并填进命令执行。核心链路：

```bash
# 1. 抓商品榜（国家 + 时间；分类在分析层过滤）
node scripts/rpa/fastmoss-rpa.mjs product --country 泰国 --days 14 --pages 20 --out outputs/<批次>/products.json

# 2. 分析：细分品类 + 品牌对比 + 价格带
node scripts/rpa/analyze-product.mjs --dir outputs/<批次> --category 跑步鞋 --brand 我们的品牌名 --top 20
```

产出 `brand-comparison.md`（报告）+ `brand-comparison.json`（可追溯数据）。

## 变量清单（后期改一个词即可复用）

| 变量 | 大白话例子 | 参数 | 默认值 | 说明 |
|---|---|---|---|---|
| **国家** | 泰国 / 美国 / 印尼 | `--country` | 无（必填，影响币种） | 自动切站+币种（泰国=THB） |
| **一级分类** | 鞋靴 / 箱包 / 美妆个护 | `--category-id` | 无（=综合榜） | 一级分类 ID（l1_cid），精确筛选 |
| **细分品类** | 跑步鞋 / 运动鞋 | `--category` | 无 | 按「商品分类/商品名」关键词过滤（在一级分类内进一步过滤） |
| **时间范围** | 近两周 / 近一周 / 近一月 | `--days` | 1 | 1日榜/7周榜/14月榜/30月榜 |
| **本品牌** | 我们品牌 / BOSTANTEN | `--brand` | 无 | =所属店铺名 |
| **竞品范围** | 排名相近的 | `--nearby` | 5 | 本品牌前后各 N 名 |
| **分析条数** | Top20 | `--top` | 20 | 品类榜展示条数 |
| **价格带** | 区分价格带 | 内置 `TIERS` | 见下 | 低价<100 / 中价100~300 / 中高价300~1000 / 高价≥1000 |

价格带阈值改 `analyze-product.mjs` 里的 `TIERS` 常量即可（单位随国家币种）。

## 分类精确筛选（关键：先拿分类，再筛）

FastMoss 商品分类是三级（一级→二级→三级），一级分类通过 `l1_cid` 参数精确筛选。**先抓一级分类映射，再筛**：

```bash
# 1. 抓一级分类映射（分类名 → l1_cid）
node scripts/rpa/fastmoss-rpa.mjs categories --country 泰国 --out outputs/categories.json

# 2. 用 l1_cid 精确筛到某类（如 鞋靴=6、箱包=7、美妆个护=14、居家日用=10、食品饮料=24、汽车与摩托车=23）
node scripts/rpa/fastmoss-rpa.mjs product --country 泰国 --days 14 --category-id 6 --pages 20 --out outputs/<批次>/products.json

# 3. 分析：在一级分类内再按细分品类过滤 + 品牌对比 + 价格带
node scripts/rpa/analyze-product.mjs --dir outputs/<批次> --category 运动鞋 --brand 品牌名 --top 20
```

**已知一级分类 ID（泰国站，2026-11-09 实测）**：美妆个护=14、鞋靴=6、箱包=7、居家日用=10、食品饮料=24、汽车与摩托车=23。完整映射见 `categories` 命令产出。

> 「跑步鞋」在 FastMoss 里没有独立分类，对应的是「鞋靴(6)」下的「运动鞋/休闲运动鞋」。所以筛跑步鞋 = `--category-id 6`（鞋靴）+ `--category 运动鞋`。

## 大白话 → 参数映射

| 业务原话 | 拆解 | 参数 |
|---|---|---|
| 「近两周」 | 平台只有日榜/周榜/月榜，无精确 14 天；近两周映射到**月榜**（date_type=3），披露口径差异 | `--days 14` |
| 「近一周」 | 周榜 | `--days 7` |
| 「昨天/近一天」 | 日榜 | `--days 1` |
| 「近一个月」 | 月榜 | `--days 30` |
| 「跑步鞋」「箱包」等一级类 | 先抓分类映射拿 l1_cid，再精确筛 | `--category-id 6`（鞋靴） |
| 「运动鞋」等二级细分 | 在一级分类内按分类字段过滤 | `--category 运动鞋` |
| 「我们品牌」 | 品牌=所属店铺名 | `--brand 品牌名` |
| 「排名相近的竞品」 | 本品牌前后各 N 名 | `--nearby 5` |
| 「按销售金额排」 | 按销售额(GMV)降序 | 内置 |
| 「区分价格带」 | 从商品售价区间分档 | 内置 `TIERS` |

## 关键事实（泰国站实测）

1. **商品榜页面**：`/zh/e-commerce/saleslist`，URL 参数 `date_type`（1日/2周/3月）、`date_value`（日期或月份如 `2026-10`）、`region`（国家）。
2. **date_value 别硬算「今天」**：月榜/日榜取当天会返回空，平台有效日期是「昨天」（日榜）或「上月」（月榜）。脚本首次无 date_value 加载，读回 `location.href` 里的真实值再翻页。
3. **接口有 MSG_SAFE_0001 签名**：不能直接 fetch 放大 pagesize，只能读 UI 渲染后的 DOM 表格。
4. **列结构**：排名 | 商品 | 国家/地区 | 所属店铺 | 商品分类 | 佣金比例 | 销量 | 销量环比 | 销售额 | 总销量 | 总销售额。
5. **价格**：商品名下方「售价：฿54.00 - 400.00」→ 提取价格区间做价格带分档。
6. **品牌**：无独立品牌列，「所属店铺」≈品牌。
7. **币种**：泰国站 THB（฿），金额解析兼容 ฿/万/亿。

## 分类精确筛选的现状（已解决）

FastMoss 商品分类是三级（一级→二级→三级），**三级都支持 URL 参数精确筛选**（2026-11-12 实测）：一级 `l1_cid`、二级 `l2_cid`、三级 `l3_cid`（如 手机壳 = 保护壳、屏幕保护膜、皮肤 = 601925）。

- **一级**：`--category-id` → `l1_cid`（鞋靴=6、箱包=7、美妆个护=14 等）。
- **二级**：`--category-id2` → `l2_cid`（如 运动鞋=834696、手机配件=909064）。
- **三级**：`--category-id3` → `l3_cid`（如 手机壳=601925）。`categories` 命令已从 `/api/live/filterInfo` 抓全三级树（30 一级 + 247 二级 + 2370 三级，含 ID）到 `categories.json` 的 `l3_categories`，和一二级一样自动匹配；`--category 手机壳` / `--category 移动电源` 直接可用。
- UI 点击 Cascader 可能触发腾讯验证码（平台反爬），本技能不绕过验证码；优先用 URL 参数（`--category-id` / `--category-id2` / `--category-id3`）而非点 UI。

## 边界

- 近两周 ≠ 精确 14 天；月榜=自然月，口径以 `date_value` 披露为准。
- GMV ≠ 净利润/ROI；「销售额」是平台口径。
- 价格带由商品售价区间中位数估算，非交易均价。
- 无订单级客单价、退货率、真实品牌方身份（店铺名≈品牌是推断）。
- 不绕过验证码、付费权限或平台限制。

## 新品榜（近期上架商品，三日销量口径）

用户要「看某类目最近上架商品、追踪新品爬坡」时，用 `new-products` 命令抓 `/zh/e-commerce/newProducts`（导航「商品 → 新品榜」，副标题「追踪近期上架的商品」）。与销量榜的关键差异：**新品榜固定「三日销量」排名，无 `date_type`/`date_value`（不能切日/周/月榜），无「销量环比」列**。

```bash
node scripts/rpa/fastmoss-rpa.mjs new-products --country 美国 --category-id 16 --category-id2 909064 --pages 20 --out outputs/<批次>/newproducts.json
```

- **列**：排名 | 商品（含售价区间 + 上架时间） | 国家/地区 | 所属店铺 | 商品分类 | 佣金比例 | 三日销量 | 三日销售额 | 总销量 | 总销售额 | 操作。
- **分类筛选**：`--category-id`/`--category-id2`/`--category-id3`（l1_cid/l2_cid/l3_cid URL 参数，已验证生效；如 `--category 手机壳` 自动匹配三级 601925）。注意列表「商品分类」列只显示一级分类（如「手机与数码」），不显示三级细分，且个别商品存在平台误分类，按细分品类筛选时需结合商品名关键词。
- **无近7天/环比**：需在详情总览确认近7天。趋势使用详情同一个完整、连续近7天逐日序列：最近3日日均÷之前4日日均，>1.1上升、<0.9下滑，其余稳定；基期零销量而近期有销量标为「新近起量」。缺数据为未知，不能把榜单三日数与不同截止日的7日数相减。

命令按商品ID去重，支持 `--top N`；空页或重复页停止。分类匹配失败、一级/二级ID冲突及不支持的日期参数都会明确失败。部分结果在 JSON 的 `meta.status` 和实际读取页数中披露，验证码/权限阻挡不会继续翻页或自动切前台。

手机壳两榜分析示例（输入目录和结果文件均可复用，不绑定某一天）：

```text
node scripts/rpa/analyze-phonecase-trend.mjs --dir outputs/phonecase --top 50
node scripts/rpa/render-phonecase-report.mjs --file outputs/phonecase/result.json
node scripts/rpa/render-phonecase-report-html.mjs --file outputs/phonecase/result.json
```

输入为该目录的 `saleslist.json` 与 `newproducts.json`，需要包含国家与币种；也可传 `--sales`、`--new-products`、`--country`、`--out`。只有明确要求前台观察时加 `--headed true`。旧结果没有近7天周期/逐日证据时，报告将原有趋势标为未知；国家、榜单日期、数量与缺失原因均由数据生成，不沿用固定的11条/5条结论。

## 商品投流 ROI

商品榜支持 `--date-value` 显式指定历史日期，例如月榜 `product --country 美国 --days 30 --date-value 2026-09 ...`。参数会传入第一页并核对页面有效值；未指定时才采用平台的默认有效日期。第一页加载后直接提取，后续分页保持同一日期，不重复打开第一页。

业务要商品 ROI 时，先搜索商品，再逐个进入 `/zh/e-commerce/detail/<商品ID>`，点击「投流分析」（锚点 `#putData`），读取该模块同周期的「销售额」与「广告消耗」。公式：**投流分析销售额（GMV）÷ 广告消耗**。

```bash
# 搜索商品并逐个抓取（默认最多10个；支持 --pages 扩大搜索范围）
node scripts/rpa/fastmoss-rpa.mjs product-roi --country 美国 --keyword earbuds --pages 1 --top 10 --period 28 --out outputs/<批次>/product-roi.json

# 已有商品清单
node scripts/rpa/fastmoss-rpa.mjs product-roi --country 美国 --ids-file outputs/<批次>/products.json --period 28 --out outputs/<批次>/product-roi.json

# 已知单个或多个商品ID
node scripts/rpa/fastmoss-rpa.mjs product-roi --country 美国 --ids 1732198421819330715,1732223944923516986 --period 28 --out outputs/<批次>/product-roi.json
```

- `--ids` / `--id`、`--ids-file` / `--id-file`、`--keyword` 三选一。文件接受 `products`、`topProducts`、`ids` 数组或直接数组，ID须是字符串，避免19位数字丢失精度。
- 文件输入默认采集全部，可用 `--top` 截取；关键词输入默认搜索1页、最多10个，按商品ID去重，重复页停止。
- `--period` 支持 `7` / `28` / `90` 或 `近28天` 等页面原文，默认28天；`--days` 可作数值别名。30天及自定义日期不自动替换，直接说明支持范围。
- 必须等待「投流分析」自己的周期选中且数据刷新；其它模块的周期和金额不构成本模块依据。模块没有日期输入时记录原始周期标签，日期数组留空。
- 取指标卡第一个数值，不误取「日均」。保存 `raw.gmv` / `raw.ad_spend` / `raw.platform_roas` 原文与解析数值；`roi` 是重算值，`platform_roas` 是页面显示值。
- 输出指定 JSON 和同名 `.md`，每个商品完成即保存。记录成功、缺指标、失败、网页阻挡与尚未采集；遇到登录、验证或权限上限停止后续访问并保留部分结果。
- 默认无界面；用户要求前台演示时才加 `--headed true`。`run-background.mjs product-roi ...` 固定后台，不自动弹窗。

已前台核对示例：美国 INSONIXN 耳机（ID `1732198421819330715`），近28天投流销售额 `$6.11万` / 广告消耗 `$2.76万`，计算 ROI `2.2138`（展示2.21），平台 ROAS `2.22`。缩写金额有舍入，两个结果都保留，不用 ROAS 反推 GMV。商品总览的 `$13.80万` 是另一口径，不参与这个计算。

不走广告创意中心 `ad` 路径计算商品 ROI，也不平均单条素材 ROAS。这里的投流 ROI 不包含商品成本、佣金、退款损失等，不表示净利润回报。

### 先分析销量，再采集选中商品的 ROI

同时需要销量分析和商品投流 ROI 时，从项目根目录依次运行：

```text
node scripts/rpa/fastmoss-rpa.mjs product --country 美国 --days 7 --pages 1 --out outputs/product-sales/products.json
node scripts/rpa/analyze-product.mjs --dir outputs/product-sales --top 10
node scripts/rpa/run-background.mjs product-roi --country 美国 --ids-file outputs/product-sales/brand-comparison.json --period 28 --out outputs/product-sales/product-roi.json
```

销量分析的 `brand-comparison.json` 会在 `topProducts` 保留商品字符串ID和详情链接，后续只对这些选中的商品逐个采集投流数据。两个报告分别保留销量榜与投流分析的原始周期，不把销量榜金额拿来充当投流 GMV。

旧版 `brand-comparison.json` 若没有商品ID/链接，先用原始 `products.json` 重新运行销量分析；不要通过商品名称模糊匹配补ID。原始文件也缺ID和链接时，需要重新从商品页采集。
