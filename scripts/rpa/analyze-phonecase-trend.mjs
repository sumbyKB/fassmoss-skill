// 手机壳两榜分析。输入目录可配置；详情默认无界面，结果逐项保存。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BASE, SKILL_ROOT, resolveCountry } from './lib/config.mjs';
import { log, parseArgs } from './lib/cli.mjs';
import { openBrowser, safeEval, assertPageAccess, assertLoggedIn, switchCountry } from './lib/browser.mjs';
import { makeTracker, waitTracked } from './lib/tracker.mjs';
import { parseAmount } from './data-rules.mjs';
import { isPhoneCase, salesTrend, dailySalesTrend, safeProductLink } from './lib/product-trend.mjs';

export function detailUnitsSnapshot() {
  const root = document.querySelector('#overview');
  if (!root) return null;
  const card = root.querySelector('label[aria-label="sold_count_show"]') || root.querySelector('input[value="sold_count_show"]')?.closest('label');
  const checked = root.querySelector('input[type=radio]:checked');
  return { period_days: checked ? Number(checked.value) : null, raw: card?.querySelector('p')?.innerText.trim() ?? null, dates: [...root.querySelectorAll('input')].map(input => input.value).filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value)), busy: !!root.querySelector('.ant-spin-spinning, .ant-spin-blur') };
}

/** 只使用总览自身的7天控件与同一商品、同一周期响应，不读取全页第一个“销量”。 */
export async function scrapeDetail7d(page, id) {
  if (!/^\d+$/.test(String(id))) throw new Error('商品ID无效');
  const tracker = makeTracker(page, '/api/goods/v3/overview', { product_id: String(id) });
  try {
    await page.goto(`${BASE}/e-commerce/detail/${id}`, { waitUntil: 'domcontentloaded' });
    await assertPageAccess(page);
    await page.locator('#overview').waitFor({ state: 'attached', timeout: 15000 });
    const initial = await safeEval(page, detailUnitsSnapshot);
    if (initial?.period_days !== 7) {
      tracker.reset({ product_id: String(id), d_type: 7 });
      await page.locator('#overview').getByRole('radio', { name: '近7天', exact: true }).check();
    }
    const body = await waitTracked(tracker, value => {
      try { return new URL(tracker.url()).searchParams.get('d_type') === '7' && Array.isArray(JSON.parse(value)?.data?.chart_list); } catch { return false; }
    }, { check: () => assertPageAccess(page) });
    if (!body) throw new Error('近7天数据未返回');
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      await assertPageAccess(page);
      const snapshot = await safeEval(page, detailUnitsSnapshot);
      if (snapshot?.period_days === 7 && !snapshot.busy) {
        const daily = JSON.parse(body).data.chart_list;
        const summary = dailySalesTrend(daily, snapshot.dates.at(-1));
        const displayed = parseAmount(snapshot.raw);
        const abbreviation = String(snapshot.raw || '').match(/\d+(?:\.(\d+))?([万亿])/);
        const tolerance = abbreviation ? (abbreviation[2] === '亿' ? 1e8 : 1e4) / (10 ** (abbreviation[1]?.length || 0)) / 2 : 0;
        if (summary.units_7d !== null && displayed !== null && Math.abs(displayed - summary.units_7d) > tolerance) { await page.waitForTimeout(100); continue; }
        return { period_days: 7, period_verified: true, period_start: snapshot.dates[0] || summary.period_start || null, period_end: snapshot.dates.at(-1) || summary.period_end || null, units_7d_raw: summary.units_7d !== null ? snapshot.raw : null, units_source: 'detail_7d_daily_sum', daily_trend: daily.map(row => ({ dt: row.dt, inc_sold_count: row.inc_sold_count })), ...summary };
      }
      await page.waitForTimeout(100);
    }
    throw new Error('详情页近7天周期未确认');
  } finally { tracker.dispose(); }
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(['phonecase-trend', ...argv]);
  if (opts.help) { console.log('analyze-phonecase-trend.mjs --dir <输入目录> [--sales <销量榜JSON>] [--new-products <新品榜JSON>] [--top 50] [--out result.json] [--headed true]'); return; }
  const directory = path.resolve(opts.dir || (opts.out ? path.dirname(opts.out) : path.join(SKILL_ROOT, 'outputs', 'latest')));
  const sales = JSON.parse(fs.readFileSync(path.resolve(opts.sales || path.join(directory, 'saleslist.json')), 'utf8'));
  const news = JSON.parse(fs.readFileSync(path.resolve(opts['new-products'] || path.join(directory, 'newproducts.json')), 'utf8'));
  if (!Array.isArray(sales.products) || !Array.isArray(news.products)) throw new Error('输入需要 products 数组');
  const country = resolveCountry(opts.country || news.meta?.country || sales.meta?.country);
  if (!country) throw new Error('输入没有国家，请传 --country');
  for (const data of [sales, news]) {
    if (data.meta?.country && resolveCountry(data.meta.country).label !== country.label) throw new Error('两榜国家不一致');
    if (data.meta?.currency && data.meta.currency !== country.currency) throw new Error('两榜币种不一致');
  }
  const limit = Number(opts.top ?? 50);
  const uniqueCases = rows => [...new Map(rows.filter(row => isPhoneCase(row.product)).map(row => {
    if (typeof row.id !== 'string' || !/^\d+$/.test(row.id)) throw new Error('商品ID必须是完整的数字字符串');
    return [row.id, row];
  })).values()].slice(0, limit);
  const salesCases = uniqueCases(sales.products);
  const newsCases = uniqueCases(news.products);
  const result = {
    collected_at: new Date().toISOString(), country: country.label, currency: country.currency, category: '手机壳（商品名称规则筛选）', requested_top: limit, status: 'running',
    saleslist: { ...sales.meta, note: '销量为榜单有效周期，保留date_type/date_value；自然周榜不等同于采集时滚动近7天。' },
    newproducts: { ...news.meta, note: '列表三日销量保留原文；趋势只由详情页同一个完整近7天逐日序列计算。' },
    trend_rule: '近7天逐日数据：最近3日日均 / 之前4日日均；>1.1上升/<0.9下滑；基期零而近期有销量标新近起量；缺数据未知。',
    sales_top50: salesCases.map(row => ({ ...row, units_7d: String(sales.meta?.date_type) === '2' ? row.units : null, ...salesTrend(row.units_wow) })),
    new_top50: newsCases.map(row => ({ ...row, units_7d: null, trend: '未知', status: 'not_attempted', period_verified: false })),
  };
  const outFile = path.resolve(opts.out || path.join(directory, 'result.json'));
  const inputPaths = [opts.sales || path.join(directory, 'saleslist.json'), opts['new-products'] || path.join(directory, 'newproducts.json')].map(file => path.resolve(file));
  if (!outFile.toLowerCase().endsWith('.json') || inputPaths.includes(outFile)) throw new Error('输出需为独立的.json文件，不能覆盖输入');
  const save = () => { fs.mkdirSync(path.dirname(outFile), { recursive: true }); fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf8'); };
  let context;
  save();
  try {
    if (newsCases.length) {
      const browser = await openBrowser({ headed: opts.headed === true || opts.headed === 'true' });
      context = browser.context;
      const page = context.pages()[0];
      await assertLoggedIn(page, `${BASE}/e-commerce/newProducts`);
      await switchCountry(page, country.label);
      for (let index = 0; index < newsCases.length; index++) {
        const item = result.new_top50[index];
        try {
          const link = safeProductLink(item.source_url);
          if (!link || !/^\d+$/.test(String(item.id)) || new URL(link).pathname.split('/').pop() !== String(item.id)) throw new Error('商品ID与详情来源不一致');
          Object.assign(item, await scrapeDetail7d(page, item.id));
          item.status = item.units_7d === null ? 'incomplete' : 'ok';
        } catch (error) {
          item.status = error.code === 'FASTMOSS_BLOCKED' ? 'blocked' : 'error';
          item.error = error.message;
          if (error.code === 'FASTMOSS_BLOCKED') throw error;
        } finally { save(); }
        log(`新品详情 ${index + 1}/${newsCases.length}：${item.status}`);
      }
    }
    result.status = result.new_top50.some(row => row.status !== 'ok') || [sales, news].some(data => data.meta?.status && data.meta.status !== 'complete') ? 'partial' : 'complete';
    save();
    return result;
  } catch (error) {
    result.status = error.code === 'FASTMOSS_BLOCKED' ? 'blocked' : 'failed';
    result.stopped_reason = error.message;
    save();
    throw error;
  } finally { if (context) await context.close(); }
}
if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error('失败：', error.message); process.exitCode = 1; });
