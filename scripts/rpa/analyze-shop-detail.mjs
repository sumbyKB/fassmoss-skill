#!/usr/bin/env node
/**
 * 店铺详情离线分析：把 shop-detail 抓下来的 <shop>_detail.json 变成
 * 店铺总览 + 商品排行 + 价格带 + 品类/渠道/销售方式 的结构化报告。
 *
 * 用法（两种）：
 *   1. 独立 CLI：node scripts/rpa/analyze-shop-detail.mjs --file outputs/<批次>/xxx_detail.json [--top 20]
 *   2. 作为模块：import { analyzeShopDetail } from './analyze-shop-detail.mjs'
 *
 * 输入：shop-detail 命令产出的 JSON（含 meta + detail）
 * 输出：同目录 <shop名>_店铺详情分析.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAmount } from './data-rules.mjs';

const SYM_MAP = { USD: '$', THB: '฿', IDR: 'Rp', VND: '₫', MYR: 'RM', PHP: '₱', JPY: '¥', SGD: 'S$', MXN: 'MX$', BRL: 'R$' };

/**
 * 分析店铺详情 payload（{ meta, detail }），返回报告 markdown 字符串 + 摘要。
 * @param {object} payload shop-detail 产出的 JSON 对象
 * @param {object} opts { top, dataFile }
 */
export function analyzeShopDetail(payload, opts = {}) {
  const top = Number(opts.top || 20);
  const dataFile = opts.dataFile || 'detail.json';
  const meta = payload.meta || {};
  const d = payload.detail || {};

  const CURRENCY = meta.currency || 'USD';
  const SYM = SYM_MAP[CURRENCY] || CURRENCY + ' ';
  const fmt = (n) => (n == null ? '—' : SYM + n.toLocaleString('en-US', { maximumFractionDigits: 0 }));
  const fmtAmount = (s) => {
    if (s == null || s === '') return '—';
    const raw = String(s).split('\n')[0].trim();
    if (/万|亿/.test(raw)) return raw;
    const n = parseAmount(raw);
    return n == null ? raw : fmt(n);
  };

  const products = (d.products || []).map((p) => ({
    ...p,
    gmvN: parseAmount(p.gmv_28d),
    unitsN: parseAmount(p.units_28d),
    priceN: parseAmount(p.price),
  })).sort((a, b) => (b.gmvN ?? 0) - (a.gmvN ?? 0));

  const L = [];
  const push = (s = '') => L.push(s);
  const shopName = d.shop_name || meta.shop_name || '未知店铺';

  push(`# ${shopName} 店铺详情分析报告`);
  push('');
  push(`> 数据源：\`${path.basename(dataFile)}\` · 国家：${meta.country || '?'} · 币种：${CURRENCY} · 采集 ${(meta.collected_at || '').slice(0, 10)}`);
  push('');

  // 一、店铺总览
  push('## 一、店铺总览');
  push('');
  push('| 指标 | 数值 | 指标 | 数值 |');
  push('|---|---|---|---|');
  const ov = d.overview || {};
  const ovLabels = ['总销量', '总销售额', '在售商品数', '全国排名', '带货直播数', '带货视频数', '带货达人数', '分类排名'];
  for (let i = 0; i < ovLabels.length; i += 2) {
    push(`| ${ovLabels[i]} | **${ov[ovLabels[i]] || '—'}** | ${ovLabels[i + 1]} | **${ov[ovLabels[i + 1]] || '—'}** |`);
  }
  push('');
  push('| 评分 | 商品价格分布 | 店铺类型 | 收录时间 | TikTok 账号 |');
  push('|---|---|---|---|---|');
  push(`| **${d.rating || '—'}** | ${d.price_range || '—'} | ${d.shop_type || '—'} | ${d.collected_date || '—'} | ${d.tiktok_account || '—'} |`);
  push('');
  if (d.product_count_note) push(`> 商品数口径：${d.product_count_note}。`);
  push('');

  // 二、商品排行
  push('## 二、商品排行（近28天，按销售额降序）');
  push('');
  push('| 排名 | 商品 | 售价 | 近28天销量 | 近28天销售额 | 佣金 | 上架时间 |');
  push('|---|---|---|---|---|---|---|');
  products.slice(0, top).forEach((p, i) => {
    push(`| ${i + 1} | ${p.name} | ${p.price || '—'} | ${p.units_28d || '—'} | **${fmtAmount(p.gmv_28d)}** | ${p.commission || '—'} | ${(p.listed || '').slice(0, 10)} |`);
  });
  if (!products.length) push('| — | 未采集到商品明细 | — | — | — | — | — |');
  push('');
  const knownGmv = products.filter(p => p.gmvN != null);
  const totalGmv = knownGmv.length ? knownGmv.reduce((sum, p) => sum + p.gmvN, 0) : null;
  const totalGmvStr = totalGmv >= 10000 ? SYM + (totalGmv / 10000).toFixed(2) + '万' : fmt(totalGmv);
  push(`> 已采集商品明细 **${products.length}** 个，其中 **${knownGmv.length}** 个有销售额数据，已知销售额小计 **${totalGmvStr}**。`);
  push('');

  // 三、价格带
  push('## 三、价格带分布');
  push('');
  const pb = d.price_band || {};
  const bands = ['0-15', '15-30', '30-45', '45-60', '60-75', '>75'];
  push(`| 价格带(${CURRENCY}) | 销量占比 |`);
  push('|---|---|');
  bands.forEach((b) => push(`| ${b} | ${pb[b] || '—'} |`));
  push('');
  const maxBand = bands.filter((b) => pb[b] && pb[b] !== '-').sort((a, b) => parseFloat(pb[b]) - parseFloat(pb[a]))[0];
  if (maxBand) push(`> 主力价格带：**${maxBand}**（占 ${pb[maxBand]}），商品售价区间 ${d.price_range || '未知'}。`);
  push('');

  // 四、品类 / 成交渠道 / 销售方式
  push('## 四、品类与成交结构');
  push('');
  if (d.category_distribution && d.category_distribution.length) {
    push('**品类分布**');
    push('');
    push('| 类目 | 占比 |');
    push('|---|---|');
    d.category_distribution.forEach((c) => push(`| ${c.category} | ${c.share} |`));
    push('');
  }
  if (d.channel_distribution && d.channel_distribution.length) {
    push('**成交渠道占比**');
    push('');
    push('| 渠道 | 占比 |');
    push('|---|---|');
    d.channel_distribution.forEach((c) => push(`| ${c.channel} | ${c.share} |`));
    push('');
  }
  if (d.sale_method_distribution && d.sale_method_distribution.length) {
    push('**销售方式分布**');
    push('');
    push('| 方式 | 占比 |');
    push('|---|---|');
    d.sale_method_distribution.forEach((m) => push(`| ${m.method} | ${m.share} |`));
    push('');
  }

  // 五、数据洞察
  push('## 五、核心洞察');
  push('');
  const insights = [];
  const ratingN = parseFloat(d.rating);
  if (ratingN && ratingN < 4.5) insights.push(`- **评分 ${d.rating} 偏低**（<4.5），是首要优化项，需排查差评来源（质量/尺码/物流/售后）。`);
  if (products.length > 0) {
    const top1 = products[0];
    insights.push(`- **销售额冠军**：${top1.name.slice(0, 50)}（${top1.price}，近28天 GMV ${fmtAmount(top1.gmv_28d)}）。`);
    const withPrice = products.filter((p) => p.priceN != null);
    const lowPrice = withPrice.sort((a, b) => a.priceN - b.priceN)[0];
    const highPrice = [...withPrice].sort((a, b) => b.priceN - a.priceN)[0];
    if (lowPrice && highPrice) insights.push(`- **价格跨度**：${lowPrice.price} ~ ${highPrice.price}，主力价位 ${maxBand || '>75'}。`);
  }
  const channel = (d.channel_distribution || []).find((c) => c.channel.includes('达人'));
  if (channel) insights.push(`- **达人带货占比 ${channel.share}**：达人渠道是核心成交来源${parseFloat(channel.share) > 70 ? '，达人质量直接决定店铺表现' : ''}。`);
  const video = (d.sale_method_distribution || []).find((m) => m.method === '视频');
  if (video) insights.push(`- **视频成交占比 ${video.share}**：${parseFloat(video.share) > 50 ? '短视频是主要出单方式，重点优化素材' : '短视频占比偏低，直播/商品卡为主'}。`);
  if (!insights.length) insights.push('- 数据有限，暂无法生成洞察。');
  insights.forEach((i) => push(i));
  push('');

  push('---');
  push(`*本报告数字全部可追溯至 \`${path.basename(dataFile)}\`；「店铺名」≈品牌名；GMV 为平台口径；价格带由商品售价区间估算。*`);

  return {
    report: L.join('\n'),
    summary: { shopName, productCount: products.length, maxBand: maxBand || '未知', totalGmv: totalGmvStr },
  };
}

// ---- CLI 入口 ----
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  const getArg = (k, d) => {
    const i = args.indexOf('--' + k);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
  };
  const inputFile = getArg('file', getArg('input', null));
  const FILE = inputFile ? path.resolve(inputFile) : null;
  const TOP = Number(getArg('top', 20));
  if (!FILE || !fs.existsSync(FILE)) {
    console.error('缺少详情数据文件：node scripts/rpa/analyze-shop-detail.mjs --file outputs/<批次>/xxx_detail.json');
    process.exit(1);
  }
  const payload = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const { report, summary } = analyzeShopDetail(payload, { top: TOP, dataFile: FILE });
  const outFile = path.join(path.dirname(FILE), `${summary.shopName.replace(/[^\w.-]/g, '_')}_店铺详情分析.md`);
  fs.writeFileSync(outFile, report, 'utf8');
  console.log(`写出：${outFile}`);
  console.log(`店铺「${summary.shopName}」：${summary.productCount} 个动销商品，主力价格带 ${summary.maxBand}`);
}
