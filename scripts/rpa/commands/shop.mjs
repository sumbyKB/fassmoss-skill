// 店铺域命令：店铺榜(shop)、店铺详情(shop-detail)、店铺详情报告(shop-detail-report)。
import fs from 'node:fs';
import path from 'node:path';
import { BASE, SKILL_ROOT, resolveCountry, REGION_BY_LABEL } from '../lib/config.mjs';
import { log } from '../lib/cli.mjs';
import { openBrowser, safeEval, assertLoggedIn, switchCountry } from '../lib/browser.mjs';
import { poolWithPage } from '../lib/pool.mjs';
import { resolveCategoryId } from '../lib/categories.mjs';
import { analyzeShopDetail } from '../analyze-shop-detail.mjs';
import { resolveShopId } from '../lib/shop.mjs';

const SHOP_BASE = `${BASE}/shop-marketing/search`;

/** 注入浏览器的店铺表提取函数 */
const SHOP_EXTRACT_FN = function () {
  const table = [...document.querySelectorAll('table')].find((t) => (t.innerText || '').includes('店铺信息'));
  if (!table) return { headers: [], rows: [] };
  const headers = [...table.querySelectorAll('thead th')].map((x) => x.innerText.trim());
  const rows = [...table.querySelectorAll('tbody tr')]
    .filter((r) => r.querySelectorAll('td').length >= 3 && (r.innerText || '').replace(/\s/g, '').length > 0)
    .map((r) => {
      const tds = [...r.querySelectorAll('td')];
      const link = r.querySelector('a[href*="/shop-marketing/detail/"]');
      const infoCell = tds[0];
      // 精确提取：店铺名 = .paragraph-text；分类 = .custom-tag-container；评分 = .ant-tag
      const shopName = (infoCell?.querySelector('.paragraph-text, [class*="paragraph-text"]')?.innerText || '').trim();
      const category = (infoCell?.querySelector('.custom-tag-container')?.innerText || '').trim();
      const rating = (infoCell?.querySelector('.ant-tag')?.innerText || '').trim();
      return {
        shop_name: shopName,
        shop_info: (infoCell?.innerText || '').replace(/\s+/g, ' ').trim(),
        category,
        rating,
        day7_units: (tds[2]?.innerText || '').trim(),
        day7_gmv: (tds[3]?.innerText || '').trim(),
        day7_products: (tds[4]?.innerText || '').trim(),
        new_rate: (tds[5]?.innerText || '').trim(),
        total_units: (tds[6]?.innerText || '').trim(),
        total_gmv: (tds[7]?.innerText || '').trim(),
        on_sell: (tds[8]?.innerText || '').trim(),
        authors: (tds[9]?.innerText || '').trim(),
        id: link ? link.href.split('/').pop() : '',
        source_url: link ? link.href : '',
      };
    });
  return { headers, rows };
};

/** 等待店铺表有真实数据行 */
async function waitShopRows(page, { timeout = 15000 } = {}) {
  await page.waitForFunction(
    () => {
      const t = [...document.querySelectorAll('table')].find((x) => (x.innerText || '').includes('店铺信息'));
      if (!t) return false;
      const rows = [...t.querySelectorAll('tbody tr')].filter(
        (r) => r.querySelectorAll('td').length >= 3 && (r.innerText || '').replace(/\s/g, '').length > 0
      );
      return rows.length >= 2;
    },
    undefined,
    { timeout }
  );
}

/** 构建店铺榜 URL（分类筛选用 l1_cid，非 category query） */
function buildShopUrl({ page = 1, sort, region, category, categoryId, rating } = {}) {
  const qs = new URLSearchParams();
  if (sort) qs.set('sort', String(sort));
  if (region) qs.set('region', String(region));
  if (categoryId) qs.set('l1_cid', String(categoryId));
  if (rating) qs.set('rating', String(rating));
  qs.set('page', String(page));
  return `${SHOP_BASE}?${qs.toString()}`;
}

/** 抓单页店铺榜 */
async function grabShopPage(page, url) {
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const navMs = Date.now() - t0;
  await waitShopRows(page);
  const payload = await safeEval(page, SHOP_EXTRACT_FN);
  return { ...payload, url, timings: { navMs, totalMs: Date.now() - t0 } };
}

/* ---------------- 店铺榜 ---------------- */
export async function cmdShop(opts) {
  const pages = Number(opts.pages || 10);
  // 店铺榜默认串行单窗口（同商品榜：数据量小 + 降低风控）
  const concurrency = Number(opts.concurrency || 1);
  const sort = opts.sort || null;
  const outFile = opts.out || path.join(SKILL_ROOT, 'outputs', `shops-${Date.now()}.json`);
  const t0 = Date.now();

  // 分类筛选：优先 --category-id，否则中文分类名自动匹配 l1_cid（店铺榜筛选用 l1_cid，非 category query）
  let shopCategoryId = opts['category-id'] || opts.cid || null;
  if (!shopCategoryId && opts.category && !/^\d+$/.test(String(opts.category))) {
    const resolved = resolveCategoryId(opts.category, opts['categories-file']);
    if (resolved) {
      shopCategoryId = resolved.l1_cid;
      log(`分类「${opts.category}」自动匹配到「${resolved.matched}」(l1_cid=${resolved.l1_cid})`);
    } else {
      log(`分类「${opts.category}」未在分类树匹配到 ID，将抓全量后按分类字段过滤`);
    }
  }

  const { context, launchMs } = await openBrowser({ headed: opts.headed === true || opts.headed === 'true' });
  await assertLoggedIn(context.pages()[0]);
  const country = opts.country ? await switchCountry(context.pages()[0], opts.country) : null;
  const currency = country ? resolveCountry(country).currency : (opts.currency || 'USD');
  const region = country ? (REGION_BY_LABEL[country] || null) : null;

  const urls = Array.from({ length: pages }, (_, i) =>
    buildShopUrl({ page: i + 1, sort, region, category: opts.category, categoryId: shopCategoryId, rating: opts.rating })
  );

  const results = new Array(pages);
  if (concurrency <= 1) {
    const page = context.pages()[0];
    for (let i = 0; i < pages; i++) {
      try { results[i] = await grabShopPage(page, urls[i]); }
      catch (e) { results[i] = { url: urls[i], headers: [], rows: [], error: String(e).slice(0, 120) }; }
    }
  } else {
    const rest = await poolWithPage(context, urls, concurrency, async (page, url) => {
      try { return await grabShopPage(page, url); }
      catch (e) { return { url, headers: [], rows: [], error: String(e).slice(0, 120) }; }
    });
    for (let i = 0; i < pages; i++) results[i] = rest[i];
  }

  // 按 shop 去重
  const byName = new Map();
  for (const r of results) {
    for (const row of r.rows || []) {
      const key = row.id || row.shop_name;
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, row);
    }
  }

  const meta = {
    collected_at: new Date().toISOString(),
    country: country || null,
    currency,
    region,
    category: opts.category || null,
    category_id: shopCategoryId || null,
    rating: opts.rating || null,
    sort: sort || '默认（GMV）',
    pages_requested: pages,
    pages_ok: results.filter((r) => !r.error).length,
    page_errors: results.filter((r) => r.error).map((r) => ({ url: r.url, error: r.error })),
    unique_shops: byName.size,
    timings: { launchMs, crawlMs: Date.now() - t0 - launchMs, totalMs: Date.now() - t0 },
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ meta, shops: [...byName.values()] }, null, 2), 'utf8');
  log(`shop 完成：${meta.pages_ok}/${pages} 页，${meta.unique_shops} 个店铺，${meta.timings.totalMs} ms`);
  log(`写出 ${outFile}`);
  await context.close();
  return { meta, outFile };
}

/* ---------------- 店铺详情 ---------------- */

/** 注入浏览器的店铺详情提取函数 */
const SHOP_DETAIL_EXTRACT_FN = function () {
  const t = document.body.innerText || '';

  // ---- 总览卡片：标签（如「总销量」）所在卡片容器里，标签前一个兄弟是数值 ----
  const OVERVIEW_LABELS = ['总销量', '总销售额', '在售商品数', '全国排名', '带货直播数', '带货视频数', '带货达人数', '分类排名'];
  const overview = {};
  for (const label of OVERVIEW_LABELS) {
    const labelEl = [...document.querySelectorAll('span,div')].find((e) => (e.innerText || '').trim() === label && e.children.length === 0);
    if (!labelEl) { overview[label] = ''; continue; }
    let card = labelEl.parentElement;
    for (let i = 0; i < 5 && card; i++) {
      if ((card.className || '').includes('px-4')) break;
      card = card.parentElement;
    }
    let val = '';
    if (card) {
      const nodes = [...card.querySelectorAll('*')].filter((e) => e.children.length === 0);
      const idx = nodes.indexOf(labelEl);
      for (let j = idx - 1; j >= 0; j--) {
        const txt = (nodes[j].innerText || '').trim();
        if (txt && txt !== label && !txt.includes('品类均值') && !txt.includes('历史商品') && !txt.includes('同行增速')) {
          val = txt;
          break;
        }
      }
      if (!val) {
        const cardTxt = (card.innerText || '').replace(/\n/g, ' ').trim();
        const m = cardTxt.match(/([\d.]+万|[\d.]+亿|[\d.]+)/);
        if (m) val = m[1];
      }
    }
    overview[label] = val;
  }

  const shop_name = (document.querySelector('.paragraph-text, [class*="paragraph-text"]')?.innerText || '').trim();
  let rating = '';
  const ratingEl = [...document.querySelectorAll('span')].find((e) => {
    const txt = (e.innerText || '').trim();
    if (!/^\d+(\.\d+)?$/.test(txt)) return false;
    let p = e.parentElement;
    for (let i = 0; i < 5 && p; i++) {
      if ((p.innerText || '').includes('店铺综合评分')) return true;
      p = p.parentElement;
    }
    return false;
  });
  if (ratingEl) rating = (ratingEl.innerText || '').trim();
  const priceRange = (t.match(/商品价格分布[：:]\s*([^\n]+)/i) || [])[1] || '';
  const collectedDate = (t.match(/收录时间[：:]\s*([\d\-]+)/i) || [])[1] || '';
  const shopType = (t.match(/店铺类型[：:]\s*([^\s\n]+)/i) || [])[1] || '';
  const tiktokAccount = (t.match(/TikTok账号[：:]\s*([^\s\n]+)/i) || [])[1] || '';

  const priceBand = {};
  const pbIdx = t.indexOf('价格带(RM)');
  if (pbIdx >= 0) {
    const seg = t.slice(pbIdx, pbIdx + 500);
    const gtIdx = seg.indexOf('>75');
    const vals = seg.slice(gtIdx).match(/([\d.]+%|-)/g) || [];
    const bands = ['0-15', '15-30', '30-45', '45-60', '60-75', '>75'];
    bands.forEach((b, i) => { priceBand[b] = vals[i] || null; });
  }

  const products = [...document.querySelectorAll('tbody tr')]
    .filter((r) => r.querySelectorAll('td').length >= 6 && (r.innerText || '').includes('售价'))
    .map((r) => {
      const tds = [...r.querySelectorAll('td')].map((td) => (td.innerText || '').trim());
      const nameRaw = tds[0] || '';
      const price = (nameRaw.match(/售价[：:]\s*(RM[\d.,]+|\$[\d.,]+)/i) || [])[1] || '';
      const name = nameRaw.split('\n')[0].slice(0, 140);
      return { name, category: tds[1] || '', listed: tds[2] || '', commission: tds[3] || '', units_28d: tds[4] || '', gmv_28d: tds[5] || '', price };
    });

  const productCountNote = (t.match(/店铺历史上架\s*(\d+)\s*个商品[，,]当前在售商品\s*(\d+)\s*个/) || [])[0] || '';
  const onSellN = (t.match(/当前在售商品\s*(\d+)\s*个/) || [])[1] || '';

  const categoryDist = [];
  const cdIdx = t.indexOf('品类分布');
  if (cdIdx >= 0) {
    const cdEnd = t.indexOf('价格带分布', cdIdx);
    const cdSeg = t.slice(cdIdx, cdEnd > 0 ? cdEnd : cdIdx + 200);
    const pairs = cdSeg.match(/([\u4e00-\u9fa5A-Za-z&]+)\s+([\d.]+%)/g) || [];
    for (const p of pairs) {
      const m = p.match(/([\u4e00-\u9fa5A-Za-z&]+)\s+([\d.]+%)/);
      if (m && !['总销量', '总销售额'].includes(m[1])) categoryDist.push({ category: m[1].trim(), share: m[2] });
    }
  }

  const channelDist = [];
  const chIdx = t.indexOf('成交渠道占比');
  if (chIdx >= 0) {
    const chEnd = t.indexOf('销售方式分布', chIdx);
    const chSeg = t.slice(chIdx, chEnd > 0 ? chEnd : chIdx + 150);
    const pairs = chSeg.match(/([\u4e00-\u9fa5]+)\s*([\d.]+%)/g) || [];
    for (const p of pairs) {
      const m = p.match(/([\u4e00-\u9fa5]+)\s*([\d.]+%)/);
      if (m) channelDist.push({ channel: m[1].trim(), share: m[2] });
    }
  }

  const saleMethodDist = [];
  const smIdx = t.indexOf('销售方式分布');
  if (smIdx >= 0) {
    const smSeg = t.slice(smIdx, smIdx + 200);
    const pairs = smSeg.match(/(视频|直播|商品卡|橱窗|搜索)\s*([\d.]+%)/g) || [];
    for (const p of pairs) {
      const m = p.match(/(视频|直播|商品卡|橱窗|搜索)\s*([\d.]+%)/);
      if (m) saleMethodDist.push({ method: m[1], share: m[2] });
    }
  }

  return {
    shop_name,
    rating,
    price_range: priceRange,
    collected_date: collectedDate,
    shop_type: shopType,
    tiktok_account: tiktokAccount,
    overview,
    price_band: priceBand,
    products,
    product_count_note: productCountNote,
    on_sell_count: onSellN,
    category_distribution: categoryDist,
    channel_distribution: channelDist,
    sale_method_distribution: saleMethodDist,
    raw_text_len: t.length,
  };
};

/** 等待店铺详情页渲染出数据（safeEval 轮询，容忍 SPA 二次跳转） */
async function waitShopDetail(page, { timeout = 20000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const ok = await safeEval(page, () => {
      const t = document.body.innerText || '';
      return t.includes('数据表现') || t.includes('店铺详情') || t.includes('数据趋势');
    }).catch(() => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`店铺详情页 ${timeout}ms 内未渲染出数据`);
}

/** shop-detail：搜索店铺名 → 进入详情页 → 抓取详情数据 → 落盘 JSON。支持 --shop-id 直接抓。 */
export async function cmdShopDetail(opts) {
  const shopName = opts.shop || opts['shop-name'] || (Array.isArray(opts._) ? opts._[0] : null);
  const shopId = opts['shop-id'] || opts.id || null;
  if (!shopName && !shopId) {
    throw new Error('缺少店铺名或 ID：node scripts/rpa/fastmoss-rpa.mjs shop-detail --shop <店铺名>');
  }
  const outFile = opts.out || path.join(SKILL_ROOT, 'outputs', `shop-detail-${(shopName || shopId).replace(/[^\w.-]/g, '_')}-${Date.now()}.json`);
  const t0 = Date.now();

  const { context, launchMs } = await openBrowser({ headed: opts.headed === true || opts.headed === 'true' });
  // 用店铺搜索页做登录检测（达人搜索页偶发风控，店铺页稳定；采集默认无界面，验证页面需人工处理）
  await assertLoggedIn(context.pages()[0], `${SHOP_BASE}`);
  const country = opts.country ? await switchCountry(context.pages()[0], opts.country) : null;
  const currency = country ? resolveCountry(country).currency : (opts.currency || null);
  const page = context.pages()[0];

  const resolvedId = shopId || await resolveShopId(page, shopName);
  const fullUrl = `${BASE}/shop-marketing/detail/${resolvedId}`;
  await page.goto(fullUrl, { waitUntil: 'domcontentloaded' });

  await waitShopDetail(page);
  // 滚动触发懒加载（成交分析/商品列表/达人列表在页面下方）
  await page.evaluate(async () => {
    const H = document.body.scrollHeight;
    for (let y = 0; y <= H; y += 800) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 250));
    }
    await new Promise((r) => setTimeout(r, 800));
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1500);

  const detail = await safeEval(page, SHOP_DETAIL_EXTRACT_FN);

  const meta = {
    collected_at: new Date().toISOString(),
    shop_name: shopName || null,
    shop_id: resolvedId || null,
    country: country || null,
    currency,
    source: fullUrl,
    timings: { launchMs, totalMs: Date.now() - t0 },
  };

  const payload = { meta, detail };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');
  log(`店铺详情完成：${detail.shop_name || shopName}（评分 ${detail.rating || '?'}），商品 ${detail.products?.length || 0} 个，${meta.timings.totalMs} ms`);
  log(`写出 ${outFile}`);
  await context.close();
  return { meta, outFile };
}

/** shop-detail-report：搜索店铺名 → 抓详情 → 自动生成分析报告（一条命令跑完）。 */
export async function cmdShopDetailReport(opts) {
  const { meta, outFile } = await cmdShopDetail(opts);
  const payload = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  const { report, summary } = analyzeShopDetail(payload, { top: Number(opts.top || 20), dataFile: outFile });
  const reportFile = path.join(path.dirname(outFile), `${summary.shopName.replace(/[^\w.-]/g, '_')}_店铺详情分析.md`);
  fs.writeFileSync(reportFile, report, 'utf8');
  log(`分析报告：${reportFile}`);
  log(`摘要：${summary.shopName} · ${summary.productCount} 个动销商品 · 主力价格带 ${summary.maxBand} · 合计 ${summary.totalGmv}`);
  return { meta, outFile, reportFile, summary };
}
