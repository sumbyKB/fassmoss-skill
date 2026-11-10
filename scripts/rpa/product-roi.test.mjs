import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { execFileSync } from 'node:child_process';
import { productRoiOptions, calculateProductRoi, productAdsSnapshot, scrapeProductRoi, searchProductRoiCandidates, renderProductRoiReport, PRODUCT_ROI_FORMULA } from './product-roi.mjs';

const id = '1732198421819330715';
const source_url = `https://www.fastmoss.com/zh/e-commerce/detail/${id}`;
const options = { period: 28, currency: 'USD' };
const snapshot = { source_url, source_module: '#putData', period_days: 28, period_label: '近28天', raw: { gmv: '$6.11万', ad_spend: '$2.76万', platform_roas: '2.22' } };

test('product ROI divides same-period displayed GMV by spend without reconstructing GMV from ROAS', () => {
  const value = calculateProductRoi(snapshot, options);
  assert.equal(value.gmv, 61100);
  assert.equal(value.ad_spend, 27600);
  assert.equal(value.roi, 2.2138);
  assert.equal(value.platform_roas, 2.22);
  assert.equal(value.status, 'ok');
  assert.equal(calculateProductRoi({ ...snapshot, raw: { ...snapshot.raw, platform_roas: '999' } }, options).roi, value.roi);
  for (const [patch, expected] of [
    [{ raw: { ad_spend: '$100', platform_roas: '2.22' } }, 'missing_metrics'],
    [{ raw: { gmv: '$100', ad_spend: '$0' } }, 'zero_ad_spend'],
    [{ raw: { gmv: '$100', ad_spend: 'RM10' } }, 'currency_mismatch'],
    [{ raw: { gmv: '$-1', ad_spend: '$100' } }, 'invalid_metrics'],
    [{ period_days: 7 }, 'period_unverified'],
    [{ busy: true }, 'not_loaded'],
  ]) {
    const row = calculateProductRoi({ ...snapshot, ...patch }, options);
    assert.equal(row.roi, null, expected);
    assert.equal(row.status, expected);
  }
  assert.equal(calculateProductRoi({ ...snapshot, raw: { gmv: '$0', ad_spend: '$100' } }, options).roi, 0);
  const report = renderProductRoiReport({ meta: { country: '美国', currency: 'USD', period_days: 28 }, products: [value] });
  assert.match(report, /6\.11万.*2\.76万.*2\.21.*2\.22/);
});

test('product selection keeps exact string IDs, deduplicates and rejects period and URL ambiguity', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fastmoss-roi-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'products.json');
  fs.writeFileSync(file, JSON.stringify({ products: [{ id, source_url }, { id }, { source_url: source_url.replace(id, '1732223944923516986') }] }));
  const parsed = productRoiOptions({ 'ids-file': file, period: '近28天' });
  assert.deepEqual(parsed.products.map(p => p.id), [id, '1732223944923516986']);
  assert.equal(parsed.top, 2);
  for (const opts of [{ ids: id, period: 30 }, { ids: id, period: 7, days: 28 }, { ids: id, start: '2026-10-01' }, { ids: id, keyword: 'earbuds' }, { keyword: true }, { ids: true }]) assert.throws(() => productRoiOptions(opts));
  for (const row of [{ id: Number(id) }, { id, source_url: source_url.replace('www.fastmoss.com', 'example.com') }, { id, source_url: source_url.replace(id, '123') }]) {
    fs.writeFileSync(file, JSON.stringify({ products: [row] }));
    assert.throws(() => productRoiOptions({ 'ids-file': file }));
  }
});

test('sales analysis passes selected product IDs and links directly to the ROI collector', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fastmoss-sales-roi-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const secondId = '1732223944923516986';
  const secondUrl = source_url.replace(id, secondId);
  fs.writeFileSync(path.join(dir, 'products.json'), JSON.stringify({
    meta: { country: '美国', currency: 'USD' },
    products: [
      { id, source_url, product: 'Same display name', shop: 'A', gmv: '$100', units: '10' },
      { id: secondId, source_url: secondUrl, product: 'Same display name', shop: 'B', gmv: '$300', units: '20' },
    ],
  }));
  execFileSync(process.execPath, [fileURLToPath(new URL('./analyze-product.mjs', import.meta.url)), '--dir', dir, '--top', '1'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  const reportFile = path.join(dir, 'brand-comparison.json');
  const selected = productRoiOptions({ 'ids-file': reportFile, period: '28' });
  assert.equal(selected.products.length, 1, 'only the selected sales Top product is passed on');
  assert.equal(selected.products[0].id, secondId, 'use exact ID even when product names match');
  assert.equal(selected.products[0].source_url, secondUrl);
});

test('real headless DOM collection scopes totals to #putData and waits for period refresh', async t => {
  const require = createRequire(import.meta.url);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const { chromium } = require(path.join(root, '.tools/node_modules/playwright'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const card = (name, value, key) => `<label aria-label="${key}"><input type="checkbox"><span><div><p>${value}</p><p>日均$99999</p><p>${name}</p></div></span></label>`;
  const html = `<h1>INSONIXN fixture</h1><a href="#putData">投流分析</a>
    <section id="overview">${card('销售额', '$13.80万', 'sale_amount_show')}</section>
    <div id="putData"><h2>投流分析</h2><label><input type="radio" name="days" value="7">近7天</label><label><input type="radio" name="days" value="28" checked>近28天</label><label><input type="radio" name="days" value="90">近90天</label>
    ${card('广告消耗', '$2.76万', 'estimate_cost_amount_show')}${card('销售额', '$6.11万', 'sale_amount_show')}${card('ROAS', '2.22', 'roas')}
    <script>document.querySelectorAll('input[type=radio]').forEach(r=>r.onchange=async()=>{const root=document.querySelector('#putData');root.setAttribute('aria-busy','true');const values=await(await fetch('/fixture/ads?days='+r.value)).json();root.querySelector('label[aria-label=sale_amount_show] p').textContent=values.gmv;root.querySelector('label[aria-label=estimate_cost_amount_show] p').textContent=values.spend;root.removeAttribute('aria-busy');});</script></div>`;
  await page.route('https://www.fastmoss.com/**', async route => {
    if (route.request().url().includes('/fixture/ads')) {
      await new Promise(resolve => setTimeout(resolve, 300));
      const seven = route.request().url().includes('days=7');
      await route.fulfill({ json: seven ? { gmv: '$980', spend: '$140' } : { gmv: '$6.11万', spend: '$2.76万' } });
    } else await route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
  });
  const product = { id, source_url };
  const row = await scrapeProductRoi(page, product, options);
  assert.equal(row.roi, 2.2138);
  assert.equal(row.gmv, 61100);
  assert.equal(row.platform_roas, 2.22);
  assert.equal((await page.evaluate(productAdsSnapshot)).raw.ad_spend, '$2.76万');
  const week = await scrapeProductRoi(page, product, { ...options, period: 7 });
  assert.equal(week.roi, 7);
  assert.equal(week.gmv, 980);
  assert.equal(week.period_days, 7);
  const same = await scrapeProductRoi(page, product, { ...options, period: 90 });
  assert.equal(same.roi, row.roi);
  assert.equal(same.period_days, 90, 'identical values across periods are valid');
  await page.route('https://www.fastmoss.com/zh/e-commerce/search*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<input role="combobox" value="earbuds"><table><tbody><tr><td><a href="${source_url}"><h3>INSONIXN</h3></a></td></tr></tbody></table>` }));
  const found = await searchProductRoiCandidates(page, { keyword: 'earbuds', pages: 3, top: 5 });
  assert.equal(found.products.length, 1);
  assert.equal(found.pages_read, 2, 'repeated rows stop pagination');
  assert.equal(found.products[0].id, id);
  await page.route(source_url, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<p>功能使用次数已达旗舰版上限</p>' }));
  await assert.rejects(scrapeProductRoi(page, product, options), e => e.code === 'FASTMOSS_BLOCKED');
});

test('batch persists earlier results and stops on a webpage access barrier', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fastmoss-roi-batch-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = fs.readFileSync(new URL('./commands/product.mjs', import.meta.url), 'utf8');
  const command = source
    .slice(source.indexOf('export async function cmdProductRoi('), source.indexOf('/* ---------------- 品类 ROI 一条龙'))
    .replace('export async function', 'async function');
  let calls = 0;
  const out = path.join(dir, 'roi.json');
  const error = new Error('FastMoss 网页次数或权限受限'); error.code = 'FASTMOSS_BLOCKED';
  const sandbox = {
    fs, path,
    productRoiOptions, PRODUCT_ROI_FORMULA, renderProductRoiReport,
    searchProductRoiCandidates: async () => { throw new Error('unexpected keyword path'); },
    SKILL_ROOT: dir,
    BASE: 'https://www.fastmoss.com/zh',
    COUNTRY_LABELS: ['美国'],
    resolveCountry: () => ({ label: '美国', currency: 'USD' }),
    assertLoggedIn: async () => {},
    switchCountry: async () => '美国',
    safeEval: async () => '美国',
    log: () => {},
    openBrowser: async () => ({ context: { pages: () => [{}] }, launchMs: 1 }),
    poolWithPage: async (_context, items, _limit, worker) => {
      const out = new Array(items.length);
      for (let i = 0; i < items.length; i++) out[i] = await worker({}, items[i], i, 0);
      return out;
    },
    scrapeProductRoi: async (_page, p) => { if (++calls === 2) throw error; return { ...p, ...calculateProductRoi(snapshot, options) }; },
    opts: { ids: id + ',1732223944923516986,1732500194875183296', country: '美国', out },
  };
  await assert.rejects(runInNewContext(command + '\ncmdProductRoi(opts)', sandbox), /已保存部分结果/);
  const batch = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(calls, 2);
  assert.equal(batch.products[0].roi, 2.2138);
  assert.equal(batch.products[1].status, 'blocked');
  assert.equal(batch.products[2].status, 'not_attempted');
  assert.equal(batch.meta.roi_calculated, 1);
  assert.ok(fs.existsSync(out.replace('.json', '.md')));
});
