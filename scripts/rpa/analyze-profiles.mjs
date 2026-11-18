#!/usr/bin/env node
/**
 * 达人档案渲染器（离线）——把 pipeline 的 candidates.json + details.json 变成逐人档案。
 *
 *   node scripts/rpa/analyze-profiles.mjs --dir outputs/<批次> [--top 10] [--subcategory 女包]
 *
 * 产出（写到同目录）：
 *   - profiles.json   ：全部深采达人的结构化档案字段
 *   - top10.json      ：目标子类筛选后的 Top N + 打分明细
 *   - 达人档案.md     ：逐人档案（基础数据 / 内容标签 / 粉丝画像 / 优劣势 / 风险点 / 收益锚 / 合作形式）
 *
 * 与 analyze.mjs（六段分析报告）互补：那个看盘面，这个看个体。
 * 原则：数字只做确定性计算；报价/转化/退货/舆情无来源就写「未知」；女包/细分判定是「样本证据」，非全量。
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseAmount, parsePriceRange, BAG_CATEGORY } from './data-rules.mjs';

const args = process.argv.slice(2);
const getArg = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};

const DIR = path.resolve(getArg('dir', 'outputs/latest'));
const TOP = Number(getArg('top', 10));
const SUB = getArg('subcategory', '女包');

const candPath = path.join(DIR, 'candidates.json');
const detPath = path.join(DIR, 'details.json');
if (!fs.existsSync(candPath) || !fs.existsSync(detPath)) throw new Error('缺 candidates.json / details.json，请先跑 pipeline');

const cand = JSON.parse(fs.readFileSync(candPath, 'utf8'));
const det = JSON.parse(fs.readFileSync(detPath, 'utf8'));
const CURRENCY = det.meta?.currency || cand.meta?.currency || 'USD';
const GENERATED_AT = det.meta?.collected_at || new Date().toISOString();

const num = parseAmount;
const fmt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

/* ---------- 子类关键词（泰英中三语） ---------- */
const SUB_KEYWORDS = {
  '女包': /กระเป๋าถือ|กระเป๋าสะพาย|กระเป๋าคาดอก|กระเป๋าผู้หญิง|ผู้หญิง|สำหรับสตรี|สตรี|กระเป๋าสตางค์|กระเป๋าโท้ท|โท้ท|tote|handbag|shoulder|crossbody|sling bag|女士|女包|女款|手提|单肩|斜挎|托特|手拎|钱包/i,
  '男包': /กระเป๋าเป้|กระเป๋าผู้ชาย|男士|男包|男款|双肩|雙肩|背包|腰包|胸包|公文|briefcase|laptop bag|backpack/i,
};
// 排除词：命中子类但被异性词覆盖的，用「明确性别词」纠偏
const STRONG_WOMEN = /ผู้หญิง|女士|女款|สตรี|女包/i;
const STRONG_MEN = /ผู้ชาย|男士|男款|男包/i;
const WALLET = /กระเป๋าสตางค์|กระเป๋าใส่เหรียญ|钱包|coin purse/i;
const REVIEW = /รีวิว|review|测评|评测|unbox|ลองใช้|ใช้จริง|ป้ายยา|ป้ายย|ตอบกลับ/i;

const isSub = (name) => {
  const re = SUB_KEYWORDS[SUB] || new RegExp(String(getArg('subcategory-keywords', SUB)).split(/[,，|]/).map((s) => s.trim()).filter(Boolean).join('|'), 'i');
  const strong = SUB === '女包' ? STRONG_WOMEN : STRONG_MEN;
  const opposite = SUB === '女包' ? SUB_KEYWORDS['男包'] : SUB_KEYWORDS['女包'];
  if (!re.test(name)) return false;
  if (opposite.test(name) && !strong.test(name)) return false;
  return true;
};

/* ---------- 列表首列画像 ---------- */
function parseCell0(s = '') {
  const lines = s.split('\n').map((x) => x.trim()).filter(Boolean);
  const handle = (lines[1] || '').replace(/^ID[:：]\s*/, '');
  const gi = lines.findIndex((x) => /^(女性|男性|其他)$/.test(x));
  const gender = gi >= 0 ? lines[gi] : null;
  const genderPct = gi >= 0 && /^\d+(\.\d+)?%$/.test(lines[gi + 1] || '') ? Number(lines[gi + 1].replace('%', '')) : null;
  const ai = lines.findIndex((x) => x === '年龄');
  const age = ai >= 0 ? (lines[ai + 1] || null) : null;
  return { name: lines[0] || '', handle, gender, genderPct, age };
}

/* ---------- 总览关键指标 ---------- */
function parseOverviewText(text = '') {
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  const near = (label) => {
    const i = lines.indexOf(label);
    if (i < 0) return null;
    const prev = lines[i - 1];
    const next = lines[i + 1];
    const pick = prev && !/^[\u4e00-\u9fa5]/.test(prev) ? prev : next;
    return pick && !/^[\u4e00-\u9fa5]/.test(pick) ? pick : null;
  };
  const g = (re) => (text.match(re) || [])[1] || null;
  return {
    fans28Raw: near('近28天涨粉数'), videos28Raw: near('近28天发布视频数'), lives28Raw: near('近28天带货直播数'),
    liveAvgGmvRaw: near('平均每场销售额'), liveAvgSalesRaw: near('平均每场销量'),
    totalGmvRaw: near('带货 GMV'), gmvVideoRaw: near('带货视频 GMV'), gmvLiveRaw: near('带货直播 GMV'),
    liveSessionsRaw: near('带货直播场次'), potentialRaw: near('带货潜力指数'),
    firstVideo: g(/首条视频时间：\s*([\d/]+)/), mcn: g(/MCN 签约：\s*(\S+)/), shopWindow: g(/橱窗状态\s*：\s*(\S+)/),
  };
}

const byId = new Map(cand.records.map((r) => [r.id, r]));
const tableOf = (tables, kw) => (tables || []).find((x) => x.headers.some((h) => h.includes(kw)));

const profiles = det.details.filter((d) => !d.error).map((d) => {
  const row = byId.get(d.id);
  const c = row?.cells || [];
  const base = parseCell0(c[0] || '');
  const ov = parseOverviewText(d.overview?.text || '');
  const t = d.tables || [];

  const products = (tableOf(t, '商品价格')?.rows || []).filter((r) => r.cells[0]).map((r) => {
    const name = r.cells[0].split('|')[0].trim();
    const cat = (r.cells[0].split('|').pop() || '').trim();
    return {
      name, cat, price: parsePriceRange(r.cells[1]),
      units: num(r.cells[2]), gmv: num(r.cells[3]),
      commission: Number(String(r.cells[5] || '').replace('%', '')) || null,
      shop: (r.cells[6] || '').split('|')[0].trim(),
      isBag: BAG_CATEGORY.test(name) || cat === '箱包',
      isSub: isSub(name), isWallet: WALLET.test(name),
    };
  });
  const videos = (tableOf(t, '视频销量')?.rows || []).filter((r) => r.cells[0]).map((r) => ({
    title: r.cells[0], type: r.cells[2], units: num(r.cells[3]), gmv: num(r.cells[4]), views: num(r.cells[5]), product: r.cells[7] || '',
  }));
  const lives = (tableOf(t, '直播销量')?.rows || []).filter((r) => /^\d{4}-\d{2}-\d{2}/.test(r.cells[1] || '')).map((r) => ({
    date: r.cells[1], units: num(r.cells[2]), gmv: num(r.cells[3]), viewers: num(r.cells[6]), uv: num(r.cells[7]), product: r.cells[8] || '',
  }));
  const shops = (tableOf(t, '合作商品数')?.rows || []).filter((r) => r.cells[1]).map((r) => ({
    shop: r.cells[1].split('|')[0].trim(), goods: num(r.cells[2]), units: num(r.cells[4]), gmv: num(r.cells[5]),
  }));

  // 子类证据池：商品表 + 视频/直播「带货商品」名（去重）
  const poolNames = [...new Set([
    ...products.map((p) => p.name), ...videos.map((v) => v.product), ...lives.map((l) => l.product),
  ].map((s) => String(s || '').split('|')[0].trim()).filter(Boolean))];
  const poolBag = poolNames.filter((n) => BAG_CATEGORY.test(n));
  const poolSub = poolBag.filter((n) => isSub(n));

  const bagP = products.filter((p) => p.isBag);
  const subP = bagP.filter((p) => p.isSub);
  const sum = (arr, k) => arr.reduce((s, x) => s + (x[k] || 0), 0);
  const avg = (arr, k) => { const u = sum(arr, 'units'); return u > 0 ? +(sum(arr, k) / u).toFixed(2) : null; };

  const fans = num(c[6]);
  const gmv28 = num(c[3]);
  const videos28 = num(ov.videos28Raw);
  const lives28 = num(ov.lives28Raw);
  const type = videos28 === 0 && lives28 > 0 ? '直播型' : lives28 === 0 && videos28 > 0 ? '视频型' : videos28 > 0 && lives28 > 0 ? '混合型' : '待判定';
  const reviewHits = videos.filter((v) => REVIEW.test(v.title)).length;
  const reviewPct = videos.length ? Math.round(reviewHits / videos.length * 100) : null;
  const commission = products.length ? +(products.reduce((s, p) => s + (p.commission || 0), 0) / products.length).toFixed(1) : null;
  const avgVideoGmv = videos.length ? Math.round(sum(videos, 'gmv') / videos.length) : null;
  const avgLiveGmv = lives.length ? Math.round(sum(lives, 'gmv') / lives.length) : null;

  return {
    id: d.id, url: d.url, ...base,
    fans, gmv28, units28: num(c[2]), gmvTotal: num(ov.totalGmvRaw),
    gmvVideo: num(ov.gmvVideoRaw), gmvLive: num(ov.gmvLiveRaw),
    videos28, lives28, type, liveSessions: num(ov.liveSessionsRaw),
    liveAvgGmv: num(ov.liveAvgGmvRaw), liveAvgSales: num(ov.liveAvgSalesRaw),
    liveAvgGmvCalc: lives.length ? Math.round(sum(lives, 'gmv') / lives.length) : null,
    potential: num(ov.potentialRaw), firstVideo: ov.firstVideo, mcn: ov.mcn, shopWindow: ov.shopWindow,
    topCats: (c[1] || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 3),
    engage: c[8] || null,
    sampleProducts: products.length, bagSample: bagP.length, subSample: subP.length,
    poolBag: poolBag.length, poolSub: poolSub.length,
    poolSubShare: poolBag.length ? Math.round(poolSub.length / poolBag.length * 100) : null,
    bagGmv: sum(bagP, 'gmv'), bagUnits: sum(bagP, 'units'), bagUnitPrice: avg(bagP, 'gmv'),
    subGmv: sum(subP, 'gmv'), subUnitPrice: avg(subP, 'gmv'),
    walletSample: subP.filter((p) => p.isWallet).length,
    commission, reviewPct, videoSample: videos.length,
    shops, avgVideoGmv, avgLiveGmv,
    estFeeVideo: avgVideoGmv && commission ? Math.round(avgVideoGmv * commission / 100) : null,
    estFeeLive: avgLiveGmv && commission ? Math.round(avgLiveGmv * commission / 100) : null,
    sampleProductNames: products.slice(0, 5).map((p) => p.name),
    sampleVideoTitles: videos.slice(0, 4).map((v) => v.title),
  };
});

fs.writeFileSync(path.join(DIR, 'profiles.json'), JSON.stringify({ generated_at: GENERATED_AT, currency: CURRENCY, subcategory: SUB, count: profiles.length, profiles }, null, 2), 'utf8');

/* ---------- 打分（可复现） ---------- */
const maxBagGmv = Math.max(0, ...profiles.map((p) => p.bagGmv || 0));
for (const p of profiles) {
  const subShare = p.poolSubShare ?? 0;
  const s = {
    子类证据: +(subShare / 100 * 25).toFixed(1),
    箱包垂直: +(Math.min(p.bagSample, 5) / 5 * 15).toFixed(1),
    包GMV: maxBagGmv ? +((p.bagGmv || 0) / maxBagGmv * 15).toFixed(1) : 0,
    客单价: +(clamp((p.bagUnitPrice ?? 0) / 500) * 10).toFixed(1),
    测评: +((p.reviewPct ?? 0) / 100 * 15).toFixed(1),
    粉丝匹配: (p.fans >= 20000 && p.fans <= 100000 ? 10 : 0),
    佣金友好: +(clamp((13 - (p.commission ?? 13)) / 6) * 10).toFixed(1),
  };
  p.scores = s;
  p.total = +Object.values(s).reduce((a, b) => a + b, 0).toFixed(1);
}

const eligible = profiles
  .filter((p) => p.fans >= 20000 && p.fans <= 100000 && p.bagSample > 0 && (p.poolSub || 0) >= 2)
  .sort((a, b) => b.total - a.total);
const top = eligible.slice(0, TOP);
fs.writeFileSync(path.join(DIR, 'top10.json'), JSON.stringify({ generated_at: GENERATED_AT, currency: CURRENCY, subcategory: SUB, criteria: '粉丝2-10万 / 带货分类箱包 / 子类证据≥2', eligible: eligible.length, top }, null, 2), 'utf8');

/* ---------- 文案规则 ---------- */
const tagsOf = (p) => {
  const t = [];
  if (p.bagUnitPrice != null && p.bagUnitPrice < 70) t.push('平价走量');
  if (p.bagUnitPrice >= 200) t.push('中高客单');
  if (p.walletSample >= 2) t.push('钱包/小皮件为主');
  if (p.type === '直播型') t.push('直播专场');
  if (p.type === '混合型') t.push('短视频+直播');
  if ((p.reviewPct ?? 0) >= 50) t.push('测评/开箱');
  if ((p.liveAvgGmv ?? 0) >= 100000) t.push('大场直播');
  if ((p.poolBag || 0) >= 6) t.push('箱包全覆盖');
  return t.length ? t : ['综合带货'];
};
const strengthsOf = (p) => {
  const s = [];
  if ((p.poolSubShare ?? 0) >= 80) s.push(`${SUB}证据占比 ${p.poolSubShare}%（样本 ${p.poolSub}/${p.poolBag}），类目高度匹配`);
  if ((p.bagUnitPrice ?? 0) >= 200) s.push(`包件均 ${CURRENCY === 'THB' ? '฿' : ''}${fmt(p.bagUnitPrice)}，能撑中高客单`);
  if ((p.gmv28 || 0) >= 1500000) s.push(`近28天总 GMV ${fmt(p.gmv28)}，账号有稳定出单`);
  if ((p.reviewPct ?? 0) >= 50) s.push(`视频样本里测评内容 ${p.reviewPct}%，适合做开箱/对比脚本`);
  if ((p.commission ?? 99) <= 10) s.push(`佣金 ${p.commission}%，品牌侧成本可控`);
  if (!s.length) s.push('箱包类目样本占比高，可作为补位人选');
  return s;
};
const risksOf = (p) => {
  const r = [];
  if ((p.videos28 || 0) === 0) r.push('近28天无视频发布，短视频合作无历史数据支撑');
  if ((p.bagUnitPrice ?? 0) < 60) r.push(`包件均仅 ${fmt(p.bagUnitPrice)}，低价包为主，正价转化待验证`);
  if ((p.poolSubShare ?? 0) < 60) r.push(`子类证据仅 ${p.poolSub}/${p.poolBag}，存在混售可能`);
  if (p.walletSample >= 3) r.push('以钱包/小皮件为主，手袋客单结构不同于正价女包');
  if ((p.fans || 0) > 90000) r.push('粉丝接近 10 万上限，超出后报价通常跳档');
  if (!p.gmvVideo) r.push('带货视频 GMV 缺失，视频挂车能力无法量化');
  r.push('报价、退货率、点击转化率平台未提供，需询价与小额测试');
  return r;
};
const cooperateOf = (p) => {
  const out = [];
  const liveGmv = p.liveAvgGmv ?? p.liveAvgGmvCalc;
  if (p.type === '直播型' || (p.lives28 || 0) >= 5) out.push(`直播：先 1 场混场（历史均场 ${liveGmv ? fmt(liveGmv) : '未知'}），按 UV 价值结算验证`);
  if ((p.reviewPct ?? 0) >= 40) out.push('短视频：测评/开箱形式（有测评内容历史）');
  else if ((p.videos28 || 0) > 0) out.push('短视频：挂车口播，先 1–2 条测试');
  if ((p.bagUnitPrice ?? 999) < 60) out.push('置换：低价包可先纯佣/置换测水温');
  if (!out.length) out.push('先纯佣挂车测试，数据达标后再谈坑位');
  return out;
};

/* ---------- 渲染 ---------- */
const L = [];
L.push(`# 泰国${SUB} · 达人档案（Top ${top.length}）`);
L.push('');
L.push(`> 数据源：FastMoss 网页实测（\`${path.basename(DIR)}\`）· 采集 ${GENERATED_AT} · 币种 ${CURRENCY} · 周期 近28天`);
L.push(`> 池子：${cand.records.length} 位列表（粉丝 2–10 万 / 带货分类=箱包）→ 深采 ${profiles.length} 位 → ${SUB}证据 ≥2 的 ${eligible.length} 位中取前 ${top.length}`);
L.push('');
L.push('## 打分口径（可复现）');
L.push('');
L.push(`| 维度 | 权重 | 计算方式 |`);
L.push(`|---|---|---|`);
L.push(`| ${SUB}证据 | 25 | ${SUB}商品数 ÷ 箱包商品数（商品表 + 视频/直播带货商品名去重） |`);
L.push(`| 箱包垂直 | 15 | 详情商品表箱包数 ÷ 5（页面只给 Top5 商品） |`);
L.push(`| 包 GMV | 15 | 样本包 GMV ÷ 池内最大值 ×15 |`);
L.push(`| 客单价 | 10 | 包件均 ÷ 500 封顶 ×10 |`);
L.push(`| 测评属性 | 15 | 视频标题含 รีวิว/测评/unbox 等占比 ×15 |`);
L.push(`| 粉丝匹配 | 10 | 2–10 万区间内满分 |`);
L.push(`| 佣金友好 | 10 | (13% − 佣金率) ÷ 6 ×10，封顶 10 |`);
L.push('');
L.push('## 推荐名单');
L.push('');
L.push(`| # | 达人 | 粉丝 | 类型 | ${SUB}证据 | 包件均 | 28天GMV | 包GMV | 佣金 | 测评 | 得分 |`);
L.push('|---|---|---|---|---|---|---|---|---|---|---|');
top.forEach((p, i) => {
  L.push(`| ${i + 1} | ${p.name} | ${(p.fans / 10000).toFixed(2)}万 | ${p.type} | ${p.poolSub}/${p.poolBag}（${p.poolSubShare}%） | ${p.bagUnitPrice ? fmt(p.bagUnitPrice) : '—'} | ${p.gmv28 ? fmt(p.gmv28) : '—'} | ${p.bagGmv ? fmt(p.bagGmv) : '—'} | ${p.commission ?? '—'}% | ${p.reviewPct == null ? '无视频样本' : p.reviewPct + '%'} | **${p.total}** |`);
});
L.push('');
L.push('> 说明：包GMV/件均来自详情页 Top5 带货商品样本，不是全店口径；子类证据同为样本判定，非全量。');
L.push('');
L.push('## 逐位档案');
L.push('');
top.forEach((p, i) => {
  L.push(`### ${i + 1}. ${p.name}（${p.handle}）`);
  L.push('');
  L.push(`- 主页：${p.url}`);
  L.push(`- 基础数据：粉丝 ${(p.fans / 10000).toFixed(2)} 万 · ${p.gender ?? '性别'} ${p.genderPct ?? '—'}% · 主力年龄 ${p.age ?? '—'} · ${p.type} · 近28天视频 ${p.videos28 ?? '—'} 条 / 直播 ${p.lives28 ?? '—'} 场 · MCN ${p.mcn ?? '未知'} · 橱窗 ${p.shopWindow ?? '未知'}`);
  L.push(`- 带货规模：近28天 GMV ${fmt(p.gmv28)} · 累计 ${p.gmvTotal ? fmt(p.gmvTotal) : '未获取'} · 视频GMV ${p.gmvVideo ? fmt(p.gmvVideo) : '未获取'} · 直播GMV ${p.gmvLive ? fmt(p.gmvLive) : '未获取'} · 潜力指数 ${p.potential ?? '—'}`);
  L.push(`- 包类结构：样本 ${p.bagSample}/${p.sampleProducts} 为箱包 · ${SUB} ${p.poolSub}/${p.poolBag}（${p.poolSubShare}%）· 包件均 ${fmt(p.bagUnitPrice)} · 平均佣金 ${p.commission ?? '—'}%`);
  L.push(`- 内容标签：${tagsOf(p).join('、')}`);
  L.push(`- 商品/内容样本：${p.sampleProductNames.slice(0, 3).map((s) => s.slice(0, 42)).join('；')}`);
  L.push(`- 优势：${strengthsOf(p).join('；')}`);
  L.push(`- 风险点：${risksOf(p).join('；')}`);
  L.push(`- 收益锚（计算值，**非平台报价**）：历史单条视频平均佣金收入 ≈ ${fmt(p.estFeeVideo)}；单场直播平均佣金收入 ≈ ${fmt(p.estFeeLive)}；真实坑位费需私信询价`);
  L.push(`- 适配合作形式：${cooperateOf(p).join('；')}`);
  L.push(`- 合作店铺（竞品覆盖）：${p.shops.slice(0, 4).map((s) => `${s.shop}(GMV ${fmt(s.gmv)})`).join('、') || '无样本'}`);
  L.push('');
});

// 竞品 / 同货源重合度
const shopAgg = new Map();
for (const p of profiles) for (const s of p.shops) {
  const cur = shopAgg.get(s.shop) || { shop: s.shop, creators: new Set(), gmv: 0 };
  cur.creators.add(p.name); cur.gmv += s.gmv || 0; shopAgg.set(s.shop, cur);
}
const shopTop = [...shopAgg.values()].sort((a, b) => b.creators.size - a.creators.size).slice(0, 10);
L.push('## 竞品 / 同货源重合度（全部深采样本的推广店铺）');
L.push('');
L.push('| 店铺 | 覆盖达人数 | 样本内合计 GMV | 说明 |');
L.push('|---|---|---|---|');
shopTop.forEach((s) => L.push(`| ${s.shop} | ${s.creators.size} | ${fmt(s.gmv)} | ${s.creators.size >= 8 ? '多数样本达人都接过，属公版货源' : '局部合作'} |`));
L.push('');
L.push('> 口径：仅统计详情页「合作店铺」样本行（每人最多 5 行），频次按达人去重；不代表全平台合作次数，也不能证明付费合作。');
L.push('');

fs.writeFileSync(path.join(DIR, '达人档案.md'), L.join('\n'), 'utf8');

console.log(`写出：profiles.json / top10.json / 达人档案.md → ${DIR}`);
console.log(`深采 ${profiles.length} 位 · ${SUB}合格池 ${eligible.length} 位 · 输出 Top ${top.length}`);
console.log(['#', '达人', '粉丝', `${SUB}证据`, '件均', '测评', '得分'].join('\t'));
top.forEach((p, i) => console.log([i + 1, p.name, p.fans, `${p.poolSub}/${p.poolBag}`, p.bagUnitPrice, p.reviewPct, p.total].join('\t')));
