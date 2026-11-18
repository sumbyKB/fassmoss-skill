// 商品详情近7天读取：任意类目复用同一周期校验，不进行手机壳过滤。
import { BASE } from './config.mjs';
import { safeEval, assertPageAccess } from './browser.mjs';
import { makeTracker, waitTracked } from './tracker.mjs';
import { parseAmount } from '../data-rules.mjs';
import { dailySalesTrend } from './product-trend.mjs';

export function productIdentitySnapshot() {
  const root = document.querySelector('#overview');
  const cards = [...(root?.querySelectorAll('label[aria-label]') || [])].map(card => [...card.querySelectorAll('p')].map(p => p.innerText.trim()));
  return { product: document.querySelector('h1')?.innerText.trim() || null, author_count_raw: cards.find(parts => /^(带货达人数|关联达人数|带货达人|关联达人|达人数)$/.test(parts.at(-1)))?.[0] ?? null };
}

export function detailUnitsSnapshot() {
  const root = document.querySelector('#overview');
  if (!root) return null;
  const card = root.querySelector('label[aria-label="sold_count_show"]') || root.querySelector('input[value="sold_count_show"]')?.closest('label');
  const checked = root.querySelector('input[type=radio]:checked');
  return { period_days: checked ? Number(checked.value) : null, raw: card?.querySelector('p')?.innerText.trim() ?? null, dates: [...root.querySelectorAll('input')].map(input => input.value).filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value)), busy: !!root.querySelector('.ant-spin-spinning, .ant-spin-blur') };
}

/** 只使用总览自身的7天控件与同一商品、同一周期响应，不读取全页第一个“销量”。 */
export async function scrapeDetail7d(page, id) {
  if (!/^\d+$/.test(String(id))) throw new Error('商品ID无效');
  const tracker = makeTracker(page, '/api/goods/v3/overview', { product_id: String(id) });
  try {
    await page.goto(`${BASE}/e-commerce/detail/${id}`, { waitUntil: 'domcontentloaded' });
    await assertPageAccess(page);
    await page.locator('#overview').waitFor({ state: 'attached', timeout: 15000 });
    const initial = await safeEval(page, detailUnitsSnapshot);
    if (initial?.period_days !== 7) {
      tracker.reset({ product_id: String(id), d_type: 7 });
      // 实站的radio输入本体宽度为0；点击可见文字标签，随后仍核对选中值与响应周期。
      await page.locator('#overview').getByText('近7天', { exact: true }).first().click();
    }
    const body = await waitTracked(tracker, value => {
      try { return new URL(tracker.url()).searchParams.get('d_type') === '7' && Array.isArray(JSON.parse(value)?.data?.chart_list); } catch { return false; }
    }, { check: () => assertPageAccess(page) });
    if (!body) throw new Error('近7天数据未返回');
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      await assertPageAccess(page);
      const snapshot = await safeEval(page, detailUnitsSnapshot);
      if (snapshot?.period_days === 7 && !snapshot.busy) {
        const daily = JSON.parse(body).data.chart_list;
        const summary = dailySalesTrend(daily, snapshot.dates.at(-1));
        const displayed = parseAmount(snapshot.raw);
        const abbreviation = String(snapshot.raw || '').match(/\d+(?:\.(\d+))?([万亿])/);
        const tolerance = abbreviation ? (abbreviation[2] === '亿' ? 1e8 : 1e4) / (10 ** (abbreviation[1]?.length || 0)) / 2 : 0;
        const cardConsistent = summary.units_7d !== null && displayed !== null ? Math.abs(displayed - summary.units_7d) <= tolerance : null;
        // 实站新品卡片可能与已确认日期的逐日序列不同；两者分列，绝不拿卡片反改序列。
        const warning = cardConsistent === false ? '总览销量卡与同日期逐日合计不同；本次近7天销量采用逐日序列，卡片原值另存' : null;
        const identity = await safeEval(page, productIdentitySnapshot);
        return { ...identity, author_count: parseAmount(identity.author_count_raw), period_days: 7, period_verified: true, period_start: snapshot.dates[0] || summary.period_start || null, period_end: snapshot.dates.at(-1) || summary.period_end || null, units_7d_raw: cardConsistent === true ? snapshot.raw : null, card_units_raw: snapshot.raw, card_consistent: cardConsistent, warning, units_source: 'detail_7d_daily_sum', daily_trend: daily.map(row => ({ dt: row.dt, inc_sold_count: row.inc_sold_count })), ...summary };
      }
      await page.waitForTimeout(100);
    }
    throw new Error('详情页近7天周期未确认');
  } finally { tracker.dispose(); }
}

