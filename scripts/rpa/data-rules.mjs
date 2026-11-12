export const BAG_CATEGORY = /箱包|手袋|钱包|托特|双肩包|斜挎包|单肩包|手拿包|手拎包|化妆包|洗漱包|\b(?:handbags?|totes?|backpacks?|purses?|bags?|satchels?|clutches)\b|กระเป๋า|ย่าม/i;

export function moduleLoaded(state, responseReceived, stableHits) {
  return responseReceived && (state === 'data' || (state === 'empty' && stableHits >= 2));
}

export function stripCurrency(value) {
  return String(value).replace(/MX\$|S\$|R\$|RM|Rp|[$,฿₫₱¥€£\s]/g, '');
}

export function parseAmount(value) {
  if (value == null) return null;
  let text = stripCurrency(value);
  const multiplier = text.endsWith('亿') ? 1e8 : text.endsWith('万') ? 1e4 : 1;
  text = text.replace(/[万亿]$/, '');
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  const amount = Number(text) * multiplier;
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null;
}

/** 页面售价区间；保留千分位和币种，不把无价格当作0。 */
export function parsePriceRange(value) {
  const parts = stripCurrency(value).split(/[-–—~]/);
  if (parts.length > 2) return null;
  const values = parts.map(parseAmount);
  if (values.some(n => n === null || !Number.isFinite(n) || n < 0)) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
}

export function findBrandIndex(rows, query, nameOf) {
  const normalize = value => String(value || '').trim().toLowerCase();
  const target = normalize(query);
  const exact = rows.map((row,index)=>({index,name:normalize(nameOf(row))})).filter(x=>x.name && x.name===target);
  if (exact.length === 1) return exact[0].index;
  const matches = rows.map((row,index)=>({index,name:normalize(nameOf(row))})).filter(x=>x.name && (x.name.includes(target)||target.includes(x.name)));
  if (exact.length > 1 || matches.length > 1) throw new Error('品牌匹配存在歧义，请使用完整名称：' + query);
  if (matches.length === 1) return matches[0].index;
  throw new Error('未找到指定品牌：' + query);
}
