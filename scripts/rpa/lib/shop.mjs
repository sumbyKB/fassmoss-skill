// 店铺共享函数：搜索店铺名拿 ID、抓店铺详情页总览 8 项。
// 多个店铺相关命令（shop-trend/shop-compare/shop-authors/shop-insight）统一从这里复用。

import { BASE } from './config.mjs';
import { log } from './cli.mjs';
import { safeEval, assertPageAccess } from './browser.mjs';
import { makeTracker, waitTracked } from './tracker.mjs';
import { findBrandIndex } from '../data-rules.mjs';

const SHOP_SEARCH = `${BASE}/shop-marketing/search`;

/** 店铺详情页总览 8 项（含分类排名，即「某类目里排第几」） */
const OVERVIEW_LABELS = ['总销量', '总销售额', '在售商品数', '全国排名', '带货直播数', '带货视频数', '带货达人数', '分类排名'];

/** 搜索店铺名 → 店铺 ID（复用 shop-detail 的搜索逻辑，但只取 ID） */
export async function resolveShopId(page, shopName) {
  if (new URL(page.url()).pathname !== new URL(SHOP_SEARCH).pathname) await page.goto(SHOP_SEARCH, { waitUntil: 'domcontentloaded' });
  const input = await page.waitForSelector('input[placeholder*="店铺"]', { timeout: 15000 }).catch(() => null);
  if (!input) throw new Error('找不到店铺搜索框，可能未登录或页面结构变化');
  const tracker = makeTracker(page, '/api/shop/v3/search');
  try {
    if ((await input.inputValue()).trim() !== String(shopName).trim()) {
      await input.fill(shopName);
      await input.press('Enter');
      const body = await waitTracked(tracker, value => { try { return !!JSON.parse(value).data; } catch { return false; } }, { check: () => assertPageAccess(page) });
      if (!body) throw new Error(`店铺「${shopName}」的搜索未完成`);
    }
    await page.waitForFunction(target => {
      if (document.querySelector('.ant-spin-spinning, .ant-spin-blur')) return false;
      const names = [...document.querySelectorAll('table tbody a[href*="/shop-marketing/detail/"]')].map(a => a.innerText.toLowerCase());
      return names.some(name => name.includes(target)) || !!document.querySelector('.ant-empty');
    }, String(shopName).trim().toLowerCase(), { timeout: 15000 });
    await assertPageAccess(page);
    const rows = await safeEval(page, () => [...document.querySelectorAll('table tbody a[href*="/shop-marketing/detail/"]')].map(a => ({
      id: a.pathname.match(/\/detail\/(\d+)\/?$/)?.[1],
      name: (a.querySelector('.paragraph-text, [class*="paragraph-text"], h3')?.innerText || a.innerText.split('\n')[0]).trim(),
    })).filter(row => row.id));
    const id = selectShopResult(rows, shopName).id;
    log(`搜索「${shopName}」命中店铺 ${id}`);
    return id;
  } finally { tracker.dispose(); }
}

export function selectShopResult(rows, shopName) {
  const unique = [...new Map(rows.map(row => [row.id, row])).values()];
  const index = findBrandIndex(unique, shopName, row => row.name);
  if (index < 0) throw new Error(`未找到店铺「${shopName}」`);
  return unique[index];
}

/** 只在商品表自己的容器内翻页或选择周期，找不到独立容器时保留部分覆盖说明。 */
function goodsControls({ advance = false } = {}) {
  const table = [...document.querySelectorAll('table')].find(t => t.querySelector('a[href*="/e-commerce/detail/"]'));
  for (let root = table?.parentElement; root && root !== document.body; root = root.parentElement) {
    if ([...root.querySelectorAll('table')].filter(t => t.querySelector('tbody a[href*="/e-commerce/detail/"]')).length > 1) break;
    const next = root.querySelector('li.ant-pagination-next');
    const radio = root.querySelector('input[type=radio][value="90"]');
    if (!next && !radio) continue;
    const canNext = !!next && !next.classList.contains('ant-pagination-disabled') && next.getAttribute('aria-disabled') !== 'true';
    if (advance && canNext) (next.querySelector('a,button') || next).click();
    return { canNext, clicked: advance && canNext, periodRootId: radio && root.id ? root.id : null, period90Checked: !!radio?.checked, paginationFound: !!next };
  }
  return { canNext: false, clicked: false, paginationFound: false, periodRootId: null };
}

export async function collectShopProducts(page, tracker, { maxPages = 100 } = {}) {
  const wait = () => waitTracked(tracker, body => { try { return Array.isArray(JSON.parse(body)?.data?.product_list); } catch { return false; } }, { check: () => assertPageAccess(page) });
  let body = await wait();
  if (!body) throw new Error('未拿到店铺商品列表');
  let controls = await safeEval(page, goodsControls);
  let uiPeriod = null;
  if (controls.periodRootId) {
    const radio = page.locator(`[id=${JSON.stringify(controls.periodRootId)}]`).getByRole('radio', { name: '近90天', exact: true });
    if (!controls.period90Checked) {
      tracker.reset();
      await radio.check();
      body = await wait();
      if (!body) throw new Error('店铺商品历史周期刷新失败');
      if (await radio.isChecked()) uiPeriod = 90;
    }
  }
  const address = tracker.url() ? new URL(tracker.url()) : null;
  const period = uiPeriod || Number(address?.searchParams.get('date_type') || address?.searchParams.get('d_type')) || null;
  const products = new Map();
  let pagesRead = 0;
  let total = null;
  let complete = false;
  let reason = null;
  while (body && pagesRead < maxPages) {
    const data = JSON.parse(body).data;
    const declaredTotal = data.total ?? data.total_count;
    if (declaredTotal != null && Number.isSafeInteger(Number(declaredTotal)) && Number(declaredTotal) >= 0) total = Number(declaredTotal);
    const before = products.size;
    for (const product of data.product_list) {
      const rawId = product.product_id ?? product.id;
      if (rawId == null || (typeof rawId === 'number' && !Number.isSafeInteger(rawId))) continue;
      const id = String(rawId);
      if (/^\d+$/.test(id)) products.set(id, { ...product, product_id: id });
    }
    pagesRead++;
    if (total !== null && products.size >= total) { complete = true; break; }
    if (pagesRead > 1 && products.size === before) { reason = '商品分页重复，已停止'; break; }
    controls = await safeEval(page, goodsControls);
    if (!controls.canNext) {
      complete = controls.paginationFound && (total === null || products.size >= total);
      if (!complete) reason = '商品清单总量或分页结束状态未确认';
      break;
    }
    if (pagesRead >= maxPages) { reason = '已达商品分页上限'; break; }
    tracker.reset();
    if (!(await safeEval(page, goodsControls, { advance: true })).clicked) { reason = '商品下一页未生效'; break; }
    body = await wait();
    if (!body) { reason = '商品下一页未返回'; break; }
  }
  return { products: [...products.values()], coverage: { pages_read: pagesRead, products_collected: products.size, total, pagination_complete: complete, period_days: period, historical_coverage_complete: complete && period === 90, reason } };
}

/** 抓店铺详情页总览 8 项（DOM：数值在标签前面的卡片里） */
export async function grabShopOverview(page) {
  // 先滚动一屏，触发总览卡片渲染（懒加载）
  await page.evaluate(() => window.scrollTo(0, 600)).catch(() => {});
  await page.waitForTimeout(500);
  return await safeEval(page, (labels) => {
    const overview = {};
    for (const label of labels) {
      const labelEl = [...document.querySelectorAll('span,div')].find((e) => (e.innerText || '').trim() === label && e.children.length === 0);
      if (!labelEl) { overview[label] = ''; continue; }
      let card = labelEl.parentElement;
      for (let i = 0; i < 5 && card; i++) { if ((card.className || '').includes('px-4')) break; card = card.parentElement; }
      let val = '';
      if (card) {
        const nodes = [...card.querySelectorAll('*')].filter((e) => e.children.length === 0);
        const idx = nodes.indexOf(labelEl);
        for (let j = idx - 1; j >= 0; j--) {
          const txt = (nodes[j].innerText || '').trim();
          if (txt && txt !== label && !txt.includes('品类均值') && !txt.includes('历史商品') && !txt.includes('同行增速')) { val = txt; break; }
        }
        // 兜底：整卡片文本里抓数字
        if (!val) {
          const cardTxt = (card.innerText || '').replace(/\n/g, ' ').trim();
          const m = cardTxt.match(/([\d.]+万|[\d.]+亿|[\d.]+)/);
          if (m) val = m[1];
        }
      }
      overview[label] = val;
    }
    return overview;
  }, labels);
}
