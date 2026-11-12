// 店铺对比命令：抓某类目商品榜 → 按店铺聚合 GMV → 取前 N → 逐个抓达人数量 → 对比报告。
// 用于「某类目 GMV 前 N 店铺逐个对比：GMV / 价格区间 / 佣金 / 达人数量」，搜索条件（国家/类目/前N/天数/基准店铺）均为变量。
import fs from 'node:fs';
import path from 'node:path';
import { BASE, SKILL_ROOT, resolveCountry, REGION_BY_LABEL, COUNTRY_LABELS } from '../lib/config.mjs';
import { log } from '../lib/cli.mjs';
import { openBrowser, assertLoggedIn, switchCountry, safeEval } from '../lib/browser.mjs';
import { resolveCategoryId } from '../lib/categories.mjs';
import { dateTypeOf, buildProductUrl, grabProductPage, openProductBoard } from './product.mjs';
import { grabShopOverview, resolveShopId } from '../lib/shop.mjs';
import { cell, money } from '../lib/report.mjs';
import { parseAmount, parsePriceRange } from '../data-rules.mjs';

/** 解析佣金率（如 8% → 8） */
function parseCommission(v) {
  const m = String(v ?? '').match(/([\d.]+)%/);
  return m ? Number(m[1]) : null;
}

/** 按店铺聚合商品榜数据 */
export function aggregateShops(rows, { minPrice = null, excludeKeywords = [] } = {}) {
  const byShop = new Map();
  for (const r of rows) {
    const pr = parsePriceRange(r.price_raw);
    if (minPrice !== null && (!pr || pr.max < minPrice)) continue;
    if (excludeKeywords.some(keyword => String(r.product || '').toLowerCase().includes(keyword.toLowerCase()))) continue;
    const shop = String(r.shop || '').trim();
    if (!shop) continue;
    const gmv = parseAmount(r.gmv);
    const comm = parseCommission(r.commission);
    const units = parseAmount(r.units);
    if (!byShop.has(shop)) byShop.set(shop, { shop, gmv: 0, gmvKnown: 0, count: 0, units: 0, unitsKnown: 0, prices: [], comms: [] });
    const s = byShop.get(shop);
    if (gmv !== null) { s.gmv += gmv; s.gmvKnown++; }
    s.count += 1;
    if (units !== null) { s.units += units; s.unitsKnown++; }
    if (pr) { s.prices.push(pr.min, pr.max); }
    if (comm != null) s.comms.push(comm);
  }
  return [...byShop.values()]
    .map((s) => ({
      shop: s.shop,
      gmv: s.gmvKnown === s.count ? s.gmv : null,
      known_gmv_subtotal: s.gmvKnown ? s.gmv : null,
      missing_gmv_products: s.count - s.gmvKnown,
      count: s.count,
      units: s.unitsKnown === s.count ? s.units : null,
      price_min: s.prices.length ? Math.min(...s.prices) : null,
      price_max: s.prices.length ? Math.max(...s.prices) : null,
      commission: s.comms.length ? +(s.comms.reduce((a, b) => a + b, 0) / s.comms.length).toFixed(1) : null,
    }))
    .sort((a, b) => (b.gmv ?? -Infinity) - (a.gmv ?? -Infinity));
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
  const minPrice = opts['min-price'] === undefined ? null : Number(opts['min-price']);
  if (minPrice !== null && (!Number.isFinite(minPrice) || minPrice < 0 || opts['min-price'] === true)) throw new Error('--min-price 必须是非负金额，单位为当前站点币种');
  if (opts['exclude-keywords'] !== undefined && typeof opts['exclude-keywords'] !== 'string') throw new Error('--exclude-keywords 需要逗号分隔的关键词');
  const excludeKeywords = String(opts['exclude-keywords'] || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);

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
  const countryLabel = country ? await switchCountry(context.pages()[0], country) : await safeEval(context.pages()[0], labels => [...document.querySelectorAll('button')].map(e => e.innerText.trim()).find(text => labels.includes(text)) || null, COUNTRY_LABELS);
  if (!countryLabel) throw new Error('无法确认当前站点，请显式传 --country');
  const currency = resolveCountry(countryLabel).currency;
  const region = countryLabel ? (REGION_BY_LABEL[countryLabel] || null) : null;
  const page = context.pages()[0];

  // 抓商品榜：第一页读回有效日期，再串行抓 pages 页
  const firstPayload = await openProductBoard(page, { dateType, dateValue: opts['date-value'], categoryId, categoryId2, sort, region });
  const effective = firstPayload.effective;
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
  const shops = aggregateShops(board, { minPrice, excludeKeywords });
  const topShops = shops.filter(s => s.gmv !== null).slice(0, top);
  log(`聚合 ${shops.length} 个店铺，取前 ${topShops.length} 个，开始逐个抓达人数量`);

  // 逐个搜索店铺名 → 抓总览（达人数量）
  const enriched = [];
  let stopped = null;
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
      if (e.code === 'FASTMOSS_BLOCKED') { stopped = e; break; }
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
    filters: { min_price: minPrice, exclude_keywords: excludeKeywords },
    incomplete_shops: shops.filter(s => s.gmv === null),
    shops: enriched,
    status: stopped ? 'blocked' : enriched.some(s => s.error) ? 'partial' : 'complete',
    stopped_reason: stopped?.message || null,
    shops_not_attempted: topShops.length - enriched.length,
    timings: { launchMs, totalMs: Date.now() - t0 },
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(reportFile, renderShopCompareReport(result), 'utf8');
  log(`写出 ${outFile} / ${reportFile}`);
  await context.close();
  if (stopped) throw stopped;
  return { result, outFile, reportFile };
}

/** 生成店铺对比报告（数据驱动） */
function renderShopCompareReport(r) {
  const moneyOf = (n) => money(n, r.currency);
  const lines = [
    `# ${r.category || r.category_id2} 类目 · 商品榜GMV前${r.top}店铺样本对比`,
    '',
    `> 采集 ${(r.collected_at || '').slice(0, 10)} · 国家 ${r.country || '未知'} · 币种 ${r.currency} · 榜单 date_type=${r.date_type} date_value=${r.date_value}${r.benchmark ? ' · 基准店铺 ' + r.benchmark : ''}`,
    '',
    '| 排名 | 店铺 | GMV(榜单周期) | 价格区间 | 平均佣金 | 达人数量 | 分类排名 | 商品数 |',
    '|---|---|---|---|---|---|---|---|',
  ];
  r.shops.forEach((s, i) => {
    const price = s.price_min != null && s.price_max != null ? `${r.currency} ${s.price_min}~${s.price_max}` : '—';
    lines.push(`| ${i + 1} | ${cell(s.shop)} | ${moneyOf(s.gmv)} | ${price} | ${s.commission != null ? s.commission + '%' : '—'} | ${cell(s.authors)} | ${cell(s.category_rank)} | ${s.count} |`);
  });
  lines.push('', `状态：${r.status}；尚未采集店铺详情 ${r.shops_not_attempted} 家。${r.stopped_reason ? '采集停止：' + cell(r.stopped_reason) : ''}`, '', `金额缺失而未参与排名的店铺：${r.incomplete_shops?.length || 0} 家。筛选：最低标价 ${r.filters.min_price ?? '不限'} ${r.currency}，排除关键词 ${r.filters.exclude_keywords.join('、') || '无'}。`, '', '---', '', '*GMV 为本次上榜商品在同一榜单周期内的店铺汇总；排名限于已采集且金额完整的样本，不代表店铺全量GMV；达人数量为店铺详情页累计口径，佣金为已知上榜商品平均。*');
  return lines.join('\n');
}
