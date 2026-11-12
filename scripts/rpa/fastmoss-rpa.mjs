#!/usr/bin/env node
/**
 * FastMoss RPA —— 打开即抓，不再逐条轮询
 *
 * 设计要点（2026-11-09 实测结论）：
 * 1. 筛选条件全部走 URL 参数，不做点击：省掉 3~4 次控件交互往返。
 * 2. 就绪判据换成「DOM 里出现带 /influencer/detail/ 链接的首行」或
 *    「表格行数>0」，这是数据真正落地的第一个瞬间；旧的
 *    “首行ID变化 + 连续两次不变”要多等 800~1000ms，纯属等空气。
 * 3. 列表分页默认 6 路并发，详情默认串行，一个 Node 进程跑完整个抓取，
 *    不再让 agent 一步步点。
 * 4. 操作页面DOM并读取页面自然返回的数据；不主动调用 FastMoss 接口，不导出Cookie。
 *
 * 代码结构：本文件只做入口与命令分发；共享基础设施在 lib/，各业务命令在 commands/。
 *
 * 用法：
 *   node scripts/rpa/fastmoss-rpa.mjs search  --follower 5000,50000 --category 7 --pages 60 --out out.json
 *   node scripts/rpa/fastmoss-rpa.mjs detail  --ids 123,456 --out details.json
 *   node scripts/rpa/fastmoss-rpa.mjs detail  --ids-file ids.json --concurrency 1 --out details.json
 *   node scripts/rpa/fastmoss-rpa.mjs pipeline --follower 5000,50000 --category 7 --pages 60 --top 18 --out-dir outputs/xxx
 *
 * 商品销售榜（品类大盘 / 品牌对比 / 价格带分析）：
 *   node scripts/rpa/fastmoss-rpa.mjs product --country 泰国 --category 跑步鞋 --days 14 --sort gmv --pages 10 --out products.json
 *     --days 1/7/14/30 映射到 date_type（1日榜/2周榜/3月榜）；--category 为细分品类名（须与页面分类匹配，走 URL 参数）；--sort gmv 按销售额排序
 *     --date-value 显式指定历史日期/月份，必须与页面有效值一致；未传时探测平台默认日期。
 *
 * 新品榜（近期上架商品，固定三日销量口径）：
 *   node scripts/rpa/fastmoss-rpa.mjs new-products --country 美国 --category-id 16 --category-id2 909064 --pages 20 --out newproducts.json
 *     --category-id/--category-id2 分类筛选（l1/l2 URL 参数）；--category 大白话分类名自动匹配 ID
 *     列：排名/商品(含售价+上架时间)/店铺/分类/佣金/三日销量/三日销售额/总销量/总销售额；无 date_type、无销量环比
 *     → 近7天销量/趋势需进详情页「数据总览」点「近7天」补抓（见 analyze-phonecase-trend.mjs）
 *
 * 商品投流 ROI（逐个进入商品详情 → 投流分析）：
 *   node scripts/rpa/fastmoss-rpa.mjs product-roi --country 美国 --keyword earbuds --top 10 --period 28 --out outputs/roi/product-roi.json
 *   node scripts/rpa/fastmoss-rpa.mjs product-roi --country 美国 --ids-file products.json --period 28 --out outputs/roi/product-roi.json
 *     ROI = 同一商品、同一周期的投流分析销售额 / 广告消耗；支持近7/28/90天，保留平台ROAS供核对。
 *
 * 品类 ROI 一条龙（榜单 → 过滤目标品类前N → 逐个投流ROI → 优势报告，改变量即可复用）：
 *   node scripts/rpa/fastmoss-rpa.mjs category-roi --country 美国 --category-id2 909320 --category 耳机 --top 10 --days 7 --pages 6 --period 28 --out outputs/xxx/耳机前10ROI.json
 *     --category-id / --category-id2：榜单层级筛选（耳机等细分品类建议用 --category-id2 限定到「影音设备」等二级）
 *     --category：目标品类关键词（榜内按 category 字段 + 商品名过滤）；能命中分类树时自动用作榜单筛选
 *     --top 前N、--days 榜单周期(1/7/14/30)、--pages 抓几页榜、--period ROI周期(7/28/90)、--sort 排序(默认gmv)
 *     → 产出 JSON + 同名 .md（含每商品自动优势标签 + 类目洞察 + 链接）
 *
 * 店铺榜（品牌/店铺销售数据）：
 *   node scripts/rpa/fastmoss-rpa.mjs shop --country 泰国 --category 箱包 --rating 4 --pages 10 --out shops.json
 *     --category 中文分类名或 --category-id <l1_cid> 精确筛（店铺榜筛选用 l1_cid，非 category query）
 *
 * 店铺详情（搜索店铺名 → 进详情页 → 抓数据）：
 *   node scripts/rpa/fastmoss-rpa.mjs shop-detail --shop Steapex.Malaysia --country 马来西亚 --out xxx.json
 *   node scripts/rpa/fastmoss-rpa.mjs shop-detail --shop-id 7494233487112177345   # 已知 ID 直接抓
 *
 * 店铺详情 + 自动分析报告（一条命令跑完抓取和分析）：
 *   node scripts/rpa/fastmoss-rpa.mjs shop-detail-report --shop Steapex.Malaysia --country 马来西亚 --out xxx.json
 *     → 产出 JSON 数据 + 同目录 <shop名>_店铺详情分析.md
 *
 * 店铺趋势涨跌（近N天 vs 上个N天 + 商品归因，店铺名/国家/天数均为变量）：
 *   node scripts/rpa/fastmoss-rpa.mjs shop-trend --shop Steapex --country 泰国 --days 30 --out xxx.json
 *     --days 1..45；--pages 商品页数上限（默认100）；日期或覆盖不完整时显示未知/partial。
 *     → 产出 JSON + 同名 .md（店铺整体涨跌 + 拖后腿/领涨商品归因）
 *
 * 店铺对比（某类目 GMV 前 N 店铺逐个对比 GMV/价格/佣金/达人，条件全变量）：
 *   node scripts/rpa/fastmoss-rpa.mjs shop-compare --country 泰国 --category 运动鞋 --top 10 --days 30 --benchmark Steapex --out xxx.json
 *     默认不设价格门槛、不排除配件；可显式 --min-price 50 --exclude-keywords 鞋垫,鞋带,insole。
 *     → 产出 JSON + 同名 .md（前N店铺对比表 + 达人数量）
 *
 * 店铺达人挖取（从竞品店铺挖带货达人清单，按贡献GMV排序）：
 *   node scripts/rpa/fastmoss-rpa.mjs shop-authors --shop Steapex --country 泰国 --top 20 --out xxx.json
 *     → 产出 JSON + 同名 .md（达人清单：粉丝/贡献GMV/销量/GPM + 链接）
 *
 * 直播搜索（按关键词/达人昵称/标题搜直播，抓直播列表）：
 *   node scripts/rpa/fastmoss-rpa.mjs live --keyword steapex --country 马来西亚 --pages 3 --out outputs/<批次>/lives.json
 *   node scripts/rpa/fastmoss-rpa.mjs live --pages 10 --out lives.json          # 不搜关键词，抓直播大盘
 *
 * 直播详情（抓单场直播的数据总览 + 商品列表 + Top3 商品）：
 *   node scripts/rpa/fastmoss-rpa.mjs live-detail --id 7705217919278762773 --country 马来西亚 --out xxx.json
 *   node scripts/rpa/fastmoss-rpa.mjs live-detail --id-file lives.json --top 5 --out-dir outputs/<批次>   # 批量抓多场
 *
 * 视频搜索（搜带货视频，抓列表 + TikTok 链接 + 视频类型）：
 *   node scripts/rpa/fastmoss-rpa.mjs video --keyword "phone case" --country 美国 --pages 2 --top 10 --out xxx.json
 *     --top N 限制进详情页抓 TikTok 链接的视频条数（默认 10）
 *
 * 广告投流数据（抓 ROAS/广告花费，支持日期范围）：
 *   node scripts/rpa/fastmoss-rpa.mjs ad --country 美国 --category-id 16 --start 2026-10-09 --end 2026-11-09 --pages 10 --out xxx.json
 *   node scripts/rpa/fastmoss-rpa.mjs ad --keyword 耳机 --start 2026-10-09 --end 2026-11-09 --out xxx.json
 *     单条广告字段：roas / estimate_cost / advertiser / play_count / desc；不用于商品 ROI。
 *     --start/--end 不传则默认"不限"（近1天投放广告）；商品 ROI 使用 product-roi。
 *
 * 切换国家（国家选择持久化到 profile，URL 不带参数）：
 *   node scripts/rpa/fastmoss-rpa.mjs country 泰国        # 单独切站（泰国=THB）
 *   node scripts/rpa/fastmoss-rpa.mjs pipeline ... --country 泰国   # 抓取时顺带切站
 *   支持：美国(us) 泰国(th) 印尼 越南 马来西亚 菲律宾 日本 新加坡 英国 德国 法国 西班牙 意大利 墨西哥 巴西
 */
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from './lib/cli.mjs';
import { activeContexts } from './lib/browser.mjs';
import { cmdSearch, cmdDetail, cmdPipeline } from './commands/influencer.mjs';
import { cmdProduct, cmdProductRoi, cmdCategoryRoi } from './commands/product.mjs';
import { cmdNewProducts } from './commands/new-products.mjs';
import { cmdHotVideo } from './commands/hot-video.mjs';
import { cmdShop, cmdShopDetail, cmdShopDetailReport } from './commands/shop.mjs';
import { cmdShopTrend } from './commands/shop-trend.mjs';
import { cmdShopCompare } from './commands/shop-compare.mjs';
import { cmdShopAuthors } from './commands/shop-authors.mjs';
import { cmdShopInsight } from './commands/shop-insight.mjs';
import { cmdLive, cmdLiveDetail } from './commands/live.mjs';
import { cmdVideo } from './commands/video.mjs';
import { cmdAd } from './commands/ad.mjs';
import { cmdCategories } from './commands/categories.mjs';
import { cmdCountry } from './commands/country.mjs';

/** 命令名 → 处理函数。新增命令时在此登记即可，main 保持单一职责。 */
export const HANDLERS = {
  search: cmdSearch,
  detail: cmdDetail,
  pipeline: cmdPipeline,
  country: cmdCountry,
  product: cmdProduct,
  'product-roi': cmdProductRoi,
  'category-roi': cmdCategoryRoi,
  'new-products': cmdNewProducts,
  'hot-video': cmdHotVideo,
  shop: cmdShop,
  'shop-detail': cmdShopDetail,
  'shop-detail-report': cmdShopDetailReport,
  'shop-trend': cmdShopTrend,
  'shop-compare': cmdShopCompare,
  'shop-authors': cmdShopAuthors,
  'shop-insight': cmdShopInsight,
  live: cmdLive,
  'live-detail': cmdLiveDetail,
  video: cmdVideo,
  ad: cmdAd,
  categories: cmdCategories,
};

/** 全部命令名（HANDLERS 的 key 是唯一权威来源，run-background / 测试都从这里取，避免重复维护清单） */
export const COMMAND_NAMES = Object.keys(HANDLERS);

export const main = async (argv = process.argv.slice(2)) => {
  const opts = parseArgs(argv);
  try {
    if (!opts.cmd || opts.cmd === 'help') {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      return;
    }
    if (!Object.hasOwn(HANDLERS, opts.cmd)) throw new Error('未知命令：' + opts.cmd);
    const handler = HANDLERS[opts.cmd];
    return await handler(opts);
  } finally {
    // 无论命令成败，统一关闭所有存活的浏览器上下文，避免资源泄漏
    await Promise.allSettled([...activeContexts].map((context) => context.close()));
  }
};

// 只在直接运行时执行 main（被 import 时不执行，供 run-background / 测试复用 HANDLERS 而不会误跑命令）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('RPA 失败：', e.message);
    process.exit(1);
  });
}
