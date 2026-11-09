# 本地达人池工具

在技能根目录运行，Python 标准库，无需安装依赖：

```text
python scripts/creator_pool.py import outputs/批次/creators.json
python scripts/creator_pool.py search "包包、粉丝2–10w、报价≤8k"
python scripts/creator_pool.py profiles
```

输入为 JSON 数组。必填：`id`（字符串稳定ID）、`collected_at`（带时区ISO时间，统一使用同一时区）、`source_url`、`country`、`currency`、`period_days`。可选：`name`、`handle`、`followers`、`gmv`、`units`、`quote`、`content_tags`、`audience`、`conversion_rate`、`return_rate`、`sentiment`。缺失用 null，不填0。附加字段原样保存在快照中。导入前逐项比对网页原文，不把预估值填入实际值。

默认数据库 `outputs/creator-pool.sqlite3`。同ID同采集时间重复导入不覆盖；新时间形成新快照。每个ID取最新快照检索。报价必须另有报价来源、币种、日期和合作单位后人工核验。工具只解析粉丝区间与报价上限，其余自然语言由技能执行网页筛选和证据核验；输出候选，不宣称完整条件匹配。

竞品证据放在 `promotions` 数组：每条含 `id`、`brand`、`source_url`、`kind`（video/live），可附日期及表现原文。按形式、ID、品牌去重计数。统计仅覆盖提供的记录，不能称合作次数或完整历史。

## 周期执行契约

每次执行：重新发现已登录网页 → 读取保存条件 → 验证页面条件及周期 → 读取允许的分页/导出 → 标准化JSON → 导入 → 生成档案 → 写operations记录。登录过期、验证码、权限不足或额度不足时停止该批次并保留旧快照；不得空结果清空达人池。

尚未安装定时任务：用户需确定国家、类目、频率、每批页数/人数和额度上限，之后通过当前环境的自动化工具创建。单独重复运行 import 不是网页定期抓取。当前未验证网页批量采集、详情采集或无人值守。

## 实现取舍

沿用网页技能作为采集层，SQLite只负责去重和快照，避免把浏览器会话或凭证存入数据库。没有新增抓取接口、模型服务或估价模型。缺少实绩时保留预测未知。当前项目没有既有CI、lint或提交钩子，本轮提供标准库核心路径测试。
