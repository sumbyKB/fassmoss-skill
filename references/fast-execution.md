# 快速网页执行（RPA 主路径）

先按任务选择采集入口，再复用已登录的 FastMoss 网页读取数据。批量任务用 `scripts/rpa/fastmoss-rpa.mjs` 一次完成采集与落盘；需要单独分析的任务再运行对应分析脚本。

## 按任务选择入口

| 用户要什么 | 执行路径 | 报告 |
|---|---|---|
| 达人名单、达人历史带货 | `pipeline` / `detail` → `analyze.mjs` | 多维度分析报告 |
| 商品销售、品牌对比、价格带 | `product` → `analyze-product.mjs` | brand-comparison.md |
| 商品 ROI、商品投产、GMV / 广告费 | `product-roi` → 商品详情 → 投流分析 | 命令自动生成 JSON 和同名 Markdown |
| 店铺榜 | `shop` → `analyze-shop.mjs` | shop-analysis.md |
| 店铺详情 | `shop-detail-report` | 命令自动生成店铺详情报告 |

商品 ROI 的完整参数和数据口径见 [product-workflow.md](product-workflow.md#商品投流-roi)。下文的达人专用命令、列映射和耗时，只适用于达人任务。

## 登录与后台运行

批量采集使用 Playwright 和本机独立的 `.browser-profile/` 保存登录状态。首次运行 `setup.mjs` 后，运行 `login-window.mjs`，在弹出的窗口人工登录并关闭该窗口，再启动采集。同一 profile 同时只运行一个登录或采集进程。

采集默认无界面；需脱离终端继续运行时用 `run-background.mjs <子命令及参数>`。只有用户明确要求前台演示或调试时才开启可见窗口。通过当前环境的浏览器工具抽查页面时，先确认连接的标签页已登录；扩展连接的日常 Chrome 与 RPA profile 的登录状态独立。

## 商品 ROI：一条命令完成采集与报告

从项目根目录运行，首次准备和登录完成后，日常只需最后一条命令：

```text
node scripts/rpa/setup.mjs
node scripts/rpa/login-window.mjs
```

登录完成并关闭登录窗口后：

```text
node scripts/rpa/run-background.mjs product-roi --country 美国 --keyword earbuds --pages 1 --top 10 --period 28 --out outputs/product-roi/product-roi.json
```

替换国家、关键词、数量和周期即可复用。返回 PID 和日志路径后，通过日志末尾及 `outputs/product-roi/product-roi.json` / `product-roi.md` 核对完成情况；启动成功只代表进程已创建。每个批次使用独立输出目录，避免覆盖已有报告。

已有商品清单时，将 `--keyword earbuds --pages 1 --top 10` 换成 `--ids-file outputs/批次/products.json`；单个商品用 `--ids 商品ID`。三种输入选一种。逐个商品读取同一周期的投流销售额和广告消耗，ROI=前者÷后者，平台 ROAS 单独保留。缺指标、周期不明或广告消耗为0时显示未知，验证或权限提示会停止后续访问。

支持近7/28/90天，近28天不能当近30天。这里的金额来自商品「投流分析」，不混入商品总览，也不用单条广告案例替代。前台单商品和本地无界面页面测试已验证；真实网站的完整后台批量采集尚未实测。

## 达人任务：采集后离线分析

```bash
# 0. 首次：装 playwright 到技能目录 .tools（不入库）
node scripts/rpa/setup.mjs

# 1. 一次性登录（弹出 Chrome 窗口，手动登录一次，登录态存 .browser-profile/）
node scripts/rpa/login-window.mjs   # 登录后关窗口即可，profile 已持久化

# 2. 一条龙：60 页列表 + 18 位详情，落盘 candidates.json + details.json
node scripts/rpa/fastmoss-rpa.mjs pipeline \
  --pages 60 --top 18 \
  --follower 5000,50000 --category 7 \
  --concurrency 6 \
  --out-dir outputs/2026-11-09-us-bags-rpa

# 3. 离线分析：candidates.json + details.json → 推荐名单 / 竞品 / evidence / 多维度分析报告
node scripts/rpa/analyze.mjs --dir outputs/2026-11-09-us-bags-rpa --top 10
```

子命令：
- `search` —— 只抓列表页（`--pages N --follower 5000,50000 --category 7`）
- `detail` —— 只抓详情（`--ids-file ids.json` 或 `--ids id1,id2`）
- `pipeline` —— 列表 + 详情一条龙

## 分析报告（统一标准）

`analyze.mjs` 跑完会生成 `多维度分析报告.md`，**结构固定六部分**，任何人拿到数据都得到一致的分析：

1. 筛选口径核对（哪些可硬筛/只能推断/无来源）
2. 候选人类型结构（直播/视频/混合型 + 测评盘点）
3. 综合打分推荐名单（箱包垂直度25 + GPM20 + 包GMV25 + 客单价10 + 测评10 + 佣金10 = 100 分，可复现）
4. 维度拆解（垂直度/GPM/历史GMV/客单价/测评/竞品/投产，各一表）
5. 缺口清单（报价/退货率/评论舆情/转化率，诚实标注未知）
6. 行动建议（首推纯箱包/测评降级/竞品排他/报价核实，自动生成）

**报告原则**：数字全部从数据算出、不硬编码；定性分级用规则函数（`tierBag`/`typeOf`/`estimateROI`），不是手写结论；「估算/推断」处标注，未知字段用「未知」不用 0。

## 实测耗时（2026-11-09，美国站，箱包类目）

| 场景 | 耗时 | 数据完整度 |
| --- | --- | --- |
| search 6 页 60 位（并发 6） | 7.3s（启动 0.5s） | 100% |
| detail 18 位串行 | 59.7s（单页 3.3s） | 18/18 done，0 空表 |
| pipeline 60 页 + 18 位详情 | 133s（列表 66s + 详情 63s） | 18/18 有数据 |

**详情必须串行（并发 1）**：实测并发 3 会让约 40% 的后台 tab 懒加载接口不触发——后台 tab 被 Chromium 降频，`IntersectionObserver` 不回调，4 个列表接口根本发不出去，既丢数据又等满超时反而更慢。串行单页稳定 3s、100% 成功。

## 详情页抓取的关键坑（2026-11-09 实测）

详情页 4 张表（视频/直播/商品/店铺）由 4 个接口喂数据，且**都是「滚到可视区才发请求」的懒加载**：

- `/api/author/v3/detail/videoList` / `liveList` / `goodsList` / `shopList`

所以「暂无数据」只代表还没请求，绝不能当加载完成。就绪判据 = **监听这 4 个接口的 response 是否都返回过**（有数据没数据都返回 200），而不是猜 sleep：

1. 分步滚到底（同一帧里连续 `scrollTo` 只有最后一次会被绘制，必须步间 `waitForTimeout`）
2. 监听 response，4 个接口齐了立刻停
3. 逐表确认：有真实数据行 = 就绪；接口已返回且表内明确「无数据」且连续 2 轮不变 = 确实无数据

三个必须记住的点：
- **接口有 `MSG_SAFE_0001` 签名校验**，不能从页面上下文直接 `fetch` 放大 pagesize，只能走 UI 滚动触发。
- **并发 = 丢数据元凶**。详情串行，别为了快并发。
- **表格真实数据行** = `td 数 >= 2 且整行非空白`；antd 的隐藏测量行 + 「暂无数据」占位行都不算数据。

## 列映射（analyze.mjs 依赖）

列表页 `cells`：`[0]达人信息 [1]带货品类 [2]近28天总销量 [3]近28天总销售额 [4]销量趋势 [5]平均播放量 [6]粉丝数 [7]涨粉数 [8]互动率 [9]赞粉比 [10]首视频时间 [11]操作`

详情页视频表 `cells`：`[0]标题 [1]发布时间 [2]视频类型 [3]视频销量 [4]视频销售额 [5]播放量 [6]互动率 [7]带货商品 [8]操作`

详情页商品表 `cells`：`[0]商品 [1]价格 [2]销量 [3]销售额 [4]上架时间 [5]佣金比例 [6]所属店铺`

## 数据边界（不可省）

- 近28天 ≠ 近30天；视频 GMV=0 可能是达人主做直播（candy 直播 GMV $132 万、视频全"非带货"），不是采集 bug，需结合总览的「带货视频 GMV / 带货直播 GMV」判断达人类型。
- GMV ≠ 转化率、净利润、ROI。退货率、真实报价、点击转化率缺来源时写未知，不用 0 顶替。
- 总览里「83.27万」这类大数字可能是**全国排名**，不是粉丝数；粉丝数以列表页 `cells[6]` 为准。
