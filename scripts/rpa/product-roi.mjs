import fs from 'node:fs';
import { parseAmount } from './data-rules.mjs';
import { assertPageAccess as assertPageAvailable } from './lib/browser.mjs';
export { pageAccessBlocker as productPageBlocker } from './lib/browser.mjs';

const BASE = 'https://www.fastmoss.com/zh/e-commerce';
export const PRODUCT_ROI_FORMULA = '投流分析销售额（GMV） / 同周期广告消耗';

export function productRoiOptions(opts) {
  const period = Number(String(opts.period ?? opts.days ?? 28).replace(/^近(\d+)天$/, '$1'));
  if (![7, 28, 90].includes(period)) throw new Error('商品投流分析周期只支持 7、28、90 天；近28天不能当作近30天');
  if (opts.start || opts.end || opts['start-date'] || opts['end-date']) throw new Error('商品投流分析不支持自定义日期，请使用 --period 7/28/90');
  if (opts.period !== undefined && opts.days !== undefined && period !== Number(opts.days)) throw new Error('--period 与 --days 周期冲突');
  const file = opts['ids-file'] ?? opts['id-file'];
  const ids = opts.ids ?? opts.id;
  const keyword = opts.keyword ?? opts.words;
  if ([file, ids, keyword].filter(x => x !== undefined).length !== 1) throw new Error('请指定一项：--ids 商品ID、--ids-file products.json 或 --keyword 搜索词');
  if (keyword !== undefined && (typeof keyword !== 'string' || !keyword.trim())) throw new Error('--keyword 需要非空搜索词');
  let rows = [];
  if (file !== undefined) {
    if (typeof file !== 'string') throw new Error('--ids-file 需要文件路径');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    rows = Array.isArray(data) ? data : data.products ?? data.topProducts ?? data.ids;
    if (!Array.isArray(rows)) throw new Error('商品文件需要 products、topProducts 或 ids 数组');
  } else if (ids !== undefined) {
    if (typeof ids !== 'string') throw new Error('--ids 需要商品ID');
    rows = ids.split(',').map(id => id.trim());
  }
  const products = new Map();
  for (const row of rows) {
    const value = typeof row === 'object' && row !== null ? row : { id: row };
    if (typeof value.id === 'number' && !Number.isSafeInteger(value.id)) throw new Error('商品ID必须使用字符串，数字ID已失去精度');
    const link = value.source_url ?? value.href;
    const url = link ? new URL(link, BASE + '/') : null;
    const linkedId = url?.pathname.match(/^\/zh\/e-commerce\/detail\/(\d+)\/?$/)?.[1];
    if (url && (url.origin !== 'https://www.fastmoss.com' || !linkedId)) throw new Error('商品来源必须是 FastMoss 商品详情链接');
    const id = String(value.id ?? linkedId ?? '');
    if (!/^\d+$/.test(id) || (linkedId && linkedId !== id)) throw new Error('商品ID缺失或与详情链接不一致');
    if (!products.has(id)) products.set(id, { id, product: value.product ?? value.name ?? null, source_url: `${BASE}/detail/${id}` });
  }
  if (!keyword && !products.size) throw new Error('商品列表为空');
  return { period, keyword: keyword?.trim() ?? null, pages: Number(opts.pages ?? 1), top: Number(opts.top ?? (keyword ? 10 : products.size)), products: [...products.values()] };
}

export async function searchProductRoiCandidates(page, { keyword, pages, top }) {
  const products = new Map();
  let pagesRead = 0;
  let rowsObserved = 0;
  for (let n = 1; n <= pages && products.size < top; n++) {
    const url = new URL(`${BASE}/search`);
    url.searchParams.set('page', String(n));
    url.searchParams.set('words', keyword);
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('table tbody a[href*="/e-commerce/detail/"]') || /暂无数据|没有找到|游客身份|正在保护|进一步确认|已达.*上限/.test(document.body.innerText));
    await assertPageAvailable(page);
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    const state = await page.evaluate(() => ({
      keyword: document.querySelector('input[role=combobox]')?.value,
      page: new URL(location.href).searchParams.get('page'),
      products: [...document.querySelectorAll('table tbody tr')].flatMap(row => {
        const a = row.querySelector('a[href*="/e-commerce/detail/"]');
        const id = a?.pathname.match(/\/detail\/(\d+)\/?$/)?.[1];
        return id ? [{ id, product: a.querySelector('h3')?.innerText ?? a.innerText.split('\n')[0], source_url: a.href }] : [];
      }),
    }));
    if (state.keyword !== keyword || Number(state.page) !== n) throw new Error('商品搜索条件或页码未生效');
    pagesRead++;
    rowsObserved += state.products.length;
    const before = products.size;
    for (const p of state.products) if (!products.has(p.id)) products.set(p.id, p);
    if (products.size === before) break;
  }
  return { products: [...products.values()].slice(0, top), pages_read: pagesRead, rows_observed: rowsObserved, unique_products_observed: products.size };
}

// 真实网页核对：投流模块是 #putData；每张指标卡的第一个 p 是总值，后续 p 才是日均与名称。
export function productAdsSnapshot() {
  const root = document.querySelector('#putData');
  if (!root) return null;
  const raw = {};
  const names = { '广告消耗': 'ad_spend', '销售额': 'gmv', 'ROAS': 'platform_roas', '销量': 'units', '播放量': 'views', '广告素材量': 'creatives', '广告成交占比': 'ad_share' };
  for (const card of root.querySelectorAll('label[aria-label]')) {
    const lines = [...card.querySelectorAll('p')].map(p => p.innerText.trim());
    const key = names[lines.at(-1)];
    if (key) raw[key] = lines[0] ?? null;
  }
  const selected = root.querySelector('input[type=radio]:checked');
  return {
    source_url: location.href.split('#')[0], source_module: '#putData',
    product: document.querySelector('h1')?.innerText ?? null,
    period_days: selected ? Number(selected.value) : null,
    period_label: selected?.closest('label')?.innerText.trim() ?? null,
    dates: [...root.querySelectorAll('input')].map(e => e.value).filter(v => /^\d{4}-\d{2}-\d{2}$/.test(v)),
    busy: !!root.querySelector('.ant-spin-spinning, .ant-spin-blur, [aria-busy=true]'), raw,
  };
}

function moneyCurrency(raw, fallback) {
  const prefix = String(raw ?? '').trim().match(/^(MX\$|S\$|R\$|RM|Rp|\$|฿|₫|₱|¥|€|£)/)?.[0];
  return ({ 'MX$': 'MXN', 'S$': 'SGD', 'R$': 'BRL', RM: 'MYR', Rp: 'IDR', '$': 'USD', '฿': 'THB', '₫': 'VND', '₱': 'PHP', '¥': 'JPY', '€': 'EUR', '£': 'GBP' })[prefix] ?? fallback ?? null;
}

export function calculateProductRoi(snapshot, { period, currency }) {
  const raw = snapshot?.raw ?? {};
  const gmv = parseAmount(raw.gmv);
  const adSpend = parseAmount(raw.ad_spend);
  const gmvCurrency = moneyCurrency(raw.gmv, currency);
  const spendCurrency = moneyCurrency(raw.ad_spend, currency);
  let status = 'ok';
  if (snapshot?.period_days !== period) status = 'period_unverified';
  else if (snapshot?.busy) status = 'not_loaded';
  else if (gmv === null || adSpend === null) status = 'missing_metrics';
  else if (!gmvCurrency || gmvCurrency !== spendCurrency || (currency && currency !== gmvCurrency)) status = 'currency_mismatch';
  else if (gmv < 0 || adSpend < 0 || !Number.isFinite(gmv) || !Number.isFinite(adSpend)) status = 'invalid_metrics';
  else if (adSpend === 0) status = 'zero_ad_spend';
  else if (!Number.isFinite(gmv / adSpend)) status = 'invalid_metrics';
  return {
    ...snapshot, requested_period_days: period, currency: gmvCurrency,
    gmv, ad_spend: adSpend, roi: status === 'ok' ? +(gmv / adSpend).toFixed(4) : null,
    platform_roas: parseAmount(raw.platform_roas), roi_formula: PRODUCT_ROI_FORMULA, status,
    calculation_note: '按商品投流模块显示金额计算；万/亿缩写有舍入，计算ROI与平台ROAS可能略有差异；此处不是利润ROI。',
  };
}

async function waitProductAds(page, period) {
  // 10 秒超时：正常 1~2 秒就绪，留足余量应对偶发慢加载，又不至于拖垮整体（原来 15 秒偏保守、8 秒偶发不够）
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    await assertPageAvailable(page);
    const state = await page.evaluate(productAdsSnapshot);
    // 指标卡是接口一次性返回的，首次读到 gmv 与 ad_spend 即可用，无需再等「连续两次相同」的稳定快照。
    if (state && !state.busy && (!period || state.period_days === period) && Object.hasOwn(state.raw, 'gmv') && Object.hasOwn(state.raw, 'ad_spend')) {
      return state;
    }
    await page.waitForTimeout(100);
  }
  throw new Error('商品投流模块未加载完成或周期未确认');
}

export async function scrapeProductRoi(page, product, { period, currency }) {
  const target = new URL(product.source_url);
  if (target.origin !== 'https://www.fastmoss.com' || target.pathname !== `/zh/e-commerce/detail/${product.id}`) throw new Error('商品来源必须是与ID一致的 FastMoss 商品详情链接');
  await page.goto(product.source_url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('a[href="#putData"]') || /正在保护|进一步确认|游客身份|已达.*上限/.test(document.body.innerText));
  await assertPageAvailable(page);
  // 详情页是 SPA，锚点很早就出现在 DOM 里，但 React 尚未完成渲染；此时点击「投流分析」tab 切换无效，
  // #putData 的指标卡永远不加载。先等商品标题 h1 渲染完成，再点 tab，确保切换生效。
  await page.waitForFunction(() => (document.querySelector('h1')?.innerText || '').length > 5, { timeout: 6000 }).catch(() => {});
  await page.getByRole('link', { name: '投流分析', exact: true }).click();
  // 点击后等 #putData 的指标卡（label[aria-label]）真正渲染出来，而非依赖 networkidle 的时机。
  await page.waitForFunction(() => document.querySelector('#putData label[aria-label]') || /正在保护|进一步确认|游客身份|已达.*上限/.test(document.body.innerText), { timeout: 6000 }).catch(() => {});
  await assertPageAvailable(page);
  let snapshot = await waitProductAds(page);
  if (snapshot.period_days !== period) {
    // 已有 networkidle 状态可能在点击后立刻返回。先等本次交互产生的数据响应，
    // 再等页面空闲与指标稳定，避免“近7天已选中、金额仍是近28天”的旧数据。
    const origin = new URL(page.url()).origin;
    const [response] = await Promise.all([
      page.waitForResponse(r => r.ok() && new URL(r.url()).origin === origin && ['xhr', 'fetch'].includes(r.request().resourceType()), { timeout: 15000 }),
      page.locator('#putData').getByRole('radio', { name: `近${period}天`, exact: true }).check(),
    ]);
    if (await response.finished()) throw new Error('商品投流周期刷新请求失败');
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    snapshot = await waitProductAds(page, period);
  }
  const actual = new URL(snapshot.source_url);
  const actualId = actual.pathname.match(/\/e-commerce\/detail\/(\d+)\/?$/)?.[1];
  if (actual.origin !== target.origin || actualId !== product.id) throw new Error('商品详情跳转后的站点或ID与目标商品不一致');
  return { ...calculateProductRoi(snapshot, { period, currency }), id: product.id, collected_at: new Date().toISOString() };
}

const STATUS = { ok: '已计算', period_unverified: '周期未确认', not_loaded: '尚未加载', missing_metrics: '指标缺失', currency_mismatch: '币种未确认或不一致', invalid_metrics: '指标异常', zero_ad_spend: '广告消耗为0', error: '采集失败', blocked: '页面验证/权限阻挡', not_attempted: '未采集' };
export function renderProductRoiReport({ meta, products }) {
  const cell = value => String(value ?? '未知').replace(/\|/g, '\\|').replace(/\s+/g, ' ');
  const lines = ['# 商品投流 ROI', '', `国家：${meta.country ?? '未知'}；币种：${meta.currency ?? '未知'}；周期：近${meta.period_days}天；来源：商品详情 → 投流分析。`, '',
    `公式：${PRODUCT_ROI_FORMULA}。保留平台 ROAS 供核对，不反推 GMV。`, '',
    `选中 ${products.length} 个商品，成功读取 ${products.filter(p => p.source_module === '#putData').length} 个，可计算 ${products.filter(p => p.status === 'ok').length} 个。${meta.stopped_reason ? '采集已停止：' + meta.stopped_reason : ''}`, '',
    '| 商品 | 投流GMV（原文） | 广告消耗（原文） | 计算ROI | 平台ROAS | 周期 | 状态 | 来源 |', '|---|---|---|---|---|---|---|---|'];
  for (const p of products) lines.push(`| ${cell(p.product ?? p.id)} | ${cell(p.raw?.gmv)} | ${cell(p.raw?.ad_spend)} | ${p.roi == null ? '未知' : p.roi.toFixed(2)} | ${p.platform_roas ?? '未知'} | ${p.period_label ?? '未知'} | ${cell(STATUS[p.status] ?? p.status)}${p.error ? '：' + cell(p.error) : ''} | [商品](${p.source_url}) |`);
  lines.push('', '金额中的万/亿是页面显示的近似值，计算ROI与平台ROAS可能存在舍入差异。缺指标、周期不明、币种不一致或广告消耗为0时，ROI保留未知。近28天不等于近30天；投流ROI不等于净利润ROI。', '');
  return lines.join('\n');
}
