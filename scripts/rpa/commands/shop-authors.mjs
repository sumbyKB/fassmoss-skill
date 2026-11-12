// 店铺达人挖取命令：抓某店铺的带货达人明细（昵称/粉丝/贡献GMV/销量/GPM），按贡献排序。
// 用于「从竞品店铺挖达人」，数据源是店铺详情页的 /api/shop/v3/author 接口。店铺名/国家/前N均为变量。
import fs from 'node:fs';
import path from 'node:path';
import { BASE, SKILL_ROOT, resolveCountry } from '../lib/config.mjs';
import { log } from '../lib/cli.mjs';
import { openBrowser, assertLoggedIn, switchCountry, assertPageAccess } from '../lib/browser.mjs';
import { resolveShopId } from '../lib/shop.mjs';
import { makeTracker, waitTracked } from '../lib/tracker.mjs';
import { cell, money } from '../lib/report.mjs';

const SHOP_SEARCH = `${BASE}/shop-marketing/search`;
const SHOP_DETAIL = `${BASE}/shop-marketing/detail`;

/** 从 author 接口响应收集达人 */
export function collectAuthors(body, out) {
  const j = JSON.parse(body);
  const list = j.data?.list || [];
  for (const a of list) {
    if (!a.uid) continue;
    out.push({
      uid: String(a.uid),
      nickname: a.nickname,
      handle: a.unique_id || null,
      follower_count: a.follower_count ?? null,
      product_count: a.product_count ?? null,
      sold_count: a.sold_count ?? null,
      sale_amount: a.sale_amount ?? null,
      video_gpm_min: a.aweme_min_gpm ?? null,
      video_gpm_max: a.aweme_max_gpm ?? null,
      live_gpm_min: a.live_gpm_min ?? null,
      live_gpm_max: a.live_gpm_max ?? null,
      category: a.author_category_name || null,
      fastmoss_url: `${BASE}/influencer/detail/${a.uid}`,
    });
  }
}

/** shop-authors：挖某店铺的带货达人清单。店铺名/国家/前N均为变量。 */
export async function cmdShopAuthors(opts) {
  const shopName = opts.shop || opts['shop-name'] || (Array.isArray(opts._) ? opts._[0] : null);
  const shopId = opts['shop-id'] || opts.id || null;
  if (!shopName && !shopId) throw new Error('缺少店铺名或 ID：node scripts/rpa/fastmoss-rpa.mjs shop-authors --shop <店铺名> [--country 泰国] [--top 20]');
  const top = Math.max(1, Number(opts.top || 20));
  const outFile = path.resolve(opts.out || path.join(SKILL_ROOT, 'outputs', `shop-authors-${(shopName || shopId).replace(/[^\w.-]/g, '_')}-${Date.now()}.json`));
  if (!outFile.toLowerCase().endsWith('.json')) throw new Error('--out 请使用 .json 文件名');
  const reportFile = outFile.slice(0, -5) + '.md';
  const t0 = Date.now();

  const { context, launchMs } = await openBrowser({ headed: opts.headed === true || opts.headed === 'true' });
  await assertLoggedIn(context.pages()[0], SHOP_SEARCH);
  const country = opts.country ? await switchCountry(context.pages()[0], opts.country) : null;
  const currency = country ? resolveCountry(country).currency : (opts.currency || 'THB');
  const page = context.pages()[0];

  const resolvedId = shopId || (await resolveShopId(page, shopName));

  // 打开详情页，监听 author 接口（页面自然发出，带签名）
  const authorTracker = makeTracker(page, '/api/shop/v3/author');
  await page.goto(`${SHOP_DETAIL}/${resolvedId}`, { waitUntil: 'domcontentloaded' });
  const firstBody = await waitTracked(authorTracker, (v) => { try { return Array.isArray(JSON.parse(v)?.data?.list); } catch { return false; } }, { timeout: 15000, check: () => assertPageAccess(page) });
  if (!firstBody) { authorTracker.dispose(); throw new Error('未拿到店铺达人数据'); }

  const authors = [];
  collectAuthors(firstBody, authors);
  const total = JSON.parse(firstBody).data?.total;
  log(`店铺达人第一页 ${authors.length} 个（总数 ${total ?? '?'}），继续翻页取前 ${top}`);

  // 翻页拿更多（author 每页 5 个），点到前 top 或翻不动为止
  const pagesNeeded = Math.ceil(top / 5);
  let stopped = null;
  try {
    for (let p = 2; p <= pagesNeeded && authors.length < top; p++) {
      const previousUrl = new URL(authorTracker.url());
      const params = {};
      for (const key of ['id', 'shop_id']) if (previousUrl.searchParams.has(key)) params[key] = previousUrl.searchParams.get(key);
      if (previousUrl.searchParams.has('page')) params.page = Number(previousUrl.searchParams.get('page')) + 1;
      authorTracker.reset(params);
      const clicked = await page.evaluate((n) => {
        const items = [...document.querySelectorAll('li.ant-pagination-item, li[class*="pagination-item"]')].filter((li) => (li.innerText || '').trim() === String(n));
        if (!items.length) return false;
        (items[items.length - 1].querySelector('a') || items[items.length - 1]).click();
        return true;
      }, p).catch(() => false);
      if (!clicked) { log(`第 ${p} 页翻页按钮未找到，停止（已拿 ${authors.length} 个）`); break; }
      const body = await waitTracked(authorTracker, (v) => { try { return Array.isArray(JSON.parse(v)?.data?.list); } catch { return false; } }, { timeout: 10000, check: () => assertPageAccess(page) });
      if (!body) { log(`第 ${p} 页未返回数据，停止`); break; }
      collectAuthors(body, authors);
    }
  } catch (error) {
    if (error.code !== 'FASTMOSS_BLOCKED') throw error;
    stopped = error;
  } finally { authorTracker.dispose(); }

  // 去重（可能翻页重叠）+ 按贡献 GMV 排序 + 取前 top
  const byUid = new Map();
  for (const a of authors) if (a.uid && !byUid.has(a.uid)) byUid.set(a.uid, a);
  const list = [...byUid.values()].sort((a, b) => (b.sale_amount ?? 0) - (a.sale_amount ?? 0)).slice(0, top);

  const result = {
    collected_at: new Date().toISOString(),
    shop_name: shopName || null,
    shop_id: resolvedId,
    country: country || null,
    currency,
    total_authors: total ?? null,
    collected: list.length,
    authors: list,
    status: stopped ? 'blocked' : list.length < Math.min(top, total ?? top) ? 'partial' : 'complete',
    stopped_reason: stopped?.message || null,
    timings: { launchMs, totalMs: Date.now() - t0 },
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(reportFile, renderShopAuthorsReport(result), 'utf8');
  log(`写出 ${outFile} / ${reportFile}`);
  await context.close();
  if (stopped) throw stopped;
  return { result, outFile, reportFile };
}

/** 生成达人清单报告（数据驱动） */
export function renderShopAuthorsReport(r) {
  const moneyOf = (n) => money(n, r.currency);
  const lines = [
    `# ${r.shop_name || r.shop_id} 带货达人清单（按贡献 GMV 排序）`,
    '',
    `> 采集 ${(r.collected_at || '').slice(0, 10)} · 国家 ${r.country || '未知'} · 币种 ${r.currency} · 达人总数 ${r.total_authors ?? '?'} · 已采集前 ${r.collected} 位`,
    '',
    '| 排名 | 达人 | 粉丝 | 带货GMV | 销量 | 带货商品数 | 视频GPM | 直播GPM | 链接 |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  r.authors.forEach((a, i) => {
    const gpm = (a.video_gpm_min != null || a.video_gpm_max != null) ? `${a.video_gpm_min ?? '?'}~${a.video_gpm_max ?? '?'}` : '—';
    const liveGpm = (a.live_gpm_min != null || a.live_gpm_max != null) ? `${a.live_gpm_min ?? '?'}~${a.live_gpm_max ?? '?'}` : '—';
    const fans = a.follower_count != null ? (a.follower_count >= 10000 ? (a.follower_count / 10000).toFixed(2) + '万' : a.follower_count) : '—';
    lines.push(`| ${i + 1} | ${cell(a.nickname)} | ${fans} | ${moneyOf(a.sale_amount)} | ${cell(a.sold_count)} | ${cell(a.product_count)} | ${gpm} | ${liveGpm} | [FastMoss](${a.fastmoss_url}) |`);
  });
  lines.push('', `状态：${r.status}。${r.stopped_reason ? '采集停止：' + cell(r.stopped_reason) : ''}`);
  lines.push('', '---', '', '*达人 GMV/销量为该店铺内的贡献口径（非达人全平台）；GPM 为视频/直播千次播放销售额区间；数据可追溯至 JSON 产物。*');
  return lines.join('\n');
}
