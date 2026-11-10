# 商品 ROI 口径修正与前台验证 · 2026-11-10

用户要求：商品搜索后逐个进入商品详情的投流分析，以 GMV / 广告花费计算。普通采集保持后台，前台仅用于用户明确要求的演示。

## 结果与范围

- 已前台操作：登录后的 Chrome 商品搜索（earbuds）→ 右上角切美国站 → INSONIXN 商品详情 → 投流分析。只读网页，不接入 FastMoss API。已将结果页面保留给用户核对。
- 商品ID 1732198421819330715，#putData 自己的选中周期为近28天。销售额 $6.11万、广告消耗 $2.76万，重算 ROI 2.2138（展示2.21），平台ROAS 2.22。总览的 $13.80万 不参与计算；两种ROAS差异保留为缩写金额舍入。
- 2026-11-10T06:41:44.015Z 再用与新模块相同的 productAdsSnapshot 函数读取真实页面，确认7张指标卡、周期、来源和非加载态。该时间为北京时间14:41。
- 证据和核对报告：outputs/2026-11-10-product-roi-verified/product-roi.json / product-roi.md。该产物标记 validation_mode=foreground_browser_dom，不冒充后台RPA批量运行。
- 新增 product-roi 子命令：关键词搜索、商品ID、商品JSON清单三选一；顺序进入详情并点击投流分析，7/28/90天，稳定ID去重，每个商品完成保存JSON与Markdown。
- 缺指标、币种冲突、周期未知、广告花费为0时ROI为null。页面风控/登录/权限阻挡停止后续商品并保留部分结果。平台ROAS仅作对照，不反推GMV。
- 回归修复：周期按钮已切换但旧networkidle已满足时可能读取旧金额；现在先等点击产生的数据响应，再等空闲和DOM稳定。不同周期金额相同仍可正常完成。
- 视频/广告新增入口残留的默认前台设置同步修正，所有采集入口只有显式 headed=true 才显示窗口；后台启动器强制 headed=false。
- 使用现有 parseAmount、浏览器生命周期、国家切换和落盘路径，新增商品投流模块承接采集与计算，不改达人利润ROI情景模型。工作区原有改动与删除均保留。

## 连接问题

初次登录窗口为独立 .browser-profile，浏览器扩展连接的是另一套Chrome登录环境，误将游客页判断套到已登录窗口。原生窗口控制因无法可靠读取URL被工具停止，未绕过。之后按用户要求新建可控Chrome标签页，用户在此登录后前台路径成功。

## 验证限制

真实站点已验证前台导航与新DOM提取函数；完整 product-roi 命令的真实后台批量采集尚未实测。无界面浏览器测试使用拦截本地HTML，不访问真实站点、不使用账号。RPA仍使用独立 .browser-profile，不能将扩展窗口已登录等同于RPA已登录；不得同时占用同一profile。

## 工程核验

VERDICT:
retry_budget: 3 remaining: 1
FILES_REVIEWED:
  - scripts/rpa/product-roi.mjs: lines 1-190 (changed; existing unrelated edits preserved)
  - scripts/rpa/fastmoss-rpa.mjs: lines 1-2195 (changed; existing unrelated edits preserved)
  - scripts/rpa/run-background.mjs: lines 1-35 (changed; existing unrelated edits preserved)
  - scripts/rpa/product-roi.test.mjs: lines 1-121 (changed; existing unrelated edits preserved)
  - scripts/rpa/cli.test.mjs: lines 1-32 (changed; existing unrelated edits preserved)
  - scripts/rpa/lifecycle.test.mjs: lines 1-50 (changed; existing unrelated edits preserved)
  - SKILL.md: lines 1-249 (changed; existing unrelated edits preserved)
  - README.md: lines 1-125 (changed; existing unrelated edits preserved)
  - references/product-workflow.md: lines 1-115 (changed; existing unrelated edits preserved)
  - references/natural-language.md: lines 1-89 (changed; existing unrelated edits preserved)
CHECKS:
  - PASS: node --test scripts/rpa/cli.test.mjs scripts/rpa/data-rules.test.mjs scripts/rpa/lifecycle.test.mjs scripts/rpa/product-roi.test.mjs (15/15; final run ~6.1s)
  - PASS: node --check scripts/rpa/fastmoss-rpa.mjs
  - PASS: node --check scripts/rpa/product-roi.mjs
  - PASS: node --check scripts/rpa/run-background.mjs
  - PASS: python -X utf8 C:/Users/Administrator/.codex/skills/.system/skill-creator/scripts/quick_validate.py D:/code/codeMy/fassmoss-skill
  - PASS: git diff --check (only pre-existing CRLF conversion notices)
  - PASS: foreground browser productAdsSnapshot returned raw.gmv=$6.11万, raw.ad_spend=$2.76万, raw.platform_roas=2.22, period_days=28, busy=false
CODE:
  > roi: status === 'ok' ? +(gmv / adSpend).toFixed(4) : null,
VALIDATION:
  APPROVED — score: 1.0, complete: true, missing: []
  Scope: requested code correction, documentation, regression checks and one foreground demonstration; live background batch collection remains an explicit unverified limitation.
