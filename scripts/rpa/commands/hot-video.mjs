// 视频商品榜命令：抓 FastMoss「视频商品榜」/zh/e-commerce/hotvideo。
// 列：带货商品 | 视频内容 | 总销量 | 总销售额 | 总播放量 | 总点赞数 | 总评论数 | 操作。
// 「视频内容」列含「X条新发布带货视频」（所选时间范围内，默认近7天），本命令提取该数量。
// 注意：页面默认按总销量排序，「视频内容」列不可排序；URL 直接跳 page>=2 会丢失分类筛选，
// 必须用 UI 点分页器翻页（.ant-pagination-next），并做稳定性检测防渲染竞态。
import fs from 'node:fs';
import path from 'node:path';
import { BASE, SKILL_ROOT, resolveCountry, REGION_BY_LABEL } from '../lib/config.mjs';
import { log } from '../lib/cli.mjs';
import { openBrowser, safeEval, assertLoggedIn, switchCountry } from '../lib/browser.mjs';
import { resolveCategoryOptions } from '../lib/categories.mjs';

const HOT_VIDEO_BASE = `${BASE}/e-commerce/hotvideo`;

function buildHotVideoUrl({ categoryId, categoryId2, categoryId3, region } = {}) {
  const qs = new URLSearchParams();
  if (categoryId) qs.set('l1_cid', String(categoryId));
  if (categoryId2) qs.set('l2_cid', String(categoryId2));
  if (categoryId3) qs.set('l3_cid', String(categoryId3));   // 三级分类（如 保护壳、屏幕保护膜、皮肤=601925）
  if (region) qs.set('region', String(region));
  return `${HOT_VIDEO_BASE}?${qs.toString()}`;
}

const HOT_VIDEO_EXTRACT_FN = function () {
  const table = [...document.querySelectorAll('table')].find((t) => (t.innerText || '').includes('带货商品'));
  if (!table) return { rows: [], catBtn: null, active: null };
  const rows = [...table.querySelectorAll('tbody tr')]
    .filter((r) => r.querySelectorAll('td').length >= 6 && (r.innerText || '').replace(/\s/g, '').length > 0)
    .map((r) => {
      const tds = [...r.querySelectorAll('td')];
      const link = r.querySelector('a[href*="/e-commerce/detail/"]');
      return {
        product: (tds[0]?.innerText || '').replace(/\s+/g, ' ').trim(),
        video_cell: (tds[1]?.innerText || '').replace(/\s+/g, ' ').trim(),
        total_units: (tds[2]?.innerText || '').trim(),
        total_gmv: (tds[3]?.innerText || '').trim(),
        total_play: (tds[4]?.innerText || '').trim(),
        total_like: (tds[5]?.innerText || '').trim(),
        total_comment: (tds[6]?.innerText || '').trim(),
        id: link ? link.href.split('/').pop() : '',
        source_url: link ? link.href : '',
      };
    });
  const catBtn = [...document.querySelectorAll('button,span,div')].find((e) => /商品分类/.test((e.innerText || '').trim()) && (e.innerText || '').trim().length < 30);
  return { rows, catBtn: catBtn ? catBtn.innerText.replace(/\s+/g, ' ').trim() : null, active: document.querySelector('.ant-pagination-item-active')?.innerText?.trim() || null };
};

function parseVideoCount(cell) {
  const m = String(cell || '').match(/([\d.,]+万?)条新发布带货视频/);
  if (!m) return null;
  let t = m[1].replace(/,/g, '');
  const mult = t.endsWith('万') ? 1e4 : 1;
  t = t.replace(/万$/, '');
  const n = Number(t) * mult;
  return Number.isFinite(n) ? Math.round(n) : null;
}

async function readStable(page, tries = 3) {
  let prev = null;
  for (let i = 0; i < tries; i++) {
    const cur = await safeEval(page, HOT_VIDEO_EXTRACT_FN);
    if (prev && cur.rows[0]?.id && prev.rows[0]?.id === cur.rows[0]?.id) return cur; // 连续两次首行一致 = 稳定
    prev = cur;
    await page.waitForTimeout(1800);
  }
  return prev;
}

export async function cmdHotVideo(opts) {
  const pages = Number(opts.pages || 10);
  const { categoryId, categoryId2, categoryId3 } = resolveCategoryOptions(opts);
  if (opts.category && !categoryId) throw new Error('分类未匹配，请更新分类树或指定分类ID');
  const outFile = opts.out || path.join(SKILL_ROOT, 'outputs', `hot-video-${Date.now()}.json`);
  const t0 = Date.now();

  const { context, launchMs } = await openBrowser({ headed: opts.headed === true || opts.headed === 'true' });
  const page = context.pages()[0];
  await assertLoggedIn(page);
  const country = opts.country ? await switchCountry(page, opts.country) : null;
  const currency = country ? resolveCountry(country).currency : (opts.currency || 'USD');
  const region = country ? (REGION_BY_LABEL[country] || null) : null;

  await page.goto(buildHotVideoUrl({ categoryId, categoryId2, categoryId3, region }), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(7000);

  const byId = new Map();
  const pageLog = [];
  let timeRange = null;
  for (let i = 0; i < pages; i++) {
    if (i > 0) {
      const ok = await page.evaluate(() => {
        const n = document.querySelector('.ant-pagination-next');
        if (!n || (n.className || '').includes('disabled')) return false;
        n.click();
        return true;
      }).catch(() => false);
      if (!ok) { pageLog.push({ page: i + 1, stop: 'next disabled' }); break; }
      await page.waitForTimeout(3500);
    }
    const data = await readStable(page);
    // 时间范围文案
    if (!timeRange && data.rows[0]?.video_cell) {
      timeRange = /过去7天/.test(data.rows[0].video_cell) ? '过去7天' : null;
    }
    let added = 0;
    for (const r of data.rows || []) {
      if (!r.id) continue;
      if (!byId.has(r.id)) {
        byId.set(r.id, { ...r, video_count: parseVideoCount(r.video_cell) });
        added++;
      }
    }
    pageLog.push({ page: i + 1, active: data.active, rows: (data.rows || []).length, added, catBtn: data.catBtn });
    log(`hot-video 第 ${i + 1} 页：${(data.rows || []).length} 行，新增 ${added}，累计 ${byId.size}`);
  }

  const meta = {
    collected_at: new Date().toISOString(),
    country: country || null,
    currency,
    region,
    category: opts.category || null,
    category_id: categoryId || null,
    category_id2: categoryId2 || null,
    category_id3: categoryId3 || null,
    time_range: timeRange || '页面默认（近7天）',
    sort_default: '总销量（视频内容列不可排序）',
    pages_requested: pages,
    unique_products: byId.size,
    page_log: pageLog,
    note: '视频商品榜「视频内容」列含「X条新发布带货视频」，即所选时间范围（默认近7天）内达人新发布带货视频数；本命令按原页面排序采集，数量排序请在分析层做。',
    timings: { launchMs, crawlMs: Date.now() - t0 - launchMs, totalMs: Date.now() - t0 },
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ meta, products: [...byId.values()] }, null, 2), 'utf8');
  log(`hot-video 完成：${byId.size} 个商品，写出 ${outFile}`);
  await context.close();
  return { meta, outFile };
}
