# FastMoss Skill

在用户已登录的 FastMoss 网页中按自然语言条件搜索达人、分析商品和店铺，逐个商品读取投流数据并计算 ROI。不需要 FastMoss API，不需要安装 Python 依赖。整个目录自包含，复制给同事后按下方要求准备环境即可使用。

## 各工具如何接入

本目录被三类 AI 编码助手使用，入口文件均已配置好，工具启动时会自动读取：

| 工具 | 读取文件 | 说明 |
| --- | --- | --- |
| Codex | `AGENTS.md` | 自动加载，路由到 `SKILL.md` |
| Claude Code | `CLAUDE.md` | 自动加载，路由到 `SKILL.md` |
| Workbuddy | `GEMINI.md` | 自动加载，路由到 `SKILL.md` |

三个文件内容一致，任何工具从任意入口进入都会被引导到 `SKILL.md`（唯一的能力定义源）。

**Claude Code 用户（可选）**：把整个目录复制为 `~/.claude/skills/fassmoss-skill/`，即可通过 `/fassmoss-skill` 或自然语言触发。`SKILL.md` 的 frontmatter（name/description）已符合 Claude 技能规范。

## 环境要求

1. **Python ≥ 3.10** — 分析与建库脚本只用标准库，无需 pip install。
2. **Node ≥ 18** — `scripts/rpa/`（RPA 抓取）需要，首次运行先 `node scripts/rpa/setup.mjs` 装 playwright 到本地 `.tools/`。
3. **系统Chrome与Playwright** — RPA主路径使用项目独立的 `.browser-profile/` 登录态。首次运行登录脚本后，正常采集默认无界面执行。通过助手浏览器工具进行页面抽查时，接入方式见 [references/browser-workflow.md](references/browser-workflow.md)。
4. **网络可达 `www.fastmoss.com`**，且用户已在浏览器中登录 FastMoss。

## 常用命令

同事首次使用商品 ROI 时，在项目根目录先执行环境准备，再打开登录窗口：

```text
node scripts/rpa/setup.mjs
node scripts/rpa/login-window.mjs
```

在弹出的窗口人工登录并关闭窗口后，复制下面这一条即可后台搜索、逐个进入商品投流分析、计算 ROI 并生成报告：

```text
node scripts/rpa/run-background.mjs product-roi --country 美国 --keyword earbuds --pages 1 --top 10 --period 28 --out outputs/product-roi/product-roi.json
```

替换国家、关键词、数量和周期即可；每个批次换一个输出目录。结果为 `product-roi.json` 和同名 `product-roi.md`，后台日志路径由启动器返回。检查日志和每个商品的状态后再确认完成；真实站点批量后台采集尚未实测。完整输入选项和口径见 [商品 ROI 流程](references/product-workflow.md#商品投流-roi)。

通过 AI 助手使用时可以直接说：「查美国 earbuds 前10个商品近28天的投流ROI，后台运行，保存报告。」同事无需指定网页按钮；助手按 `SKILL.md` 和任务路由选择 `product-roi`。

其它常用命令如下：

```bash
# 完整抓取 + 分析（RPA 主路径）
node scripts/rpa/setup.mjs            # 首次：装 playwright 到 .tools/
node scripts/rpa/login-window.mjs     # 弹窗登录一次（登录态存 .browser-profile/）
node scripts/rpa/fastmoss-rpa.mjs country 泰国                    # 切换国家站点（可选，持久化）
node scripts/rpa/fastmoss-rpa.mjs pipeline --pages 60 --top 18 --follower 5000,50000 --category 7 --out-dir outputs/<批次>
node scripts/rpa/analyze.mjs --dir outputs/<批次> --top 10   # 出 JSON + 多维度分析报告.md

# 抓取时顺带切国家（美国/泰国/印尼/越南/马来/菲律宾/日本/新加坡/英/德/法/西/意/墨西哥/巴西）
node scripts/rpa/fastmoss-rpa.mjs pipeline --country 泰国 --follower 2000,50000 --category 7 --pages 60 --top 10
node scripts/rpa/fastmoss-rpa.mjs search --country 印尼 --follower 5000,50000 --category 7 --pages 30

# 商品销售榜分析（细分品类 / 品牌对比 / 价格带）
node scripts/rpa/fastmoss-rpa.mjs categories --country 泰国 --out outputs/categories.json   # 先抓分类映射
node scripts/rpa/fastmoss-rpa.mjs product --country 泰国 --days 14 --category-id 6 --pages 20 --out outputs/<批次>/products.json
node scripts/rpa/analyze-product.mjs --dir outputs/<批次> --category 运动鞋 --brand 品牌名 --top 20

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
python scripts/creator_pool.py import outputs/<批次>/creators.json
python scripts/creator_pool.py search "包包、粉丝2–10w、报价≤8k"
python scripts/creator_pool.py profiles
```

## 目录结构

```
SKILL.md          # 能力定义与执行流程（唯一入口，先读这个）
references/       # 分场景执行手册：natural-language（大白话路由）/ fast-execution /
                  # browser-workflow / history-workflow / live-workflow / local-pool /
                  # product-workflow（商品分析）/ data-and-roadmap
scripts/          # history_analysis.py、creator_pool.py（纯标准库）
                  # rpa/（RPA 主路径：fastmoss-rpa.mjs + analyze.mjs +
                  #      product-roi.mjs + analyze-product.mjs + analyze-shop.mjs + setup/login）
operations/       # 每次实际执行的记录（日期、条件、结果、阻碍）
outputs/          # 任务产物，git 忽略，不入库
AGENTS.md / CLAUDE.md / GEMINI.md   # 各工具入口路由
```

## 离线测试

```text
node --test scripts/rpa/cli.test.mjs scripts/rpa/data-rules.test.mjs scripts/rpa/lifecycle.test.mjs scripts/rpa/product-roi.test.mjs
```

测试覆盖参数校验、数据规则、离线分析重复运行、各命令的异步收尾、默认无界面、商品投流模块取值与周期刷新。商品ROI页面测试需要上述RPA环境（Playwright + 系统Chrome），使用本地拦截页面和独立无界面浏览器，不使用账户、不访问真实FastMoss。真实网页采集仍需单独实测。

## 数据边界（摘要，全文见 SKILL.md）

- 所有结论区分平台显示值、计算值与推断；缺分母的指标保持 null，不悄悄替换口径。
- 只用当前账号可访问的页面和允许的导出；不绕过验证码、付费权限。
- 不发送邀约、不联系达人、不购买服务；凭证/Cookie/令牌不写入报告或操作记录。登录态由Playwright保存在本机 `.browser-profile/`，复制项目给同事时排除该目录。
- 已验证范围与未验证功能见 `operations/` 下各记录与 `SKILL.md` 末节。
# 后台运行

采集脚本默认使用无界面浏览器，不弹出Chrome窗口。需要任务在终端返回后继续执行时：

```text
node scripts/rpa/run-background.mjs search --country 美国 --follower 5000,50000 --category 7 --pages 1
node scripts/rpa/run-background.mjs product-roi --country 美国 --keyword earbuds --top 10 --period 28 --out outputs/<批次>/product-roi.json
```

启动器返回进程PID和日志路径。日志保存在 `outputs/background/`，可通过任务管理器结束对应PID。启动信息不代表采集完成，请检查日志末尾及产物。首次或登录过期时先执行 `node scripts/rpa/login-window.mjs`，完成登录并关闭该窗口。采集与登录请勿同时使用同一项目的浏览器配置。需要查看调试窗口时直接运行原采集命令并加 `--headed true`。

助手通过浏览器扩展控制的日常Chrome窗口与RPA的 `.browser-profile/` 是不同登录环境：一边已登录不代表另一边也已登录。页面核对和采集记录必须说明使用哪种环境，避免在错误窗口重复登录。
