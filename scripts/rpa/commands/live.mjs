// 直播域命令：直播搜索(live)、直播详情(live-detail)。
import fs from 'node:fs';
import path from 'node:path';
import { BASE, SKILL_ROOT, resolveCountry } from '../lib/config.mjs';
import { log } from '../lib/cli.mjs';
import { openBrowser, safeEval, assertLoggedIn, switchCountry } from '../lib/browser.mjs';

const LIVE_BASE = `${BASE}/live/search`;
// 登录检测用店铺页（顶栏版本标识加载快，且比直播页更不易触发风控/崩溃）
const SHOP_BASE = `${BASE}/shop-marketing/search`;

/** 注入浏览器的直播表提取函数 */
const LIVE_EXTRACT_FN = function () {
  const table = [...document.querySelectorAll('table')].find((t) => (t.innerText || '').includes('直播间'));
  if (!table) return { headers: [], rows: [] };
  const headers = [...table.querySelectorAll('thead th')].map((x) => x.innerText.trim());
  const rows = [...table.querySelectorAll('tbody tr')]
    .filter((r) => r.querySelectorAll('td').length >= 4 && (r.innerText || '').replace(/\s/g, '').length > 0)
    .map((r) => {
      const tds = [...r.querySelectorAll('td')];
      const link = r.querySelector('a[href*="/live/detail/"]');
      const infoCell = tds[0];
      const title = (infoCell?.querySelector('.paragraph-text, [class*="paragraph-text"]')?.innerText || infoCell?.innerText || '').split('\n')[0].trim();
      const category = (infoCell?.querySelector('.custom-tag-container, [class*="tag"]')?.innerText || '').trim();
      const anchorCell = tds[1];
      const anchorName = (anchorCell?.querySelector('.paragraph-text, [class*="paragraph-text"]')?.innerText || '').trim();
      const anchorInfo = (anchorCell?.innerText || '').replace(/\s+/g, ' ').trim();
      const fullText = (r.innerText || '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
      // 抓「标签：值」——值可能含空格（如日期+时间+时区），用下一个已知标签或结尾作为边界
      const grab = (label) => {
        const m = fullText.match(new RegExp(label + '[：:]\\s*([\\d\\-: .()GMT+]+?)(?=\\s+(?:结束时间|直播时长|累计观看|直播商品|总销量|总销售额|UV价值|开播时间)|$)'));
        return m ? m[1].trim() : '';
      };
      // 直播时长：抓 HH:MM:SS 格式（紧跟「直播时长」标签后）
      const durationMatch = fullText.match(/直播时长[：:]\s*(\d{1,2}:\d{2}:\d{2})/);
      return {
        title,
        category,
        anchor_name: anchorName,
        anchor_info: anchorInfo,
        start_time: grab('开播时间'),
        end_time: grab('结束时间'),
        duration: durationMatch ? durationMatch[1] : '',
        viewers: (tds[3]?.innerText || '').trim(),
        product_count: (tds[4]?.innerText || '').trim(),
        total_units: (tds[5]?.innerText || '').trim(),
        total_gmv: (tds[6]?.innerText || '').trim(),
        uv_value: (tds[7]?.innerText || '').trim(),
        id: link ? link.href.split('/').pop() : '',
        source_url: link ? link.href : '',
      };
    });
  return { headers, rows };
};

/** 等待直播表渲染出数据 */
async function waitLiveRows(page, { timeout = 20000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const ok = await safeEval(page, () => {
      const t = [...document.querySelectorAll('table')].find((x) => (x.innerText || '').includes('直播间'));
      if (!t) return false;
      const rows = [...t.querySelectorAll('tbody tr')].filter((r) => r.querySelectorAll('td').length >= 4 && (r.innerText || '').replace(/\s/g, '').length > 0);
      return rows.length >= 1;
    }).catch(() => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`直播列表 ${timeout}ms 内未渲染出数据`);
}

/** live：搜索直播（按关键词/达人昵称/标题）并抓取直播列表落盘。不传关键词则抓直播大盘。 */
export async function cmdLive(opts) {
  const keyword = opts.keyword || opts.words || opts.kw || (Array.isArray(opts._) ? opts._[0] : null);
  const pages = Number(opts.pages || 1);
  const outFile = opts.out || path.join(SKILL_ROOT, 'outputs', `lives-${Date.now()}.json`);
  const t0 = Date.now();

  const { context, launchMs } = await openBrowser({ headed: opts.headed === true || opts.headed === 'true' });
  await assertLoggedIn(context.pages()[0], `${SHOP_BASE}`);
  const country = opts.country ? await switchCountry(context.pages()[0], opts.country) : null;
  const currency = country ? resolveCountry(country).currency : (opts.currency || null);
  const page = context.pages()[0];

  // 打开直播搜索页
  await page.goto(`${LIVE_BASE}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  // 搜索关键词（达人昵称/标题/ID）
  if (keyword) {
    const input = await page.waitForSelector('input[placeholder*="直播标题"]', { timeout: 15000 }).catch(() => null);
    if (!input) throw new Error('找不到直播搜索框，可能未登录或页面结构变化');
    await input.fill(String(keyword));
    await input.press('Enter');
    await page.waitForTimeout(5000);
    log(`搜索直播关键词「${keyword}」`);
  }

  await waitLiveRows(page);

  // 翻页抓取
  const byId = new Map();
  for (let i = 0; i < pages; i++) {
    if (i > 0) {
      const ok = await page.evaluate((n) => {
        const items = [...document.querySelectorAll('li.ant-pagination-item')].filter((li) => (li.innerText || '').trim() === String(n));
        if (!items.length) return false;
        const a = items[items.length - 1].querySelector('a') || items[items.length - 1];
        a.click();
        return true;
      }, i + 1).catch(() => false);
      if (!ok) break;
      await page.waitForTimeout(3000);
      await waitLiveRows(page);
    }
    const payload = await safeEval(page, LIVE_EXTRACT_FN);
    for (const row of payload.rows || []) {
      const key = row.id || (row.title + row.start_time);
      if (key && !byId.has(key)) byId.set(key, row);
    }
  }

  const meta = {
    collected_at: new Date().toISOString(),
    country: country || null,
    currency,
    keyword: keyword || null,
    pages_requested: pages,
    unique_lives: byId.size,
    timings: { launchMs, crawlMs: Date.now() - t0 - launchMs, totalMs: Date.now() - t0 },
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ meta, lives: [...byId.values()] }, null, 2), 'utf8');
  log(`live 完成：${byId.size} 场直播（关键词「${keyword || '大盘'}」），${meta.timings.totalMs} ms`);
  log(`写出 ${outFile}`);
  await context.close();
  return { meta, outFile };
}

/* ---------------- 直播详情 ---------------- */

/** 注入浏览器的直播详情提取函数 */
const LIVE_DETAIL_EXTRACT_FN = function () {
  const t = document.body.innerText || '';
  const grabPct = (label) => {
    const idx = t.indexOf(label);
    if (idx < 0) return '';
    const seg = t.slice(idx, idx + 60);
    const m = seg.match(/([\d.]+%|[\d.]+)/);
    return m ? m[1] : '';
  };
  // 头部
  const title = (t.match(/直播详情\s*[\s\S]*?\n([^\n]+)/) || [])[1] || '';
  const liveTime = (t.match(/直播时间[：:]\s*([^\n]+)/) || [])[1] || '';
  const duration = (t.match(/直播时长[：:]\s*([^\n]+)/) || [])[1] || '';
  const liveType = (t.match(/直播类型[：:]\s*([^\n]+)/) || [])[1] || '';
  const anchor = (t.match(/ID[：:]\s*([^\s]+)/) || [])[1] || '';
  const anchorFans = (t.match(/粉丝数[:：]\s*([\d.]+万?)/) || [])[1] || '';
  const mainCategory = (t.match(/主推品类[：:]\s*([^\n]+)/) || [])[1] || '';

  // 数据总览：值是「标签前面」的（如「43.96万 累计观看人次」），从「数据总览」区块按标签反向取值。
  const ovIdx = t.indexOf('数据总览');
  const ovSeg = ovIdx >= 0 ? t.slice(ovIdx, ovIdx + 900) : '';
  const grabBefore = (label) => {
    const idx = ovSeg.indexOf(label);
    if (idx < 0) return '';
    const before = ovSeg.slice(0, idx).replace(/\s*\/小时/g, '').replace(/\d+\s*个动销/g, '').trim();
    const m = before.match(/(RM[\d.,]+万?|\$[\d.,]+万?|[\d.,]+万?|[\d.]+%|[\d.]+)\s*$/);
    return m ? m[1] : '';
  };
  const overview = {
    viewers: grabBefore('累计观看人次'),
    peak_viewers: grabBefore('人数峰值'),
    new_fans: grabBefore('本场直播增粉数'),
    fan_growth_rate: grabBefore('粉丝增长率'),
    total_units: (ovSeg.match(/([\d.,]+万?)\s+[\d.,]+\s*\/小时\s*本场总销量/) || [])[1] || '',
    units_per_hour: (ovSeg.match(/([\d.]+万?)\s*\/小时\s*本场总销量/) || [])[1] || '',
    total_gmv: (ovSeg.match(/(RM[\d.,]+万?)\s+RM[\d.,]+万?\s*\/小时\s*本场总销售额/) || [])[1] || '',
    gmv_per_hour: (ovSeg.match(/(RM[\d.,]+万?)\s*\/小时\s*本场总销售额/) || [])[1] || '',
    uv_value: (ovSeg.match(/(RM[\d.,]+万?)\s+RM[\d.,]+万?\s*UV价值/) || [])[1] || '',
    avg_price: (ovSeg.match(/(RM[\d.,]+万?)\s*UV价值\s*平均成交单价/) || [])[1] || '',
    listed_products: (ovSeg.match(/([\d]+)\s*\d+\s*个动销\s*本场上架商品数/) || ovSeg.match(/([\d]+)\s*个动销\s*本场上架商品数/) || [])[1] || '',
    conversion_rate: grabBefore('销售转化率'),
    gpm: (ovSeg.match(/销售转化率\s*(RM[\d.,]+万?|\$[\d.,]+万?|[\d.,]+万?)/) || [])[1] || '',
  };

  // 直播带货商品列表（td: 0商品(含售价) 1所属店铺 2销量 3销售额 4佣金比例）
  const products = [...document.querySelectorAll('tbody tr')]
    .filter((r) => r.querySelectorAll('td').length >= 4 && (r.innerText || '').includes('售价'))
    .map((r) => {
      const tds = [...r.querySelectorAll('td')].map((td) => (td.innerText || '').trim());
      const nameRaw = tds[0] || '';
      const price = (nameRaw.match(/售价[：:]\s*(RM[\d.,]+|\$[\d.,]+)/i) || [])[1] || '';
      const name = nameRaw.split('\n')[0].slice(0, 120);
      const shopRaw = tds[1] || '';
      const shop = shopRaw.split('\n')[0].trim();
      return {
        name,
        price,
        shop,
        category: (shopRaw.match(/(美妆个护|食品饮料|运动与户外|女装与女士内衣|男装与男士内衣|箱包|鞋靴|居家日用|[^\n]+)/) || [])[0] || '',
        units: tds[2] || '',
        gmv: tds[3] || '',
        commission: tds[4] || '',
      };
    });

  // Top3 商品
  const top3 = [];
  const top3Match = t.match(/本场直播销量Top3商品([\s\S]*?)(?:itakosmetik|ID[：:]|近28天)/);
  if (top3Match) {
    const names = top3Match[1].match(/[\u4e00-\u9fa5A-Za-z0-9()\- .]+/g) || [];
    top3.push(...names.filter((x) => x.trim().length > 2).slice(0, 6));
  }

  return {
    title,
    live_time: liveTime,
    duration,
    live_type: liveType,
    anchor,
    anchor_fans: anchorFans,
    main_category: mainCategory,
    overview,
    products,
    top3_products: top3,
    raw_text_len: t.length,
  };
};

/** 等待直播详情页渲染出数据 */
async function waitLiveDetail(page, { timeout = 25000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const ok = await page.evaluate(() => {
      const t = document.body.innerText || '';
      return t.includes('数据总览') || t.includes('累计观看人次') || t.includes('本场总销售额');
    }).catch(() => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`直播详情页 ${timeout}ms 内未渲染出数据`);
}

/** live-detail：抓单场直播详情（数据总览 + 商品列表 + Top3 商品）。支持 --id 或 --id-file 批量。 */
export async function cmdLiveDetail(opts) {
  const ids = opts['id-file']
    ? (() => { const j = JSON.parse(fs.readFileSync(path.resolve(opts['id-file']), 'utf8')); return (j.lives || []).map((l) => l.id).filter(Boolean).slice(0, Number(opts.top || 5)); })()
    : (opts.id ? String(opts.id).split(',').map((s) => s.trim()).filter(Boolean) : null);
  if (!ids || !ids.length) throw new Error('缺少直播 ID：node scripts/rpa/fastmoss-rpa.mjs live-detail --id <live_id> 或 --id-file lives.json');

  const outDir = opts['out-dir'] || null;
  const outFile = opts.out || (outDir ? null : path.join(SKILL_ROOT, 'outputs', `live-detail-${Date.now()}.json`));
  const t0 = Date.now();

  const { context, launchMs } = await openBrowser({ headed: opts.headed === true || opts.headed === 'true' });
  await assertLoggedIn(context.pages()[0], `${SHOP_BASE}`);
  const country = opts.country ? await switchCountry(context.pages()[0], opts.country).catch((e) => { log(`切国家失败（忽略）：${e.message}`); return null; }) : null;
  const currency = country ? resolveCountry(country).currency : (opts.currency || null);
  const page = context.pages()[0];

  const details = [];
  for (const id of ids) {
    await page.goto(`${BASE}/live/detail/${id}`, { waitUntil: 'domcontentloaded' });
    await waitLiveDetail(page);
    // 滚动触发商品列表懒加载
    await page.evaluate(async () => {
      const H = document.body.scrollHeight;
      for (let y = 0; y <= H; y += 800) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 250)); }
      await new Promise((r) => setTimeout(r, 600));
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(1000);
    const detail = await safeEval(page, LIVE_DETAIL_EXTRACT_FN);
    details.push({ live_id: id, source: `${BASE}/live/detail/${id}`, ...detail });
    log(`直播 ${id}：${detail.title || '?'} · GMV ${detail.overview.total_gmv || '?'} · 商品 ${detail.products.length} 个`);
  }

  const meta = {
    collected_at: new Date().toISOString(),
    country: country || null,
    currency,
    requested: ids.length,
    ok: details.length,
    timings: { launchMs, totalMs: Date.now() - t0 },
  };

  if (outDir) {
    fs.mkdirSync(path.resolve(outDir), { recursive: true });
    const file = path.join(path.resolve(outDir), 'live-details.json');
    fs.writeFileSync(file, JSON.stringify({ meta, details }, null, 2), 'utf8');
    log(`写出 ${file}`);
    await context.close();
    return { meta, outFile: file };
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ meta, details }, null, 2), 'utf8');
  log(`live-detail 完成：${details.length} 场，${meta.timings.totalMs} ms`);
  log(`写出 ${outFile}`);
  await context.close();
  return { meta, outFile };
}
