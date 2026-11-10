// 广告域命令：广告投流数据(ad)，抓单条广告案例的 ROAS/花费等（非商品 ROI 路径）。
import fs from 'node:fs';
import path from 'node:path';
import { BASE, SKILL_ROOT, resolveCountry, REGION_BY_LABEL } from '../lib/config.mjs';
import { log } from '../lib/cli.mjs';
import { openBrowser, assertLoggedIn, switchCountry } from '../lib/browser.mjs';

const AD_BASE = `${BASE}/creativecenter/search`;
const SHOP_BASE = `${BASE}/shop-marketing/search`;

/**
 * ad：抓投流广告数据（含 ROAS、广告花费），支持日期范围参数。
 * 用法：
 *   node scripts/rpa/fastmoss-rpa.mjs ad --country 美国 --category-id 16 --start 2026-10-09 --end 2026-11-09 --pages 10 --out xxx.json
 *   node scripts/rpa/fastmoss-rpa.mjs ad --keyword 耳机 --start 2026-10-09 --end 2026-11-09 --out xxx.json
 * 参数：--start/--end 投放时间范围（可选）；--category-id 一级分类 l1_cid；--pages 翻页数（每页 12 条）。
 */
export async function cmdAd(opts) {
  const start = opts.start || opts['start-date'] || null;
  const end = opts.end || opts['end-date'] || null;
  const categoryId = opts['category-id'] || opts.cid || null;
  const keyword = opts.keyword || opts.words || opts.kw || (Array.isArray(opts._) ? opts._[0] : null);
  const pages = Number(opts.pages || 10);
  const outFile = opts.out || path.join(SKILL_ROOT, 'outputs', `ads-${Date.now()}.json`);
  const t0 = Date.now();

  const { context, launchMs } = await openBrowser({ headed: opts.headed === true || opts.headed === 'true' });
  await assertLoggedIn(context.pages()[0], `${SHOP_BASE}`);
  const country = opts.country ? await switchCountry(context.pages()[0], opts.country).catch((e) => { log(`切国家失败（忽略）：${e.message}`); return null; }) : null;
  const region = country ? (REGION_BY_LABEL[country] || 'US') : 'US';
  const page = context.pages()[0];

  // 捕获接口数据
  const allAds = new Map();
  page.on('response', async (res) => {
    if (res.url().includes('/api/da/V4/search')) {
      try {
        const j = JSON.parse(await res.text());
        const ads = (j.data && j.data.ad_list) || [];
        ads.forEach((a) => { if (a.id) allAds.set(a.id, a); });
      } catch (e) { /* 忽略解析错误 */ }
    }
  });

  // 构造 URL（带日期范围 + 分类 + 关键词）
  const qs = new URLSearchParams();
  qs.set('page', '1');
  if (categoryId) qs.set('l1_cid', String(categoryId));
  if (start) qs.set('last_start_date', String(start));
  if (end) qs.set('last_end_date', String(end));
  if (keyword) qs.set('words', String(keyword));
  const url = `${AD_BASE}?${qs.toString()}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);
  if (keyword) log(`广告关键词「${keyword}」（URL words 参数）`);

  // 翻页抓取
  for (let pg = 2; pg <= pages; pg++) {
    const ok = await page.evaluate((n) => {
      const items = [...document.querySelectorAll('li.ant-pagination-item')].filter((li) => (li.innerText || '').trim() === String(n));
      if (!items.length) return false;
      (items[items.length - 1].querySelector('a') || items[items.length - 1]).click();
      return true;
    }, pg).catch(() => false);
    if (!ok) break;
    await page.waitForTimeout(1500);
  }

  const ads = [...allAds.values()];
  const meta = {
    collected_at: new Date().toISOString(),
    country: country || null,
    region,
    category_id: categoryId || null,
    start_date: start || null,
    end_date: end || null,
    keyword: keyword || null,
    pages_requested: pages,
    unique_ads: ads.length,
    timings: { launchMs, crawlMs: Date.now() - t0 - launchMs, totalMs: Date.now() - t0 },
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ meta, ads }, null, 2), 'utf8');
  log(`ad 完成：${ads.length} 条广告（日期 ${start || '不限'}~${end || '不限'}，分类 ${categoryId || '不限'}），${meta.timings.totalMs} ms`);
  log(`写出 ${outFile}`);
  await context.close();
  return { meta, outFile };
}
