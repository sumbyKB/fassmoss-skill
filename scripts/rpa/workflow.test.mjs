import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { openProductBoard, buildProductUrl, grabProductPage } from './commands/product.mjs';
import { resolveShopId, collectShopProducts } from './lib/shop.mjs';
import { makeTracker } from './lib/tracker.mjs';
import { readNinetyDayTrend } from './commands/shop-trend.mjs';

let browser;
before(async () => {
  const require = createRequire(import.meta.url);
  const { chromium } = require(path.join(fileURLToPath(new URL('../../', import.meta.url)), '.tools/node_modules/playwright'));
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
after(async () => browser?.close());
async function pageFor(t) {
  const page = await browser.newPage();
  page.setDefaultTimeout(3000);
  t.after(() => page.close());
  return page;
}

test('product first page is read once, explicit dates are kept and subsequent pages reuse them', async t => {
  const page = await pageFor(t);
  const navigations = [];
  await page.route('**/*', async route => {
    if (route.request().isNavigationRequest()) navigations.push(route.request().url());
    await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<table><thead><tr><th>排名</th><th>商品</th><th>国家</th><th>所属店铺</th></tr></thead><tbody><tr><td>1</td><td><a href="/zh/e-commerce/detail/123">Fixture 售价：$19.99</a></td><td>美国</td><td>Fixture Shop</td><td>耳机</td><td>10%</td><td>1</td><td>0%</td><td>$20</td><td>1</td><td>$20</td></tr></tbody></table><script>const url=new URL(location.href);if(!url.searchParams.has('date_value')){url.searchParams.set('date_value','2026-10');history.replaceState({},'',url);}</script>` });
  });
  const options = { dateType: 3, dateValue: '2026-09' };
  const first = await openProductBoard(page, options);
  assert.equal(navigations.length, 1);
  assert.equal(new URL(navigations[0]).searchParams.get('date_value'), '2026-09');
  assert.equal(first.effective.date_value, '2026-09');
  assert.equal(first.rows[0].id, '123');
  await grabProductPage(page, buildProductUrl({ ...options, page: 2 }));
  assert.equal(navigations.length, 2);
  assert.equal(new URL(navigations[1]).searchParams.get('date_value'), '2026-09');
  const defaults = await openProductBoard(page, { dateType: 3 });
  assert.equal(defaults.effective.date_value, '2026-10');
});

test('a page that silently changes an explicit date fails instead of reporting a different month', async t => {
  const page = await pageFor(t);
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<table><thead><tr><th>所属店铺</th></tr></thead><tbody><tr><td>1</td><td>售价：$10</td><td>US</td><td>Store</td><td>Category</td></tr></tbody></table><script>const u=new URL(location.href);u.searchParams.set('date_value','2026-10');history.replaceState({},'',u);</script>` }));
  await assert.rejects(openProductBoard(page, { dateType: 3, dateValue: '2026-09' }), /指定日期未生效/);
});

test('shop search waits for its response, picks the exact match and reuses the current search page', async t => {
  const page = await pageFor(t);
  let navigations = 0;
  let searches = 0;
  const fixedWaits = [];
  const originalWait = page.waitForTimeout.bind(page);
  page.waitForTimeout = ms => { fixedWaits.push(ms); return originalWait(ms); };
  await page.route('**/*', async route => {
    if (route.request().url().includes('/api/shop/v3/search')) {
      searches++;
      await route.fulfill({ json: { data: { list: [{ id: '1', name: 'Wanted Shop Outlet' }, { id: '2', name: 'Wanted Shop' }] } } });
      return;
    }
    navigations++;
    await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<input placeholder="请输入店铺名称"><table><tbody><tr><td><a href="/zh/shop-marketing/detail/999">Default old result</a></td></tr></tbody></table><script>document.querySelector('input').onkeydown=async e=>{if(e.key!=='Enter')return;const d=await(await fetch('/api/shop/v3/search?words='+encodeURIComponent(e.target.value))).json();document.querySelector('tbody').innerHTML=d.data.list.map(s=>'<tr><td><a href="/zh/shop-marketing/detail/'+s.id+'"><span class="paragraph-text">'+s.name+'</span></a></td></tr>').join('');};</script>` });
  });
  await page.goto('https://www.fastmoss.com/zh/shop-marketing/search');
  assert.equal(await resolveShopId(page, 'Wanted Shop'), '2');
  assert.equal(await resolveShopId(page, 'Wanted Shop'), '2');
  assert.equal(navigations, 1);
  assert.equal(searches, 1);
  assert.ok(!fixedWaits.includes(5000));
});

test('shop product pagination retains zero sales and confirms the visible 90-day list coverage', async t => {
  const page = await pageFor(t);
  const tracker = makeTracker(page, '/api/shop/v3/goods');
  t.after(() => tracker.dispose());
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/shop/v3/goods') {
      const current = url.searchParams.get('page') === '1';
      await route.fulfill({ json: { data: { total: 2, product_list: [{ product_id: current ? '100' : '200', sold_count: current ? 0 : 5, sale_amount: current ? 0 : 50 }] } } });
      return;
    }
    await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<section id="goods-panel"><label><input type="radio" value="90" checked>近90天</label><table><tbody></tbody></table><ul><li class="ant-pagination-next"><a href="javascript:void(0)">下一页</a></li></ul></section><script>let pageNumber=1;async function load(){const d=await(await fetch('/api/shop/v3/goods?id=shop&page='+pageNumber+'&date_type=90')).json();document.querySelector('tbody').innerHTML=d.data.product_list.map(p=>'<tr><td><a href="/zh/e-commerce/detail/'+p.product_id+'">Product '+p.product_id+'</a></td></tr>').join('');if(pageNumber===2)document.querySelector('li').classList.add('ant-pagination-disabled');}document.querySelector('li a').onclick=()=>{pageNumber++;load();};load();</script>` });
  });
  await page.goto('https://www.fastmoss.com/zh/shop-marketing/detail/123');
  const list = await collectShopProducts(page, tracker);
  assert.deepEqual(list.products.map(p => p.product_id), ['100', '200']);
  assert.equal(list.products[0].sold_count, 0);
  assert.equal(list.coverage.pages_read, 2);
  assert.equal(list.coverage.historical_coverage_complete, true);
});

test('captcha in a headless page stops before any period interaction or human-wait loop', async t => {
  const page = await pageFor(t);
  await page.route('**/*', route => route.fulfill({ body: '<div id="tCaptchaMaskLayer">访问验证</div>', contentType: 'text/html; charset=utf-8' }));
  await page.goto('https://www.fastmoss.com/zh/shop-marketing/detail/123');
  const tracker = makeTracker(page, '/api/shop/v3/recentData');
  t.after(() => tracker.dispose());
  await assert.rejects(readNinetyDayTrend(page, tracker, { id: '123', date_type: 90 }, json => json.data.list.trend), e => e.code === 'FASTMOSS_BLOCKED');
});
