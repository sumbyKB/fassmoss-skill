// HTML报告与Markdown共用趋势规则，保留原有颜色与表格样式。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SKILL_ROOT } from './lib/config.mjs';
import { parseArgs } from './lib/cli.mjs';
import { preparePhonecaseReport } from './lib/product-trend.mjs';

export function renderPhonecaseReportHtml(r) {
  const { salesRows, newRows, st, nt } = preparePhonecaseReport(r);
  const esc = value => String(value ?? '未知').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const short = (value, length = 40) => { const text = String(value || '').replace(/\s+/g, ' ').trim(); return text.length > length ? text.slice(0, length) + '…' : text; };
  const linkOf = row => row.source_url ? '<a href="' + esc(row.source_url) + '" target="_blank" rel="noopener noreferrer" class="link">详情 ↗</a>' : '<span class="muted">未知</span>';
  // 趋势徽章样式（涨=红、跌=绿、稳定=蓝、爬坡=橙、未知=灰）
  const TREND_STYLE = {
    '上升': { cls: 'up', label: '上升 ▲' },
    '下滑': { cls: 'down', label: '下滑 ▼' },
    '稳定': { cls: 'flat', label: '稳定 —' },
    '新近起量': { cls: 'ramp', label: '新近起量 ▲' },
    '未知': { cls: 'na', label: '未知' },
  };
  const badge = (t) => { const s = TREND_STYLE[t] || TREND_STYLE['未知']; return `<span class="badge ${s.cls}">${s.label}</span>`; };

  // 环比着色（正值红、负值绿、无数据灰）
  function wowCell(v, pct) {
    if (v == null || v === '' || v === '-') return '<span class="muted">—</span>';
    const cls = pct > 0 ? 'pos' : pct < 0 ? 'neg' : 'zero';
    return `<span class="${cls}">${esc(v)}</span>`;
  }

  // 占比色块条
  function bar(entries) {
    const total = entries.reduce((s, e) => s + e.n, 0) || 1;
    return `<div class="bar">` + entries.map((e) =>
      `<div class="seg ${e.cls}" style="width:${(e.n / total * 100).toFixed(1)}%" title="${e.label} ${e.n}"></div>`
    ).join('') + `</div>`;
  }
  function legend(entries) {
    return entries.map((e) =>
      `<span class="legend"><i class="dot ${e.cls}"></i>${e.label} <b>${e.n}</b></span>`
    ).join('');
  }

  const salesDist = [
    { label: '上升', n: st.上升, cls: 'up' }, { label: '稳定', n: st.稳定, cls: 'flat' },
    { label: '下滑', n: st.下滑, cls: 'down' }, { label: '未知', n: st.未知, cls: 'na' },
  ];
  const newDist = [
    { label: '上升', n: nt.上升, cls: 'up' }, { label: '新近起量', n: nt.新近起量, cls: 'ramp' },
    { label: '稳定', n: nt.稳定, cls: 'flat' }, { label: '下滑', n: nt.下滑, cls: 'down' },
    { label: '未知', n: nt.未知, cls: 'na' },
  ];

  // —— 表格行 ——
  const salesRowsHtml = salesRows.map((p, i) => `
    <tr>
      <td class="rank">${i + 1}</td>
      <td class="prod" title="${esc(p.product)}">${esc(short(p.product))}<div class="shop">${esc(p.shop)}</div></td>
      <td class="num">${esc(p.units ?? p.units_7d)}</td>
      <td class="num">${wowCell(p.units_wow, p.wow_pct)}</td>
      <td class="num">${esc(p.total_units)}</td>
      <td>${badge(p.trend)}</td>
      <td>${linkOf(p)}</td>
    </tr>`).join('');

  const newRowsHtml = newRows.map((p, i) => `
    <tr>
      <td class="rank">${i + 1}</td>
      <td class="prod" title="${esc(p.product)}">${esc(short(p.product))}<div class="shop">${esc(p.shop)}${p.list_date ? ' · ' + esc(p.list_date) : ''}</div></td>
      <td class="num">${esc(p.units_3d)}</td>
      <td class="num">${p.units_7d != null ? esc(p.units_7d) : '<span class="muted">—</span>'}</td>
      <td class="num">${esc(p.total_units)}</td>
      <td>${badge(p.trend)}</td>
      <td>${linkOf(p)}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
  <html lang="zh-CN">
  <head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(r.country || "未知")} 手机壳双榜趋势分析</title>
  <style>
  :root{
    --up:#e5484d; --up-bg:#fdecec;
    --down:#16a34a; --down-bg:#e6f4ea;
    --flat:#2563eb; --flat-bg:#e8f0fe;
    --ramp:#ea8600; --ramp-bg:#fff3e0;
    --na:#8b919d; --na-bg:#f3f4f6;
    --ink:#1f283c; --sub:#6b7280; --line:#e5e7eb;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#f5f6f8;color:var(--ink);line-height:1.55;padding:28px 20px}
  .wrap{max-width:1180px;margin:0 auto}
  h1{font-size:22px;letter-spacing:.3px}
  .meta{color:var(--sub);font-size:13px;margin:8px 0 4px}
  .chip{display:inline-block;background:#fff;border:1px solid var(--line);border-radius:6px;padding:2px 8px;font-size:12px;color:var(--sub);margin:2px 4px 0 0}
  .card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin:16px 0;box-shadow:0 1px 3px rgba(0,0,0,.04)}
  .card h2{font-size:16px;margin-bottom:12px;display:flex;align-items:center;gap:8px}
  .card h2 .tag{font-size:11px;font-weight:500;padding:1px 8px;border-radius:10px;background:#eef2ff;color:#4f46e5}
  .bar{display:flex;height:14px;border-radius:7px;overflow:hidden;background:#eee;margin:6px 0 12px}
  .seg{height:100%}
  .dot{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:middle}
  .legend{display:inline-block;margin-right:16px;font-size:13px;color:var(--sub)}
  .legend b{color:var(--ink)}
  .up{background:var(--up)} .down{background:var(--down)} .flat{background:var(--flat)} .ramp{background:var(--ramp)} .na{background:var(--na)}
  .badge{display:inline-block;font-size:12px;font-weight:600;padding:2px 9px;border-radius:11px;white-space:nowrap}
  .badge.up{color:var(--up);background:var(--up-bg)} .badge.down{color:var(--down);background:var(--down-bg)}
  .badge.flat{color:var(--flat);background:var(--flat-bg)} .badge.ramp{color:var(--ramp);background:var(--ramp-bg)}
  .badge.na{color:var(--na);background:var(--na-bg)}
  table{width:100%;border-collapse:collapse;font-size:13px}
  thead th{position:sticky;top:0;background:#fafbfc;text-align:left;padding:9px 8px;border-bottom:2px solid var(--line);font-size:12px;color:var(--sub);white-space:nowrap}
  tbody td{padding:8px;border-bottom:1px solid #f0f1f3;vertical-align:top}
  tbody tr:nth-child(even){background:#fafbfc}
  tbody tr:hover{background:#f2f6ff}
  td.rank{color:var(--sub);font-weight:600;width:38px;text-align:center}
  td.prod{max-width:340px}
  .shop{font-size:11px;color:var(--sub);margin-top:2px}
  .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
  .pos{color:var(--up);font-weight:600} .neg{color:var(--down);font-weight:600} .zero{color:var(--sub)}
  .muted{color:#c3c8d0}
  .link{color:#4f46e5;text-decoration:none;font-size:12px;white-space:nowrap}
  .link:hover{text-decoration:underline}
  .note{font-size:13px;color:var(--sub)}
  .note li{margin:4px 0 4px 18px}
  .kv{font-size:13px;color:var(--sub);margin-top:6px}
  </style>
  </head>
  <body>
  <div class="wrap">
    <h1>${esc(r.country || "未知")} 手机壳 · 双榜销量趋势</h1>
    <div class="meta">采集时间 ${esc((r.collected_at || '').slice(0, 19).replace('T', ' '))} · 国家/币种 ${esc(r.country || "未知")} / ${esc(r.currency || "未知")}</div>
    <div><span class="chip">${esc(r.category || '')}</span></div>

    <div class="card">
      <h2>趋势总览 <span class="tag">红=上升 · 绿=下滑 · 蓝=稳定 · 橙=新近起量</span></h2>
      <div class="kv"><b>销量榜</b>（有效榜单周期，趋势=平台环比）：${legend(salesDist)}</div>
      ${bar(salesDist)}
      <div class="kv"><b>新品榜</b>（三日销量，趋势=近3日 vs 前4日）：${legend(newDist)}</div>
      ${bar(newDist)}
    </div>

    <div class="card">
      <h2>销量榜样本 ${salesRows.length} 件 <span class="tag">榜单周期销量 · 平台环比</span></h2>
      <table>
        <thead><tr><th>#</th><th>商品 / 店铺</th><th>榜单周期销量</th><th>销量环比</th><th>总销量</th><th>趋势</th><th></th></tr></thead>
        <tbody>${salesRowsHtml}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>新品榜样本 ${newRows.length} 件 <span class="tag">三日销量 · 近7天由详情页补抓</span></h2>
      <table>
        <thead><tr><th>#</th><th>商品 / 店铺·上架</th><th>三日销量</th><th>近7天销量</th><th>总销量</th><th>趋势</th><th></th></tr></thead>
        <tbody>${newRowsHtml}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>口径与说明</h2>
      <ul class="note">
        <li><b>销量榜</b>：date_type=${esc(r.saleslist?.date_type)}，date_value=${esc(r.saleslist?.date_value)}；销量属于该有效榜单周期，缺环比时未知。</li>
        <li><b>新品榜</b>：列表固定三日口径；详情近7天销量由同一完整逐日序列求和。当前趋势未知 ${nt.未知} 件，逐条保留缺失原因，不推断为商品过新。</li>
        <li><b>趋势分级</b>：新品趋势仅用详情同一个完整近7天序列：最近3日日均÷前4日日均；基期为0且近期有销量为新近起量。日期/销量/周期证据不完整时未知。</li>
        <li>「手机壳」按商品名关键词判定（case/cover/shell/bumper + phone/iPhone，排除屏幕保护膜/镜头膜），个别边界商品可能有少量误判。</li>
        <li>数据来自FastMoss网页正常操作触发的数据；销量为平台口径，不据此推算退货率或利润。</li>
      </ul>
    </div>
  </div>
  </body>
  </html>`;
  return html;
}

export function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(['phonecase-html', ...argv]);
  if (opts.help) { console.log('render-phonecase-report-html.mjs --file result.json [--out report.html]，或 --dir <结果目录>'); return; }
  const file = path.resolve(opts.file || path.join(opts.dir || path.join(SKILL_ROOT, 'outputs', 'latest'), 'result.json'));
  const out = path.resolve(opts.out || path.join(path.dirname(file), '手机壳趋势分析.html'));
  if (!out.toLowerCase().endsWith('.html') || out === file) throw new Error('HTML输出需为独立.html文件');
  const html = renderPhonecaseReportHtml(JSON.parse(fs.readFileSync(file, 'utf8')));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html, 'utf8');
  console.log('HTML报告写出：', out);
  return out;
}
if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error('报告失败：', error.message); process.exitCode = 1; }
}
