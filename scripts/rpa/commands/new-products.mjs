// 新品榜：固定三日口径；按商品ID去重，逐页验证条件并保存进度。
import fs from 'node:fs';
import path from 'node:path';
import { BASE, SKILL_ROOT, COUNTRY_LABELS, resolveCountry, REGION_BY_LABEL } from '../lib/config.mjs';
import { log } from '../lib/cli.mjs';
import { openBrowser, safeEval, assertLoggedIn, switchCountry, assertPageAccess } from '../lib/browser.mjs';
import { resolveCategoryOptions } from '../lib/categories.mjs';

const NEW_PRODUCTS_BASE = `${BASE}/e-commerce/newProducts`;

export function newProductOptions(opts) {
  for (const key of ['days', 'period', 'date-type', 'date-value', 'start', 'end']) {
    if (opts[key] !== undefined) throw new Error('新品榜固定三日口径，不支持 --' + key + '；近7天需进详情页另取');
  }
  const positive = (key, fallback) => {
    const value = opts[key] ?? fallback;
    if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new Error('--' + key + ' 必须为正整数');
    return Number(value);
  };
  const pages = positive('pages', 10);
  const top = opts.top === undefined ? null : positive('top');
  if (opts.sort !== undefined && (typeof opts.sort !== 'string' || !opts.sort.trim())) throw new Error('--sort 需要页面支持的排序值');
  if (opts.category !== undefined && (typeof opts.category !== 'string' || !opts.category.trim())) throw new Error('--category 需要分类名称');
  const { categoryId, categoryId2, categoryId3 } = resolveCategoryOptions(opts);
  if (opts.category && !categoryId) throw new Error('分类未匹配，请更新分类树或指定分类ID');
  const country = opts.country ? resolveCountry(opts.country) : null;
  if (country && opts.currency && opts.currency !== country.currency) throw new Error('--currency 与指定站点币种冲突');
  const outFile = path.resolve(opts.out || path.join(SKILL_ROOT, 'outputs', `new-products-${Date.now()}.json`));
  if (!outFile.toLowerCase().endsWith('.json')) throw new Error('--out 请使用 .json 文件名');
  return { pages, top, categoryId, categoryId2, categoryId3, country, outFile };
}

export function buildNewProductsUrl({ categoryId, categoryId2, categoryId3, sort, region, page = 1 } = {}) {
  const query = new URLSearchParams({ page: String(page) });
  if (categoryId) query.set('l1_cid', String(categoryId));
  if (categoryId2) query.set('l2_cid', String(categoryId2));
  if (categoryId3) query.set('l3_cid', String(categoryId3));
  if (sort) query.set('sort', String(sort));
  if (region) query.set('region', String(region));
  return `${NEW_PRODUCTS_BASE}?${query}`;
}

/** 列按表头定位；名称保持独立，不把售价和上架时间揉进商品名。 */
export function newProductsSnapshot() {
  const table = [...document.querySelectorAll('table')].find(node => node.innerText.includes('所属店铺'));
  if (!table) return { ready: false };
  const headers = [...table.querySelectorAll('thead th')].map(node => node.innerText.replace(/\s|[↑↓▲▼]/g, ''));
  const aliases = {
    product: ['商品', '商品信息'], shop: ['所属店铺'], category: ['商品分类'], commission: ['佣金比例', '佣金率'],
    units_3d: ['三日销量', '3日销量', '近3天销量'], gmv_3d: ['三日销售额', '3日销售额', '近3天销售额', '三日GMV'],
    total_units: ['总销量'], total_gmv: ['总销售额', '总GMV'],
  };
  const indexes = Object.fromEntries(Object.entries(aliases).map(([key, labels]) => [key, headers.findIndex(name => labels.includes(name))]));
  const busy = !!table.closest('.ant-spin-blur') || !!document.querySelector('.ant-spin-spinning, [aria-busy=true]');
  const missing = Object.keys(indexes).filter(key => key !== 'commission' && indexes[key] < 0);
  if (missing.length) return { ready: !busy, busy, headers, schema_error: '新品榜表头变化：' + missing.join(', ') };
  const rows = [...table.querySelectorAll('tbody tr')].flatMap(row => {
    const cells = [...row.querySelectorAll('td')];
    const cell = key => cells[indexes[key]];
    const link = cell('product')?.querySelector('a[href*="/e-commerce/detail/"]');
    const id = link?.pathname.match(/\/e-commerce\/detail\/(\d+)\/?$/)?.[1];
    if (!id || link.origin !== location.origin) return [];
    const raw = cell('product').innerText;
    const name = link.querySelector('h3, [class*="paragraph-text"]')?.innerText || raw.split('\n').find(text => text.trim() && !/^(售价|上架时间)/.test(text.trim()));
    const rankIndex = headers.findIndex(name => name === '排名');
    return [{
      id, source_url: link.href.split(/[?#]/)[0], rank: rankIndex >= 0 ? cells[rankIndex]?.innerText.trim() : cells[0]?.innerText.trim() || '',
      product: (name || '').replace(/\s+/g, ' ').trim(),
      price_raw: raw.match(/售价[：:]\s*([^\n]+)/)?.[1]?.trim() ?? null,
      list_date: raw.match(/上架时间[：:]\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null,
      shop: cell('shop')?.innerText.replace(/店铺销量[\s\S]*/, '').trim() ?? null,
      shop_id: cell('shop')?.querySelector('a[href*="/shop-marketing/detail/"]')?.pathname.match(/\/detail\/(\d+)\/?$/)?.[1] ?? null,
      category: cell('category')?.innerText.trim() ?? null, commission: cell('commission')?.innerText.trim() || null,
      units_3d: cell('units_3d')?.innerText.trim() || null, gmv_3d: cell('gmv_3d')?.innerText.trim() || null,
      total_units: cell('total_units')?.innerText.trim() || null, total_gmv: cell('total_gmv')?.innerText.trim() || null,
    }];
  });
  return { ready: !busy && (rows.length > 0 || /暂无数据|没有数据|No data/i.test(table.innerText) || !!table.querySelector('.ant-empty')), busy, headers, rows };
}

export async function grabNewProductPage(page, url, { timeout = 15000 } = {}) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const deadline = Date.now() + timeout;
  let previous = null;
  while (Date.now() < deadline) {
    await assertPageAccess(page);
    const state = await safeEval(page, newProductsSnapshot);
    if (state.ready && !state.busy) {
      if (state.schema_error) { const error = new Error(state.schema_error); error.code = 'NEW_PRODUCTS_SCHEMA'; throw error; }
      const expected = new URL(url);
      const actual = new URL(page.url());
      for (const key of ['page', 'region', 'l1_cid', 'l2_cid', 'l3_cid', 'sort']) {
        if (expected.searchParams.has(key) && actual.searchParams.get(key) !== expected.searchParams.get(key)) {
          const error = new Error('新品榜筛选或页码未生效：' + key); error.code = 'NEW_PRODUCTS_FILTER'; throw error;
        }
      }
      const key = JSON.stringify(state.rows);
      if (key === previous) return { headers: state.headers, rows: state.rows, url: actual.href };
      previous = key;
    }
    await page.waitForTimeout(100);
  }
  throw new Error('新品榜数据未加载完成');
}

export async function cmdNewProducts(opts) {
  const options = newProductOptions(opts);
  const t0 = Date.now();
  const meta = {
    collected_at: new Date().toISOString(), country: options.country?.label ?? null, currency: options.country?.currency ?? null, region: null,
    category: opts.category || null, category_id: options.categoryId, category_id2: options.categoryId2, category_id3: options.categoryId3,
    sort: opts.sort || '默认（三日销量）', period_days: 3, data_end_date: null,
    pages_requested: options.pages, top_requested: options.top, pages_visited: 0, pages_ok: 0, page_errors: [], unique_products: 0, status: 'running',
    note: '列表三日口径不等于近7天；数据截止日未在页面确认时保持未知。', timings: {},
  };
  const products = new Map();
  const save = () => {
    meta.unique_products = products.size;
    meta.timings.totalMs = Date.now() - t0;
    fs.mkdirSync(path.dirname(options.outFile), { recursive: true });
    fs.writeFileSync(options.outFile, JSON.stringify({ meta, products: [...products.values()] }, null, 2), 'utf8');
  };
  let context;
  save();
  try {
    const browser = await openBrowser({ headed: opts.headed === true || opts.headed === 'true' });
    context = browser.context;
    meta.timings.launchMs = browser.launchMs;
    const page = context.pages()[0];
    await assertLoggedIn(page, NEW_PRODUCTS_BASE);
    const country = options.country ? await switchCountry(page, options.country.label) : await safeEval(page, labels => [...document.querySelectorAll('button')].map(node => node.innerText.trim()).find(text => labels.includes(text)) || null, COUNTRY_LABELS);
    if (!country) throw new Error('无法确认新品榜站点，请传 --country');
    meta.country = country;
    meta.currency = resolveCountry(country).currency;
    if (opts.currency && opts.currency !== meta.currency) throw new Error('--currency 与当前站点币种冲突');
    meta.region = REGION_BY_LABEL[country];
    for (let number = 1; number <= options.pages; number++) {
      const url = buildNewProductsUrl({ ...options, region: meta.region, sort: opts.sort, page: number });
      meta.pages_visited++;
      try {
        const payload = await grabNewProductPage(page, url);
        meta.pages_ok++;
        const before = products.size;
        for (const product of payload.rows) {
          if (!products.has(product.id)) products.set(product.id, { ...product, observed_position: products.size + 1 });
          if (options.top && products.size >= options.top) break;
        }
        if (!payload.rows.length) { meta.stop_reason = '榜单结束'; break; }
        if (products.size === before) { meta.stop_reason = '分页重复，未取得新商品'; meta.status = 'partial'; break; }
        if (options.top && products.size >= options.top) { meta.stop_reason = '达到指定数量'; break; }
      } catch (error) {
        meta.page_errors.push({ url, error: error.message });
        if (error.code === 'FASTMOSS_BLOCKED' || error.code === 'NEW_PRODUCTS_FILTER' || error.code === 'NEW_PRODUCTS_SCHEMA') throw error;
        meta.status = products.size ? 'partial' : 'failed';
        meta.stopped_reason = error.message;
        break;
      } finally { save(); }
    }
    if (meta.status === 'running') meta.status = 'complete';
    save();
    if (meta.status === 'failed') throw new Error(meta.stopped_reason);
    log(`new-products 完成：读取 ${meta.pages_visited} 页，成功 ${meta.pages_ok} 页，${meta.unique_products} 个商品，${meta.status}`);
    return { meta, outFile: options.outFile };
  } catch (error) {
    meta.status = error.code === 'FASTMOSS_BLOCKED' ? 'blocked' : 'failed';
    meta.stopped_reason = error.message;
    save();
    throw error;
  } finally { if (context) await context.close(); }
}
