import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { comparePeriod, validateCompareDays } from './lib/trend.mjs';
import { parsePriceRange } from './data-rules.mjs';
import { aggregateShops } from './commands/shop-compare.mjs';
import { renderCategoryRoiReport, cmdProduct, dateTypeOf, buildProductUrl } from './commands/product.mjs';
import { resolveCategoryOptions } from './lib/categories.mjs';
import { selectShopResult } from './lib/shop.mjs';
import { cmdShopTrend, renderShopTrendReport } from './commands/shop-trend.mjs';
import { cmdShopAuthors, collectAuthors, renderShopAuthorsReport } from './commands/shop-authors.mjs';

const trend = (count = 90) => Array.from({ length: count }, (_, i) => ({ dt: new Date(Date.UTC(2026, 7, 12 + i)).toISOString().slice(0, 10), inc_sold_count: 1, inc_sale_amount: 10 }));

test('equal-length continuous periods are compared by date, independent of response order', () => {
  const rows = trend().reverse();
  const result = comparePeriod(rows, 30);
  assert.equal(result.complete, true);
  assert.equal(result.cur.sold, 30);
  assert.equal(result.prev.sold, 30);
  assert.equal(result.sold_pct, 0);
  assert.equal(result.amount_pct, 0);
  assert.equal(result.current_end, '2026-11-09');
  for (const value of [0, 46, 60, 'abc', true, 1.5, -1]) assert.throws(() => validateCompareDays(value), /1到45/);
});

test('missing days, duplicates, missing metrics and inconsistent end dates remain unknown', () => {
  const all = trend();
  for (const rows of [all.slice(-50), all.filter((_, i) => i !== 80), [...all, all.at(-1)], all.map((r, i) => i === 89 ? { ...r, inc_sale_amount: null } : r)]) {
    const result = comparePeriod(rows, 30);
    assert.equal(result.complete, false);
    assert.equal(result.sold_pct, null);
    assert.equal(result.amount_pct, null);
    assert.equal(result.cur, null);
  }
  assert.equal(comparePeriod(all, 30, '2026-11-10').complete, false);
});

test('a product that stops selling is a 100 percent decliner and zero baseline is unknown', () => {
  const result = comparePeriod(trend().map((r, i) => i >= 60 ? { ...r, inc_sold_count: 0, inc_sale_amount: 0 } : r), 30);
  assert.equal(result.cur.sold, 0);
  assert.equal(result.prev.sold, 30);
  assert.equal(result.sold_pct, -100);
  const zeroBaseline = comparePeriod(trend().map((r, i) => i < 60 ? { ...r, inc_sold_count: 0, inc_sale_amount: 0 } : r), 30);
  assert.equal(zeroBaseline.sold_pct, null);
});

test('cross-category shop ranking includes low prices by default and filters only on explicit options', () => {
  const rows = [
    { product: 'Earbuds', shop: 'A', price_raw: '$19.99', gmv: '$1000', units: '50', commission: '10%' },
    { product: 'Premium earbuds', shop: 'B', price_raw: '$59.99', gmv: '$500', units: '10', commission: '10%' },
    { product: 'insole', shop: 'C', price_raw: '$5', gmv: '$200', units: '10' },
  ];
  assert.deepEqual(aggregateShops(rows).map(s => s.shop), ['A', 'B', 'C']);
  assert.deepEqual(aggregateShops(rows, { minPrice: 50 }).map(s => s.shop), ['B']);
  assert.deepEqual(aggregateShops(rows, { excludeKeywords: ['INSOLE'] }).map(s => s.shop), ['A', 'B']);
  const missing = aggregateShops([{ ...rows[0], gmv: null }])[0];
  assert.equal(missing.gmv, null);
  assert.equal(missing.missing_gmv_products, 1);
  assert.deepEqual(parsePriceRange('S$1,299.00 - 1,399.00'), { min: 1299, max: 1399 });
  assert.equal(parsePriceRange('—'), null);
});

test('category ROI conclusions are observations and do not claim low-price ROI is higher', () => {
  const products = [
    { product: 'Low price', roi: 1, raw: { gmv: '$100', ad_spend: '$100' }, _board: { shop: 'A', price_raw: '$20', week_units: '5' } },
    { product: 'High price', roi: 4, raw: { gmv: '$400', ad_spend: '$100' }, _board: { shop: 'B', price_raw: '$1,299', week_units: '4' } },
  ];
  const report = renderCategoryRoiReport({ meta: { category: '耳机', currency: 'USD', period_days: 28, days: 7 }, products });
  assert.match(report, /1\.00 ～ 4\.00/);
  assert.match(report, /20 ～ 1299 USD/);
  assert.doesNotMatch(report, /前者投入小|ROI 略高|无暴利|稳态竞争|品类进入稳态/);
});

test('shop result matching prefers exact names and rejects ambiguous fuzzy names', () => {
  const rows = [{ id: '1', name: 'Wanted Shop Outlet' }, { id: '2', name: 'Wanted Shop' }];
  assert.equal(selectShopResult(rows, 'Wanted Shop').id, '2');
  assert.throws(() => selectShopResult(rows, 'Wanted'), /歧义/);
});

test('the product command reuses its loaded first page and passes the requested date', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fastmoss-product-first-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = path.join(dir, 'products.json');
  let reads = 0;
  let closes = 0;
  const sandbox = { fs, path, dateTypeOf, buildProductUrl, resolveCategoryOptions, SKILL_ROOT: dir, REGION_BY_LABEL: { '美国': 'US' },
    openBrowser: async () => ({ context: { pages: () => [{}], close: async () => closes++ }, launchMs: 1 }),
    assertLoggedIn: async () => {}, switchCountry: async () => '美国', resolveCountry: () => ({ currency: 'USD' }), log: () => {},
    openProductBoard: async (_page, request) => {
      reads++;
      assert.equal(request.dateValue, '2026-09');
      return { headers: [], rows: [{ id: '123', rank: '1' }], effective: { date_type: '3', date_value: '2026-09' } };
    },
    grabProductPage: async () => { throw new Error('first page must not be navigated again'); },
    opts: { pages: 1, days: 30, country: '美国', 'date-value': '2026-09', out },
  };
  const result = await runInNewContext(cmdProduct.toString() + '\ncmdProduct(opts)', sandbox);
  assert.equal(reads, 1);
  assert.equal(closes, 1);
  assert.equal(result.meta.pages_ok, 1);
  assert.equal(result.meta.date_value, '2026-09');
  assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).products[0].id, '123');
});

test('incomplete attribution does not claim that the whole shop has no decliners', () => {
  const report = renderShopTrendReport({ shop_id: '1', compare_days: 30, status: 'partial', products: [], shop: comparePeriod([], 30), coverage: { comparison_complete: false }, attribution: { risers: [], decliners: [] } });
  assert.match(report, /全店结论未知/);
  assert.match(report, /店铺涨跌未知/);
  assert.doesNotMatch(report, /无下跌商品。/);
});

test('blocked background shop trend saves a partial report and closes its context', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fastmoss-trend-stop-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = path.join(dir, 'trend.json');
  const events = [];
  const blocker = new Error('需要人工访问验证'); blocker.code = 'FASTMOSS_BLOCKED';
  const sandbox = { fs, path, validateCompareDays, renderShopTrendReport,
    attribution: () => ({ risers: [], decliners: [] }),
    openBrowser: async () => ({ context: { pages: () => [{}], close: async () => events.push('closed') }, launchMs: 1 }),
    assertLoggedIn: async () => { throw blocker; }, SHOP_SEARCH: 'https://www.fastmoss.com/zh/shop-marketing/search', SKILL_ROOT: dir,
    opts: { shop: 'Fixture Shop', days: 30, out },
  };
  await assert.rejects(runInNewContext(cmdShopTrend.toString() + '\ncmdShopTrend(opts)', sandbox), e => e.code === 'FASTMOSS_BLOCKED');
  const saved = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(saved.status, 'blocked');
  assert.equal(saved.stopped_reason, blocker.message);
  assert.ok(fs.existsSync(path.join(dir, 'trend.md')));
  assert.deepEqual(events, ['closed']);
});

test('shop authors retain the first page when a later page is blocked', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fastmoss-authors-stop-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = path.join(dir, 'authors.json');
  const body = JSON.stringify({ data: { total: 10, list: [{ uid: '123', nickname: 'Fixture', sale_amount: 100 }] } });
  const blocker = new Error('网页权限受限'); blocker.code = 'FASTMOSS_BLOCKED';
  const events = [];
  const page = { goto: async () => {}, evaluate: async () => true };
  const sandbox = { fs, path, URL, collectAuthors, renderShopAuthorsReport, SKILL_ROOT: dir, SHOP_SEARCH: 'https://www.fastmoss.com/zh/shop-marketing/search', SHOP_DETAIL: 'https://www.fastmoss.com/zh/shop-marketing/detail',
    openBrowser: async () => ({ context: { pages: () => [page], close: async () => events.push('closed') }, launchMs: 1 }),
    assertLoggedIn: async () => {}, switchCountry: async () => '美国', resolveCountry: () => ({ currency: 'USD' }), log: () => {},
    makeTracker: () => ({ url: () => 'https://www.fastmoss.com/api/shop/v3/author?id=1&page=1', reset: params => assert.equal(params.page, 2), dispose: () => events.push('disposed') }),
    waitTracked: async () => { if (events.includes('first')) throw blocker; events.push('first'); return body; },
    opts: { 'shop-id': '1', country: '美国', top: 10, out },
  };
  await assert.rejects(runInNewContext(cmdShopAuthors.toString() + '\ncmdShopAuthors(opts)', sandbox), e => e.code === 'FASTMOSS_BLOCKED');
  const saved = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(saved.status, 'blocked');
  assert.equal(saved.collected, 1);
  assert.equal(saved.authors[0].uid, '123');
  assert.deepEqual(events, ['first', 'disposed', 'closed']);
});
