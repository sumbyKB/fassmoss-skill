# 直播流程验证

用户指定新打开的达人页面，发现并读取Kourtney♡ / savingwithk详情。读取直播列表第一页5场；进入7705528508910553870详情并读取流量、带货与场内商品第一页5行。未操作监控、导出、邀约或付费。未读取其余分页，不称全量。浏览器保留在该用户标签的直播详情页。

实现直播时长/效率/动销比例、平台原值保留、本场商品证据绑定、跨场商品去重及竞品商品行归因。新增直播行为测试，原功能继续通过。更新SKILL入口、live-workflow与实测报告。

VERDICT:
FILES_REVIEWED:
  - scripts/history_analysis.py: live_metrics及竞品归因部分（修改）
  - scripts/test_live_analysis.py: 全文件（新增）
  - references/live-workflow.md: 全文件（新增）
CHECKS:
  - python -m unittest discover -s scripts -p test_*.py: PASS，9项
  - history_analysis.py真实直播证据生成: PASS
  - 实际网页列表→直播详情→本场商品行: PASS
CODE:
  > raise ValueError('Product metric belongs to another session')
VALIDATION:
  APPROVED — score: 1.0, complete: true, missing: []
  验收范围为直播采集技能与计算工具及部分真实样本；全量分页、评论正文、退货与真实预测不是本次已验证范围。
retry_budget: 3 remaining: 3
