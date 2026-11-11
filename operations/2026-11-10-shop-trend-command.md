# 新增 shop-trend 命令（2026-11-10）

## 背景

用户要「店铺最近30天总销量/GMV、运动鞋类目排名、跟上个30天比涨跌、哪个商品拖后腿/涨」。原 skill 的 shop-detail 只抓单期快照（累计总量 + 近28天商品），拿不到「30天对比」，需扩展。

## 数据源（探索结论）

- 店铺级：`/api/shop/v3/recentData?id=<店铺ID>&date_type=90` → `data.list.trend`（90 天逐日，含 `inc_sold_count`/`inc_sale_amount` 每日增量）。
- 商品级：`/api/goods/v3/overview?product_id=<PID>&d_type=90` → `data.chart_list`（90 天逐日）。
- 商品列表：`/api/shop/v3/goods`（product_list，含近28天 sold_count/sale_amount）。

## 实现

`commands/shop-trend.mjs` + 注册到 `fastmoss-rpa.mjs` HANDLERS + `run-background.mjs` 白名单。

- 变量：`--shop`/`--shop-id`、`--country`、`--days`（对比周期，默认30）。
- 涨跌计算：近N天 = trend.slice(-N) 的 inc 求和；上个N天 = slice(-2N, -N) 求和；环比 = (cur-prev)/prev。
- 归因：按商品 sold_pct 排序，>0 领涨，<0 拖后腿。
- 报告：JSON + MD（店铺整体涨跌表 + 拖后腿/领涨商品表）。

## 关键技术坑

1. **MSG_SAFE_0001 签名**：接口不能直接 fetch（返回签名错误），须「页面正常操作（点『近90天』）+ 监听 response」拿 90 天数据。
2. **腾讯验证码**：频繁自动化点击周期按钮会触发 `tCaptchaMaskLayer` 遮罩拦截，需人工完成。给 `openBrowser` 加 `allowImages` 参数（shop-trend 传 true 放行图片，验证码才能显示）。
3. **商品级残留 bug**：tracker 是共享的，循环里必须在 `goto` 前 reset，否则拿到上一个商品的 90 天数据被误判为当前商品（导致后续商品「无趋势」）。
4. **店铺名**：从 recentData 的 `total_info.shop_name` 取真实店铺名（比搜索词/ID 准）。

## 验证

- Steapex 泰国站跑 2 次（--shop-id 和 --shop 搜索路径），结果完全一致。
- 结果：近30天销量 21327 vs 18607（+14.6%）、GMV ฿1847.84万 vs ฿1585.66万（+16.5%）；AERO 跌 11%（拖后腿）、RUSH/Wind Spirit/oxyflow 涨 32-34%、SURGE 涨 11.4%。
- 16/16 测试通过；语法检查全 OK；无临时诊断脚本残留。
