#!/usr/bin/env node
/**
 * 店铺榜离线分析：把 fastmoss-rpa.mjs shop 抓下来的 shops.json 变成
 * 店铺销售榜 + 分类分布 + 品牌对比 的结构化报告。
 *
 *   node scripts/rpa/analyze-shop.mjs --dir outputs/<批次> --category 箱包 --brand 品牌名 [--top 20]
 *
 * 输入：<dir>/shops.json（shop 命令产出）
 * 输出：<dir>/shop-analysis.md + shop-analysis.json
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
const CATEGORY = getArg('category', null);
const BRAND = getArg('brand', null);
const TOP = Number(getArg('top', 20));
const MIN_RATING = getArg('min-rating', null);   // 最低评分筛选

const num = parseAmount;

// 读数据
let shopsFile = getArg('shops', null);
if (!shopsFile) {
  shopsFile = path.join(DIR, 'shops.json');
} else if (!path.isAbsolute(shopsFile)) {
  shopsFile = path.join(DIR, shopsFile);
}
const raw = JSON.parse(fs.readFileSync(shopsFile, 'utf8'));
const meta = raw.meta || {};
const shops = (raw.shops || []).map((s) => ({
  ...s,
  day7GmvN: num(s.day7_gmv),
  day7UnitsN: num(s.day7_units),
  totalGmvN: num(s.total_gmv),
  totalUnitsN: num(s.total_units),
  ratingN: parseFloat(s.rating),
  onSellN: num(s.on_sell),
  authorsN: num(s.authors),
}));

const CURRENCY = meta.currency || 'USD';
const SYM = { USD: '$', THB: '฿', IDR: 'Rp', VND: '₫', MYR: 'RM', PHP: '₱', JPY: '¥', SGD: 'S$', MXN: 'MX$', BRL: 'R$' }[CURRENCY] || CURRENCY + ' ';
const fmt = (n) => (n == null ? '—' : SYM + n.toLocaleString('en-US', { maximumFractionDigits: 0 }));

// 筛选
let pool = shops;
if (CATEGORY) pool = pool.filter((s) => (s.category || '').includes(CATEGORY) || (s.shop_name || '').includes(CATEGORY));
if (MIN_RATING) pool = pool.filter((s) => (s.ratingN || 0) >= Number(MIN_RATING));

const byGmv = [...pool].sort((a, b) => (b.day7GmvN ?? 0) - (a.day7GmvN ?? 0));
const byTotalGmv = [...pool].sort((a, b) => (b.totalGmvN ?? 0) - (a.totalGmvN ?? 0));

// 分类分布
const catMap = new Map();
for (const s of pool) {
  const c = s.category || '其它';
  if (!catMap.has(c)) catMap.set(c, { category: c, count: 0, day7Gmv: 0, totalGmv: 0 });
  const x = catMap.get(c);
  x.count++; x.day7Gmv += s.day7GmvN ?? 0; x.totalGmv += s.totalGmvN ?? 0;
}
const categories = [...catMap.values()].sort((a, b) => b.day7Gmv - a.day7Gmv);

// 品牌对比（本品牌前后各 N 名，按近7天GMV排名）
let brandComparison = null;
if (BRAND) {
  const idx = findBrandIndex(byGmv, BRAND, s => s.shop_name);
  if (idx >= 0) {
    const lo = Math.max(0, idx - 5);
    const hi = Math.min(byGmv.length, idx + 6);
    brandComparison = {
      target: byGmv[idx], targetRank: idx + 1,
      nearby: byGmv.slice(lo, hi).map((s, i) => ({ rank: lo + i + 1, ...s })),
    };
  }
}

// 输出
const L = [];
const push = (s = '') => L.push(s);
push(`# 店铺销售分析报告 · ${CATEGORY || '全品类'}`);
push('');
push(`> 数据源：\`${path.basename(DIR)}/shops.json\` · 国家：${meta.country || '?'} · 币种：${CURRENCY} · 采集 ${meta.unique_shops} 个店铺`);
push('');

push('## 一、店铺销售榜（按近7天销售额降序）');
push('');
push('| 排名 | 店铺 | 分类 | 评分 | 近7天GMV | 近7天销量 | 总GMV | 总销量 | 在售商品 | 带货达人 |');
push('|---|---|---|---|---|---|---|---|---|---|');
byGmv.slice(0, TOP).forEach((s, i) => {
  push(`| ${i + 1} | ${s.shop_name} | ${s.category} | ${s.rating || '—'} | **${fmt(s.day7GmvN)}** | ${s.day7_units} | ${fmt(s.totalGmvN)} | ${s.total_units} | ${s.on_sell} | ${s.authors} |`);
});
push('');

push('## 二、分类分布（按近7天GMV）');
push('');
push('| 分类 | 店铺数 | 近7天GMV | 总GMV |');
push('|---|---|---|---|');
categories.slice(0, 15).forEach((c) => push(`| ${c.category} | ${c.count} | **${fmt(c.day7Gmv)}** | ${fmt(c.totalGmv)} |`));
push('');

if (brandComparison) {
  const t = brandComparison;
  push('## 三、品牌对比（本品牌 vs 排名相近竞品）');
  push('');
  push(`> 本品牌「${t.target.shop_name}」在品类内近7天GMV排名 **第 ${t.targetRank} 名**，前后各 5 名：`);
  push('');
  push('| 排名 | 店铺 | 分类 | 评分 | 近7天GMV | 总GMV | 带货达人 |');
  push('|---|---|---|---|---|---|---|');
  t.nearby.forEach((s) => {
    const isTarget = s.shop_name === t.target.shop_name;
    push(`| ${s.rank} | ${s.shop_name} | ${s.category} | ${s.rating || '—'} | **${fmt(s.day7GmvN)}** | ${fmt(s.totalGmvN)} | ${s.authors} | ${isTarget ? '← 本品牌' : ''} |`);
  });
  push('');
}

push('## 四、总GMV Top（按总销售额）');
push('');
push('| 排名 | 店铺 | 分类 | 总GMV | 总销量 |');
push('|---|---|---|---|---|');
byTotalGmv.slice(0, TOP).forEach((s, i) => push(`| ${i + 1} | ${s.shop_name} | ${s.category} | **${fmt(s.totalGmvN)}** | ${s.total_units} |`));
push('');
push('---');
push('');
push(`*本报告数字全部可追溯至 \`${path.basename(DIR)}/shops.json\`；「店铺名」≈品牌名（泰国品牌名常=店铺名）；GMV 为平台口径。*`);

const report = L.join('\n');
fs.writeFileSync(path.join(DIR, 'shop-analysis.md'), report, 'utf8');

const outJson = {
  meta: { ...meta, category: CATEGORY, brand: BRAND },
  topShops: byGmv.slice(0, TOP).map((s) => ({ rank: undefined, ...s })),
  categories,
  brandComparison,
};
fs.writeFileSync(path.join(DIR, 'shop-analysis.json'), JSON.stringify(outJson, null, 2), 'utf8');

console.log(`写出：shop-analysis.md / shop-analysis.json → ${DIR}`);
console.log(`品类「${CATEGORY || '全品类'}」：${pool.length} 个店铺，${categories.length} 个分类`);
