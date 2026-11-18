# 新电脑使用说明

## 让助手发现技能

普通文件夹可直接运行脚本，但不等于已经安装到助手的技能列表。解压后保留整个 `fassmoss-skill` 目录（包含 `SKILL.md`、`agents/`、`references/`、`scripts/` 和依赖锁），按使用方式选一处存放：

| 使用方式 | 放置位置 | 如何验证 |
|---|---|---|
| Codex 个人技能 | `~/.agents/skills/fassmoss-skill/` | 新开会话，在技能选择器查找 FastMoss 或显式输入 `$fassmoss-skill` |
| Codex 项目技能 | `<项目>/.agents/skills/fassmoss-skill/` | 在该项目打开会话后同上 |
| Claude Code 个人技能 | `~/.claude/skills/fassmoss-skill/` | 新开会话，输入 `/fassmoss-skill` |
| Claude Code 项目技能 | `<项目>/.claude/skills/fassmoss-skill/` | 从该项目启动后输入 `/fassmoss-skill` |
| 普通目录/其它助手 | 自选目录 | 把完整 `SKILL.md` 路径交给助手并要求读取，或直接运行本文命令 |

`~` 表示当前用户主目录；Windows 通常可从 `%USERPROFILE%` 找到。只保留一个打算使用的副本，避免多份同名技能或登录在不同副本。目录层级应为 `fassmoss-skill/SKILL.md`，不要多套一层解压目录。存放好后在**这个副本**的根目录完成以下安装和登录；之后助手也应从这个副本运行。若客户端未立即刷新，重开会话后检查。以上为本地技能安装，不代表云端会话具备本机浏览器能力。

安装位置依据 [OpenAI 官方技能文档](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills) 与 [Claude Code 官方技能文档](https://code.claude.com/docs/en/skills#choose-where-skills-load)。本包含 Codex 显示名称和启动提示，不要求所有客户端都读取相同入口文件。

## 首次使用

将项目解压到本机可写目录，例如桌面或文档下的任意文件夹。路径可以包含中文和空格；保留完整目录结构，在项目目录打开终端。不要把项目放在只读安装目录或多人共享同一个浏览器配置的网络目录。

安装 Node.js 22 或更高版本，建议使用 [Node.js 24 LTS](https://nodejs.org/en/download)。安装程序包含 npm。安装后重新打开终端，确认 `node --version` 和 `npm --version` 可运行。网页采集和 Node 报告无需 Python；只有 `.py` 工具需要 Python 3.10+。Linux/macOS 上 Python 命令通常为 `python3`。

默认使用已安装的 Google Chrome。Playwright 的支持范围请以 [官方系统要求](https://playwright.dev/docs/intro#system-requirements) 为准；本项目没有在全部系统上实机验证。

```text
node scripts/rpa/setup.mjs
```

该命令按 `package-lock.json` 精确安装依赖到项目 `node_modules/`，检查项目可写并启动一个临时无界面浏览器，成功时打印 PASS。可重复执行，不会删除 `.browser-profile/` 登录态或 `outputs/` 结果。安装期间不要运行采集，以免依赖正在更新。不要单独复制旧 `.tools/` 或别的电脑的 `node_modules/`。

再运行人工登录入口：

```text
node scripts/rpa/login-window.mjs
```

只在这一步打开前台窗口。在该窗口完成登录后，关闭整个窗口再启动采集。日常 Chrome 已登录不代表此窗口也已登录；账号状态仅保存在本项目本机的 `.browser-profile/`。不需要 API Key、RTK、AIOS、Codex 或全局 Playwright，普通终端即可运行。

## 开始采集

```text
node scripts/rpa/fastmoss-rpa.mjs product-roi --country 美国 --keyword earbuds --top 10 --period 28 --out outputs/roi/product-roi.json
```

采集命令统一打开项目独立 Chrome。

采集命令统一打开项目独立 Chrome。

采集命令统一打开项目独立 Chrome。

## 常见问题

| 提示或现象 | 处理 |
|---|---|
| 找不到 node / npm | 安装完整 Node.js LTS，重新打开终端，确认 PATH。PowerShell 阻止 npm.ps1 时可使用本文 `node ...` 入口或 `npm.cmd`。 |
| 依赖未就绪或版本不匹配 | 在项目目录重跑 `node scripts/rpa/setup.mjs`，不要混用全局或旧 `.tools` 依赖。 |
| 依赖下载超时 | 检查 npm 官方源、网络和公司代理；浏览器下载也需要网络。不关闭证书校验。 |

| 登录目录正被占用 | 关闭同一项目的登录窗口或采集进程后重试，不删除登录目录。 |
| 目录不可写 | 将项目移到当前用户有写权限的本地目录。 |
| 未登录 / 访问验证 / 会员次数限制 | 单独打开登录入口人工处理，关闭后再采集；次数或权限限制需要账号方处理，不自动切窗口或换工具绕过。 |


## 发给同事

```text
python -X utf8 scripts/package_share.py --out outputs/distribution/fastmoss-skill.zip
```

压缩包包含代码、说明、依赖清单和锁文件；不包含浏览器登录态、依赖目录、业务产物、AI 工具状态、历史操作记录或测试文件。给同事发送该 ZIP 即可。完整源码仓库维护者可执行 `npm test`；本轮没有新增测试文件。
