// 报告工具函数：markdown 单元格转义、文本截断、金额/百分比格式化。
// 各命令的报告渲染统一从这里复用，避免重复实现。

/** markdown 单元格转义：空值转「—」，转义竖线、压缩空白 */
export function cell(v) {
  return String(v ?? '—').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

/** 文本截断（超长加省略号） */
export function short(v, n = 40) {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/** 金额格式化：万/亿缩写 + 币种符号。n 为数值，currency 为币种代码（THB→฿ 等）。 */
export function money(n, currency) {
  if (n == null) return '—';
  const abs = Math.abs(n);
  const num = abs >= 1e8 ? (n / 1e8).toFixed(2) + '亿' : abs >= 1e4 ? (n / 1e4).toFixed(2) + '万' : String(Math.round(n));
  const symbol = currency === 'THB' ? '฿' : (currency || '');
  return num + symbol;
}

/** 百分比格式化：带正负号，null 转「—」 */
export function pct(v) {
  return v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}
