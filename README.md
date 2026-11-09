# FastMoss Skill

在用户已登录的 FastMoss 网页中按自然语言条件搜索 TikTok 达人、读取名单并整理达人档案。不需要 FastMoss API，不需要安装 Python 依赖。整个目录自包含，复制给同事后即可使用。

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
3. **浏览器自动化工具** — 你的助手环境必须能把用户**已登录**的 FastMoss 标签页接入 Playwright 风格的 DOM 操作（如 Claude Code 的浏览器 MCP 工具、Codex/Workbuddy 环境自带的浏览器工具）。各环境工具名不同，接入方式见 [references/browser-workflow.md](references/browser-workflow.md)——先发现可用工具，不假设别人环境的扩展。
4. **网络可达 `www.fastmoss.com`**，且用户已在浏览器中登录 FastMoss。

## 常用命令

```bash
# 完整抓取 + 分析（RPA 主路径）
node scripts/rpa/setup.mjs            # 首次：装 playwright 到 .tools/
node scripts/rpa/login-window.mjs     # 弹窗登录一次（登录态存 .browser-profile/）
node scripts/rpa/fastmoss-rpa.mjs pipeline --pages 60 --top 18 --follower 5000,50000 --category 7 --out-dir outputs/<批次>
node scripts/rpa/analyze.mjs --dir outputs/<批次> --top 10   # 出 JSON + 多维度分析报告.md

# 历史带货分析：网页采集 evidence.json 后
python scripts/history_analysis.py outputs/<批次>/evidence.json --output outputs/<批次>

# 本地达人池
python scripts/creator_pool.py import outputs/<批次>/creators.json
python scripts/creator_pool.py search "包包、粉丝2–10w、报价≤8k"
python scripts/creator_pool.py profiles
```

`bulk-page.mjs` / `collect-pages.mjs` 是旧的浏览器内执行脚本（已被 RPA 取代，保留兼容）：由助手在浏览器工具的 JS 执行面里调用。

- `collectTables(tab)` / `creatorRows(tables)`——单页整表提取与按ID去重。
- `pagesScript({maxPages})`——返回一段 JS，一次调用内完成多页点击、等待、提取与去重；`toPoolRecords(payload)` 转成入库记录并带 coverage。RPA 出现前的翻页方案，现仅作参考。

## 目录结构

```
SKILL.md          # 能力定义与执行流程（唯一入口，先读这个）
references/       # 分场景执行手册：fast-execution / browser-workflow /
                  # history-workflow / live-workflow / local-pool / data-and-roadmap
scripts/          # history_analysis.py、creator_pool.py（纯标准库）
                  # bulk-page.mjs / collect-pages.mjs（旧浏览器内脚本，兼容保留）
                  # rpa/（RPA 主路径：fastmoss-rpa.mjs + analyze.mjs + setup/login）
operations/       # 每次实际执行的记录（日期、条件、结果、阻碍）
outputs/          # 任务产物，git 忽略，不入库
AGENTS.md / CLAUDE.md / GEMINI.md   # 各工具入口路由
```

## 数据边界（摘要，全文见 SKILL.md）

- 所有结论区分平台显示值、计算值与推断；缺分母的指标保持 null，不悄悄替换口径。
- 只用当前账号可访问的页面和允许的导出；不绕过验证码、付费权限。
- 不发送邀约、不联系达人、不购买服务；凭证/Cookie/令牌不写入任何文件。
- 已验证范围与未验证功能见 `operations/` 下各记录与 `SKILL.md` 末节。
