---
name: fassmoss-skill
description: 在用户要求 FastMoss/Fassmoss 的 TikTok 达人筛选、商品或新品榜、带货视频、店铺、直播分析及商品投流ROI时使用。操作已登录网页并生成有来源的名单和报告，采集使用项目独立 Chrome，不接 FastMoss API。飞书写入另行处理。
---

# FastMoss 数据助手

把用户的业务条件转为网页筛选、跨页面取证和可追溯的名单/报告。数据源为当前账号可访问的 `https://www.fastmoss.com/zh` 网页。优先运行随附脚本完成批量操作，采集使用项目专用登录资料打开独立 Chrome。

## 先定位运行环境

- 以本文件所在目录为技能根目录。运行示例前把工具的工作目录设为该目录，或使用脚本的绝对路径；不要假设用户当前项目就是技能目录。
- 用户给定的相对输入/输出路径先按其工作目录解析为绝对路径，再切换工作目录。默认名单和报告放技能目录的 `outputs/<本批次>/`，执行记录放 `operations/`。
- 首次使用或环境报错才读 [安装与登录](references/installation.md)。需要 Node.js 22+（建议24 LTS）、npm、所选浏览器；Python 3.10+仅用于 `.py` 工具。不依赖 AIOS、RTK、全局 Playwright 或开发者盘符。
- 首次执行 `node scripts/rpa/setup.mjs` 安装锁定依赖并无界面自检。账号未登录时提示用户单独运行 `node scripts/rpa/login-window.mjs`，在窗口登录并关闭后重跑；不要自行把普通采集切为前台。
- RPA 的 `.browser-profile/` 与助手浏览器扩展所连的日常 Chrome 是不同环境。一边已登录不证明另一边已登录。登录、采集使用同一浏览器配置，同一目录只跑一个任务。

## 按需求选入口

采集命令统一打开项目独立 Chrome。

独立的详情对象默认最多同时使用五个标签页。用 `--concurrency 1` 可以串行采集，`pipeline` 的详情阶段用 `--detail-concurrency 1`。同一页面的翻页和周期切换按顺序执行。

| 用户要什么 | 子命令/后续处理 | 按需读取 |
|---|---|---|
| 按条件找达人、读达人详情 | `search` / `pipeline` / `detail` → `analyze.mjs` | [达人采集与报告](references/fast-execution.md) |
| 逐人达人档案（基础/画像/优劣势/风险/收益锚/合作形式） | `analyze-profiles.mjs --dir <批次> [--subcategory 女包]` | [达人采集与报告](references/fast-execution.md) |
| 历史视频/直播带货、退货/评论、竞品推广与成本情景 | 详情页取证 → `history_analysis.py` | [历史证据与计算](references/history-workflow.md) |
| 商品销量榜、品牌、价格带 | `product` → `analyze-product.mjs` | [商品流程](references/product-workflow.md) |
| 商品反查达人、指定竞品达人 | `product-creators` | [三个重点工作流](references/priority-workflows.md) |
| 通用新品机会分析 | `new-opportunities` | [新品机会与规则](references/priority-workflows.md) |
| 竞品上新/调价/达人/素材变化 | `competitor-diff` | [快照与变化对照](references/priority-workflows.md) |
| 新品榜与爬坡趋势 | `new-products`；列表固定三日，近7天另进详情 | [新品与趋势](references/product-workflow.md#新品榜近期上架商品三日销量口径) |
| 商品投流 ROI | `product-roi`；类目榜前N用 `category-roi` | [商品投流ROI](references/product-workflow.md#商品投流-roi) |
| 单条带货视频、TikTok原链接 | `video` | [视频流程](references/video-workflow.md) |
| 哪些商品有更多新发布带货视频 | `hot-video` → `render-hot-video-report.mjs` | [视频商品榜](references/video-workflow.md) |
| 店铺榜、店铺详情与报告 | `shop` / `shop-detail` / `shop-detail-report` | [店铺流程](references/shop-workflow.md) |
| 店铺涨跌、店铺对比、店铺达人、综合洞察 | `shop-trend` / `shop-compare` / `shop-authors` / `shop-insight` | [店铺流程](references/shop-workflow.md) |
| 直播搜索、单场数据、场内商品 | `live` / `live-detail` | [直播流程](references/live-workflow.md) |
| 单条广告素材案例 | `ad`，不用于商品ROI | [视频与广告](references/video-workflow.md) |
| 分类树或站点切换 | `categories` / `country` | [分类匹配](references/natural-language.md)、[国家切换](references/browser-workflow.md) |
| 本地达人池 | `creator_pool.py` | [本地工具](references/local-pool.md) |

需要组合任务或白话参数映射时读 [自然语言路由](references/natural-language.md)。飞书写入另用可用的飞书工具，不能让飞书配置阻塞网页采集。

## 执行与交付

1. 保留用户明确的对象、国家、时间、数量、筛选和输出位置。未指定国家可沿用已确认的页面站点并说明；报价预算须明确币种、视频/直播合作形式。已有信息不重复询问。
2. 区分页面硬筛选和证据条件。粉丝、类目、榜单字段可筛；测评属性需内容证据，报价需来源，GMV高不等于高转化。未知条件保留待核实，不凑人数冒充全条件通过。
3. 分类按当前树精确匹配一/二/三级，冲突或歧义先解决，不扩大到全站冒充细分类。分类缓存不存在且任务依赖它时才运行 `categories`；关键词/ID输入的商品ROI不需要分类树。
4. 首次在新环境用本任务的小样本核对站点、筛选、周期与字段，成功后按用户数量扩展；已验证的运行环境无需每次重装、登录或重新演示。列表能批量运行时不逐条让用户等待操作。
5. 每个模块核对自身周期与来源。确认当前模块无数据后，记录空结果并继续下一个已配置步骤；分页确认空页时结束该榜单。加载中、超时或验证阻挡按各自状态处理。保留字符串ID、来源URL、原文和抓取时间，披露实际覆盖范围。
6. PID/`started` 仅表示进程启动。检查后台日志和 JSON 状态；需要离线报告时等采集结束再执行分析。验证报告实际存在且与输入一致后再称完成。

交付先给用户可读的结果：实际完成数量、主要发现或推荐表、可点击的报告/数据路径，再列影响决策的未知或未完成项。每条推荐附依据；样本不足时交付有效的实际人数及原因。不要只返回一堆JSON，也不要把数据量、速度或历史成功记录当作本轮质量证明。

## 口径与停止条件

- 商品投流ROI只取同商品详情「投流分析」`#putData` 的同周期、同币种销售额 ÷ 广告消耗。不得混入商品总览GMV、单条素材ROAS，也不从ROAS反推GMV；它不等于净利润ROI。
- `product-roi` 仅支持近7/28/90天；明确要求30天时说明差异并等待用户选择，不自动换为28天。新品榜固定三日。商品自然日/周/月榜不等于精确滚动天数，保留有效 `date_type/date_value`。店铺涨跌仅对两个完整连续等长周期计算。
- 通用新品机会用 `new-opportunities`；`analyze-phonecase-trend.mjs` 仍只适用于手机壳商品名规则。只分析新品时使用 `--new-only`；未采集销量榜不能伪造空文件。趋势只由详情同一个完整近7天逐日序列计算；缺日期、分母或权限时为未知。
- GMV/销量是件均销售额，GMV/订单才是订单客单价。转化率、退货率、真实报价、评论情绪没有证据就写未知；投产情景须有用户成本和明确假设。
- 竞品未指定时先给商品/店铺推广记录，不擅自指定竞品。推广记录不证明付费合作，频次按已观察到的商品链接视频ID/直播ID去重，不能把TOP合作店铺的商品数当作合作次数。
- 独立采集窗口出现验证码弹窗时，临时放行图片并等待人工验证，最多三分钟。弹窗消失后重新检查页面状态并恢复拦图。登录失效、权限或次数上限，以及验证未通过时停止并保存可用结果。
采集命令统一打开项目独立 Chrome。

## 可直接开始的示例

工作目录设为技能根后，以下采集命令逐个商品进入投流分析并生成 JSON 与同名 Markdown：

```text
node scripts/rpa/fastmoss-rpa.mjs product-roi --country 美国 --keyword earbuds --pages 1 --top 5 --period 28 --out outputs/earbuds-roi/product-roi.json
```

替换为用户的变量，不把示例的国家、类目、数量或周期设成所有任务的默认值。技能发现、首次使用和实测范围见 [安装说明](references/installation.md) 与 [验收范围](references/verification.md)。
