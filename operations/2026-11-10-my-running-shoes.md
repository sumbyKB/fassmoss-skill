# 2026-11-10 马来西亚站跑步鞋销售分析

## 任务
分析马来西亚站近两周跑步鞋细分销售（按销售金额排）+ Steapex 品牌 vs 排名相近运动鞋品牌对比 + 价格带分档。

## 条件与口径
- 国家：马来西亚（MYR）
- 时间：「近两周」→ 月榜 date_type=3, date_value=2026-10
- 类目：运动与户外 l1_cid=9（Steapex 归在此类，非鞋靴 6）
- 排序：商品榜 --sort gmv；店铺榜按总 GMV
- 品牌：Steapex.Malaysia（店铺全名）

## 执行过程与关键发现
1. 抓分类树：鞋靴 l1=6，二级仅女鞋/男鞋/鞋靴配件，无独立跑步鞋；运动与户外 l1=9。
2. 抓鞋靴商品榜（销量排+GMV排）：Steapex 不在榜，因归类在运动与户外。
3. 店铺搜索确认：Steapex 归「运动与户外」，评分 3.8，总GMV RM584.63万。
4. 抓运动与户外商品榜（300 条，GMV排）：鞋类仅 7 个商品，无 Steapex 单品（单品未进月榜前300）。
5. 抓运动与户外店铺榜（300 条）：Steapex 总GMV排名第 56。

## 脚本修复（重要）
`fastmoss-rpa.mjs` 的 `shop` 子命令分类筛选 bug：
- **原**：`buildShopUrl` 把 `--category` 拼成 `category=` query（无效，店铺搜索接口用 `l1_cid`）。
- **修**：`buildShopUrl` 改为 `categoryId → l1_cid`；`cmdShop` 增加 `--category-id` 支持 + 中文分类名自动匹配（复用 resolveCategoryId），meta 增加 category_id 记录。
- 实测验证：`shop --category-id 9` 正确筛出 219 个运动与户外店铺（修复前是全量 300 混合店铺）。

## 结果
- 跑步鞋细分（鞋类 7 商品）头部：Feidian shoes（RM13.88万）、kuncheng out door（RM11.02万）。
- Steapex：第56名，评分3.8（相邻竞品最低），总GMV RM584.63万，近7天 GMV RM11.10万。
- 相邻运动鞋竞品：MATBULSPORT(48)、Activeeverywear(53)、PT Sport Wear(54)、SUMFIT(60)、ApexSport(61)。
- 价格带：主力 RM10–116，集中在低价(<30)与中价(30–80)，无 ≥RM200 高价。

## 产出
- `outputs/2026-11-10-my-running-shoes/跑步鞋销售分析报告.md`（主报告）
- `products_sports_gmv.json` / `shops.json` / `categories.json` / `products_gmv.json` / `products.json`
- `shop-analysis.md` / `shop-analysis.json`（analyze-shop 脚本产物）

## 阻碍/边界
- Steapex 单品未进商品榜前300，无法在商品榜层面做"前后各N名"对比，改为店铺榜对比。
- 「近两周」实为 2026-10 自然月，非精确 14 天。
- 价格带阈值改为马币档位（30/80/200），需用户后续确认是否微调。

## 补充：店铺详情页抓取（2026-11-10 09:47）
用户要求搜索 Steapex.Malaysia → 进详情页抓数据 → 分析。用 playwright 直接 goto `shop-marketing/detail/7494233487112177345` 抓全量详情。

### 详情页关键发现
- 店铺 ID：7494233487112177345，TikTok 账号 steapex.my，本土店，收录 2025-11-30。
- 商品价格分布 RM11.5-RM651，价格带：>RM75 占 98.35%，0-15 占 1.65%，中间档全空。
- 5 个主力 SKU 全是专业跑鞋（RM96.45~RM507），佣金 10%，近28天销量 325-659。
- 自营账号（1.64万粉）是最大带货来源（RM4.27万），大粉达人（bangsoda 28.76万）直播GPM仅 RM1.98 几乎无效。
- 1.39万带货视频含大量 AD 投流，但单条销量仅 22-52 件，投流 ROI 存疑。
- 评分 3.8、佣金 0%-0%（详情页）vs 10%（商品列表）口径差异需核实。
- 核心结论：高投入低转化（达人/视频/直播全超同行增速，但总销量仅品类均值 1/14）。

### 产出
- `steapex_shop_detail.json`（结构化详情数据）
- `Steapex店铺详情分析报告.md`（深度分析报告）

## 补充2：固化「搜索店铺→详情抓取」到代码（2026-11-10 09:50）
用户要求把「搜索店铺名 → 进详情抓数据」流程固化到代码逻辑。

### 新增 `shop-detail` 子命令
- 用法：`shop-detail --shop Steapex.Malaysia --country 马来西亚 --out xxx.json`；`--shop-id <id>` 跳过搜索。
- 流程：搜索页输入店铺名 → 取第一条详情链接 → goto 详情页 → 滚动触发懒加载 → 抓取落盘 JSON。
- 抓取字段：店铺名/评分/价格分布/收录时间/店铺类型/TikTok账号 + 总览8项 + 价格带分布 + 商品列表（售价/分类/上架时间/佣金/近28天销量/GMV）。

### 关键修复（实测踩坑）
1. **风控**：FastMoss 对 headless 自动化触发风控页（"正在保护您的数据"），headed 模式正常。→ `shop-detail` 默认 headed；`assertLoggedIn` 增加 `detectUrl` 参数 + 风控页识别（不再误判"未登录"）。
2. **登录检测**：达人搜索页偶发风控，店铺搜索页稳定 → `shop-detail` 用店铺页做登录检测。
3. **详情页就绪判据**：`waitForFunction` 在 SPA 二次跳转下易超时 → 改用 `safeEval` 轮询。
4. **URL 重复 /zh**：`BASE` 已含 /zh，拼 detailUrl 时重复 → 改用绝对 URL 拼接。
5. **提取精度**：总览卡片（标签前一个兄弟是数值）、评分（`店铺综合评分`容器内纯数字 span）、商品 td 结构（0商品名含售价/1分类/2上架时间/3佣金/4销量/5GMV）、价格带（`>75` 后跟 6 个百分比）。

### 同步更新
- SKILL.md / README.md 增加 shop-detail 命令文档。
- 实测验证：Steapex.Malaysia 详情全部字段抓取正确（评分3.8、总览8项、价格带、5个商品）。

## 补充3：第二轮完整重跑（2026-11-10 10:04）
用户要求重新完整跑一遍，看数据有无变化。

### 执行（批次 outputs/2026-11-10-my-running-shoes-r2/）
- 全程用 headed 模式（headless 触发风控，实测确认）。
- 抓分类树 + 运动与户外商品榜（300条 GMV排）+ 店铺榜（300条）+ Steapex 详情（shop-detail）。

### 结论：两轮数据完全一致（零差异）
- 鞋类商品 7 个、Steapex 第 56 名、总GMV RM584.63万、评分 3.8、相邻竞品、价格带全同。
- 原因：月榜（date_value=2026-10）是静态快照，两轮间隔仅 20 分钟抓同一窗口，必然一致。
- 要看变化需等 11 月月榜，或改抓近7天周榜/近1天日榜。

### 风控经验补充
- headless 会触发 FastMoss 风控页；headed 正常。→ 后续所有 RPA 抓取建议默认 headed。
- 风控解除：headed 打开页面等几秒即可恢复，无需人工点验证码（本轮实测）。

### 产出
- `跑步鞋销售与品牌对比报告-R2.md`（含两轮对比结论）

## 补充4：扩展 shop-detail 抓「商品分析」维度（2026-11-10 10:15）
用户要求看店铺商品排行和价格区间，并把商品分析固化进 shop-detail。

### 新增抓取字段（SHOP_DETAIL_EXTRACT_FN）
- `on_sell_count` / `product_count_note`：在售商品数口径（"历史上架14个、当前在售14个"）
- `category_distribution`：品类分布（一级/二级类目占比）
- `channel_distribution`：成交渠道占比（商品卡/店铺自营号/达人带货）
- `sale_method_distribution`：销售方式分布（视频/直播/商品卡）

### 关键修正
- 成交渠道/品类分布正则需精确截断（成交渠道截到"销售方式分布"前、品类分布截到"价格带分布"前），否则相邻区块数据会混入。

### 实测验证
- Steapex 品类分布：运动与户外 100%
- 成交渠道：商品卡12.05% / 店铺自营号8.78% / 达人带货79.17%
- 销售方式：视频64.13% / 直播23.82% / 商品卡12.05%
- 在售14个商品，近28天有动销5个（专业跑鞋 RM96.45-507）

### 商品排行/价格区间结论（Steapex）
- 5个近28天动销商品全是专业跑鞋，售价 RM96.45-507。
- 价格带：>RM75 占 98.35%，0-15 占 1.65%，中间档（15-75）完全空白。
- 最贵 HIVE SWIFT(RM507) 销售额最高 RM10.74万；走量主力 RUSH(RM112,659件)、OxyFlow(RM96,625件)。

## 补充5：固化「店铺详情→分析报告」一条龙（2026-11-10 10:17）
用户要求把获取详情数据的完整流程写在代码里，方便后续直接跑。

### 新增
1. `scripts/rpa/analyze-shop-detail.mjs`：店铺详情分析脚本，导出 `analyzeShopDetail(payload)` 函数（可被 import）+ CLI 入口。
   - 报告五部分：①店铺总览 ②商品排行(按GMV降序) ③价格带分布 ④品类/成交渠道/销售方式 ⑤核心洞察(自动生成)。
   - 金额保留「万/亿」中文单位格式（更直观）。
2. `shop-detail-report` 子命令（fastmoss-rpa.mjs）：搜索→抓详情→自动生成报告，一条命令跑完。
   - 用法：`shop-detail-report --shop Steapex.Malaysia --country 马来西亚 --out xxx.json`
   - 产出：JSON 数据 + 同目录 <shop名>_店铺详情分析.md。

### 实测
- `shop-detail-report` 全流程跑通：搜索→详情→报告，约 23s。
- 报告包含总览8项、5个商品排行、价格带、成交结构、5条核心洞察。

### 后续使用
```bash
# 一条龙（推荐）
node scripts/rpa/fastmoss-rpa.mjs shop-detail-report --shop <店铺名> --country <国家> --out outputs/<批次>/xxx.json
# 或离线分析已抓的 JSON
node scripts/rpa/analyze-shop-detail.mjs --file outputs/<批次>/xxx_detail.json
```

## 补充6：重跑发现滚动不足 bug 并修复（2026-11-10 10:26）
用户要求重新跑一次验证一条龙命令。

### 发现 bug
- `shop-detail` 命令用 `mouse.wheel` 滚动 12 次，成交分析区块（成交渠道占比/销售方式分布）**懒加载未稳定触发**，导致 `channel_distribution`/`sale_method_distribution` 偶发为空（第一次跑抓到、第二次空）。

### 修复
- 滚动方式改为 `window.scrollTo` 分段滚到底（每 800px 停顿 250ms）再回顶部，比 `mouse.wheel` 更可靠地触发所有 tab 的懒加载。

### 验证
- 修复后 `shop-detail-report` 一条龙重跑，成交渠道（商品卡12.05%/自营号8.78%/达人79.17%）和销售方式（视频64.13%/直播23.82%/商品卡12.05%）均稳定抓到。
- 报告五部分齐全（总览/商品排行/价格带/品类成交结构/核心洞察）。

## 补充7：固化「直播搜索」抓取（2026-11-10 10:33）
用户要求最后补上直播数据抓取，方便后续运行 skill。

### 新增 `live` 子命令
- 入口：顶部导航「直播」→ `/zh/live/search` 直播搜索页。
- 用法：`live --keyword steapex --country 马来西亚 --pages 3 --out lives.json`；不带 keyword 抓直播大盘。
- 抓取字段：标题/分类/主播(昵称+粉丝数+国家)/开播时间/结束时间/直播时长/累计观看/商品数/总销量/总销售额/UV价值/详情链接。

### 关键实现
1. 直播搜索框 placeholder「请输入直播标题相关内容/达人昵称/ID」，搜索后 URL 带 words=关键词。
2. 登录检测：直播页顶栏「旗舰版」标识 t+3s 才渲染，标准 assertLoggedIn 会误判 → 改用直播页特征（「直播间」表头/「筛选条件」）做就绪判据。
3. 时间字段：开播/结束时间含「日期+时间+时区」，需用下一个标签边界截断；直播时长用 HH:MM:SS 正则。

### 实测
- `live --keyword steapex` 抓到 5 场 Steapex 直播（主播 aimanpicasso_ 3场 + akubest501 2场），字段全对。

### 直播数据结论（Steapex 近期直播）
- 近期直播主要由 2 个小达人（aimanpicasso_ 4214粉、akubest501 4474粉）带货。
- 场均观看 634-1712，场均 GMV RM224-1725，UV 价值极低（RM0.35-1.37），直播带货体量很小。

## 补充8：固化「直播详情」抓取（2026-11-10 10:41）
用户要求把直播页面的操作都实现，方便后续 AI 直接操作。

### 新增 `live-detail` 子命令
- 抓单场直播详情（/zh/live/detail/<id>）：头部（标题/时间/时长/类型/主播/主推品类）+ 数据总览 13 项 + 直播带货商品列表 + Top3 商品。
- 支持单场（--id）和批量（--id-file lives.json --top N --out-dir）。

### 关键实现/踩坑
1. **登录检测统一**：live/live-detail 都改用店铺页 assertLoggedIn（直播页顶栏版本标识 t+3s 才渲染，易误判；连续 goto 会 Page crashed）。
2. **数据总览提取难点**：值是「标签前面」的（如「43.96万 累计观看人次」），且多个值挤在一起（「/小时」是小时指标、「个动销」是动销数）。需精确锚定每个字段（如 total_gmv 用 `(RM..) RM.. /小时 本场总销售额`）。
3. 13 项指标：观看/峰值/增粉/粉丝增长率/总销量/小时销量/总销售额/小时销售额/UV价值/平均成交单价/上架商品数/转化率/GPM。

### 实测
- 单场：itakosmetik 直播 13 项全对（观看43.96万、GMV RM83.28万、转化3.1%、GPM RM1894.61）。
- 批量：Steapex 5 场直播详情全抓到（GMV RM1724.76/RM991.69/RM358.37/RM224.4/RM0，与列表一致）。

### Steapex 直播详情数据（批量抓取）
| 主播 | 观看 | 峰值 | 增粉 | 销量 | GMV | UV价值 | 转化率 | GPM |
|---|---|---|---|---|---|---|---|---|
| aimanpicasso_ | 1263 | 16 | 5 | 10 | RM1724.76 | RM172.48 | 0.79% | RM1365.61 |
| aimanpicasso_ | 1712 | 14 | 10 | 7 | RM991.69 | RM141.67 | 0.41% | RM579.26 |
| aimanpicasso_ | 736 | 12 | 6 | 5 | RM358.37 | RM71.67 | 0.68% | RM486.92 |
| akubest501 | 634 | 7 | 4 | 2 | RM224.4 | RM112.2 | 0.32% | RM353.94 |
| akubest501 | 674 | 5 | 1 | 0 | RM0 | RM0 | 0% | RM0 |
