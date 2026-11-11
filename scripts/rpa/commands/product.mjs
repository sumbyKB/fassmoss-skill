// 商品域命令：商品销售榜(product)、商品投流ROI(product-roi)、品类ROI一条龙(category-roi)。
import fs from 'node:fs';
import path from 'node:path';
import { BASE, SKILL_ROOT, resolveCountry, COUNTRY_LABELS, REGION_BY_LABEL } from '../lib/config.mjs';
import { log } from '../lib/cli.mjs';
import { openBrowser, safeEval, assertLoggedIn, switchCountry } from '../lib/browser.mjs';
import { poolWithPage } from '../lib/pool.mjs';
import { resolveCategoryId } from '../lib/categories.mjs';
import { parseAmount } from '../data-rules.mjs';
import { productRoiOptions, searchProductRoiCandidates, scrapeProductRoi, renderProductRoiReport, PRODUCT_ROI_FORMULA } from '../product-roi.mjs';

const PRODUCT_BASE = `${BASE}/e-commerce/saleslist`;

/** date_type 映射：days 语义 → 榜单类型（1日榜/2周榜/3月榜） */
export function dateTypeOf(days) {
  if (days == null) return 1;
  const d = Number(days);
  if (d <= 1) return 1;          // 近1天 → 日榜
  if (d <= 7) return 2;          // 近7天 → 周榜
  return 3;                       // 近14天/近30天 → 月榜
}

/**
 * 构建商品榜 URL。date_value 缺省时不带该参数——让平台自己跳转到有效日期
 * （实测：date_value 传「今天」会返回空，平台有效日期是「昨天」的日榜）。
 * 首次加载后读回 location.href 里的真实 date_type/date_value 再翻页。
 */
function buildProductUrl({ dateType, dateValue, category, categoryId, categoryId2, page = 1, sort, region } = {}) {
  const qs = new URLSearchParams();
  if (dateType) qs.set('date_type', String(dateType));
  if (dateValue) qs.set('date_value', String(dateValue));
  if (categoryId) qs.set('l1_cid', String(categoryId));   // 一级分类 ID（精确筛选，如 鞋靴=6、箱包=7、美妆个护=14）
  if (categoryId2) qs.set('l2_cid', String(categoryId2)); // 二级分类 ID（更细筛选，如 运动鞋=834696）
  if (category) qs.set('category', String(category));
  if (sort) qs.set('sort', String(sort));
  if (region) qs.set('region', String(region));
  qs.set('page', String(page));
  return `${PRODUCT_BASE}?${qs.toString()}`;
}

export { buildProductUrl };

/** 等待商品榜表格有真实数据行（≥2 个真实数据行，排除「暂无数据」占位与单行加载态） */
async function waitProductRows(page, { timeout = 15000 } = {}) {
  await page.waitForFunction(
    () => {
      const t = [...document.querySelectorAll('table')].find((x) => (x.innerText || '').includes('所属店铺'));
      if (!t) return false;
      const rows = [...t.querySelectorAll('tbody tr')].filter(
        (r) => r.querySelectorAll('td').length >= 5 && (r.innerText || '').replace(/\s/g, '').length > 0
      );
      return rows.length >= 2;
    },
    undefined,
    { timeout }
  );
}

/** 注入浏览器上下文的商品榜整表提取函数（内联解析，不依赖 Node 侧闭包） */
const PRODUCT_EXTRACT_FN = function () {
  const table = [...document.querySelectorAll('table')].find((t) => (t.innerText || '').includes('所属店铺'));
  if (!table) return { headers: [], rows: [] };
  const headers = [...table.querySelectorAll('thead th')].map((x) => x.innerText.trim());
  const rows = [...table.querySelectorAll('tbody tr')]
    .filter((r) => r.querySelectorAll('td').length >= 5 && (r.innerText || '').replace(/\s/g, '').length > 0)
    .map((r) => {
      const tds = [...r.querySelectorAll('td')];
      const nameTd = tds.find((c) => /售价/.test(c.innerText)) || tds[1];
      const nameText = (nameTd?.innerText || '').replace(/\s+/g, ' ').trim();
      const priceRaw = (nameTd?.innerText.match(/售价[：:]\s*([^\n]+)/) || [])[1] || null;
      const link = r.querySelector('a[href*="/e-commerce/detail/"]');
      return {
        rank: (tds[0]?.innerText || '').trim(),
        product: nameText.split('\n')[0].trim(),
        price_raw: priceRaw,
        shop: (tds[3]?.innerText || '').replace(/店铺销量[\s\S]*/, '').trim(),
        category: (tds[4]?.innerText || '').trim(),
        commission: (tds[5]?.innerText || '').trim(),
        units: (tds[6]?.innerText || '').trim(),
        units_wow: (tds[7]?.innerText || '').trim(),
        gmv: (tds[8]?.innerText || '').trim(),
        total_units: (tds[9]?.innerText || '').trim(),
        total_gmv: (tds[10]?.innerText || '').trim(),
        id: link ? link.href.split('/').pop() : '',
        source_url: link ? link.href : '',
      };
    });
  return { headers, rows };
};

/** 抓单页商品榜 */
export async function grabProductPage(page, url) {
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const navMs = Date.now() - t0;
  await waitProductRows(page);
  const payload = await safeEval(page, PRODUCT_EXTRACT_FN);
  return { ...payload, url, timings: { navMs, totalMs: Date.now() - t0 } };
}

/* ---------------- 商品销售榜 ---------------- */
export async function cmdProduct(opts) {
  const pages = Number(opts.pages || 10);
  // 商品榜默认串行单窗口：每页仅 10 条、数据量小，并发加速意义不大；
  // 串行单窗口还能显著降低触发验证码风控的概率（连续并发开多 tab 易被反爬识别）。
  const concurrency = Number(opts.concurrency || 1);
  const days = opts.days ? Number(opts.days) : null;
  const dateType = Number(opts['date-type'] || dateTypeOf(days));
  const dateValue = opts['date-value'] || null;
  const sort = opts.sort || null;
  let categoryId = opts['category-id'] || opts.cid || null;   // 一级分类 ID（l1_cid，精确筛选）
  let categoryId2 = opts['category-id2'] || null;             // 二级分类 ID（l2_cid，更细筛选）
  // 若传了中文分类名（--category）但没传 --category-id，自动从分类树匹配 ID
  if (!categoryId && opts.category && !/^\d+$/.test(String(opts.category))) {
    const resolved = resolveCategoryId(opts.category, opts['categories-file']);
    if (resolved) {
      categoryId = resolved.l1_cid;
      if (resolved.level === 2 && resolved.l2_code) categoryId2 = resolved.l2_code;
      log(`分类「${opts.category}」自动匹配到「${resolved.matched}」(l1_cid=${resolved.l1_cid}${resolved.level === 2 ? '，二级 l2_cid=' + resolved.l2_code : ''})`);
    } else {
      log(`分类「${opts.category}」未在分类树匹配到 ID，将抓全量后按关键词过滤`);
    }
  }
  const outFile = opts.out || path.join(SKILL_ROOT, 'outputs', `products-${Date.now()}.json`);
  const t0 = Date.now();

  const { context, launchMs } = await openBrowser({ headed: opts.headed === true || opts.headed === 'true' });
  await assertLoggedIn(context.pages()[0]);
  const country = opts.country ? await switchCountry(context.pages()[0], opts.country) : null;
  const currency = country ? resolveCountry(country).currency : (opts.currency || 'USD');
  const region = country ? (REGION_BY_LABEL[country] || null) : null;

  // 第一次：只带 date_type（不带 date_value，让平台跳到有效日期），读回真实 date_value
  const firstUrl = buildProductUrl({ dateType, category: opts.category, categoryId, categoryId2, sort, region, page: 1 });
  const firstPage = context.pages()[0];
  await firstPage.goto(firstUrl, { waitUntil: 'domcontentloaded' });
  await waitProductRows(firstPage);
  const effective = await safeEval(firstPage, () => {
    const u = new URL(location.href);
    return { date_type: u.searchParams.get('date_type'), date_value: u.searchParams.get('date_value') };
  }).catch(() => ({ date_type: null, date_value: null }));
  const effDateType = effective.date_type || String(dateType);
  const effDateValue = effective.date_value || dateValue;

  // 用读回的有效日期翻页抓取。第 1 页复用 firstPage（已加载），只对第 2 页起开新 tab，
  // 避免并发 1 时也开出「空白首 tab + 工作 tab」两个窗口。
  const urls = Array.from({ length: pages }, (_, i) =>
    buildProductUrl({ dateType: Number(effDateType), dateValue: effDateValue, category: opts.category, categoryId, categoryId2, sort, region, page: i + 1 })
  );

  // 第 1 页：直接复用 firstPage 抓取（它已经 goto 到 page=1）
  const results = new Array(pages);
  results[0] = await (async () => {
    try { return await grabProductPage(firstPage, urls[0]); }
    catch (e) { return { url: urls[0], headers: [], rows: [], error: String(e).slice(0, 120) }; }
  })();

  // 第 2 页起：串行（concurrency=1）时直接复用 firstPage 单窗口顺序抓，不多开任何 tab；
  // 仅当用户显式 --concurrency>1 时才开额外 tab 并发。
  if (pages > 1) {
    if (concurrency <= 1) {
      for (let i = 1; i < pages; i++) {
        try { results[i] = await grabProductPage(firstPage, urls[i]); }
        catch (e) { results[i] = { url: urls[i], headers: [], rows: [], error: String(e).slice(0, 120) }; }
      }
    } else {
      const rest = await poolWithPage(context, urls.slice(1), concurrency, async (page, url) => {
        try { return await grabProductPage(page, url); }
        catch (e) { return { url, headers: [], rows: [], error: String(e).slice(0, 120) }; }
      });
      for (let i = 1; i < pages; i++) results[i] = rest[i - 1];
    }
  }

  // 按 rank 去重
  const byRank = new Map();
  for (const r of results) {
    for (const row of r.rows || []) {
      const key = row.rank || row.id || row.product;
      if (!key) continue;
      if (!byRank.has(key)) byRank.set(key, row);
    }
  }

  const meta = {
    collected_at: new Date().toISOString(),
    country: country || null,
    currency,
    region,
    date_type: Number(effDateType),
    date_value: effDateValue,
    days_note: days ? `近${days}天 → 映射 date_type=${dateTypeOf(days)}` : null,
    category: opts.category || null,
    category_id: categoryId || null,
    category_id2: categoryId2 || null,
    sort: sort || '默认（销量）',
    pages_requested: pages,
    pages_ok: results.filter((r) => !r.error).length,
    page_errors: results.filter((r) => r.error).map((r) => ({ url: r.url, error: r.error })),
    unique_products: byRank.size,
    timings: { launchMs, crawlMs: Date.now() - t0 - launchMs, totalMs: Date.now() - t0 },
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ meta, products: [...byRank.values()] }, null, 2), 'utf8');
  log(`product 完成：${meta.pages_ok}/${pages} 页，${meta.unique_products} 个商品（date_type=${effDateType} date_value=${effDateValue}），${meta.timings.totalMs} ms`);
  log(`写出 ${outFile}`);
  await context.close();
  return { meta, outFile };
}

/* ---------------- 商品投流 ROI ---------------- */
export async function cmdProductRoi(opts) {
  // 所有参数与文件先校验，避免无效任务启动浏览器。
  const options = productRoiOptions(opts);
  const requestedCountry = opts.country ? resolveCountry(opts.country) : null;
  const outFile = path.resolve(opts.out || path.join(opts['out-dir'] || path.join(SKILL_ROOT, 'outputs', `${new Date().toISOString().slice(0, 10)}-product-roi-${Date.now()}`), 'product-roi.json'));
  if (!outFile.toLowerCase().endsWith('.json')) throw new Error('--out 请使用 .json 文件名');
  const reportFile = outFile.slice(0, -5) + '.md';
  const t0 = Date.now();
  const { context, launchMs } = await openBrowser({ headed: opts.headed === true || opts.headed === 'true' });
  const page = context.pages()[0];
  await assertLoggedIn(page, `${BASE}/e-commerce/search`);
  const country = requestedCountry ? await switchCountry(page, requestedCountry.label) : await safeEval(page, (labels) => {
    return [...document.querySelectorAll('button')].map((e) => e.innerText.trim()).find((text) => labels.includes(text)) || null;
  }, COUNTRY_LABELS);
  if (!country) throw new Error('无法确认当前站点，请显式传 --country');
  const currency = resolveCountry(country).currency;
  if (opts.currency && opts.currency !== currency) throw new Error('--currency 与站点币种不一致');
  const candidates = options.keyword ? await searchProductRoiCandidates(page, options) : {
    products: options.products.slice(0, options.top), pages_read: 0, unique_products_observed: options.products.length,
  };
  const meta = {
    collected_at: new Date().toISOString(), country, currency, period_days: options.period,
    keyword: options.keyword, pages_requested: options.keyword ? options.pages : 0,
    pages_read: candidates.pages_read, unique_products_observed: candidates.unique_products_observed,
    products_requested: candidates.products.length, products_read: 0, roi_calculated: 0,
    source: 'FastMoss 商品详情 → #putData 投流分析（网页DOM）', roi_formula: PRODUCT_ROI_FORMULA,
  };
  const products = candidates.products.map((p) => ({ ...p, status: 'not_attempted', roi: null }));
  const save = () => {
    meta.products_read = products.filter((p) => p.source_module === '#putData').length;
    meta.roi_calculated = products.filter((p) => p.status === 'ok').length;
    meta.timings = { launchMs, totalMs: Date.now() - t0 };
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify({ meta, products }, null, 2), 'utf8');
    fs.writeFileSync(reportFile, renderProductRoiReport({ meta, products }), 'utf8');
  };
  save();
  // 投流数据是接口一次性返回、不依赖懒加载列表，多 tab 并发抓取安全；但并发越高越易触发风控，默认 1（串行）。
  // 每个商品完成后立即落盘。
  const concurrency = Math.min(Math.max(1, Number(opts.concurrency || 1)), products.length);
  await poolWithPage(context, products, concurrency, async (pg, product, i) => {
    // 遇到风控/权限阻挡后停止后续访问（保留已采集的部分结果，不再无谓触发风控）
    if (meta.stopped_reason) return product;
    let result;
    try { result = await scrapeProductRoi(pg, product, { period: options.period, currency }); }
    catch (error) {
      result = { ...product, status: error.code === 'FASTMOSS_BLOCKED' ? 'blocked' : 'error', error: error.message, roi: null };
      if (error.code === 'FASTMOSS_BLOCKED') meta.stopped_reason = error.message;
    }
    products[i] = result;
    save();
    log(`商品投流 ${i + 1}/${products.length}：${result.id}，${result.status}，ROI=${result.roi ?? '未知'}`);
    return result;
  });
  log(`写出 ${outFile} / ${reportFile}`);
  if (meta.stopped_reason) throw new Error(meta.stopped_reason + '；已保存部分结果，未继续翻页或切换工具');
  return { meta, outFile, reportFile };
}

/* ---------------- 品类 ROI 一条龙 ---------------- */

/** 价格区间取中位数：`$14.50 - 36.00` → 25.25；`$17.00` → 17 */
function parsePriceMid(priceRaw) {
  if (priceRaw == null) return null;
  const nums = [...String(priceRaw).matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  if (!nums.length) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return Math.round(((min + max) / 2) * 100) / 100;
}

/** 数据驱动的报告：前 N 品类商品 + ROI + 自动优势标签 + 类目洞察。金额/标签全由数据算出，不硬编码。 */
function renderCategoryRoiReport({ meta, products }) {
  const cell = (v) => String(v ?? '未知').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  const short = (s, n = 46) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
  // 归一化数值：投流GMV、广告消耗、周销量、客单价中位数
  const norm = products.map((p) => {
    const b = p._board || {};
    return {
      ...p,
      shop: b.shop || p.shop || null,
      price_raw: b.price_raw || null,
      week_units: b.week_units || null,
      week_gmv: b.week_gmv || null,
      gmv_num: parseAmount(p.raw?.gmv),
      ad_num: parseAmount(p.raw?.ad_spend),
      units_num: parseAmount(b.week_units),
      price_mid: parsePriceMid(b.price_raw),
    };
  });
  // 自动优势标签
  const ok = norm.filter((p) => p.roi != null);
  const maxRoi = ok.length ? Math.max(...ok.map((p) => p.roi)) : null;
  const maxGmv = Math.max(...norm.map((p) => p.gmv_num || 0));
  const maxUnits = Math.max(...norm.map((p) => p.units_num || 0));
  const prices = norm.map((p) => p.price_mid).filter((v) => v != null);
  const maxPrice = prices.length ? Math.max(...prices) : null;
  const minPrice = prices.length ? Math.min(...prices) : null;
  const shopCount = {};
  norm.forEach((p) => { const s = p.shop || '未知'; shopCount[s] = (shopCount[s] || 0) + 1; });
  const tags = norm.map((p) => {
    const t = [];
    if (maxRoi != null && p.roi === maxRoi) t.push('投流效率冠军');
    if (maxGmv > 0 && (p.gmv_num || 0) === maxGmv) t.push('投流规模最大');
    if (maxUnits > 0 && (p.units_num || 0) === maxUnits) t.push('周销量冠军');
    if (maxPrice != null && p.price_mid === maxPrice) t.push('高客单');
    if (minPrice != null && p.price_mid === minPrice && minPrice !== maxPrice) t.push('低价走量');
    if ((shopCount[p.shop || '未知'] || 0) >= 2) t.push('品牌矩阵');
    if (!t.length) t.push('细分/常规');
    return t;
  });
  const title = `${meta.category || '目标'}类目前${products.length} 投流 ROI 分析`;
  const lines = [
    `# ${title}`,
    '',
    `> 采集时间：${(meta.collected_at || '').slice(0, 10)} ｜ 国家/币种：${meta.country} / ${meta.currency} ｜ 榜单：近${meta.days}天${meta.board_note || ''}（按 ${meta.category || '关键词'} 过滤）｜ ROI 周期：近${meta.period_days}天投流分析`,
    '',
    '## 一、数据口径',
    '',
    `- **ROI 公式** = 投流分析销售额(GMV) ÷ 同周期广告消耗（保留平台 ROAS 供核对，不反推 GMV）`,
    `- **排名依据**：近${meta.days}天榜单内、目标品类商品的榜内名次`,
    `- **注意**：榜单周期(近${meta.days}天) ≠ ROI 周期(近${meta.period_days}天)；投流 ROI ≠ 净利润 ROI（未含商品成本/佣金/退款）`,
    '',
    '## 二、前 N 品类 ROI 与优势',
    '',
    '| 排名 | 商品 | 店铺 | 周销量 | 客单价 | 投流GMV | 广告消耗 | ROI | 优势 | 链接 |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  norm.forEach((p, i) => {
    lines.push(`| ${i + 1} | ${cell(short(p.product))} | ${cell(p.shop)} | ${cell(p.week_units)} | ${cell(p.price_raw)} | ${cell(p.raw?.gmv)} | ${cell(p.raw?.ad_spend)} | ${p.roi == null ? '未知' : '**' + p.roi.toFixed(2) + '**'} | ${tags[i].join('、')} | [详情](${p.source_url}) |`);
  });
  lines.push('', '## 三、类目洞察', '');
  if (ok.length) {
    const lo = Math.min(...ok.map((p) => p.roi));
    const hi = Math.max(...ok.map((p) => p.roi));
    const spread = hi - lo;
    lines.push(`1. **ROI 区间 ${lo.toFixed(2)} ～ ${hi.toFixed(2)}**：${spread < 0.3 ? '极差小，投产效率高度收敛，品类进入稳态竞争，无暴利单品' : '极差较大，头部投产效率分化明显'}。`);
    const roiTop = norm.find((p) => p.roi === maxRoi);
    const gmvTop = norm.find((p) => (p.gmv_num || 0) === maxGmv && maxGmv > 0);
    lines.push(`2. **投流效率冠军**：${roiTop ? cell(short(roiTop.product)) + '（ROI ' + roiTop.roi.toFixed(2) + '）' : '未知'}；**投流规模冠军**：${gmvTop ? cell(short(gmvTop.product)) + '（投流GMV ' + cell(gmvTop.raw?.gmv) + '）' : '未知'}。`);
  } else {
    lines.push('1. 本次未能计算任何 ROI，请检查投流模块采集状态。');
  }
  const brandLine = Object.entries(shopCount).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}×${n}`).join('、');
  lines.push(`3. **品牌格局**：${brandLine || '未知'}${Object.values(shopCount).some((n) => n >= 2) ? '——有品牌多席上榜，矩阵打法明显' : '——品牌分散，各占一席'}。`);
  lines.push('4. **路线**：按客单价区分「低价走量」与「品牌溢价」两条路线，前者投入小、ROI 略高，后者规模大、客单价高。');
  lines.push('', `> 金额中的万/亿是页面近似值，计算 ROI 与平台 ROAS 可能有舍入差异；投流 ROI 不含商品成本/佣金/退款，不代表净利润回报。`, '');
  return lines.join('\n');
}

/** 一条命令完成：抓商品榜 → 过滤目标品类前 N → 逐个抓投流 ROI → 出优势报告。以后只改变量即可复用。 */
export async function cmdCategoryRoi(opts) {
  const category = opts.category || null;
  const top = Math.max(1, Number(opts.top || 10));
  const pages = Math.max(1, Number(opts.pages || 6));
  const days = opts.days ? Number(opts.days) : 7;
  const period = Number(String(opts.period ?? 28).replace(/^近(\d+)天$/, '$1'));
  if (![7, 28, 90].includes(period)) throw new Error('ROI 周期只支持 7/28/90 天');
  const sort = opts.sort || 'gmv';
  const dateType = Number(opts['date-type'] || dateTypeOf(days));
  let categoryId = opts['category-id'] || opts.cid || null;
  let categoryId2 = opts['category-id2'] || null;
  let boardLabel = null;
  // 只给了二级分类 ID、没给一级时，从分类树自动补一级 ID（FastMoss 的 l2_cid 筛选需配合 l1_cid，否则翻页失效）
  if (categoryId2 && !categoryId) {
    try {
      const catFile = opts['categories-file'] || path.join(SKILL_ROOT, 'outputs', 'categories.json');
      if (fs.existsSync(catFile)) {
        const cat = JSON.parse(fs.readFileSync(catFile, 'utf8'));
        const l2 = (cat.l2_categories || []).find((c) => String(c.code) === String(categoryId2));
        if (l2?.parent_code) { categoryId = String(l2.parent_code); boardLabel = l2.name || null; log(`二级分类 ${categoryId2} 自动补一级分类 ${categoryId}（${l2.parent_name || ''}）`); }
      }
    } catch (e) { /* 忽略，保持原值 */ }
  }
  // 分类自动匹配：category 命中分类树时用它限定榜单范围（如「箱包」→ l1_cid=7）
  if (!categoryId2 && category && !/^\d+$/.test(String(category))) {
    const resolved = resolveCategoryId(category, opts['categories-file']);
    if (resolved) {
      categoryId = resolved.l1_cid;
      if (resolved.level === 2 && resolved.l2_code) categoryId2 = resolved.l2_code;
      boardLabel = resolved.matched || null;
      log(`分类「${category}」自动匹配到「${resolved.matched}」(l1_cid=${resolved.l1_cid}${resolved.level === 2 ? '，二级 ' + resolved.l2_code : ''})`);
    } else {
      log(`分类「${category}」未命中分类树，将抓榜单后按关键词过滤（耳机等细分品类建议配合 --category-id2 限定榜单范围）`);
    }
  }
  const outFile = path.resolve(opts.out || path.join(SKILL_ROOT, 'outputs', `${new Date().toISOString().slice(0, 10)}-category-roi`, `${category || '全部'}前${top}ROI.json`));
  if (!outFile.toLowerCase().endsWith('.json')) throw new Error('--out 请使用 .json 文件名');
  const reportFile = outFile.slice(0, -5) + '.md';
  const t0 = Date.now();

  const { context, launchMs } = await openBrowser({ headed: opts.headed === true || opts.headed === 'true' });
  const page = context.pages()[0];
  await assertLoggedIn(page);
  const countryLabel = opts.country ? await switchCountry(page, opts.country) : await safeEval(page, (labels) => [...document.querySelectorAll('button')].map((e) => e.innerText.trim()).find((t) => labels.includes(t)) || null, COUNTRY_LABELS);
  if (!countryLabel) throw new Error('无法确认当前站点，请显式传 --country');
  const currency = resolveCountry(countryLabel).currency;
  const region = REGION_BY_LABEL[countryLabel] || null;

  // 抓榜：第一页读回有效日期，再串行抓 pages 页（商品榜每页仅 10 条，串行稳定、不易风控）
  const firstUrl = buildProductUrl({ dateType, categoryId, categoryId2, sort, region, page: 1 });
  await page.goto(firstUrl, { waitUntil: 'domcontentloaded' });
  await waitProductRows(page);
  const effective = await safeEval(page, () => { const u = new URL(location.href); return { date_type: u.searchParams.get('date_type'), date_value: u.searchParams.get('date_value') }; }).catch(() => ({ date_type: null, date_value: null }));
  const effDateType = Number(effective.date_type || dateType);
  const effDateValue = effective.date_value || null;

  const board = [];
  const seen = new Set();
  for (let i = 1; i <= pages; i++) {
    const url = buildProductUrl({ dateType: effDateType, dateValue: effDateValue, categoryId, categoryId2, sort, region, page: i });
    const payload = await grabProductPage(page, url);
    for (const row of payload.rows || []) {
      if (!row.id || seen.has(row.id)) continue;
      seen.add(row.id);
      board.push(row);
    }
  }

  // 过滤目标品类：关键词匹配 category 字段 + 商品名，按 rank 升序取前 top
  const kw = category ? String(category).toLowerCase() : null;
  const matched = board.filter((r) => !kw || (`${r.category || ''} ${r.product || ''}`).toLowerCase().includes(kw));
  matched.sort((a, b) => (parseInt(a.rank) || 999999) - (parseInt(b.rank) || 999999));
  const picked = matched.slice(0, top).map((p) => ({ id: String(p.id), product: p.product, source_url: p.source_url || `${BASE}/e-commerce/detail/${p.id}`, _board: { rank: p.rank, shop: p.shop, category: p.category, price_raw: p.price_raw, week_units: p.units, week_gmv: p.gmv } }));
  log(`榜单抓到 ${board.length} 个商品，命中「${category || '全部'}」${matched.length} 个，取前 ${picked.length} 个抓 ROI`);

  const products = picked.map((p) => ({ ...p, status: 'not_attempted', roi: null }));
  const save = () => {
    const meta = { collected_at: new Date().toISOString(), country: countryLabel, currency, days, period_days: period, category: category || null, category_id: categoryId || null, category_id2: categoryId2 || null, sort, board_note: boardLabel ? `「${boardLabel}」榜单` : '全站榜单', roi_formula: PRODUCT_ROI_FORMULA, products_read: products.filter((p) => p.source_module === '#putData').length, roi_calculated: products.filter((p) => p.status === 'ok').length, timings: { launchMs, totalMs: Date.now() - t0 } };
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify({ meta, products }, null, 2), 'utf8');
    fs.writeFileSync(reportFile, renderCategoryRoiReport({ meta, products }), 'utf8');
  };
  save();
  // 投流 ROI 串行抓取（并发多 tab 后台降频会丢数据，串行最稳）；偶发超时自动重试 1 次，风控则立即停止。
  for (let i = 0; i < products.length; i++) {
    const item = products[i];
    let result = null;
    let blocked = false;
    for (let attempt = 0; attempt < 2 && !result; attempt++) {
      if (attempt > 0) { log(`商品投流 ${i + 1}/${products.length} 超时重试…`); await page.waitForTimeout(1000); }
      try {
        result = { ...item, ...(await scrapeProductRoi(page, item, { period, currency })) };
      } catch (error) {
        if (error.code === 'FASTMOSS_BLOCKED') { result = { ...item, status: 'blocked', error: error.message, roi: null }; blocked = true; }
        else if (attempt === 1) result = { ...item, status: 'error', error: error.message, roi: null };
      }
    }
    products[i] = result;
    save();
    log(`商品投流 ${i + 1}/${products.length}：${result.id}，${result.status}，ROI=${result.roi ?? '未知'}`);
    if (blocked) break;
  }
  log(`写出 ${outFile} / ${reportFile}`);
  await context.close();
  return { meta: { country: countryLabel, currency, category, top: picked.length, roi_calculated: products.filter((p) => p.status === 'ok').length }, outFile, reportFile };
}
