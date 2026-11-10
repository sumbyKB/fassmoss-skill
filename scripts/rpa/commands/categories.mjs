// 分类树命令：抓「一级/二级分类名 → ID」映射（商品榜/店铺榜分类筛选的关键参数）。
import fs from 'node:fs';
import path from 'node:path';
import { BASE, SKILL_ROOT } from '../lib/config.mjs';
import { log } from '../lib/cli.mjs';
import { openBrowser, assertLoggedIn, switchCountry } from '../lib/browser.mjs';

const SHOP_BASE = `${BASE}/shop-marketing/search`;

/** categories：抓完整分类树（一级 + 二级，含分类 ID），供 product/shop/category-roi 做分类筛选。 */
export async function cmdCategories(opts) {
  const outFile = opts.out || path.join(SKILL_ROOT, 'outputs', 'categories.json');
  const t0 = Date.now();
  const { context, launchMs } = await openBrowser({ headed: opts.headed === true || opts.headed === 'true' });
  await assertLoggedIn(context.pages()[0]);
  const country = opts.country ? await switchCountry(context.pages()[0], opts.country) : null;
  const page = context.pages()[0];

  // 完整分类树来自店铺页的 categoryInfo 接口（返回一级 + 二级分类，含 c_code=分类 ID）。
  // 用 page.on('response') 同步捕获 body（避免 SPA 二次跳转导致响应体被清理）。
  let captured = null;
  page.on('response', async (res) => {
    if (res.url().includes('/api/shop/V3/categoryInfo') && !captured) {
      try { captured = await res.text(); } catch (e) { /* 导航清理，忽略 */ }
    }
  });
  await page.goto(`${SHOP_BASE}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  let l1Categories = [];
  let l2Categories = [];
  if (captured) {
    try {
      const j = JSON.parse(captured);
      const cats = (j.data && j.data.category) || [];
      l1Categories = cats.map((c) => ({ code: c.c_code, name: c.c_name, rank: c.rank }));
      for (const c of cats) {
        for (const s of (c.sub || [])) {
          l2Categories.push({ code: s.c_code, name: s.c_name, parent_code: c.c_code, parent_name: c.c_name });
        }
      }
    } catch (e) {
      log(`解析 categoryInfo 失败：${String(e).slice(0, 100)}`);
    }
  }

  const result = {
    collected_at: new Date().toISOString(),
    country: country || null,
    source: `${SHOP_BASE} 的 /api/shop/V3/categoryInfo 接口（完整分类树，含 ID）`,
    l1_categories: l1Categories,   // [{code, name, rank}]  一级分类，code 即 l1_cid
    l2_categories: l2Categories,   // [{code, name, parent_code, parent_name}]  二级分类
    note: '一级分类 code 即商品榜 l1_cid；二级分类 code 可用于更细筛选（如「运动鞋」在「运动与户外」下）。「跑步鞋」无独立分类，对应「运动与户外(9)→运动鞋」或「鞋靴(6)」。',
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf8');
  log(`分类树抓取完成：${l1Categories.length} 个一级分类 + ${l2Categories.length} 个二级分类，${Date.now() - t0} ms`);
  log(`写出 ${outFile}`);
  await context.close();
  return { l1Categories, l2Categories, outFile };
}
