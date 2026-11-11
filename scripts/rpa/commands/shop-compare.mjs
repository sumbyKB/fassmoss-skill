// 店铺对比命令：抓某类目商品榜 → 按店铺聚合 GMV → 取前 N → 逐个抓达人数量 → 对比报告。
// 用于「某类目 GMV 前 N 店铺逐个对比：GMV / 价格区间 / 佣金 / 达人数量」，搜索条件（国家/类目/前N/天数/基准店铺）均为变量。
import fs from 'node:fs';
import path from 'node:path';
import { BASE, SKILL_ROOT, resolveCountry, REGION_BY_LABEL } from '../lib/config.mjs';
import { log } from '../lib/cli.mjs';
import { openBrowser, safeEval, assertLoggedIn, switchCountry } from '../lib/browser.mjs';
import { resolveCategoryId } from '../lib/categories.mjs';
import { dateTypeOf, buildProductUrl, grabProductPage } from './product.mjs';
import { grabShopOverview, resolveShopId } from '../lib/shop.mjs';
import { cell, money } from '../lib/report.mjs';

/** 解析金额字符串（如 ฿762.76万 / ฿1.56亿 / ฿649.90）→ 数值 */
function parseAmount(v) {
  const s = String(v ?? '').replace(/฿|,/g, '');
  const m = s.match(/([\d.]+)(万|亿)?/);
  if (!m) return 0;
  return Number(m[1]) * (m[2] === '亿' ? 1e8 : m[2] === '万' ? 1e4 : 1);
}

/** 解析价格区间（如 ฿393.43 - 493.00 → {min,max}） */
function parsePriceRange(v) {
  const s = String(v ?? '').replace(/฿|,/g, '');
  const nums = [...s.matchAll(/[\d.]+/g)].map((x) => Number(x[0]));
  if (!nums.length) return null;
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

/** 解析佣金率（如 8% → 8） */
function parseCommission(v) {
  const m = String(v ?? '').match(/([\d.]+)%/);
  return m ? Number(m[1]) : null;
}

/** 是否运动鞋类商品（排除鞋垫/鞋带等配件，靠价格门槛 + 关键词） */
function isRealProduct(p) {
  const name = String(p.product || '');
  const isAccessory = /แผ่นรอง|鞋垫|鞋带|insole|เชือก|鞋扣|鞋垫垫/.test(name);
  const pr = parsePriceRange(p.price_raw);
  return !isAccessory && pr && pr.max >= 50;
}

/** 按店铺聚合商品榜数据 */
function aggregateShops(rows) {
  const byShop = new Map();
  for (const r of rows) {
    if (!isRealProduct(r)) continue;
    const shop = String(r.shop || '').trim();
    if (!shop) continue;
    const gmv = parseAmount(r.gmv);
    const pr = parsePriceRange(r.price_raw);
    const comm = parseCommission(r.commission);
    const units = parseAmount(r.units);
    if (!byShop.has(shop)) byShop.set(shop, { shop, gmv: 0, count: 0, units: 0, prices: [], comms: [] });
    const s = byShop.get(shop);
    s.gmv += gmv;
    s.count += 1;
    s.units += units;
    if (pr) { s.prices.push(pr.min, pr.max); }
    if (comm != null) s.comms.push(comm);
  }
  return [...byShop.values()]
    .map((s) => ({
      shop: s.shop,
      gmv: s.gmv,
      count: s.count,
      units: s.units,
      price_min: s.prices.length ? Math.min(...s.prices) : null,
      price_max: s.prices.length ? Math.max(...s.prices) : null,
      commission: s.comms.length ? +(s.comms.reduce((a, b) => a + b, 0) / s.comms.length).toFixed(1) : null,
    }))
    .sort((a, b) => b.gmv - a.gmv);
}

/** shop-compare：某类目 GMV 前 N 店铺对比。国家/类目/前N/天数/基准店铺均为变量。 */
export async function cmdShopCompare(opts) {
  const country = opts.country || null;
  const category = opts.category || null;
  let categoryId = opts['category-id'] || opts.cid || null;
  let categoryId2 = opts['category-id2'] || null;
  const top = Math.max(1, Number(opts.top || 10));
  const days = opts.days ? Number(opts.days) : 30;
  const pages = Math.max(1, Number(opts.pages || 15));
  const benchmark = opts.benchmark || null; // 基准店铺名（「跟我对比」的主角）

  // 类目自动匹配：给了中文类目名时，匹配到二级分类 ID（店铺对比需精确到二级类目）
  if (!categoryId2 && category && !/^\d+$/.test(String(category))) {
    const resolved = resolveCategoryId(category, opts['categories-file']);
    if (resolved) {
      categoryId = resolved.l1_cid;
      if (resolved.level === 2 && resolved.l2_code) categoryId2 = resolved.l2_code;
      log(`类目「${category}」匹配到「${resolved.matched}」(l1_cid=${resolved.l1_cid}${resolved.level === 2 ? '，二级 ' + resolved.l2_code : ''})`);
    }
  }
  if (!categoryId2) throw new Error('店铺对比需精确到二级类目：请传 --category <类目名>（如 运动鞋）或 --category-id2 <ID>');

  const dateType = Number(opts['date-type'] || dateTypeOf(days));
  const sort = opts.sort || 'gmv';
  const outFile = path.resolve(opts.out || path.join(SKILL_ROOT, 'outputs', `shop-compare-${(category || categoryId2).replace(/[^\w.-]/g, '_')}-${Date.now()}.json`));
  if (!outFile.toLowerCase().endsWith('.json')) throw new Error('--out 请使用 .json 文件名');
  const reportFile = outFile.slice(0, -5) + '.md';
  const t0 = Date.now();

  const { context, launchMs } = await openBrowser({ headed: opts.headed === true || opts.headed === 'true' });
  await assertLoggedIn(context.pages()[0]);
  const countryLabel = country ? await switchCountry(context.pages()[0], country) : null;
  const currency = countryLabel ? resolveCountry(countryLabel).currency : (opts.currency || 'THB');
  const region = countryLabel ? (REGION_BY_LABEL[countryLabel] || null) : null;
  const page = context.pages()[0];

  // 抓商品榜：第一页读回有效日期，再串行抓 pages 页
  const firstUrl = buildProductUrl({ dateType, categoryId, categoryId2, sort, region, page: 1 });
  await page.goto(firstUrl, { waitUntil: 'domcontentloaded' });
  const firstPayload = await grabProductPage(page, firstUrl);
  const effective = await safeEval(page, () => { const u = new URL(location.href); return { date_type: u.searchParams.get('date_type'), date_value: u.searchParams.get('date_value') }; }).catch(() => ({ date_type: null, date_value: null }));
  const effDateType = Number(effective.date_type || dateType);
  const effDateValue = effective.date_value || null;

  const board = [...(firstPayload.rows || [])];
  const seen = new Set(board.map((r) => r.id).filter(Boolean));
  for (let i = 2; i <= pages; i++) {
    const url = buildProductUrl({ dateType: effDateType, dateValue: effDateValue, categoryId, categoryId2, sort, region, page: i });
    const payload = await grabProductPage(page, url);
    for (const row of payload.rows || []) {
      if (row.id && seen.has(row.id)) continue;
      if (row.id) seen.add(row.id);
      board.push(row);
    }
  }
  log(`商品榜抓取完成：${board.length} 个商品`);

  // 聚合店铺 GMV，取前 top
  const shops = aggregateShops(board);
  const topShops = shops.slice(0, top);
  log(`聚合 ${shops.length} 个店铺，取前 ${topShops.length} 个，开始逐个抓达人数量`);

  // 逐个搜索店铺名 → 抓总览（达人数量）
  const enriched = [];
  for (const s of topShops) {
    try {
      const shopId = await resolveShopId(page, s.shop);
      await page.goto(`${BASE}/shop-marketing/detail/${shopId}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const overview = await grabShopOverview(page);
      enriched.push({ ...s, shop_id: shopId, authors: overview['带货达人数'] || null, category_rank: overview['分类排名'] || null, rating: null });
      log(`店铺 ${s.shop}：达人 ${overview['带货达人数'] || '?'}，分类排名 ${overview['分类排名'] || '?'}`);
    } catch (e) {
      enriched.push({ ...s, authors: null, error: String(e).slice(0, 80) });
      log(`店铺 ${s.shop} 抓取失败：${String(e).slice(0, 80)}`);
    }
  }

  const result = {
    collected_at: new Date().toISOString(),
    country: countryLabel || null,
    currency,
    category: category || null,
    category_id: categoryId || null,
    category_id2: categoryId2 || null,
    days,
    date_type: effDateType,
    date_value: effDateValue,
    top,
    benchmark: benchmark || null,
    shops: enriched,
    timings: { launchMs, totalMs: Date.now() - t0 },
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(reportFile, renderShopCompareReport(result), 'utf8');
  log(`写出 ${outFile} / ${reportFile}`);
  await context.close();
  return { result, outFile, reportFile };
}

/** 生成店铺对比报告（数据驱动） */
function renderShopCompareReport(r) {
  const moneyOf = (n) => money(n, r.currency);
  const lines = [
    `# ${r.category || r.category_id2} 类目 · 近${r.days}天 GMV 前${r.top}店铺对比`,
    '',
    `> 采集 ${(r.collected_at || '').slice(0, 10)} · 国家 ${r.country || '未知'} · 币种 ${r.currency} · 榜单 date_type=${r.date_type} date_value=${r.date_value}${r.benchmark ? ' · 基准店铺 ' + r.benchmark : ''}`,
    '',
    '| 排名 | 店铺 | GMV(近' + r.days + '天) | 价格区间 | 平均佣金 | 达人数量 | 分类排名 | 商品数 |',
    '|---|---|---|---|---|---|---|---|',
  ];
  r.shops.forEach((s, i) => {
    const price = s.price_min != null && s.price_max != null ? `฿${s.price_min}~${s.price_max}` : '—';
    lines.push(`| ${i + 1} | ${cell(s.shop)} | ${moneyOf(s.gmv)} | ${price} | ${s.commission != null ? s.commission + '%' : '—'} | ${cell(s.authors)} | ${cell(s.category_rank)} | ${s.count} |`);
  });
  lines.push('', '---', '', '*GMV 按商品榜（二级类目）按店铺聚合，非店铺整体 GMV；达人数量为店铺详情页累计口径；佣金为上榜商品平均；价格区间为过滤配件后的上榜商品价格范围。*');
  return lines.join('\n');
}
