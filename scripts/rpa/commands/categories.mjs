// 分类树命令：抓「一级/二级/三级分类名 → ID」映射（商品榜/店铺榜分类筛选的关键参数）。
// 数据源：/api/live/filterInfo 的 data.product_category（完整三级树，一级→二级→三级，全带 c_code）。
// 兜底：/api/shop/V3/categoryInfo（只有一/二级，filterInfo 拿不到时用）。
import fs from 'node:fs';
import path from 'node:path';
import { BASE, SKILL_ROOT } from '../lib/config.mjs';
import { log } from '../lib/cli.mjs';
import { openBrowser, assertLoggedIn, switchCountry, assertPageAccess } from '../lib/browser.mjs';

import { makeTracker, waitTracked } from '../lib/tracker.mjs';

const HOT_VIDEO_BASE = `${BASE}/e-commerce/hotvideo`;

/** 解析 filterInfo 的完整三级树 */
function parseFilterInfo(text) {
  const j = JSON.parse(text);
  const cats = (j.data && j.data.product_category) || [];
  const l1 = [], l2 = [], l3 = [];
  for (const c of cats) {
    l1.push({ code: c.c_code, name: c.c_name, rank: c.rank });
    for (const s of (c.sub || [])) {
      l2.push({ code: s.c_code, name: s.c_name, parent_code: c.c_code, parent_name: c.c_name });
      for (const t of (s.sub || [])) {
        l3.push({ code: t.c_code, name: t.c_name, parent_code: s.c_code, parent_name: s.c_name, l1_code: c.c_code, l1_name: c.c_name });
      }
    }
  }
  return { l1, l2, l3 };
}

/** 解析 categoryInfo（一/二级，兜底） */
function parseCategoryInfo(text) {
  const j = JSON.parse(text);
  const cats = (j.data && j.data.category) || [];
  const l1 = [], l2 = [];
  for (const c of cats) {
    l1.push({ code: c.c_code, name: c.c_name, rank: c.rank });
    for (const s of (c.sub || [])) {
      l2.push({ code: s.c_code, name: s.c_name, parent_code: c.c_code, parent_name: c.c_name });
    }
  }
  return { l1, l2, l3: [] };
}

/** categories：抓完整分类树（一级 + 二级 + 三级，含分类 ID），供 product/shop/category-roi 做分类筛选。 */
export async function cmdCategories(opts) {
  const outFile = opts.out || path.join(SKILL_ROOT, 'outputs', 'categories.json');
  const { context } = await openBrowser({ headed: opts.headed === true || opts.headed === 'true' });
  const page = context.pages()[0];
  let tracker;
  try {
    await assertLoggedIn(page);
    const country = opts.country ? await switchCountry(page, opts.country) : null;
    const readTree = async (url, endpoint, parse) => {
      tracker = makeTracker(page, endpoint);
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        const body = await waitTracked(tracker, text => {
          try { return parse(text).l1.length > 0; } catch { return false; }
        }, { check: () => assertPageAccess(page) });
        return body ? parse(body) : null;
      } finally { tracker.dispose(); tracker = null; }
    };
    let tree = await readTree(HOT_VIDEO_BASE, '/api/live/filterInfo', parseFilterInfo);
    let source = '视频商品榜页面分类树';
    if (!tree) {
      tree = await readTree(BASE + '/shop-marketing/search', '/api/shop/V3/categoryInfo', parseCategoryInfo);
      source = '店铺榜页面分类树（仅一二级）';
    }
    if (!tree?.l1.length) throw new Error('未取得有效分类树，保留原缓存');
    // 缓存已包含三级时，降级采集不得破坏它。
    if (!tree.l3.length && fs.existsSync(outFile)) {
      const previous = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      if (previous.l3_categories?.length) throw new Error('本次未取得三级分类，保留原完整缓存');
    }
    const result = { collected_at: new Date().toISOString(), country, source,
      l1_categories: tree.l1, l2_categories: tree.l2, l3_categories: tree.l3,
      complete_levels: tree.l3.length ? 3 : 2 };
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf8');
    log('分类树已保存：' + tree.l1.length + '/' + tree.l2.length + '/' + tree.l3.length);
    return { l1Categories: tree.l1, l2Categories: tree.l2, l3Categories: tree.l3, outFile };
  } finally { tracker?.dispose(); await context.close(); }
}
