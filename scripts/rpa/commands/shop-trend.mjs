// 店铺趋势：两个完整等长周期的逐日对比，以及已采集商品的涨跌归因。
import fs from 'node:fs';
import path from 'node:path';
import { BASE, SKILL_ROOT, COUNTRY_LABELS, resolveCountry } from '../lib/config.mjs';
import { log } from '../lib/cli.mjs';
import { openBrowser, safeEval, assertLoggedIn, switchCountry, assertPageAccess } from '../lib/browser.mjs';
import { makeTracker, waitTracked } from '../lib/tracker.mjs';
import { resolveShopId, grabShopOverview, collectShopProducts } from '../lib/shop.mjs';
import { comparePeriod, validateCompareDays } from '../lib/trend.mjs';
import { parseAmount } from '../data-rules.mjs';
import { cell, short, pct, money } from '../lib/report.mjs';

const SHOP_SEARCH = `${BASE}/shop-marketing/search`;
const SHOP_DETAIL = `${BASE}/shop-marketing/detail`;
const GOODS_DETAIL = `${BASE}/e-commerce/detail`;

/** 等本次90天请求，验证阻挡直接交给人工登录流程，不在后台空等。 */
export async function readNinetyDayTrend(page, tracker, params, readRows) {
  await assertPageAccess(page);
  const currentUrl = tracker.url() ? new URL(tracker.url()) : null;
  const correctPeriod = currentUrl && Object.entries(params).every(([key, value]) => currentUrl.searchParams.get(key) === String(value));
  if (!correctPeriod) {
    tracker.reset(params);
    await page.getByRole('radio', { name: '近90天', exact: true }).first().check();
  }
  const body = await waitTracked(tracker, value => {
    try { return Array.isArray(readRows(JSON.parse(value))); } catch { return false; }
  }, { check: () => assertPageAccess(page) });
  if (!body) throw new Error('未拿到目标对象的近90天趋势数据');
  return JSON.parse(body);
}

function attribution(products) {
  const compared = products.filter(p => p.cmp?.complete && p.cmp.sold_pct !== null);
  const item = p => ({ id: p.id, title: p.title, price: p.price, crate: p.crate, fastmoss_url: p.fastmoss_url, sold_pct: p.cmp.sold_pct, amount_pct: p.cmp.amount_pct, cur_sold: p.cmp.cur.sold, prev_sold: p.cmp.prev.sold, cur_amount: p.cmp.cur.amount, prev_amount: p.cmp.prev.amount });
  return {
    risers: compared.filter(p => p.cmp.sold_pct > 0).sort((a, b) => b.cmp.sold_pct - a.cmp.sold_pct).map(item),
    decliners: compared.filter(p => p.cmp.sold_pct < 0).sort((a, b) => a.cmp.sold_pct - b.cmp.sold_pct).map(item),
  };
}

export async function cmdShopTrend(opts) {
  const days = validateCompareDays(opts.days ?? 30);
  const maxPages = Number(opts.pages ?? 100);
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) throw new Error('--pages 必须为正整数');
  const shopName = opts.shop || opts['shop-name'] || (Array.isArray(opts._) ? opts._[0] : null);
  const shopId = opts['shop-id'] || opts.id || null;
  if (!shopName && !shopId) throw new Error('缺少店铺名或ID：shop-trend --shop <店铺名> 或 --shop-id <ID>');
  const outFile = path.resolve(opts.out || path.join(SKILL_ROOT, 'outputs', `shop-trend-${(shopName || shopId).replace(/[^\w.-]/g, '_')}-${Date.now()}.json`));
  if (!outFile.toLowerCase().endsWith('.json')) throw new Error('--out 请使用 .json 文件名');
  const reportFile = outFile.slice(0, -5) + '.md';
  const t0 = Date.now();
  const { context, launchMs } = await openBrowser({ headed: opts.headed === true || opts.headed === 'true' });
  const page = context.pages()[0];
  const result = { collected_at: new Date().toISOString(), status: 'running', shop_name: shopName, shop_id: shopId, country: null, currency: null, compare_days: days, overview: {}, shop: null, products: [], coverage: { scope: 'page_visible_products', historical_coverage_complete: false }, attribution: { risers: [], decliners: [] } };
  const trackers = [];
  const save = () => {
    result.attribution = attribution(result.products);
    result.coverage.products_requested = result.products.length;
    result.coverage.products_compared = result.products.filter(p => p.cmp?.complete).length;
    const emptyDespiteSales = result.products.length === 0 && result.shop?.complete && (result.shop.cur.sold !== 0 || result.shop.prev.sold !== 0);
    result.coverage.comparison_complete = !emptyDespiteSales && result.shop?.complete === true && result.coverage.historical_coverage_complete === true && result.coverage.products_compared === result.products.length;
    result.timings = { launchMs, totalMs: Date.now() - t0 };
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf8');
    fs.writeFileSync(reportFile, renderShopTrendReport(result), 'utf8');
  };
  save();
  try {
    await assertLoggedIn(page, SHOP_SEARCH);
    const country = opts.country ? await switchCountry(page, opts.country) : await safeEval(page, labels => [...document.querySelectorAll('button')].map(e => e.innerText.trim()).find(text => labels.includes(text)) || null, COUNTRY_LABELS);
    if (!country) throw new Error('无法确认当前站点，请显式传 --country');
    result.country = country;
    result.currency = resolveCountry(country).currency;
    const resolvedId = shopId || await resolveShopId(page, shopName);
    result.shop_id = resolvedId;
    const recent = makeTracker(page, '/api/shop/v3/recentData', { id: resolvedId });
    const goods = makeTracker(page, '/api/shop/v3/goods');
    trackers.push(recent, goods);
    await page.goto(`${SHOP_DETAIL}/${resolvedId}`, { waitUntil: 'domcontentloaded' });
    const initial = await waitTracked(recent, value => { try { return Array.isArray(JSON.parse(value)?.data?.list?.trend); } catch { return false; } }, { check: () => assertPageAccess(page) });
    if (!initial) throw new Error('店铺趋势未加载');
    result.overview = await grabShopOverview(page);
    const shopData = await readNinetyDayTrend(page, recent, { id: resolvedId, date_type: 90 }, json => json?.data?.list?.trend);
    result.shop_name = shopData.data.list.total_info?.shop_name || shopName || resolvedId;
    result.shop = comparePeriod(shopData.data.list.trend, days);
    save();

    // 从首次导航起就监听商品列表，避免为重新捕获接口而整页重载。
    await page.evaluate(() => [...document.querySelectorAll('table')].find(t => t.querySelector('a[href*="/e-commerce/detail/"]'))?.scrollIntoView());
    const listing = await collectShopProducts(page, goods, { maxPages });
    result.coverage = { ...result.coverage, ...listing.coverage };
    result.products = listing.products.map(p => ({
      id: p.product_id, title: p.title, price: p.price, ori_price: p.ori_price, crate: p.crate,
      ctime: p.ctime, category_l2: Array.isArray(p.category_name_l2) ? p.category_name_l2.join('/') : p.category_name_l2 || null,
      product_rating: p.product_rating, relate_author_count: p.relate_author_count, tiktok_url: p.detail_url,
      fastmoss_url: `${GOODS_DETAIL}/${p.product_id}`,
      listing_period_days: listing.coverage.period_days, listed_units: parseAmount(p.sold_count), listed_gmv: parseAmount(p.sale_amount),
      sold_28d: listing.coverage.period_days === 28 ? parseAmount(p.sold_count) : null,
      amount_28d: listing.coverage.period_days === 28 ? parseAmount(p.sale_amount) : null,
      status: 'not_attempted', cmp: null,
    }));
    save();
    const overview = makeTracker(page, '/api/goods/v3/overview');
    trackers.push(overview);
    for (const product of result.products) {
      try {
        overview.reset({ product_id: product.id });
        await page.goto(product.fastmoss_url, { waitUntil: 'domcontentloaded' });
        const first = await waitTracked(overview, value => { try { return Array.isArray(JSON.parse(value)?.data?.chart_list); } catch { return false; } }, { check: () => assertPageAccess(page) });
        if (!first) throw new Error('商品趋势未加载');
        const data = await readNinetyDayTrend(page, overview, { product_id: product.id, d_type: 90 }, json => json?.data?.chart_list);
        product.cmp = comparePeriod(data.data.chart_list, days, result.shop.comparison_end);
        product.status = product.cmp.complete ? 'ok' : 'incomplete';
        if (!product.cmp.complete) product.error = product.cmp.reason;
      } catch (error) {
        product.status = error.code === 'FASTMOSS_BLOCKED' ? 'blocked' : 'error';
        product.error = error.message;
        if (error.code === 'FASTMOSS_BLOCKED') throw error;
      } finally { save(); }
      log(`商品趋势 ${product.id}：${product.status}`);
    }
    result.status = result.coverage.comparison_complete ? 'complete' : 'partial';
    save();
    return { result, outFile, reportFile };
  } catch (error) {
    result.status = error.code === 'FASTMOSS_BLOCKED' ? 'blocked' : 'failed';
    result.stopped_reason = error.message;
    save();
    throw error;
  } finally {
    trackers.forEach(tracker => tracker.dispose());
    await context.close();
  }
}

export function renderShopTrendReport(r) {
  const s = r.shop;
  const ov = r.overview || {};
  const moneyOf = value => money(value, r.currency);
  const lines = [
    `# ${r.shop_name || r.shop_id || '店铺'} 趋势分析（近${r.compare_days}天 vs 上个${r.compare_days}天）`, '',
    `国家：${r.country || '未知'} · 币种：${r.currency || '未知'} · 状态：${r.status}`, '',
    '## 一、店铺总览（累计口径）', '',
    '| 指标 | 数值 | 指标 | 数值 |', '|---|---|---|---|',
    `| 总销量 | ${cell(ov['总销量'])} | 总销售额 | ${cell(ov['总销售额'])} |`,
    `| 在售商品数 | ${cell(ov['在售商品数'])} | 全国排名 | ${cell(ov['全国排名'])} |`,
    `| 带货直播数 | ${cell(ov['带货直播数'])} | 带货视频数 | ${cell(ov['带货视频数'])} |`,
    `| 带货达人数 | ${cell(ov['带货达人数'])} | 分类排名 | ${cell(ov['分类排名'])} |`, '',
    '## 二、周期对比', '',
  ];
  if (s?.complete) {
    lines.push(`上期：${s.previous_start}～${s.previous_end}；本期：${s.current_start}～${s.current_end}。`, '',
      '| 指标 | 本期 | 上期 | 环比 |', '|---|---|---|---|',
      `| 销量 | ${s.cur.sold} | ${s.prev.sold} | ${pct(s.sold_pct)} |`,
      `| GMV | ${moneyOf(s.cur.amount)} | ${moneyOf(s.prev.amount)} | ${pct(s.amount_pct)} |`, '',
      '基期为0时百分比保持未知；逐日数据连续、两期等长后才计算环比。', '');
  } else lines.push(`店铺涨跌未知：${s?.reason || '趋势尚未采集'}。`, '');
  lines.push('## 三、商品归因与覆盖范围', '',
    `商品清单：已读 ${r.coverage.pages_read || 0} 页、${r.products.length} 个商品（含当前销量为0的商品）；完成比较 ${r.coverage.products_compared || 0} 个。`,
    `清单周期：${r.coverage.period_days ? '近' + r.coverage.period_days + '天' : '未确认'}；页面可见历史清单与比较覆盖：${r.coverage.comparison_complete ? '完整' : '部分/未确认'}。`, '');
  if (!r.coverage.comparison_complete) lines.push('以下仅为已采集样本；页面未覆盖的历史商品或缺失趋势可能影响归因，不能据此认定全店没有下跌商品。', '');
  if (r.coverage.reason) lines.push(`清单限制：${cell(r.coverage.reason)}。`, '');
  const table = (title, products) => {
    lines.push(`### ${title}`, '', '| 商品 | 价格 | 佣金 | 本期销量 | 上期销量 | 销量环比 | 本期GMV | 上期GMV | GMV环比 | 链接 |', '|---|---|---|---|---|---|---|---|---|---|');
    products.forEach(p => lines.push(`| ${cell(short(p.title))} | ${cell(p.price)} | ${cell(p.crate)} | ${p.cur_sold} | ${p.prev_sold} | ${pct(p.sold_pct)} | ${moneyOf(p.cur_amount)} | ${moneyOf(p.prev_amount)} | ${pct(p.amount_pct)} | [商品](${p.fastmoss_url}) |`));
    lines.push('');
  };
  if (r.attribution.decliners.length) table('销量下跌商品', r.attribution.decliners);
  else lines.push(r.coverage.comparison_complete ? '完整覆盖的页面可见比较范围内未发现销量下跌商品；这不包含平台未展示的历史商品。' : '当前已采集样本未发现可确认的下跌；全店结论未知。', '');
  if (r.attribution.risers.length) table('销量上涨商品', r.attribution.risers);
  const unfinished = r.products.filter(p => p.status !== 'ok');
  if (unfinished.length) {
    lines.push('### 未完成项', '', '| 商品 | 状态 | 原因 |', '|---|---|---|');
    unfinished.forEach(p => lines.push(`| ${cell(p.title || p.id)} | ${cell(p.status)} | ${cell(p.error || '尚未采集')} |`));
    lines.push('');
  }
  if (r.stopped_reason) lines.push(`采集停止：${cell(r.stopped_reason)}。`, '');
  return lines.join('\n');
}
