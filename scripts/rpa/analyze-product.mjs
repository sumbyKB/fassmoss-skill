#!/usr/bin/env node
/**
 * 商品榜离线分析：把 fastmoss-rpa.mjs product 抓下来的 products.json 变成
 * 品牌对比 + 价格带分档 + 销售金额排序 的结构化报告。
 *
 *   node scripts/rpa/analyze-product.mjs --dir outputs/<批次> --category 跑步鞋 --brand 我们品牌名 [--top 20]
 *
 * 输入：<dir>/products.json（product 命令产出）
 * 输出：<dir>/brand-comparison.md + brand-comparison.json
 *
 * 能力（对应业务大白话）：
 *   1. 细分品类销售分析（按销售金额排序）—— --category 关键词过滤「商品分类」字段，按 gmv 降序。
 *   2. 品牌对比 —— --brand 指定本品牌，自动找出「销售额排名相近」的竞品品牌（前后各 N 名）。
 *   3. 价格带分档 —— 从商品 price_raw（如 ฿54-400）提取价格区间，按价格带聚合。
 *
 * 原则：数字全部从数据算出；「所属店铺」≈品牌（泰国品牌名常=店铺名）；未知字段留 null 不编造。
 */
import fs from 'node:fs';
import { parseAmount, stripCurrency, findBrandIndex, BAG_CATEGORY } from './data-rules.mjs';
import path from 'node:path';

const args = process.argv.slice(2);
const getArg = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};

const DIR = path.resolve(getArg('dir', 'outputs/latest'));
const CATEGORY = getArg('category', null);       // 细分品类关键词，如「跑步鞋」
const BRAND = getArg('brand', null);             // 本品牌名（=所属店铺名）
const TOP = Number(getArg('top', 20));
const NEARBY = Number(getArg('nearby', 5));      // 本品牌前后各取 N 个竞品

// 金额解析：剥离货币符号（$ ฿ Rp 等），处理「万/亿」
const num = parseAmount;

// 价格带：从 price_raw（如 "฿54.00 - 400.00" 或 "฿66.00"）提取 [min, max, mid]
const priceBand = (raw) => {
  if (!raw) return null;
  const m = stripCurrency(raw).match(/\d+(\.\d+)?/g);
  if (!m) return null;
  const nums = m.map(Number);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return { min, max, mid: +((min + max) / 2).toFixed(2) };
};

// 价格带分档（可配置档位，默认按商品中位价）
// 马来西亚站（MYR）档位：低价<30 / 中价30-80 / 中高价80-200 / 高价≥200 RM
const TIERS = [
  { name: '低价带', min: 0, max: 30 },        // < 30 RM
  { name: '中价带', min: 30, max: 80 },       // 30 - 80 RM
  { name: '中高价带', min: 80, max: 200 },    // 80 - 200 RM
  { name: '高价带', min: 200, max: Infinity },// ≥ 200 RM
];
function tierOf(mid) {
  if (mid == null) return '未知';
  for (const t of TIERS) if (mid >= t.min && mid < t.max) return t.name;
  return '高价带';
}

/* ---------------- 读数据 ---------------- */
// 商品数据文件：优先 --products 显式指定，否则自动找目录里的 products*.json
let productsFile = getArg('products', null);
if (!productsFile) {
  productsFile = path.join(DIR, 'products.json');
} else if (!path.isAbsolute(productsFile)) {
  productsFile = path.join(DIR, productsFile);
}
if (!fs.existsSync(productsFile)) throw new Error('缺商品数据文件：' + productsFile);
const raw = JSON.parse(fs.readFileSync(productsFile, 'utf8'));
const meta = raw.meta || {};
const products = (raw.products || []).map((p, i) => ({
  ...p,
  _rank: Number(p.rank) || i + 1,          // rank 兜底：空 rank 用位置
  gmvN: num(p.gmv),
  unitsN: num(p.units),
  totalGmvN: num(p.total_gmv),
  price: priceBand(p.price_raw),
}));

const CURRENCY = meta.currency || 'USD';
const SYM = { USD: '$', THB: '฿', IDR: 'Rp', VND: '₫', MYR: 'RM', PHP: '₱', JPY: '¥', SGD: 'S$', MXN: 'MX$', BRL: 'R$' }[CURRENCY] || CURRENCY + ' ';
const fmt = (n) => (n == null ? '—' : SYM + n.toLocaleString('en-US', { maximumFractionDigits: 0 }));

/* ---------------- 1. 细分品类过滤 + 销售金额排序 ---------------- */
let pool = products;
if (CATEGORY) {
  const kw = CATEGORY;
  pool = products.filter((p) => (p.category || '').includes(kw) || (p.product || '').includes(kw));
}
const sortedByGmv = [...pool].sort((a, b) => (b.gmvN ?? 0) - (a.gmvN ?? 0));

/* ---------------- 2. 品牌对比（排名相近） ---------------- */
// 按品牌（=所属店铺）聚合，计算品牌销售额
const brandMap = new Map();
for (const p of pool) {
  const brand = (p.shop || '').trim() || '未知品牌';
  if (!brandMap.has(brand)) brandMap.set(brand, { brand, gmv: 0, units: 0, productCount: 0, prices: [] });
  const b = brandMap.get(brand);
  b.gmv += p.gmvN ?? 0;
  b.units += p.unitsN ?? 0;
  b.productCount += 1;
  if (p.price?.mid != null) b.prices.push(p.price.mid);
}
const brands = [...brandMap.values()].sort((a, b) => b.gmv - a.gmv);
brands.forEach((b) => {
  b.avgPrice = b.prices.length ? +(b.prices.reduce((s, x) => s + x, 0) / b.prices.length).toFixed(2) : null;
  b.priceTier = tierOf(b.avgPrice);
});

// 本品牌 + 前后各 NEARBY 个竞品（按销售额排名）
let brandComparison = null;
if (BRAND) {
  const idx = findBrandIndex(brands, BRAND, b => b.brand);
  if (idx >= 0) {
    const lo = Math.max(0, idx - NEARBY);
    const hi = Math.min(brands.length, idx + NEARBY + 1);
    brandComparison = {
      target: brands[idx],
      targetRank: idx + 1,
      nearby: brands.slice(lo, hi).map((b, i) => ({ rank: lo + i + 1, ...b })),
    };
  }
}

/* ---------------- 3. 价格带分档 ---------------- */
const tierStat = new Map();
for (const p of pool) {
  const tier = tierOf(p.price?.mid);
  if (!tierStat.has(tier)) tierStat.set(tier, { tier, count: 0, gmv: 0, units: 0 });
  const t = tierStat.get(tier);
  t.count += 1; t.gmv += p.gmvN ?? 0; t.units += p.unitsN ?? 0;
}
const tiers = [...tierStat.values()].sort((a, b) => b.gmv - a.gmv);

/* ---------------- 输出 ---------------- */
const L = [];
const push = (s = '') => L.push(s);

push(`# 商品销售分析报告 · ${CATEGORY || '全品类'}`);
push('');
push(`> 数据源：\`${path.basename(DIR)}/products.json\` · 国家：${meta.country || '?'} · 币种：${CURRENCY}`);
push(`> 周期：date_type=${meta.date_type} date_value=${meta.date_value}（${meta.days_note || ''}）· 采集 ${meta.unique_products} 个商品`);
push('');

// 一、细分品类销售榜（按销售金额）
push(`## 一、细分品类销售榜（按销售金额降序）`);
push('');
if (!CATEGORY) push(`> 未指定细分品类，展示全量 Top ${TOP}。用 \`--category 跑步鞋\` 指定细分品类。`);
else push(`> 按「商品分类/商品名」含「${CATEGORY}」过滤，共 ${sortedByGmv.length} 个商品，取销售额 Top ${Math.min(TOP, sortedByGmv.length)}。`);
push('');
push('| 排名 | 商品 | 品牌(店铺) | 分类 | 价格带 | 销售额 | 销量 | 总销售额 |');
push('|---|---|---|---|---|---|---|---|');
sortedByGmv.slice(0, TOP).forEach((p, i) => {
  push(`| ${i + 1} | ${(p.product || '').slice(0, 40)} | ${p.shop} | ${p.category} | ${p.price ? SYM + Math.round(p.price.min) + '~' + SYM + Math.round(p.price.max) : '—'} | **${fmt(p.gmvN)}** | ${p.units} | ${fmt(p.totalGmvN)} |`);
});
push('');

// 二、品牌对比
push('## 二、品牌对比（本品牌 vs 排名相近竞品）');
push('');
if (!brandComparison) {
  push(`> 未指定本品牌（用 \`--brand 品牌名\`），以下为品类内品牌销售额排行榜 Top ${Math.min(TOP, brands.length)}。`);
  push('');
  push('| 排名 | 品牌(店铺) | 销售额 | 销量 | 商品数 | 均价 | 价格带 |');
  push('|---|---|---|---|---|---|---|');
  brands.slice(0, TOP).forEach((b, i) => {
    push(`| ${i + 1} | ${b.brand} | **${fmt(b.gmv)}** | ${b.units} | ${b.productCount} | ${fmt(b.avgPrice)} | ${b.priceTier} |`);
  });
} else {
  const t = brandComparison;
  push(`> 本品牌「${t.target.brand}」在品类内销售额排名 **第 ${t.targetRank} 名**，前后各 ${NEARBY} 名竞品如下：`);
  push('');
  push('| 排名 | 品牌(店铺) | 销售额 | 销量 | 商品数 | 均价 | 价格带 | 备注 |');
  push('|---|---|---|---|---|---|---|---|');
  t.nearby.forEach((b) => {
    const isTarget = b.brand === t.target.brand;
    push(`| ${b.rank} | ${b.brand} | **${fmt(b.gmv)}** | ${b.units} | ${b.productCount} | ${fmt(b.avgPrice)} | ${b.priceTier} | ${isTarget ? '← 本品牌' : ''} |`);
  });
}
push('');

// 三、价格带分档
push('## 三、价格带分档');
push('');
push('> 按商品售价中位数分档（阈值：低价带 <100、中价带 100~300、中高价带 300~1000、高价带 ≥1000，单位' + CURRENCY + '）。');
push('');
push('| 价格带 | 商品数 | 销售额 | 销量 | 销售额占比 |');
push('|---|---|---|---|---|');
const totalGmv = pool.reduce((s, p) => s + (p.gmvN ?? 0), 0);
tiers.forEach((t) => {
  push(`| ${t.tier} | ${t.count} | **${fmt(t.gmv)}** | ${t.units} | ${totalGmv ? ((t.gmv / totalGmv) * 100).toFixed(1) + '%' : '—'} |`);
});
push('');

// 四、结论
push('## 四、关键结论');
push('');
if (sortedByGmv.length) {
  const top1 = sortedByGmv[0];
  push(`- 销售额第一：${(top1.product || '').slice(0, 40)}（${top1.shop}），${fmt(top1.gmvN)}。`);
}
if (brandComparison?.target) {
  push(`- 本品牌排名第 ${brandComparison.targetRank}，销售额 ${fmt(brandComparison.target.gmv)}，均价 ${fmt(brandComparison.target.avgPrice)}（${brandComparison.target.priceTier}）。`);
}
if (tiers.length) {
  const topTier = tiers[0];
  push(`- 销售额最集中的价格带：${topTier.tier}（${fmt(topTier.gmv)}，占 ${totalGmv ? ((topTier.gmv / totalGmv) * 100).toFixed(1) : '—'}%）。`);
}
push('');
push('---');
push('');
push(`*本报告数字全部可追溯至 \`${path.basename(DIR)}/products.json\`；「所属店铺」≈品牌（泰国品牌名常=店铺名）；价格带由商品售价区间计算，为估算值。*`);

const report = L.join('\n');
fs.writeFileSync(path.join(DIR, 'brand-comparison.md'), report, 'utf8');

// JSON 产物
const outJson = {
  meta: { ...meta, category: CATEGORY, brand: BRAND },
  // 保留稳定ID和详情来源，让销量分析结果可直接交给 product-roi 逐个采集。
  topProducts: sortedByGmv.slice(0, TOP).map((p) => ({
    id: p.id ?? null, source_url: p.source_url ?? null,
    rank: p._rank, product: p.product, shop: p.shop, category: p.category,
    price: p.price, gmv: p.gmvN, units: p.unitsN, total_gmv: p.totalGmvN, price_raw: p.price_raw,
  })),
  brands: brands.map((b, i) => ({ rank: i + 1, ...b })),
  brandComparison,
  priceTiers: tiers,
};
fs.writeFileSync(path.join(DIR, 'brand-comparison.json'), JSON.stringify(outJson, null, 2), 'utf8');

console.log(`写出：brand-comparison.md / brand-comparison.json → ${DIR}`);
console.log(`品类「${CATEGORY || '全品类'}」：${pool.length} 个商品，${brands.length} 个品牌，${tiers.length} 个价格带`);
