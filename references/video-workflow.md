# 视频搜索与视频商品榜

## 视频搜索（搜带货视频 + TikTok 链接）

用户要「看某类商品的热门带货视频、要视频链接」时，用 `video` 子命令，搜索关键词抓视频列表 + 逐条进详情页拿 TikTok 链接 + 视频类型：

```bash
# 搜索带货视频（按关键词），抓列表 + TikTok 链接 + 视频类型
node scripts/rpa/fastmoss-rpa.mjs video --keyword "phone case" --country 美国 --pages 2 --top 10 --out outputs/<批次>/videos.json
```

抓取字段（每条视频）：标题（含 AD 标记）、达人、达人粉丝数、发布时间、播放量、点赞数、互动率、视频类型（带货视频/未带货）、**TikTok 原视频链接**（`tiktok.com/@<达人>/video/<id>`）。

> 视频搜索页 `/zh/media-source/video`（导航「视频&素材」→ 热门视频），搜索框 placeholder「热门视频」，搜索后 URL 带 `words=<关键词>`。视频详情页 `/zh/media-source/video/<id>` 含「进入TikTok官方视频主页」链接。`--top N` 限制进详情页抓链接的条数（默认 10，串行约 3.5s/条）。


## 视频商品榜（按商品汇总新发布带货视频数）

用户想看哪件商品有更多带货视频时使用 hot-video；用户想找单条视频、达人或 TikTok 原视频链接时用 video。不要把二者互换。

```text
node scripts/rpa/fastmoss-rpa.mjs hot-video --country 美国 --category 手机壳 --pages 3 --out outputs/video-products/hotvideo.json
node scripts/rpa/render-hot-video-report.mjs --file outputs/video-products/hotvideo.json --top 10
```

采集保持页面默认排序（总销量），报告只在已采集样本内按新发布视频数排序，不能宣称全站前N。总销量/总GMV是累计口径，不是该视频计数周期内的销量或GMV。周期未确认时标未知；报告中的手机壳子表为商品名规则推断。输入和输出路径可改，不绑定开发者的历史文件或美国站。

## 广告创意案例

```text
node scripts/rpa/fastmoss-rpa.mjs ad --country 美国 --start 2026-11-01 --end 2026-11-07 --pages 1 --out outputs/ad/ads.json
```

日期替换为用户指定区间；它表示该区间投放过的素材，不是该周期商品投流GMV。商品ROI使用 product-roi，不平均素材ROAS。
