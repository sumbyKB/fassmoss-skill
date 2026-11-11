// 店铺洞察命令：一次打开店铺详情页，抓取多个分析接口，输出综合洞察报告。
// 数据源（店铺详情页各 tab 的接口）：品类结构(goodsStats)、价格带(priceRange)、达人结构(authorAnalysis)、
// 成交结构(saleAnalysis)、爆款直播(liveAnalysis)、爆款视频(videoAnalysis)。店铺名/国家均为变量。
import fs from 'node:fs';
import path from 'node:path';
import { BASE, SKILL_ROOT, resolveCountry } from '../lib/config.mjs';
import { log } from '../lib/cli.mjs';
import { openBrowser, assertLoggedIn, switchCountry } from '../lib/browser.mjs';
import { resolveShopId } from '../lib/shop.mjs';
import { makeMultiTracker } from '../lib/tracker.mjs';
import { cell } from '../lib/report.mjs';

const SHOP_SEARCH = `${BASE}/shop-marketing/search`;
const SHOP_DETAIL = `${BASE}/shop-marketing/detail`;

/** 需要点击的 tab 与对应接口（tab 名 → 接口 URL 片段） */
const TABS = [
  { tab: '成交分析', apis: ['saleAnalysis'] },
  { tab: '商品分析', apis: ['goodsStats', 'priceRange'] },
  { tab: '达人分析', apis: ['authorAnalysis'] },
  { tab: '视频', apis: ['videoAnalysis'] },
  { tab: '直播', apis: ['liveAnalysis'] },
];

/** 点击 tab（文本匹配） */
async function clickTab(page, text) {
  try {
    const tab = page.locator(`text="${text}"`).first();
    if (await tab.count() > 0) { await tab.click(); await page.waitForTimeout(2500); return true; }
  } catch (e) { /* 忽略 */ }
  return false;
}

/** shop-insight：店铺综合洞察。店铺名/国家均为变量。 */
export async function cmdShopInsight(opts) {
  const shopName = opts.shop || opts['shop-name'] || (Array.isArray(opts._) ? opts._[0] : null);
  const shopId = opts['shop-id'] || opts.id || null;
  if (!shopName && !shopId) throw new Error('缺少店铺名或 ID：node scripts/rpa/fastmoss-rpa.mjs shop-insight --shop <店铺名> [--country 泰国]');
  const outFile = path.resolve(opts.out || path.join(SKILL_ROOT, 'outputs', `shop-insight-${(shopName || shopId).replace(/[^\w.-]/g, '_')}-${Date.now()}.json`));
  if (!outFile.toLowerCase().endsWith('.json')) throw new Error('--out 请使用 .json 文件名');
  const reportFile = outFile.slice(0, -5) + '.md';
  const t0 = Date.now();

  const { context, launchMs } = await openBrowser({ headed: opts.headed === true || opts.headed === 'true' });
  await assertLoggedIn(context.pages()[0], SHOP_SEARCH);
  const country = opts.country ? await switchCountry(context.pages()[0], opts.country) : null;
  const currency = country ? resolveCountry(country).currency : (opts.currency || 'THB');
  const page = context.pages()[0];

  const resolvedId = shopId || (await resolveShopId(page, shopName));

  // 监听所有分析接口（video/live 用「?」精确匹配明细接口，排除 Summary 汇总接口）
  const tracker = makeMultiTracker(page, {
    saleAnalysis: '/api/shop/v3/saleAnalysis?',
    goodsStats: '/api/shop/goodsStats?',
    priceRange: '/api/shop/v3/priceRange?',
    authorAnalysis: '/api/shop/v3/authorAnalysis?',
    liveAnalysis: '/api/shop/v3/liveAnalysis?',
    videoAnalysis: '/api/shop/v3/videoAnalysis?',
    goods: '/api/shop/v3/goods?',
  });

  await page.goto(`${SHOP_DETAIL}/${resolvedId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  // 逐个点 tab 触发接口
  for (const { tab } of TABS) {
    await clickTab(page, tab);
  }
  // 滚动触发懒加载（视频/直播明细在页面下方，点 tab 不一定触发，滚动更可靠）
  await page.evaluate(async () => {
    const H = document.body.scrollHeight;
    for (let y = 0; y <= H; y += 800) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 200)); }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(2500);

  // === 品类结构（goodsStats）===
  const category = parseCategory(tracker.get('goodsStats'));
  // === 达人结构（authorAnalysis）===
  const author = parseAuthor(tracker.get('authorAnalysis'));
  // === 成交结构（saleAnalysis）===
  const sale = parseSale(tracker.get('saleAnalysis'));
  // === 价格分布（基于 goods 商品价格分档，priceRange 接口只返回档位定义、无占比）===
  const price = parsePriceDistribution(tracker.get('goods'));
  // === 爆款视频（videoAnalysis）===
  const video = parseVideo(tracker.get('videoAnalysis'));
  // === 爆款直播（liveAnalysis）===
  const live = parseLive(tracker.get('liveAnalysis'));
  const result = {
    collected_at: new Date().toISOString(),
    shop_name: shopName || null,
    shop_id: resolvedId,
    country: country || null,
    currency,
    category,
    author,
    sale,
    price,
    video,
    live,
    timings: { launchMs, totalMs: Date.now() - t0 },
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(reportFile, renderInsightReport(result), 'utf8');
  log(`写出 ${outFile} / ${reportFile}`);
  tracker.dispose();
  await context.close();
  return { result, outFile, reportFile };
}

/** 解析品类结构（goodsStats 的二级/三级分类占比） */
function parseCategory(body) {
  if (!body) return null;
  try {
    const d = JSON.parse(body).data || {};
    const l2Product = (d.l2_category_product_ratio || []).map((x) => ({ name: (x.category_name || []).join('/'), product_count: x.product_count ?? null, ratio: x.ratio ?? null }));
    const l2Sold = (d.l2_category_sold_ratio || []).map((x) => ({ name: (x.category_name || []).join('/'), sold_count: x.sold_count ?? null, ratio: x.ratio ?? null }));
    const l3Sold = (d.l3_category_sold_ratio || []).map((x) => ({ name: (x.category_name || []).join('/'), sold_count: x.sold_count ?? null, ratio: x.ratio ?? null }));
    return { l2_product_ratio: l2Product, l2_sold_ratio: l2Sold, l3_sold_ratio: l3Sold };
  } catch (e) {
    return null;
  }
}

/** 成交渠道/内容形式的英文 key → 中文 */
const SOURCE_LABELS = {
  'common.goods.product_card': '商品卡',
  'common.goods.shop_account': '店铺自营号',
  'common.goods.affiliate': '达人带货',
  'video.name': '视频',
  'live.name': '直播',
};

/** 解析成交结构（saleAnalysis 的渠道分布 + 内容分布） */
function parseSale(body) {
  if (!body) return null;
  try {
    const d = JSON.parse(body).data || {};
    const channel = d.channel_distribution || {};
    const content = d.content_distribution || {};
    const mapList = (x) => (x?.list || []).map((it) => ({ name: SOURCE_LABELS[it.source ?? it.category] || it.source || it.category, propotion: it.propotion, count: it.sold_count ?? it.sale_amount ?? null }));
    return {
      channel_units: mapList(channel.units_sold),
      channel_gmv: mapList(channel.gmv),
      content_units: mapList(content.units_sold),
      content_gmv: mapList(content.gmv),
    };
  } catch (e) {
    return null;
  }
}

/** 解析达人结构（authorAnalysis 的粉丝区间/达人类型分布 + 汇总） */
function parseAuthor(body) {
  if (!body) return null;
  try {
    const d = JSON.parse(body).data || {};
    const follower = d.follower_range || {};
    const type = d.auther_type_range || {};
    const summary = d.summary || {};
    return {
      summary: {
        author_count: summary.author_count ?? null,
        video_count: summary.video_count ?? null,
        live_count: summary.live_count ?? null,
        sold_count: summary.sold_count ?? null,
        sale_amount: summary.sale_amount ?? null,
      },
      follower_sold: (follower.sold_count_range || []).map((x) => ({ range: x.label, authors: x.value_count ?? null, rate: x.value_rate ?? null })),
      follower_gmv: (follower.sale_amount_range || []).map((x) => ({ range: x.label, authors: x.value_count ?? null, rate: x.value_rate ?? null })),
      type_sold: (type.sold_count_range || []).map((x) => ({ type: x.label, authors: x.value_count ?? null, rate: x.value_rate ?? null })),
    };
  } catch (e) {
    return null;
  }
}

/** 解析价格分布（基于 goods 商品价格分档，priceRange 接口只返回档位定义、无占比） */
function parsePriceDistribution(body) {
  if (!body) return null;
  try {
    const d = JSON.parse(body).data || {};
    const list = d.product_list || [];
    const bands = [
      { label: '<฿500', min: 0, max: 500 },
      { label: '฿500-1000', min: 500, max: 1000 },
      { label: '฿1000-1500', min: 1000, max: 1500 },
      { label: '฿1500-2000', min: 1500, max: 2000 },
      { label: '≥฿2000', min: 2000, max: Infinity },
    ].map((b) => ({ ...b, count: 0, sold: 0, gmv: 0 }));
    for (const p of list) {
      const price = Number(String(p.price ?? '').replace(/[฿,]/g, ''));
      if (!Number.isFinite(price) || price <= 0) continue;
      const band = bands.find((b) => price >= b.min && price < b.max) || bands[bands.length - 1];
      band.count += 1;
      band.sold += Number(p.sold_count) || 0;
      band.gmv += Number(p.sale_amount) || 0;
    }
    return bands.filter((b) => b.count > 0);
  } catch (e) {
    return null;
  }
}

/** 解析爆款视频（videoAnalysis 的视频明细，按 GMV 排序） */
function parseVideo(body) {
  if (!body) return null;
  try {
    const d = JSON.parse(body).data || {};
    const list = d.list || [];
    return {
      total: d.total ?? null,
      videos: list.map((v) => ({
        is_ad: v.is_ad,
        sold_count: v.sold_count ?? null,
        sale_amount: v.sale_amount ?? null,
        play_cnt: v.play_cnt ?? null,
        digg_cnt: v.digg_cnt ?? null,
        interact_rate: v.interact_rate ?? null,
        nickname: v.nickname,
        follower_count: v.follower_count ?? null,
        desc: v.video_desc ?? null,
        create_time: v.ctime ?? v.create_time ?? null,
      })).sort((a, b) => (b.sale_amount ?? 0) - (a.sale_amount ?? 0)),
    };
  } catch (e) {
    return null;
  }
}

/** 解析爆款直播（liveAnalysis 的直播明细，按 GMV 排序） */
function parseLive(body) {
  if (!body) return null;
  try {
    const d = JSON.parse(body).data || {};
    const list = d.list || [];
    return {
      total: d.total_cnt ?? d.total ?? null,
      lives: list.map((l) => ({
        title: l.title ?? null,
        sold_count: l.sold_count ?? null,
        sale_amount: l.sale_amount ?? null,
        viewers: l.total_user ?? null,
        nickname: l.nickname ?? null,
        follower_count: l.follower_count ?? null,
        is_shop: l.is_shop,
        duration: l.duration ?? null,
        create_time: l.create_time ?? null,
      })).sort((a, b) => (b.sale_amount ?? 0) - (a.sale_amount ?? 0)),
    };
  } catch (e) {
    return null;
  }
}

/** 生成洞察报告（数据驱动，各章节按数据有无输出） */
function renderInsightReport(r) {
  const lines = [
    `# ${r.shop_name || r.shop_id} 店铺洞察报告`,
    '',
    `> 采集 ${(r.collected_at || '').slice(0, 10)} · 国家 ${r.country || '未知'} · 币种 ${r.currency}`,
    '',
  ];
  if (r.category) {
    lines.push('## 一、品类结构（店铺主营什么）', '');
    if (r.category.l2_sold_ratio.length) {
      lines.push('### 二级分类 · 销量占比', '', '| 分类 | 销量 | 占比 |', '|---|---|---|');
      for (const x of r.category.l2_sold_ratio) lines.push(`| ${cell(x.name)} | ${cell(x.sold_count)} | ${cell(x.ratio)}% |`);
      lines.push('');
    }
    if (r.category.l2_product_ratio.length) {
      lines.push('### 二级分类 · 商品数占比', '', '| 分类 | 商品数 | 占比 |', '|---|---|---|');
      for (const x of r.category.l2_product_ratio) lines.push(`| ${cell(x.name)} | ${cell(x.product_count)} | ${cell(x.ratio)}% |`);
      lines.push('');
    }
    if (r.category.l3_sold_ratio.length) {
      lines.push('### 三级分类 · 销量占比', '', '| 分类 | 销量 | 占比 |', '|---|---|---|');
      for (const x of r.category.l3_sold_ratio) lines.push(`| ${cell(x.name)} | ${cell(x.sold_count)} | ${cell(x.ratio)}% |`);
      lines.push('');
    }
  } else {
    lines.push('## 一、品类结构', '', '未采集到品类数据。', '');
  }
  if (r.author) {
    lines.push('## 二、达人结构', '');
    if (r.author.summary) {
      const s = r.author.summary;
      lines.push(`**达人总数** ${cell(s.author_count)} · 视频达人 ${cell(s.video_count)} · 直播达人 ${cell(s.live_count)} · 贡献销量 ${cell(s.sold_count)}`);
      lines.push('');
    }
    if (r.author.follower_sold.length) {
      lines.push('### 达人粉丝区间 · 销量贡献', '', '| 粉丝区间 | 达人数 | 占比 |', '|---|---|---|');
      for (const x of r.author.follower_sold) lines.push(`| ${cell(x.range)} | ${cell(x.authors)} | ${cell(x.rate)} |`);
      lines.push('');
    }
    if (r.author.type_sold.length) {
      lines.push('### 达人类型 · 销量贡献', '', '| 达人类型 | 达人数 | 占比 |', '|---|---|---|');
      for (const x of r.author.type_sold) lines.push(`| ${cell(x.type)} | ${cell(x.authors)} | ${cell(x.rate)} |`);
      lines.push('');
    }
  } else {
    lines.push('## 二、达人结构', '', '未采集到达人结构数据。', '');
  }
  if (r.sale) {
    lines.push('## 三、成交结构', '');
    const distTable = (title, arr, countLabel) => {
      const out = [`### ${title}`, '', `| ${countLabel} | 占比 |`, '|---|---|'];
      for (const x of arr) out.push(`| ${cell(x.name)} | ${cell(x.propotion)} |`);
      out.push('');
      return out;
    };
    if (r.sale.channel_units.length) lines.push(...distTable('成交渠道 · 销量', r.sale.channel_units, '渠道'));
    if (r.sale.content_units.length) lines.push(...distTable('内容形式 · 销量', r.sale.content_units, '内容形式'));
  } else {
    lines.push('## 三、成交结构', '', '未采集到成交结构数据。', '');
  }
  if (r.price && r.price.length) {
    lines.push('## 四、价格分布（商品价格分档）', '', '| 价格档位 | 商品数 | 销量 | GMV |', '|---|---|---|---|');
    for (const b of r.price) lines.push(`| ${cell(b.label)} | ${cell(b.count)} | ${cell(b.sold)} | ${cell(b.gmv)} |`);
    lines.push('');
  }
  if (r.video && r.video.videos.length) {
    lines.push('## 五、爆款视频（按 GMV 排序）', '', '| 达人 | 视频文案 | 播放量 | 点赞 | 销量 | GMV | 互动率 | AD |', '|---|---|---|---|---|---|---|---|');
    for (const v of r.video.videos.slice(0, 15)) lines.push(`| ${cell(v.nickname)} | ${cell((v.desc || '').slice(0, 30))} | ${cell(v.play_cnt)} | ${cell(v.digg_cnt)} | ${cell(v.sold_count)} | ${cell(v.sale_amount)} | ${cell(v.interact_rate)} | ${v.is_ad ? '是' : '否'} |`);
    lines.push('');
  }
  if (r.live && r.live.lives.length) {
    lines.push('## 六、爆款直播（按 GMV 排序）', '', '| 主播 | 直播标题 | 观看人次 | 销量 | GMV | 店铺自播 |', '|---|---|---|---|---|---|');
    for (const l of r.live.lives.slice(0, 15)) lines.push(`| ${cell(l.nickname)} | ${cell((l.title || '').slice(0, 30))} | ${cell(l.viewers)} | ${cell(l.sold_count)} | ${cell(l.sale_amount)} | ${l.is_shop ? '是' : '否'} |`);
    lines.push('');
  }
  lines.push('---', '', '*数据可追溯至 JSON 产物；品类占比为店铺详情页「商品分析」tab 的接口数据。*');
  return lines.join('\n');
}
