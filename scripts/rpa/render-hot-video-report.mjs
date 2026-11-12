// 生成「手机配件·视频商品榜 Top50」HTML 报告：按近7天新发布带货视频数排序，标注品类 + 销量。
// 用法：node scripts/rpa/render-hot-video-report.mjs
import fs from 'node:fs';
import path from 'node:path';
import { SKILL_ROOT } from './lib/config.mjs';
import { parseAmount } from './data-rules.mjs';

const SRC = path.join(SKILL_ROOT, 'outputs', '2026-11-12-us-phonecase-video', 'hotvideo-3level.json');
const OUT_HTML = path.join(SKILL_ROOT, 'outputs', '2026-11-12-us-phonecase-video', '手机壳视频榜Top50.html');
const OUT_JSON = path.join(SKILL_ROOT, 'outputs', '2026-11-12-us-phonecase-video', 'top50-3level.json');

const d = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const short = (s, n = 46) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

// 品类判定（hotvideo 只到二级「手机配件」，无三级分类，按商品名归类）
// 顺序很重要：先判明确品类，再判手机壳，最后才判支架（避免「带支架的手机壳」被误判成支架）
function categoryOf(name) {
  const n = String(name || '');
  if (/power\s*bank|battery|充电宝|移动电源/i.test(n)) return '充电宝';
  if (/screen\s*protector|privacy\s*screen|tempered|glass|film|贴膜|保护膜|\blens\b|\bprotector\b/i.test(n)) return '屏幕膜/镜头膜';
  if (/charger|charging|cable|adapter|usb|数据线|充电器/i.test(n)) return '线材/充电器';
  if (/\b(case|cases|cover|casing|shell|bumper)\b/i.test(n) && /phone|iphone|cellphone|smartphone|samsung|android|galaxy|pixel|mag-?safe|手机/i.test(n)) return '手机壳';
  if (/\bstand\b|\bgrip\b|\bmount\b|holder|支架/i.test(n)) return '支架/握把';
  if (/sticker|decal|贴纸/i.test(n)) return '贴纸/装饰';
  return '其他配件';
}

const CAT_STYLE = {
  '手机壳': 'cat-case', '充电宝': 'cat-power', '线材/充电器': 'cat-cable',
  '屏幕膜/镜头膜': 'cat-screen', '支架/握把': 'cat-stand', '贴纸/装饰': 'cat-deco', '其他配件': 'cat-other',
};

const rows = d.products
  .filter((p) => p.video_count != null)
  .sort((a, b) => b.video_count - a.video_count)
  .slice(0, 50)
  .map((p, i) => ({
    rank: i + 1,
    product: p.product,
    category: categoryOf(p.product),
    video_count: p.video_count,
    total_units: p.total_units,
    total_gmv: p.total_gmv,
    total_play: p.total_play,
    total_like: p.total_like,
    total_comment: p.total_comment,
    id: p.id,
    source_url: p.source_url,
  }));

// 纯手机壳（名字判定：case/cover + phone，排除屏幕膜/充电宝/线材），按视频数取前20
function isPhoneCase(name) {
  const n = String(name || '');
  const hasCase = /\b(case|cases|cover|casing|shell|bumper)\b/i.test(n);
  const hasPhone = /phone|iphone|cellphone|smartphone|samsung|android|galaxy|pixel|mag-?safe|手机/i.test(n);
  const isScreen = /screen\s*protector|privacy\s*screen|tempered|glass|film|贴膜|保护膜|\bprotector\b|\blens\b/i.test(n);
  const isPowerCable = /power\s*bank|battery|charger|charging|cable|adapter|usb/i.test(n);
  return hasCase && hasPhone && !isScreen && !isPowerCable;
}
const caseRows = d.products
  .filter((p) => p.video_count != null && isPhoneCase(p.product))
  .sort((a, b) => b.video_count - a.video_count)
  .slice(0, 50)
  .map((p, i) => ({ rank: i + 1, product: p.product, video_count: p.video_count, total_units: p.total_units, total_gmv: p.total_gmv, source_url: p.source_url }));

// 统计
const maxV = Math.max(...rows.map((r) => r.video_count));
const catCount = {};
rows.forEach((r) => catCount[r.category] = (catCount[r.category] || 0) + 1);
const sumUnits = rows.reduce((s, r) => s + (parseAmount(r.total_units) || 0), 0);

const rowsHtml = rows.map((r) => {
  const w = Math.max(4, Math.round(r.video_count / maxV * 100));
  return `
  <tr>
    <td class="rank">${r.rank}</td>
    <td class="prod"><span class="cat ${CAT_STYLE[r.category] || 'cat-other'}">${esc(r.category)}</span><div class="pname" title="${esc(r.product)}">${esc(short(r.product))}</div></td>
    <td class="num"><div class="vbar"><span style="width:${w}%"></span><b>${r.video_count}</b></div></td>
    <td class="num strong">${esc(r.total_units)}</td>
    <td class="num">${esc(r.total_gmv)}</td>
    <td class="num">${esc(r.total_play)}</td>
    <td class="num">${esc(r.total_like)}</td>
    <td><a href="${esc(r.source_url)}" target="_blank" class="link">详情 ↗</a></td>
  </tr>`;
}).join('');

const catLegend = Object.entries(catCount).sort((a, b) => b[1] - a[1])
  .map(([c, n]) => `<span class="legend"><i class="dot ${CAT_STYLE[c] || 'cat-other'}"></i>${esc(c)} <b>${n}</b></span>`).join('');

const caseRowsHtml = caseRows.map((r) => `
  <tr>
    <td class="rank">${r.rank}</td>
    <td class="prod"><div class="pname" title="${esc(r.product)}">${esc(short(r.product))}</div></td>
    <td class="num"><span class="badge-hot">${r.video_count} 条</span></td>
    <td class="num strong">${esc(r.total_units)}</td>
    <td class="num">${esc(r.total_gmv)}</td>
    <td><a href="${esc(r.source_url)}" target="_blank" class="link">详情 ↗</a></td>
  </tr>`).join('');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>美区手机配件 · 近7天新发布带货视频数 Top50</title>
<style>
:root{--ink:#1f283c;--sub:#6b7280;--line:#e5e7eb;--hot:#e5484d;--hot-bg:#fdecec}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#f5f6f8;color:var(--ink);line-height:1.55;padding:28px 20px}
.wrap{max-width:1200px;margin:0 auto}
h1{font-size:22px;letter-spacing:.3px}
.meta{color:var(--sub);font-size:13px;margin:8px 0 4px}
.chip{display:inline-block;background:#fff;border:1px solid var(--line);border-radius:6px;padding:2px 8px;font-size:12px;color:var(--sub);margin:2px 4px 0 0}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin:16px 0;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.card h2{font-size:16px;margin-bottom:12px;display:flex;align-items:center;gap:8px}
.card h2 .tag{font-size:11px;font-weight:500;padding:1px 8px;border-radius:10px;background:#eef2ff;color:#4f46e5}
.kpi{display:flex;gap:24px;flex-wrap:wrap}
.kpi .item{min-width:120px}
.kpi .v{font-size:24px;font-weight:700;color:var(--hot)}
.kpi .l{font-size:12px;color:var(--sub)}
.legend-wrap{margin-top:10px}
.legend{display:inline-block;margin:4px 16px 0 0;font-size:13px;color:var(--sub)}
.legend b{color:var(--ink)}
.dot{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:middle}
table{width:100%;border-collapse:collapse;font-size:13px}
thead th{position:sticky;top:0;background:#fafbfc;text-align:left;padding:9px 8px;border-bottom:2px solid var(--line);font-size:12px;color:var(--sub);white-space:nowrap}
tbody td{padding:8px;border-bottom:1px solid #f0f1f3;vertical-align:top}
tbody tr:nth-child(even){background:#fafbfc}
tbody tr:hover{background:#f2f6ff}
td.rank{color:var(--sub);font-weight:600;width:40px;text-align:center}
td.prod{max-width:430px}
.pname{font-size:12.5px}
.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.strong{font-weight:700;color:#111827}
.vbar{display:flex;align-items:center;justify-content:flex-end;gap:6px}
.vbar span{display:inline-block;height:9px;border-radius:5px;background:linear-gradient(90deg,#ff9a9e,#e5484d);min-width:4px;max-width:90px;width:auto}
.vbar b{font-size:13px;color:var(--hot);min-width:26px;text-align:right}
.cat{display:inline-block;font-size:11px;font-weight:600;padding:1px 7px;border-radius:9px;margin-bottom:3px}
.cat-case{background:#e8f0fe;color:#2563eb}
.cat-power{background:#fff3e0;color:#ea8600}
.cat-cable{background:#f3e8ff;color:#9333ea}
.cat-screen{background:#e0f2fe;color:#0284c7}
.cat-stand{background:#dcfce7;color:#16a34a}
.cat-deco{background:#fce7f3;color:#db2777}
.cat-other{background:#f3f4f6;color:#6b7280}
.badge-hot{display:inline-block;font-size:12px;font-weight:600;padding:1px 8px;border-radius:10px;background:var(--hot-bg);color:var(--hot)}
.link{color:#4f46e5;text-decoration:none;font-size:12px;white-space:nowrap}
.link:hover{text-decoration:underline}
.note{font-size:13px;color:var(--sub)}
.note li{margin:4px 0 4px 18px}
</style>
</head>
<body>
<div class="wrap">
  <h1>美区手机壳 · 近7天新发布带货视频数 Top50</h1>
  <div class="meta">采集时间 ${esc((d.meta.collected_at || '').slice(0, 19).replace('T', ' '))} · 国家/币种 美国 / USD · 时间范围 ${esc(d.meta.time_range || '过去7天')}</div>
  <div><span class="chip">手机与数码(16) → 手机配件(909064) → 保护壳、屏幕保护膜、皮肤(601925)</span><span class="chip">三级类目样本 ${d.products.length} 个</span><span class="chip">按「新发布带货视频数」排序</span></div>

  <div class="card">
    <h2>概览</h2>
    <div class="kpi">
      <div class="item"><div class="v">${rows.length}</div><div class="l">入榜商品</div></div>
      <div class="item"><div class="v">${maxV}</div><div class="l">最高新发布视频数</div></div>
      <div class="item"><div class="v">${rows[rows.length - 1]?.video_count ?? '-'}</div><div class="l">第50名视频数</div></div>
      <div class="item"><div class="v">${sumUnits.toLocaleString()}</div><div class="l">Top50 总销量合计</div></div>
    </div>
    <div class="legend-wrap">${catLegend}</div>
  </div>

  <div class="card">
    <h2>三级类目 Top50 <span class="tag">保护壳·屏幕膜·皮肤 混排｜视频数=近7天新发布 · 销量=总销量</span></h2>
    <table>
      <thead><tr><th>#</th><th>商品 / 品类</th><th>新发布视频数</th><th>总销量</th><th>总销售额</th><th>总播放量</th><th>总点赞</th><th></th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>

  <div class="card">
    <h2>纯手机壳 Top50 <span class="tag">从三级类目中按商品名筛出手机壳（排除屏幕膜/镜头膜）</span></h2>
    <table>
      <thead><tr><th>#</th><th>商品</th><th>新发布视频数</th><th>总销量</th><th>总销售额</th><th></th></tr></thead>
      <tbody>${caseRowsHtml}</tbody>
    </table>
  </div>

  <div class="card">
    <h2>口径与说明</h2>
    <ul class="note">
      <li><b>视频数量</b>来自「视频商品榜」每行「视频内容」列的「X条新发布带货视频」，即所选时间范围（近7天）内达人新发布的带货视频数；这是平台已聚合好的口径，非本地统计。</li>
      <li><b>排序</b>：页面默认按总销量排序，「视频内容」列不可排序；本报告采集 ${d.meta.pages_requested} 页（${d.products.length} 个商品）后，在本地按「新发布视频数」降序取前 50。</li>
      <li><b>分类</b>：本次用三级筛选 <code>l3_cid=601925</code>（保护壳、屏幕保护膜、皮肤），比二级「手机配件」精确，已排除充电宝/线材/支架；但该三级仍含屏幕膜，所以另出「纯手机壳 Top50」——由商品名再筛（case/cover + phone，排除 screen protector/lens）。</li>
      <li><b>销量</b>=该商品总销量（累计口径），不是近7天销量；如需近7天销量可再配合销量榜核对。</li>
      <li>数据来自 FastMoss 网页 DOM（非 API），采集为登录状态；页面翻页偶有渲染竞态，已做稳定性检测与去重。</li>
    </ul>
  </div>
</div>
</body>
</html>`;

fs.writeFileSync(OUT_HTML, html, 'utf8');
fs.writeFileSync(OUT_JSON, JSON.stringify({ meta: d.meta, top50: rows }, null, 2), 'utf8');
console.log('HTML 报告：', OUT_HTML);
console.log('Top50 JSON：', OUT_JSON);
console.log('Top50 视频数门槛：', rows[rows.length - 1]?.video_count);
