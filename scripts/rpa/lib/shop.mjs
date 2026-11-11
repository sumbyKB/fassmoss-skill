// 店铺共享函数：搜索店铺名拿 ID、抓店铺详情页总览 8 项。
// 多个店铺相关命令（shop-trend/shop-compare/shop-authors/shop-insight）统一从这里复用。

import { BASE } from './config.mjs';
import { log } from './cli.mjs';
import { safeEval } from './browser.mjs';

const SHOP_SEARCH = `${BASE}/shop-marketing/search`;

/** 店铺详情页总览 8 项（含分类排名，即「某类目里排第几」） */
const OVERVIEW_LABELS = ['总销量', '总销售额', '在售商品数', '全国排名', '带货直播数', '带货视频数', '带货达人数', '分类排名'];

/** 搜索店铺名 → 店铺 ID（复用 shop-detail 的搜索逻辑，但只取 ID） */
export async function resolveShopId(page, shopName) {
  await page.goto(SHOP_SEARCH, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const input = await page.waitForSelector('input[placeholder*="店铺"]', { timeout: 15000 }).catch(() => null);
  if (!input) throw new Error('找不到店铺搜索框，可能未登录或页面结构变化');
  await input.fill(shopName);
  await input.press('Enter');
  await page.waitForTimeout(5000);
  const link = await page.waitForSelector('a[href*="/shop-marketing/detail/"]', { timeout: 15000 }).catch(() => null);
  if (!link) throw new Error(`未找到店铺「${shopName}」的搜索结果`);
  const href = await link.getAttribute('href');
  const id = href.split('/').pop();
  log(`搜索「${shopName}」命中店铺 ${id}`);
  return id;
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
