import { parseAmount } from '../data-rules.mjs';

export function isPhoneCase(value) {
  const name = String(value || '').split(/售价[：:]|上架时间[：:]/)[0];
  return /\b(case|cases|cover|casing|shell|bumper)\b/i.test(name) && /phone|iphone|smartphone|samsung|galaxy|pixel|mag-?safe|手机/i.test(name) && !/screen\s*protector|tempered|glass|film|privacy|\blens\b|贴膜|保护膜|power\s*bank|charger|curtain|earbuds?/i.test(name);
}

export function salesTrend(value) {
  const match = String(value ?? '').trim().match(/^([+-]?\d+(?:\.\d+)?)%$/);
  const percent = match ? Number(match[1]) : null;
  return { wow_pct: percent, trend: percent === null ? '未知' : percent > 5 ? '上升' : percent < -5 ? '下滑' : '稳定' };
}

/** 最近3日与之前4日必须来自同一个完整、连续的近7天逐日序列。 */
export function dailySalesTrend(rows, expectedEnd) {
  const unknown = reason => ({ trend: '未知', reason, units_7d: null, recent_3d_units: null, previous_4d_units: null, ratio: null });
  if (!Array.isArray(rows) || rows.length < 7) return unknown('近7天逐日数据不足');
  const days = new Map();
  for (const row of rows) {
    const date = String(row.dt || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return unknown('逐日日期缺失');
    const time = Date.parse(date + 'T00:00:00Z');
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date || days.has(date)) return unknown('逐日日期无效或重复');
    const count = parseAmount(row.inc_sold_count);
    if (count === null || !Number.isFinite(count) || count < 0) return unknown('逐日销量缺失或异常');
    days.set(date, count);
  }
  const sorted = [...days.keys()].sort();
  const end = sorted.at(-1);
  if (expectedEnd && expectedEnd !== end) return unknown('逐日数据截止日与页面周期不一致');
  const values = [];
  for (let offset = 6; offset >= 0; offset--) {
    const date = new Date(Date.parse(end + 'T00:00:00Z') - offset * 86400000).toISOString().slice(0, 10);
    if (!days.has(date)) return unknown('近7天日期不连续');
    values.push(days.get(date));
  }
  const previous = values.slice(0, 4).reduce((a, b) => a + b, 0);
  const recent = values.slice(4).reduce((a, b) => a + b, 0);
  const ratio = previous > 0 ? (recent / 3) / (previous / 4) : null;
  return { trend: previous === 0 ? recent > 0 ? '新近起量' : '稳定' : ratio > 1.1 ? '上升' : ratio < 0.9 ? '下滑' : '稳定', reason: previous === 0 ? recent > 0 ? '前4日零销量、最近3日有销量' : '近7天零销量' : null, units_7d: previous + recent, recent_3d_units: recent, previous_4d_units: previous, ratio, period_start: sorted.at(-7), period_end: end };
}

export function verifiedNewTrend(row) {
  if (row.error || ['blocked', 'error', 'not_attempted'].includes(row.status)) return { trend: '未知', reason: row.error || '详情未完成', units_7d: null };
  return row.period_verified === true && row.period_days === 7 ? dailySalesTrend(row.daily_trend, row.period_end) : { trend: '未知', reason: row.error || '缺少近7天周期与逐日证据', units_7d: null };
}

export function safeProductLink(value) {
  try {
    const url = new URL(value, 'https://www.fastmoss.com');
    return url.origin === 'https://www.fastmoss.com' && /^\/zh\/e-commerce\/detail\/\d+\/?$/.test(url.pathname) ? url.origin + url.pathname : null;
  } catch { return null; }
}

/** 分析和两种报告共用同一规则；历史结果缺周期证据时不沿用旧的上涨标签。 */
export function preparePhonecaseReport(result) {
  const salesRows = (result.sales_top50 || []).map(row => ({ ...row, ...salesTrend(row.units_wow), source_url: safeProductLink(row.source_url) }));
  const newRows = (result.new_top50 || []).map(row => ({ ...row, ...verifiedNewTrend(row), source_url: safeProductLink(row.source_url) }));
  const tally = rows => rows.reduce((counts, row) => { counts[row.trend]++; return counts; }, { 上升: 0, 新近起量: 0, 稳定: 0, 下滑: 0, 未知: 0 });
  return { salesRows, newRows, st: tally(salesRows), nt: tally(newRows) };
}
