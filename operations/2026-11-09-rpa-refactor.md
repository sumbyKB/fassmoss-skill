# RPA 重构：懒加载抓取与串行结论（2026-11-09）

## 背景

用户要求把抓取代码全写进 `D:\code\codeMy\fassmoss-skill`，速度更快、DOM 一打开就抓、先抓数据再分析。核心产出是 `scripts/rpa/fastmoss-rpa.mjs`（RPA）+ `scripts/rpa/analyze.mjs`（离线分析）。

## 关键发现

### 1. 详情页 4 张表是懒加载（最重要的坑）

详情页「视频/直播/商品/店铺」4 张表由 4 个接口喂数据，且**滚到可视区才发请求**：

- `/api/author/v3/detail/videoList` / `liveList` / `goodsList` / `shopList`

没触发时表格渲染 antd 占位行（隐藏测量行 + 「暂无数据」）。**「暂无数据」只代表还没请求，不是真的没数据**。早期脚本把占位行当数据，导致「18/18 有数据」是假象（实际全是空表）。

### 2. 接口有签名校验，不能直连

从页面上下文直接 `fetch` 这些接口返回 `MSG_SAFE_0001`，`pagesize` 放大无效。只能走 UI 滚动触发，无法绕过。

### 3. 并发 = 丢数据元凶

| 并发 | 18 位详情耗时 | 结果 |
| --- | --- | --- |
| 1（串行） | 59.7s（单页 3.3s） | 18/18 done，0 空表 |
| 3 | 70s+ | ~40% 页面接口不触发，丢数据 |
| 5 | 更差 | h1 超时 + 丢数据 |

后台 tab 被 Chromium 降频，`IntersectionObserver` 不回调，懒加载接口发不出去。加了 `--disable-background-timer-throttling` 等启动参数仍无效（`channel:chrome` 下这些 flag 不生效）。**结论：详情必须串行。**

### 4. 就绪判据 = 监听接口响应，不是 sleep

滚动触发懒加载后，监听 `response` 事件判断 4 个接口是否都返回过，比固定 sleep 快且不丢数据。同一帧里连续 `scrollTo` 只有最后一次会被绘制，必须步间 `waitForTimeout`。

### 5. 空表补抓

串行下仍有小概率首位达人冷启动空表（pipeline 首跳）。补抓判据从「仅 error」扩展为「error 或 4 张表全空」。

## 最终实测

```
pipeline 60 页 + 18 位详情：133s
  - 列表 66s（600 位 → 含包 35 位）
  - 详情 63s（18/18 有数据，0 空表）
```

## 产物

`outputs/2026-11-09-us-bags-rpa/`：candidates.json / details.json / creators-final.json / final-top.json / competitor-shops.json / evidence/*.json

## 数据口径提示

- candy（直播型达人）视频全"非带货"，视频 GMV=0 是真实情况，不是 bug；其直播 GMV $132 万。
- 总览「83.27万」是全国排名，不是粉丝数；粉丝数 = 2.13 万。
