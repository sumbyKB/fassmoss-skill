<!-- AIOS: .aios/context-db/index.json -->

## FastMoss 工作目录

用户指定本目录为 FastMoss Skill 及后续相关工作的统一存放位置。**开始任何任务前先读 `SKILL.md`**，相关操作记录写入 `operations/`，产生的名单、报告、下载与截图写入 `outputs/<日期-任务>/`，相关脚本和参考资料也放在本目录内。不要将凭证、Cookie或令牌写入记录。明确区分已验证功能与后续规划，保留原有AIOS配置。

- 脚本只用 Python 标准库（无需安装依赖）；`scripts/rpa/`（RPA 抓取）需 Node ≥18，首次先 `node scripts/rpa/setup.mjs` 装 playwright。
- FastMoss 一律通过用户已登录浏览器由当前环境的浏览器自动化工具操作，不调用 FastMoss API。
- 环境准备与自检见 [README.md](README.md)。
