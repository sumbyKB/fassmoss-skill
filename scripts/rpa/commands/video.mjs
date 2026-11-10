// 视频域命令：视频搜索(video)，抓视频列表 + 逐条进详情页拿 TikTok 链接 + 视频类型。
import fs from 'node:fs';
import path from 'node:path';
import { BASE, SKILL_ROOT, resolveCountry } from '../lib/config.mjs';
import { log } from '../lib/cli.mjs';
import { openBrowser, assertLoggedIn, switchCountry } from '../lib/browser.mjs';

const VIDEO_BASE = `${BASE}/media-source/video`;
const SHOP_BASE = `${BASE}/shop-marketing/search`;

/** 注入浏览器的视频表提取函数（用带 /media-source/video/ 链接的 tr 精确定位） */
const VIDEO_EXTRACT_FN = function () {
  const rows = [...document.querySelectorAll('tr')].filter((r) => r.querySelector('a[href*="/media-source/video/"]'));
  return rows.map((r) => {
    const tds = [...r.querySelectorAll('td')].map((td) => (td.innerText || '').trim());
    const link = r.querySelector('a[href*="/media-source/video/"]');
    const detailUrl = link ? link.href : '';
    const rawTitle = tds[0] || '';
    const title = rawTitle.replace(/^AD\s*/, '').split('\n')[0].slice(0, 140);
    return {
      title,
      is_ad: /^AD/.test(rawTitle),
      author: (tds[1] || '').split('\n')[0].trim(),
      author_region_category: (tds[1] || '').replace(/\n/g, ' ').trim(),
      fans: tds[2] || '',
      pub_time: tds[3] || '',
      plays: tds[4] || '',
      likes: tds[5] || '',
      interaction: tds[6] || '',
      video_id: detailUrl ? detailUrl.split('/').pop() : '',
      detail_url: detailUrl,
    };
  });
};

/** 等待视频列表渲染出数据 */
async function waitVideoRows(page, { timeout = 20000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const ok = await page.evaluate(() => {
      return [...document.querySelectorAll('tr')].some((r) => r.querySelector('a[href*="/media-source/video/"]'));
    }).catch(() => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`视频列表 ${timeout}ms 内未渲染出数据`);
}

/** video：搜索视频（关键词/标题）并抓视频列表 + 逐条进详情页拿 TikTok 链接 + 视频类型。 */
export async function cmdVideo(opts) {
  const keyword = opts.keyword || opts.words || opts.kw || (Array.isArray(opts._) ? opts._[0] : null);
  const pages = Number(opts.pages || 1);
  const topN = Number(opts.top || 10);
  const outFile = opts.out || path.join(SKILL_ROOT, 'outputs', `videos-${Date.now()}.json`);
  const t0 = Date.now();

  const { context, launchMs } = await openBrowser({ headed: opts.headed === true || opts.headed === 'true' });
  await assertLoggedIn(context.pages()[0], `${SHOP_BASE}`);
  const country = opts.country ? await switchCountry(context.pages()[0], opts.country).catch((e) => { log(`切国家失败（忽略）：${e.message}`); return null; }) : null;
  const page = context.pages()[0];

  // 打开视频搜索页
  const url = keyword ? `${VIDEO_BASE}?page=1&words=${encodeURIComponent(keyword)}` : `${VIDEO_BASE}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  if (keyword && !page.url().includes('words=')) {
    // URL 没带上 words，可能 SPA 跳转丢了，手动搜一次
    const input = await page.waitForSelector('input[placeholder*="视频"], input[placeholder*="热门"]', { timeout: 10000 }).catch(() => null);
    if (input) { await input.fill(String(keyword)); await input.press('Enter'); await page.waitForTimeout(5000); }
    log(`搜索视频关键词「${keyword}」`);
  }

  await waitVideoRows(page);

  // 翻页抓列表
  const byId = new Map();
  for (let i = 0; i < pages; i++) {
    if (i > 0) {
      const ok = await page.evaluate((n) => {
        const items = [...document.querySelectorAll('li.ant-pagination-item')].filter((li) => (li.innerText || '').trim() === String(n));
        if (!items.length) return false;
        (items[items.length - 1].querySelector('a') || items[items.length - 1]).click();
        return true;
      }, i + 1).catch(() => false);
      if (!ok) break;
      await page.waitForTimeout(3000);
      await waitVideoRows(page);
    }
    const rows = await page.evaluate(VIDEO_EXTRACT_FN).catch(() => []);
    for (const row of rows) {
      if (row.video_id && !byId.has(row.video_id)) byId.set(row.video_id, row);
    }
  }

  // 逐个进详情页拿 TikTok 链接 + 视频类型（串行，取前 topN 条）
  const list = [...byId.values()].slice(0, topN);
  let linkedCount = 0;
  for (const row of list) {
    try {
      await page.goto(row.detail_url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3500);
      const info = await page.evaluate(() => {
        const a = [...document.querySelectorAll('a')].find((x) => /tiktok\.com\/@/.test(x.href));
        const m = document.body.innerText.match(/视频类型[：:]\s*([^\n|]+)/);
        return { tiktok_url: a ? a.href : '', video_type: m ? m[1].trim() : '' };
      });
      row.tiktok_url = info.tiktok_url;
      row.video_type = info.video_type;
      if (info.tiktok_url) linkedCount++;
    } catch (e) { row.tiktok_url = ''; row.video_type = ''; }
  }

  const meta = {
    collected_at: new Date().toISOString(),
    country: country || null,
    keyword: keyword || null,
    pages_requested: pages,
    unique_videos: byId.size,
    linked: linkedCount,
    timings: { launchMs, crawlMs: Date.now() - t0 - launchMs, totalMs: Date.now() - t0 },
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ meta, videos: list }, null, 2), 'utf8');
  log(`video 完成：${list.length} 条视频（关键词「${keyword || '热门'}」），拿到 TikTok 链接 ${linkedCount} 条，${meta.timings.totalMs} ms`);
  log(`写出 ${outFile}`);
  await context.close();
  return { meta, outFile };
}
