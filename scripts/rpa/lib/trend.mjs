import { parseAmount } from '../data-rules.mjs';

const DAY = 86400000;
export function validateCompareDays(value = 30) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 45) {
    throw new Error('--days 必须为1到45的整数：90天数据最多比较两个45天周期');
  }
  return Number(value);
}

function dayNumber(value) {
  const match = String(value ?? '').match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const stamp = Date.UTC(year, month - 1, day);
  const canonical = new Date(stamp).toISOString().slice(0, 10).replaceAll('-', '');
  return canonical === match.slice(1).join('') ? stamp / DAY : null;
}

/** 日期连续、两期等长且指标完整时才计算；产品可沿用店铺的同一个截止日。 */
export function comparePeriod(trend, value, endDate) {
  const days = validateCompareDays(value);
  const rows = Array.isArray(trend) ? trend : [];
  const byDay = new Map();
  let invalid = null;
  for (const row of rows) {
    const date = dayNumber(row.dt);
    if (date === null || byDay.has(date)) { invalid = '趋势日期无效或重复'; break; }
    byDay.set(date, row);
  }
  const dates = [...byDay.keys()].sort((a, b) => a - b);
  const toDate = stamp => stamp == null ? null : new Date(stamp * DAY).toISOString().slice(0, 10);
  const end = endDate === undefined ? dates.at(-1) : dayNumber(endDate);
  const result = { complete: false, reason: null, cur: null, prev: null, sold_pct: null, amount_pct: null, trend_days: dates.length, first_date: toDate(dates[0]), last_date: toDate(dates.at(-1)), comparison_end: toDate(end) };
  if (invalid || end == null) return { ...result, reason: invalid || '趋势日期缺失' };
  const points = [];
  for (let date = end - 2 * days + 1; date <= end; date++) {
    const row = byDay.get(date);
    if (!row) return { ...result, reason: '数据未覆盖两个连续完整周期' };
    const sold = parseAmount(row.inc_sold_count);
    const amount = parseAmount(row.inc_sale_amount);
    if (sold === null || amount === null || !Number.isFinite(sold) || !Number.isFinite(amount)) return { ...result, reason: '逐日销量或销售额缺失' };
    points.push({ sold, amount });
  }
  const sum = list => list.reduce((total, point) => ({ sold: total.sold + point.sold, amount: Math.round((total.amount + point.amount) * 100) / 100 }), { sold: 0, amount: 0 });
  const prev = sum(points.slice(0, days));
  const cur = sum(points.slice(days));
  const pct = (current, previous) => previous > 0 ? (current - previous) / previous * 100 : null;
  return { ...result, complete: true, cur, prev, sold_pct: pct(cur.sold, prev.sold), amount_pct: pct(cur.amount, prev.amount), previous_start: toDate(end - 2 * days + 1), previous_end: toDate(end - days), current_start: toDate(end - days + 1), current_end: toDate(end) };
}
