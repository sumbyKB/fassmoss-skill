# FastMoss Skill

在用户已登录的 FastMoss 网页中按自然语言条件搜索达人、分析商品和店铺，逐个商品读取投流数据并计算 ROI。不需要 FastMoss API，不需要安装 Python 依赖。整个目录自包含，复制给同事后按下方要求准备环境即可使用。

## 各工具如何接入

需要让助手自动发现技能时，按 [安装说明](references/installation.md#让助手发现技能) 放入该助手支持的技能目录，再在该副本中安装与登录。Codex 可用 `$fassmoss-skill`，Claude Code 可用 `/fassmoss-skill`。

普通目录模式下，Codex 从项目 `AGENTS.md`、Claude Code 从 `CLAUDE.md` 引导到 `SKILL.md`；其它助手可显式读取 `SKILL.md`。项目入口文件不等于全局技能安装，不承诺 Workbuddy 自动加载 `GEMINI.md`。

## 环境要求

1. **Node.js ≥22（建议24 LTS）和 npm** — 安装依赖与网页采集需要；安装 Node 后重新打开终端。
2. **Google Chrome** — 默认浏览器，见 [新电脑使用说明](references/installation.md)。
3. **Python ≥3.10（可选）** — 仅本地达人池、历史证据分析和制作分享包需要，全部使用标准库。Node 采集与报告不依赖 Python。
4. **FastMoss 账号和网页访问权限** — 每个人在本机独立登录，不复制别人的登录目录。

在解压的项目目录运行下面的三步；安装脚本会自动做无界面自检。遇到环境问题可以单独运行 `node scripts/rpa/doctor.mjs`。安装和自检不使用日常浏览器，不访问 FastMoss。

```text
node scripts/rpa/setup.mjs
node scripts/rpa/login-window.mjs
node scripts/rpa/fastmoss-rpa.mjs product-roi --country 美国 --keyword earbuds --top 10 --period 28 --out outputs/roi/product-roi.json
```

第二步在打开的窗口中登录，关闭整个窗口后再执行第三步。采集完成以命令输出和结果文件为准。安装方式、各系统的浏览器配置及常见问题见 [新电脑使用说明](references/installation.md)。

分享项目请用打包脚本，它只打包运行源码和使用说明，不包含登录态、业务数据、本地工具配置或测试文件：

```text
python -X utf8 scripts/package_share.py
```

产物为 `outputs/distribution/fastmoss-skill.zip`；重复打包请用 `--out 新文件名.zip`，不覆盖已有包。同事解压后从安装第一步开始，无需开发者电脑上的依赖或目录。

## 三个重点工作流

```text
node scripts/rpa/fastmoss-rpa.mjs product-creators --country 美国 --id 1732198421819330715 --top 20 --out outputs/product-creators/result.json
node scripts/rpa/fastmoss-rpa.mjs new-opportunities --country 美国 --category 箱包 --pages 3 --scan 30 --top 10 --out outputs/new-opportunities/result.json
node scripts/rpa/fastmoss-rpa.mjs competitor-diff --country 美国 --shop-id 7496301295491516571 --pages 3 --out outputs/competitor/result.json
```

完整参数、原始周期、规则评分和基线保护见 [重点工作流说明](references/priority-workflows.md)。采集统一打开项目独立 Chrome。

## 常用命令

通过 AI 助手使用时可以直接说：「查美国 earbuds 前10个商品近28天的投流ROI，使用独立浏览器，保存报告。」同事无需指定网页按钮；助手按 `SKILL.md` 和任务路由选择 `product-roi`。

其它常用命令如下：

```bash
# 完整抓取 + 分析（RPA 主路径）
node scripts/rpa/setup.mjs            # 首次：按锁文件安装依赖并自检
node scripts/rpa/login-window.mjs     # 弹窗登录一次（登录态存 .browser-profile/）
node scripts/rpa/fastmoss-rpa.mjs country 泰国                    # 切换国家站点（可选，持久化）
node scripts/rpa/fastmoss-rpa.mjs pipeline --pages 60 --top 18 --follower 5000,50000 --category 7 --out-dir outputs/<批次>
node scripts/rpa/analyze.mjs --dir outputs/<批次> --top 10   # 出 JSON + 多维度分析报告.md
node scripts/rpa/analyze-profiles.mjs --dir outputs/<批次> --top 10 --subcategory 女包   # 出逐人达人档案.md + profiles.json + top10.json

# 抓取时顺带切国家（美国/泰国/印尼/越南/马来/菲律宾/日本/新加坡/英/德/法/西/意/墨西哥/巴西）
node scripts/rpa/fastmoss-rpa.mjs pipeline --country 泰国 --follower 2000,50000 --category 7 --pages 60 --top 10
node scripts/rpa/fastmoss-rpa.mjs search --country 印尼 --follower 5000,50000 --category 7 --pages 30

# 商品销售榜分析（细分品类 / 品牌对比 / 价格带）
node scripts/rpa/fastmoss-rpa.mjs categories --country 泰国 --out outputs/categories.json   # 先抓分类映射
node scripts/rpa/fastmoss-rpa.mjs product --country 泰国 --days 14 --category-id 6 --pages 20 --out outputs/<批次>/products.json
node scripts/rpa/analyze-product.mjs --dir outputs/<批次> --category 运动鞋 --brand 品牌名 --top 20

# 三级分类（如手机壳）：--category 手机壳 自动匹配 l3_cid=601925（保护壳、屏幕保护膜、皮肤）
node scripts/rpa/fastmoss-rpa.mjs product --country 美国 --category 手机壳 --days 7 --pages 20 --out outputs/<批次>/products.json
node scripts/rpa/fastmoss-rpa.mjs hot-video --country 美国 --category 手机壳 --pages 20 --out outputs/<批次>/hotvideo.json

# 新品榜（近期上架商品，固定「三日销量」口径，无近7天/环比）
node scripts/rpa/fastmoss-rpa.mjs new-products --country 美国 --category-id 16 --category-id2 909064 --pages 20 --out outputs/<批次>/newproducts.json

# 商品投流ROI：逐个进入商品详情的「投流分析」，销售额 / 同周期广告消耗
node scripts/rpa/fastmoss-rpa.mjs product-roi --country 美国 --keyword earbuds --pages 1 --top 10 --period 28 --out outputs/<批次>/product-roi.json
node scripts/rpa/fastmoss-rpa.mjs product-roi --country 美国 --ids-file outputs/<批次>/products.json --period 28 --out outputs/<批次>/product-roi.json

# 店铺榜分析（品牌 / 分类 / 评分）
node scripts/rpa/fastmoss-rpa.mjs shop --country 泰国 --category 箱包 --pages 10 --out outputs/<批次>/shops.json
node scripts/rpa/analyze-shop.mjs --dir outputs/<批次> --category 箱包 --brand 品牌名 --top 20

# 店铺详情（搜索店铺名 → 进详情页 → 抓数据）
node scripts/rpa/fastmoss-rpa.mjs shop-detail --shop Steapex.Malaysia --country 马来西亚 --out outputs/<批次>/xxx_detail.json
node scripts/rpa/fastmoss-rpa.mjs shop-detail --shop-id 7494233487112177345   # 已知 ID 直接抓

# 店铺详情一条龙（搜索 → 抓详情 → 自动生成分析报告）
node scripts/rpa/fastmoss-rpa.mjs shop-detail-report --shop Steapex.Malaysia --country 马来西亚 --out outputs/<批次>/xxx.json
# 离线分析（对已抓 JSON 单独出报告）
node scripts/rpa/analyze-shop-detail.mjs --file outputs/<批次>/xxx_detail.json --top 20

# 直播搜索（按关键词/达人昵称搜直播，抓直播列表）
node scripts/rpa/fastmoss-rpa.mjs live --keyword steapex --country 马来西亚 --pages 3 --out outputs/<批次>/lives.json
node scripts/rpa/fastmoss-rpa.mjs live --country 马来西亚 --pages 10 --out lives.json   # 直播大盘

# 直播详情（抓单场直播数据总览 + 商品列表 + Top3）
node scripts/rpa/fastmoss-rpa.mjs live-detail --id 7705217919278762773 --country 马来西亚 --out xxx.json
node scripts/rpa/fastmoss-rpa.mjs live-detail --id-file lives.json --top 5 --out-dir outputs/<批次>   # 批量抓多场

# 视频搜索（搜带货视频，抓列表 + TikTok 链接 + 视频类型）
node scripts/rpa/fastmoss-rpa.mjs video --keyword "phone case" --country 美国 --pages 2 --top 10 --out outputs/<批次>/videos.json

# 单条广告案例数据（广告创意中心；不用于商品ROI）
node scripts/rpa/fastmoss-rpa.mjs ad --country 美国 --category-id 16 --start 2026-10-09 --end 2026-11-09 --pages 10 --out outputs/<批次>/ads.json

# 历史带货分析：网页采集 evidence.json 后
python scripts/history_analysis.py outputs/<批次>/evidence.json --output outputs/<批次>

# 本地达人池
python scripts/creator_pool.py import outputs/<批次>/creators.json          # 扁平 schema（见 --final 的说明）
python scripts/creator_pool.py import outputs/<批次>/creators-final.json --final   # 直接吃 analyze.mjs 产物，自动拍平
python scripts/creator_pool.py search "包包、粉丝2–10w、报价≤8k"
python scripts/creator_pool.py profiles
```

## 目录结构

```
SKILL.md          # 能力定义与执行流程（唯一入口，先读这个）
references/       # 分场景执行手册：natural-language（大白话路由）/ fast-execution /
                  # browser-workflow / history-workflow / live-workflow / local-pool /
                  # product-workflow（商品分析）/ data-and-roadmap
scripts/          # history_analysis.py、creator_pool.py、package_share.py（纯标准库）
                  # rpa/（RPA 主路径：fastmoss-rpa.mjs + analyze.mjs +
                  #      product-roi.mjs + analyze-product.mjs + analyze-shop.mjs + setup/login）
operations/       # 每次实际执行的记录（日期、条件、结果、阻碍）
outputs/          # 任务产物，git 忽略，不入库
AGENTS.md / CLAUDE.md / GEMINI.md   # 各工具入口路由
```

## 开发者离线验证（完整源码仓库）

```text
node --test scripts/rpa/cli.test.mjs scripts/rpa/data-rules.test.mjs scripts/rpa/lifecycle.test.mjs scripts/rpa/product-roi.test.mjs scripts/rpa/tracker.test.mjs scripts/rpa/shop-analysis.test.mjs scripts/rpa/workflow.test.mjs
```

分享包不包含测试文件；维护完整源码时也可直接运行 `npm test`。

测试覆盖参数校验、数据规则、离线分析重复运行、每个命令成功/失败时的实际收尾顺序、旧响应隔离、完整日期对比、零销量商品、跨品类排名、商品日期生效、搜索结果核验、商品分页和验证中止。页面测试需要上述RPA环境（锁定的Playwright + 所选浏览器），使用本地拦截页面和独立无界面浏览器，不使用账户、不访问真实FastMoss。真实网页采集仍需单独实测。

店铺趋势的 `--days` 支持1到45，只有两个完整等长周期才计算环比；报告中的 `partial` 表示页面清单或逐日数据覆盖不足。店铺对比默认不筛最低售价或配件；可用 `--min-price` 和 `--exclude-keywords` 显式指定。商品榜指定历史日期时用 `--date-value`，页面未生效会报错。详细修正记录见 [当前验收范围](references/verification.md)。

## 数据边界（摘要，全文见 SKILL.md）

- 所有结论区分平台显示值、计算值与推断；缺分母的指标保持 null，不悄悄替换口径。
- 只用当前账号可访问的页面和允许的导出；不绕过验证码、付费权限。
- 不发送邀约、不联系达人、不购买服务；凭证/Cookie/令牌不写入报告或操作记录。登录态由Playwright保存在本机 `.browser-profile/`，复制项目给同事时排除该目录。
- 已验证范围与未验证功能见 `operations/` 下各记录与 `SKILL.md` 末节。
