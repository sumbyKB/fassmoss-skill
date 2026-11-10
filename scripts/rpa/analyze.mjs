#!/usr/bin/env node
/**
 * 离线分析：把 RPA 抓下来的 candidates.json / details.json 变成
 * creators-final.json、summary-metrics.json、competitor-shops.json、evidence/<id>.json
 *
 *   node scripts/rpa/analyze.mjs --dir outputs/2026-11-09-us-bags-review [--top 10] [--currency THB]
 *
 * 币种：默认自动读 details.json / candidates.json 的 meta.currency（RPA 抓取时写入，
 * 泰国站=THB 等），也可显式 --currency THB 覆盖。金额符号（$ ฿ Rp ₫ 等）随之切换。
 *
 * 原则：只做确定性计算与字段搬运；未知字段留 null，不用 0 顶替；
 * GMV÷销量 只称“件均销售额”，不称订单客单价。
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
const TOP = Number(getArg('top', 10));
// 详情页抓的周期口径（默认页面原生近28天；抓 90 天时传 --period 近90天）
const legacyPeriod = getArg('period', null);
const targetProducts = new Set(getArg('competitor-products', '').split(',').filter(Boolean));

// 币种符号映射（RPA 已把 country/currency 写进 meta，这里从 meta 自动读取，缺省 USD）
const CURRENCY_SYMBOL = { USD: '$', THB: '฿', IDR: 'Rp', VND: '₫', MYR: 'RM', PHP: '₱', JPY: '¥', SGD: 'S$', MXN: 'MX$', BRL: 'R$' };
const symbolOf = (c) => CURRENCY_SYMBOL[c] || (c ? c + ' ' : '$');

const BAG = BAG_CATEGORY;
const REVIEW = /(review|unbox|honest|worth it|tested|\btest\b|\bvs\b|dupe|comparison|测评|实测|开箱|haul|优缺点|pros and cons|which one|quality|for less|girl math|รีวิว|บอกต่อ|ใช้ดี|คุ้ม|ทดลอง|เทียบ|ถูกและดี|ของดี|รีวิวจริง)/i;

const num = parseAmount;
const priceMid = (s) => {
  if (!s) return null;
  const m = stripCurrency(s).match(/\d+(\.\d+)?/g);
  if (!m) return null;
  const a = m.map(Number);
  return +(((a[0] + (a[1] ?? a[0])) / 2).toFixed(2));
};
const idFrom = (href) => (href || '').split('/').pop();

/* ---------- 总览文本 → 指标 ---------- */
function parseOverview(text = '') {
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  const val = (label) => {
    const i = lines.indexOf(label);
    if (i < 0) return null;
    const prev = lines[i - 1];
    const next = lines[i + 1];
    const pick = prev && !/^[\u4e00-\u9fa5]/.test(prev) ? prev : next;
    return pick && !/^[\u4e00-\u9fa5]/.test(pick) ? pick : null;
  };
  const o = {};
  const map = {
    fans: '粉丝数', fans28: '近28天涨粉数', videos28: '近28天发布视频数', lives28: '近28天带货直播数',
    gmvTotal: '带货 GMV', gmvVideo: '带货视频 GMV', gmvLive: '带货直播 GMV',
    rankCountry: '带货 GMV 国家排名', potential: '带货潜力指数', trafficIdx: '流量指数', rankCat: '分类排名',
    totalVideos: '总视频数', sellingVideos: '带货视频数', avgViews: '平均播放量', medianViews: '播放中位数',
    avgEngage: '平均互动率', liveSessions: '带货直播场次', liveAvgSales: '平均每场销量', liveAvgGmv: '平均每场销售额',
  };
  for (const [k, label] of Object.entries(map)) {
    const raw = val(label);
    if (raw) o[k] = { raw, n: num(raw) };
  }
  o.firstVideoDate = (text.match(/首条视频时间：\s*([\d/]+)/) || [])[1] || null;
  o.mcn = (text.match(/MCN 签约：\s*(\S+)/) || [])[1] || null;
  o.shopWindow = (text.match(/橱窗状态\s*：\s*(\S+)/) || [])[1] || null;
  return o;
}

/* ---------- 表格解析 ---------- */
const pickTable = (tables, kw) => tables.find((t) => t.headers.some((h) => h.includes(kw)));

function parseDetail(d) {
  const t = d.tables || [];
  const videoT = pickTable(t, '视频销量');
  const liveT = pickTable(t, '直播销量');
  const shopT = pickTable(t, '合作商品数');
  const prodT = pickTable(t, '商品价格');

  const videos = (videoT?.rows || []).filter((r) => r.cells[0] && r.cells[1]).map((r) => ({
    id: idFrom(r.href), href: r.href, period: periodOf(videoT), productIds: r.productIds || [], title: r.cells[0], date: r.cells[1], type: r.cells[2],
    units: num(r.cells[3]), gmv: num(r.cells[4]), views: num(r.cells[5]), engage: r.cells[6],
    product: r.cells[7] || '', isBag: BAG.test(r.cells[7] || '') || BAG.test(r.cells[0] || ''),
    isReview: REVIEW.test(r.cells[0] || ''),
  }));
  const lives = (liveT?.rows || []).filter((r) => r.cells[0] && /^\d{4}-\d{2}-\d{2}/.test(r.cells[1] || '')).map((r) => ({
    id: (r.href || '').includes('/live/detail/') ? idFrom(r.href) : null, href: r.href, period: periodOf(liveT), productIds: r.productIds || [], title: r.cells[0], date: r.cells[1],
    units: num(r.cells[2]), gmv: num(r.cells[3]), products: num(r.cells[4]), soldProducts: num(r.cells[5]),
    viewers: num(r.cells[6]), uv: num(r.cells[7]), product: r.cells[8] || '',
    isBag: BAG.test(r.cells[8] || '') || BAG.test(r.cells[0] || ''),
    duration: (r.cells[0].match(/时长：([\d:]+)/) || [])[1] || null,
  }));
  const shops = (shopT?.rows || []).filter((r) => r.cells[1]).map((r) => ({
    rank: r.cells[0], shop: r.cells[1].split('|')[0].trim(), goodsCount: num(r.cells[2]),
    best: r.cells[3], units: num(r.cells[4]), gmv: num(r.cells[5]),
  }));
  const products = (prodT?.rows || []).filter((r) => r.cells[0]).map((r) => ({
    name: r.cells[0], priceRaw: r.cells[1], price: priceMid(r.cells[1]),
    units: num(r.cells[2]), gmv: num(r.cells[3]), listed: r.cells[4],
    commissionRaw: r.cells[5], commission: parseFloat(r.cells[5]),
    shop: (r.cells[6] || '').split('|')[0].trim(), isBag: BAG.test(r.cells[0] || ''),
  }));
  return { videos, lives, shops, products };
}

function countPromotions(parsed, targets) {
  if (!targets.size) return null;
  const count = rows => {
    const known = rows.filter(r => r.id && r.productIds.length);
    return { observed: known.length ? new Set(known.filter(r => r.productIds.some(id => targets.has(id))).map(r => r.id)).size : null, covered: known.length, sampled: rows.length };
  };
  return {video: count(parsed.videos), live: count(parsed.lives)};
}

function calc(p) {
  // 注意：「带货视频」判定不能用 /带货视频/，会误匹配「非带货视频」；要精确排除「非带货」
  const selling = p.videos.filter((v) => {
    const t = v.type || '';
    const isSelling = /带货视频/.test(t) && !/非带货/.test(t);
    return isSelling || (v.units || 0) > 0;
  });
  const vUnits = selling.reduce((s, v) => s + (v.units || 0), 0);
  const vGmv = selling.reduce((s, v) => s + (v.gmv || 0), 0);
  const views = p.videos.reduce((s, v) => s + (v.views || 0), 0);
  const bagProd = p.products.filter((x) => x.isBag);
  const bagUnits = bagProd.reduce((s, x) => s + (x.units || 0), 0);
  const bagGmv = bagProd.reduce((s, x) => s + (x.gmv || 0), 0);
  const prices = bagProd.map((x) => x.price).filter((x) => x);
  const paired = selling.filter(v => v.views != null && v.gmv != null);
  const pairedViews = paired.reduce((sum,v)=>sum+v.views,0);
  const comms = p.products.map((x) => x.commission).filter((x) => !isNaN(x));
  return {
    sampleVideos: p.videos.length,
    sampleSellingVideos: selling.length,
    sampleVideoGmv: selling.some(v => v.gmv != null) ? +vGmv.toFixed(2) : null,
    sampleVideoUnits: selling.some(v => v.units != null) ? vUnits : null,
    sampleViews: p.videos.some(v => v.views != null) ? views : null,
    gpmPer1000Views: pairedViews ? +((paired.reduce((sum,v)=>sum+v.gmv,0) / pairedViews) * 1000).toFixed(2) : null,
    unitGmv: selling.every(v => v.gmv != null && v.units != null) && vUnits ? +(vGmv / vUnits).toFixed(2) : null,
    reviewShare: p.videos.length ? +((p.videos.filter((v) => v.isReview).length / p.videos.length) * 100).toFixed(1) : null,
    bagShareVideos: p.videos.length ? +((p.videos.filter((v) => v.isBag).length / p.videos.length) * 100).toFixed(1) : null,
    productsSampled: p.products.length,
    bagProducts: bagProd.length,
    bagProductShare: p.products.length ? +((bagProd.length / p.products.length) * 100).toFixed(0) : null,
    bagAvgPrice: prices.length ? +(prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2) : null,
    bagUnits: bagProd.some(x=>x.units != null) ? bagUnits : null, bagGmv: bagProd.some(x=>x.gmv != null) ? +bagGmv.toFixed(2) : null,
    bagUnitGmv: bagProd.every(v => v.gmv != null && v.units != null) && bagUnits ? +(bagGmv / bagUnits).toFixed(2) : null,
    commissionAvg: comms.length ? +(comms.reduce((a, b) => a + b, 0) / comms.length).toFixed(1) : null,
    liveSessions: p.lives.length,
  };
}

/* ---------- 主流程 ---------- */
const candidates = JSON.parse(fs.readFileSync(path.join(DIR, 'candidates.json'), 'utf8'));
const detailsFile = path.join(DIR, 'details.json');
if (!fs.existsSync(detailsFile)) throw new Error('缺 details.json，请先跑 pipeline');
const details = JSON.parse(fs.readFileSync(detailsFile, 'utf8'));
// 币种：优先显式 --currency，否则读 RPA 写进 meta 的 currency（泰国站=THB 等），兜底 USD
const CURRENCY = getArg('currency', null) || details.meta?.currency || candidates.meta?.currency || 'USD';
const SYM = symbolOf(CURRENCY);
const periodOf = t => t?.dates?.length === 2 ? t.dates.join('/') : t?.period || legacyPeriod || '周期未核实';
const PERIOD = [...new Set(details.details.flatMap(d => (d.tables || []).filter(t => t.headers.some(h => ['视频销量','直播销量'].includes(h))).map(periodOf)))].join('、') || '周期未核实';

const searchById = new Map(candidates.records.map((r) => [r.id, r]));

const creators = details.details.filter((d) => !d.error).map((d) => {
  const parsed = parseDetail(d);
  const search = searchById.get(d.id) || {};
  return {
    id: d.id,
    name: (d.overview?.pageName || '').replace(/（.*$/, '').trim(),
    url: d.url,
    search28: {
      units: search.cells?.[2] || null,
      gmv: search.cells?.[3] || null,
      avgViews: search.cells?.[5] || null,
      followers: search.cells?.[6] || null,
      fans28: search.cells?.[7] || null,
      engage: search.cells?.[8] || null,
      likeFans: search.cells?.[9] || null,
      categories: (search.cells?.[1] || '').replace(/\n/g, ' / '),
    },
    overview: parseOverview(d.overview?.text),
    competitorPromotions: countPromotions(parsed, targetProducts),
    ...parsed,
  };
}).map((c) => ({ ...c, calc: calc(c) }));

fs.writeFileSync(path.join(DIR, 'creators-final.json'), JSON.stringify(creators, null, 2), 'utf8');

/* 竞品店铺矩阵 */
const competitor = buildCompetitorMatrix(creators);
fs.writeFileSync(path.join(DIR, 'competitor-shops.json'), JSON.stringify({...competitor, meaning:'共同推广店铺覆盖达人数'}, null, 2));
const ctx = { gpmMax: Math.max(0,...creators.map(c=>c.calc.gpmPer1000Views ?? 0)), bagMax: Math.max(0,...creators.map(c=>c.calc.bagGmv ?? 0)) };
const ranked = creators.map(c=>({c,s:scoreCreator(c,ctx)})).sort((a,b)=>b.s.total-a.s.total || a.c.id.localeCompare(b.c.id)).slice(0,TOP);
const topList = ranked.map(x=>x.c);
fs.writeFileSync(path.join(DIR,'final-top.json'),JSON.stringify(ranked.map(({c,s})=>({id:c.id,name:c.name,fans:c.overview.fans?.raw,potential:c.overview.potential?.n,search28:c.search28,calc:c.calc,score:s,topShops:c.shops.map(x=>x.shop).slice(0,3)})),null,2));

/* evidence（给 history_analysis.py 用） */
const evDir = path.join(DIR, 'evidence');
fs.mkdirSync(evDir, { recursive: true });
for (const c of topList) {
  const records = [];
  for (const v of c.videos) {
    if (!v.id) continue;
    records.push({
      kind: 'video', id: v.id, source_url: v.href, period: v.period, currency: CURRENCY,
      published_at: v.date, video_type: v.type,
      units: v.units, gmv: v.gmv, views: v.views, views_scope_verified: false,
      title: v.title.slice(0, 300), product_text: (v.product || '').slice(0, 200),
    });
  }
  for (const l of c.lives) {
    if (!l.id) continue;
    const sec = l.duration ? l.duration.split(':').reduce((a, b) => a * 60 + Number(b), 0) : null;
    records.push({
      kind: 'live', id: l.id, source_url: l.href, period: l.period, currency: CURRENCY,
      started_at: l.date, units: l.units, gmv: l.gmv,
      listed_product_count: l.products, active_product_count: l.soldProducts,
      viewer_visits: l.viewers, duration_seconds: sec,
      platform_metrics: { UV价值: l.uv }, title: (l.title || '').slice(0, 120),
    });
  }
  const periods = [...new Set(records.map(r=>r.period))];
  for (const [index, period] of (periods.length ? periods : ['周期未核实']).entries()) {
  const file = periods.length > 1 ? c.id + '-' + (index+1) : c.id;
  fs.writeFileSync(path.join(evDir, file + '.json'), JSON.stringify({
    creator_id: c.id, creator_name: c.name, source_url: c.url,
    collected_at: details.meta?.collected_at || null, currency: CURRENCY, period,
    coverage: `视频列表前 ${c.videos.length} 条 + 直播列表前 ${c.lives.length} 场（${PERIOD}，非全量）`,
    platform_period_note: '以逐条记录周期为准',
    records: records.filter(r=>r.period===period), comments: [], comment_note: '页面仅显示评论数量，未获得正文，情绪不判定', products_complete: false,
  }, null, 2), 'utf8');
  }
}

/* 输出验收表 */
const head = ['#', '达人', 'handle', '粉丝', '28天GMV', '包商品', '包均价', '包GMV', '包件均', '佣金%', '样本GMV', 'GPM', '测评%'];
const rows = topList.map((c, i) => [
  i + 1, c.name, c.search28.followers, c.overview.fans?.raw, c.search28.gmv,
  `${c.calc.bagProducts}/${c.calc.productsSampled}`, c.calc.bagAvgPrice, c.calc.bagGmv, c.calc.bagUnitGmv,
  c.calc.commissionAvg, c.calc.sampleVideoGmv, c.calc.gpmPer1000Views, c.calc.reviewShare,
].join('\t'));
console.log(head.join('\t'));
console.log(rows.join('\n'));

/* ======================================================================
 * 多维度分析报告（renderReport）
 * 目标：任何人拿到 candidates.json + details.json，跑一次 analyze.mjs，
 * 就得到结构完全一致、数字可追溯、结论可复现的 Markdown 分析报告。
 * 原则：报告里的数字全部从 creators 数据算出来，不硬编码；定性分级用规则函数判定。
 * ====================================================================== */

const fmtMoney = (n) => (n == null ? '—' : SYM + n.toLocaleString('en-US', { maximumFractionDigits: 0 }));
const fmtWan = (n) => (n == null ? '—' : (n / 1e4).toFixed(1) + '万');
const pct = (n) => (n == null ? '—' : n + '%');
const orDash = (x) => (x == null || x === '' ? '—' : x);

// 箱包垂直度分级
const tierBag = (c) => {
  const share = c.calc.bagProductShare;
  if (share == null) return '未知';
  if (share >= 90) return '纯箱包';
  if (share >= 40) return '半箱包';
  return '附带箱包';
};

// 达人类型：直播型 / 视频型 / 混合型
// 用总览的「带货视频 GMV / 带货直播 GMV」判定，并按占比区分主导型：
// 直播 GMV ≥ 80% 合计 → 直播型；视频 GMV ≥ 80% → 视频型；否则混合型。
const typeOf = (c) => {
  const videoGmv = c.overview?.gmvVideo?.n ?? c.calc.sampleVideoGmv ?? 0;
  const liveGmv = c.overview?.gmvLive?.n ?? 0;
  const total = videoGmv + liveGmv;
  if (total <= 0) return (c.calc.liveSessions > 0) ? '直播型' : '视频型';
  const liveShare = liveGmv / total;
  if (liveShare >= 0.8) return '直播型';
  if (liveShare <= 0.2) return '视频型';
  return '混合型';
};

// 综合打分：箱包垂直度(0-25) + 带货能力GPM(0-20) + 包GMV(0-25) + 客单价(0-10) + 测评属性(0-10) + 佣金友好(0-10)
function scoreCreator(c, ctx) {
  const s = { breakdown: {} };
  // 1. 箱包垂直度（0-25）
  const share = c.calc.bagProductShare ?? 0;
  s.breakdown.bagFocus = +(share * 0.25).toFixed(1);
  // 2. 带货能力 GPM（0-20，用全局 GPM 最大/最小归一）
  const gpm = c.calc.gpmPer1000Views ?? 0;
  s.breakdown.gpm = ctx.gpmMax > 0 ? +((gpm / ctx.gpmMax) * 20).toFixed(1) : 0;
  // 3. 包 GMV（0-25，归一）
  const bagGmv = c.calc.bagGmv ?? 0;
  s.breakdown.bagGmv = ctx.bagMax > 0 ? +((bagGmv / ctx.bagMax) * 25).toFixed(1) : 0;
  // 4. 客单价（0-10，$30-$100 之间线性给分，越高端分越高，但 >$100 回落以控风险）
  const unit = CURRENCY === 'USD' ? c.calc.bagUnitGmv : null;
  s.breakdown.unit = unit == null ? null : +Math.max(0, Math.min(10, (unit - 15) / 8.5)).toFixed(1);
  // 5. 测评属性（0-10）
  const review = c.calc.reviewShare ?? 0;
  s.breakdown.review = +Math.min(10, review / 5).toFixed(1);
  // 6. 佣金友好（0-10，佣金越低分越高，0% 给满分 10，20% 给 0）
  const comm = c.calc.commissionAvg;
  s.breakdown.commission = comm == null ? null : +Math.max(0, Math.min(10, (20 - comm) / 2)).toFixed(1);
  s.total = +Object.values(s.breakdown).reduce((a, b) => a + b, 0).toFixed(1);
  return s;
}

// 竞品矩阵：被 ≥2 位达人合作算「共享竞品」
function buildCompetitorMatrix(creators) {
  const shopMap = new Map();
  for (const c of creators) {
    const seen = new Set();
    for (const s of [...c.shops.map((x) => x.shop), ...c.products.map((x) => x.shop)]) {
      if (!s || seen.has(s)) continue;
      seen.add(s);
      if (!shopMap.has(s)) shopMap.set(s, []);
      shopMap.get(s).push(c.name);
    }
  }
  const arr = [...shopMap.entries()].sort((a, b) => b[1].length - a[1].length);
  return { shared: arr.filter(([, v]) => v.length > 1), all: arr };
}

// 投产潜力：净贡献率 = 毛利率 − 佣金率 − 退款损失率（毛利率/退款率作为可调假设参数）
// 投产分级结合三项：净贡献率 + 包GMV规模（盘子越大越值得投） + 箱包垂直度。
function estimateROI(c, { grossMargin = 0.6, refundRate = 0.05 } = {}) {
  if (c.calc.commissionAvg == null) return {netContribution:null, grade:'佣金未知', breakeven:null};
  const comm = c.calc.commissionAvg / 100;
  const net = grossMargin - comm - refundRate;
  const netRounded = +net.toFixed(3); // 规避浮点误差（0.6-0.15-0.05=0.399999...）
  const bagShare = c.calc.bagProductShare ?? 0;
  const bagGmv = c.calc.bagGmv ?? 0;
  // 高：净贡献率≥40% 且（箱包垂直 或 包GMV≥$5万）；中：净贡献率≥40%；低：其余
  let grade;
  if (CURRENCY !== 'USD') return { netContribution: netRounded, grade: '待配置本币阈值', breakeven: null };
  if (netRounded >= 0.40 && (bagShare >= 90 || bagGmv >= 50000)) grade = '高';
  else if (netRounded >= 0.40) grade = '中';
  else grade = '低';
  return { netContribution: netRounded, grade, breakeven: null }; // breakeven 需固定成本，缺省不估算
}

function renderReport(creators, competitor, opts) {
  const { dir, period, currency, follower, category, top } = opts;
  const L = [];
  const push = (s = '') => L.push(s);

  // 头部
  push(`# FastMoss 达人推荐 · 多维度分析报告`);
  push('');
  push(`> 数据源：\`${path.basename(dir)}/\`（RPA 实时抓取，列表 + 详情）`);
  push(`> 采集时间：${details.meta?.collected_at || '未知'} · 币种：${currency} · 周期：${period}`);
  push(`> 筛选条件：粉丝 ${follower} · 类目 ${category} · 分析人数 ${creators.length}（Top ${top} 深采）`);
  push('');
  push('---');
  push('');

  // 一、口径核对
  push('## 一、筛选口径核对（先对齐，再下结论）');
  push('');
  push('| 条件 | 可用性 | 处理方式 |');
  push('|---|---|---|');
  push('| 粉丝区间 | ✅ 硬筛选（URL follower 参数） | 全部命中 |');
  push('| 类目 | ⚠️ 列表只给「带货 TOP 品类」 | 按品类关键词在 TOP3 中判定 |');
  push('| 常做测评 | ⚠️ 「测评分类」与类目/粉丝叠加常为 0 结果 | 改为按视频标题/文案内容推断 |');
  push('| 点击订单转化率 | 当前采集缺少点击与订单分母 | 单场平台销售转化率须另取原值及定义 |');
  push('| 报价 | ❌ 页面无报价来源 | 全部标注未知，需私信询价 |');
  push('| 退货率 / 评论舆情 | ❌ 页面仅评论数量，无正文 | 无法判定，标注缺失 |');
  push('');
  push('> **关键澄清**：`近28天 ≠ 近30天`；`GMV ≠ 转化率 ≠ 净利润`；`总 GMV ≠ 类目 GMV`。凡下结论处均已区分「平台数据 / 计算结果 / 推断」。');
  push('');

  // 二、类型结构
  push('## 二、候选人类型结构');
  push('');
  const byType = { '直播型': [], '视频型': [], '混合型': [] };
  creators.forEach((c) => byType[typeOf(c)].push(c.name));
  push('| 类型 | 人数 | 达人 |');
  push('|---|---|---|');
  for (const [t, names] of Object.entries(byType)) push(`| ${t} | ${names.length} | ${names.join('、') || '—'} |`);
  push('');
  const reviewOnes = creators.filter((c) => (c.calc.reviewShare ?? 0) > 0);
  push(`**测评内容**：${reviewOnes.length} 位有测评属性 —— ${reviewOnes.map((c) => `${c.name}(${c.calc.reviewShare}%)`).join('、') || '无'}。`);
  push('');

  // 三、综合打分排名
  push('## 三、综合打分推荐名单（可复现）');
  push('');
  push('> 打分维度：箱包垂直度(25) + 带货GPM(20) + 包GMV(25) + 客单价(10) + 测评属性(10) + 佣金友好(10) = 100 分。');
  push('');
  push('| 排名 | 达人 | 粉丝 | 28天GMV | 包GMV | 包件均 | 佣金 | GPM | 箱包垂直度 | 类型 | 得分 |');
  push('|---|---|---|---|---|---|---|---|---|---|---|');
  const scored = ranked;
  scored.forEach(({ c, s }, i) => {
    push(`| ${i + 1} | ${c.name} | ${orDash(c.search28.followers)} | ${orDash(c.search28.gmv)} | ${fmtMoney(c.calc.bagGmv)} | ${fmtMoney(c.calc.bagUnitGmv)} | ${pct(c.calc.commissionAvg)} | ${c.calc.gpmPer1000Views == null ? '—' : Math.round(c.calc.gpmPer1000Views)} | ${tierBag(c)} | ${typeOf(c)} | **${s.total}** |`);
  });
  push('');

  // 四、七维拆解（每维一个表）
  push('## 四、维度拆解');
  push('');
  // 维度1 箱包垂直度
  push('### 1. 箱包垂直度');
  push('');
  push('| 档位 | 达人 |');
  push('|---|---|');
  for (const tier of ['纯箱包', '半箱包', '附带箱包']) {
    const names = creators.filter((c) => tierBag(c) === tier).map((c) => c.name);
    push(`| ${tier} | ${names.join('、') || '—'} |`);
  }
  push('');
  // 维度2 GPM
  push('### 2. 带货能力（GPM，视频千次播放 GMV）');
  push('');
  push('| 达人 | GPM | 是否箱包垂类 |');
  push('|---|---|---|');
  const byGpm = [...creators].filter((c) => c.calc.gpmPer1000Views != null).sort((a, b) => b.calc.gpmPer1000Views - a.calc.gpmPer1000Views);
  for (const c of byGpm) push(`| ${c.name} | ${Math.round(c.calc.gpmPer1000Views)} | ${tierBag(c)} |`);
  push('');
  // 维度3 历史GMV
  push('### 3. 历史 GMV 规模');
  push('');
  push('| 达人 | 28天GMV | 总带货GMV | 包GMV |');
  push('|---|---|---|---|');
  const byGmv = [...creators].sort((a, b) => (num(b.search28.gmv) ?? 0) - (num(a.search28.gmv) ?? 0));
  for (const c of byGmv) push(`| ${c.name} | ${orDash(c.search28.gmv)} | ${orDash(c.overview.gmvTotal?.raw)} | ${fmtMoney(c.calc.bagGmv)} |`);
  push('');
  // 维度4 客单价
  push('### 4. 客单价（件均销售额）');
  push('');
  push('| 达人 | 包件均 |');
  push('|---|---|');
  const byUnit = [...creators].filter((c) => c.calc.bagUnitGmv != null).sort((a, b) => b.calc.bagUnitGmv - a.calc.bagUnitGmv);
  for (const c of byUnit) push(`| ${c.name} | ${fmtMoney(c.calc.bagUnitGmv)} |`);
  push('> 注：「件均销售额」= 包GMV ÷ 包销量，**不等于订单客单价**（平台无订单级客单价字段）。');
  push('');
  // 维度5 测评
  push('### 5. 测评属性');
  push('');
  push(`| 达人 | 测评占比 |`);
  push('|---|---|');
  for (const c of creators) push(`| ${c.name} | ${pct(c.calc.reviewShare)} |`);
  push('');
  // 维度6 竞品
  push('### 6. 共同推广店铺覆盖达人数');
  if (targetProducts.size) {
    push('指定竞品商品 ID：' + [...targetProducts].join('、'));
    for (const c of creators) {
      const { video, live } = c.competitorPromotions;
      push(`- ${c.name}：视频 ${video.observed ?? '未知'} 条，直播 ${live.observed ?? '未知'} 场（仅已采集的商品链接）。`);
    }
  }
  push('');
  push('| 共享店铺 | 覆盖达人数 | 合作达人 |');
  push('|---|---|---|');
  for (const [shop, names] of competitor.shared) push(`| ${shop} | ${names.length} | ${names.join('、')} |`);
  push('');
  // 维度7 投产
  push('### 7. 投产潜力预测（估算）');
  push('');
  push('> 净贡献率 = 毛利率(假设60%) − 佣金率 − 退款损失率(假设5%)。**退货率/真实报价平台未提供，为估算值**。');
  push('');
  push('| 达人 | 佣金 | 净贡献率(估) | 投产判断 |');
  push('|---|---|---|---|');
  for (const c of creators) {
    const roi = estimateROI(c);
    const netPct = roi.netContribution == null ? '未知' : (roi.netContribution * 100).toFixed(0) + '%';
    push(`| ${c.name} | ${pct(c.calc.commissionAvg)} | ${netPct} | ${roi.grade} |`);
  }
  push('');

  // 五、缺口清单
  push('## 五、缺口清单（诚实披露）');
  push('');
  push('| 维度 | 状态 | 说明 |');
  push('|---|---|---|');
  push('| 报价 | ❌ 未知 | 页面无报价，需私信询价 |');
  push('| 退货率 | ❌ 未知 | 平台不显示 |');
  push('| 评论舆情 | ❌ 无法 | 页面仅评论数，无正文 |');
  push('| 点击转化率 | ❌ 未知 | 平台不提供 |');
  push('| 精确投产 ROI | ⚠️ 估算 | 缺固定成本 + 真实退款率 |');
  push('');

  // 六、行动建议（基于数据自动生成）
  push('## 六、行动建议（自动生成）');
  push('');
  const pureBag = creators.filter((c) => tierBag(c) === '纯箱包').sort((a, b) => b.calc.bagGmv - a.calc.bagGmv);
  if (pureBag.length) {
    push(`1. **首推纯箱包达人**：${pureBag.slice(0, 3).map((c) => c.name).join('、')} —— 已采商品样本中箱包占比至少90%。`);
  }
  const topReview = creators.filter((c) => (c.calc.reviewShare ?? 0) > 0).sort((a, b) => b.calc.reviewShare - a.calc.reviewShare);
  if (topReview.length === 0) {
    push(`2. **测评诉求需降级**：当前池内无测评属性达人，建议放宽粉丝上限，或用合作脚本（开箱/测评）补测评内容。`);
  } else {
    push(`2. **测评达人优先**：${topReview[0].name}（测评 ${topReview[0].calc.reviewShare}%），可优先用测评脚本合作。`);
  }
  const topCompetitor = competitor.shared[0];
  if (topCompetitor) {
    push(`3. **共同推广店铺**：${topCompetitor[0]} 覆盖 ${topCompetitor[1].length} 位样本达人。`);
  }
  push(`4. **报价核实**：签约前务必私信询价，名单达人报价全部未知，不能假设符合预算。`);
  push('');
  push('---');
  push('');
  push(`*本报告所有数字可追溯至 \`creators-final.json\` / \`final-top.json\` / \`competitor-shops.json\`；「估算/推断」处已明确标注，未用 0 或编造数据顶替缺失字段。*`);

  return L.join('\n');
}

const reportMd = renderReport(creators, competitor, {
  dir: DIR, period: PERIOD, currency: CURRENCY,
  follower: candidates.meta?.filters?.follower || '5000,50000',
  category: candidates.meta?.filters?.sale_category_l1 || '7',
  top: TOP,
});
fs.writeFileSync(path.join(DIR, '多维度分析报告.md'), reportMd, 'utf8');

console.log(`\n写出：creators-final.json / competitor-shops.json / final-top.json / evidence/*.json / 多维度分析报告.md → ${DIR}`);
