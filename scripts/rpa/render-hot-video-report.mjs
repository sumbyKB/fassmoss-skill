// 视频商品榜离线报告：只对已采集样本排序，输入和输出均可配置。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SKILL_ROOT } from './lib/config.mjs';
import { parseArgs } from './lib/cli.mjs';
import { parseAmount } from './data-rules.mjs';
import { safeProductLink, isPhoneCase } from './lib/product-trend.mjs';

const reportStyle = "\n:root{--ink:#1f283c;--sub:#6b7280;--line:#e5e7eb;--hot:#e5484d;--hot-bg:#fdecec}\n*{box-sizing:border-box;margin:0;padding:0}\nbody{font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",\"PingFang SC\",\"Microsoft YaHei\",sans-serif;background:#f5f6f8;color:var(--ink);line-height:1.55;padding:28px 20px}\n.wrap{max-width:1200px;margin:0 auto}\nh1{font-size:22px;letter-spacing:.3px}\n.meta{color:var(--sub);font-size:13px;margin:8px 0 4px}\n.chip{display:inline-block;background:#fff;border:1px solid var(--line);border-radius:6px;padding:2px 8px;font-size:12px;color:var(--sub);margin:2px 4px 0 0}\n.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin:16px 0;box-shadow:0 1px 3px rgba(0,0,0,.04)}\n.card h2{font-size:16px;margin-bottom:12px;display:flex;align-items:center;gap:8px}\n.card h2 .tag{font-size:11px;font-weight:500;padding:1px 8px;border-radius:10px;background:#eef2ff;color:#4f46e5}\n.kpi{display:flex;gap:24px;flex-wrap:wrap}\n.kpi .item{min-width:120px}\n.kpi .v{font-size:24px;font-weight:700;color:var(--hot)}\n.kpi .l{font-size:12px;color:var(--sub)}\n.legend-wrap{margin-top:10px}\n.legend{display:inline-block;margin:4px 16px 0 0;font-size:13px;color:var(--sub)}\n.legend b{color:var(--ink)}\n.dot{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:middle}\ntable{width:100%;border-collapse:collapse;font-size:13px}\nthead th{position:sticky;top:0;background:#fafbfc;text-align:left;padding:9px 8px;border-bottom:2px solid var(--line);font-size:12px;color:var(--sub);white-space:nowrap}\ntbody td{padding:8px;border-bottom:1px solid #f0f1f3;vertical-align:top}\ntbody tr:nth-child(even){background:#fafbfc}\ntbody tr:hover{background:#f2f6ff}\ntd.rank{color:var(--sub);font-weight:600;width:40px;text-align:center}\ntd.prod{max-width:430px}\n.pname{font-size:12.5px}\n.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}\n.strong{font-weight:700;color:#111827}\n.vbar{display:flex;align-items:center;justify-content:flex-end;gap:6px}\n.vbar span{display:inline-block;height:9px;border-radius:5px;background:linear-gradient(90deg,#ff9a9e,#e5484d);min-width:4px;max-width:90px;width:auto}\n.vbar b{font-size:13px;color:var(--hot);min-width:26px;text-align:right}\n.cat{display:inline-block;font-size:11px;font-weight:600;padding:1px 7px;border-radius:9px;margin-bottom:3px}\n.cat-case{background:#e8f0fe;color:#2563eb}\n.cat-power{background:#fff3e0;color:#ea8600}\n.cat-cable{background:#f3e8ff;color:#9333ea}\n.cat-screen{background:#e0f2fe;color:#0284c7}\n.cat-stand{background:#dcfce7;color:#16a34a}\n.cat-deco{background:#fce7f3;color:#db2777}\n.cat-other{background:#f3f4f6;color:#6b7280}\n.badge-hot{display:inline-block;font-size:12px;font-weight:600;padding:1px 8px;border-radius:10px;background:var(--hot-bg);color:var(--hot)}\n.link{color:#4f46e5;text-decoration:none;font-size:12px;white-space:nowrap}\n.link:hover{text-decoration:underline}\n.note{font-size:13px;color:var(--sub)}\n.note li{margin:4px 0 4px 18px}\n";

export function renderHotVideoReport(data, { top = 50 } = {}) {
  if (!Number.isSafeInteger(top) || top < 1) throw new Error('--top 必须为正整数');
  if (!Array.isArray(data.products)) throw new Error('输入需要 products 数组');
  const esc = v => String(v ?? '未知').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const meta = data.meta || {};
  const byId = new Map();
  for (const row of data.products) {
    if (typeof row.id !== 'string' || !/^\d+$/.test(row.id)) throw new Error('商品ID必须为完整数字字符串');
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  const valid = [...byId.values()].filter(row => typeof row.video_count === 'number' && Number.isFinite(row.video_count) && row.video_count >= 0);
  const rows = valid.sort((a, b) => b.video_count - a.video_count).slice(0, top).map((row, index) => ({ ...row, rank: index + 1, source_url: safeProductLink(row.source_url) }));
  const phoneRows = valid.filter(row => isPhoneCase(row.product)).slice(0, top).map((row, index) => ({ ...row, rank: index + 1, source_url: safeProductLink(row.source_url) }));
  const maxV = rows.length ? rows[0].video_count : null;
  const units = rows.map(row => parseAmount(row.total_units)).filter(value => value !== null);
  const sumUnits = units.length === rows.length && rows.length ? units.reduce((sum, value) => sum + value, 0) : null;
  const title = `${meta.country || '国家未知'} ${meta.category || '视频商品榜'} · 已采集样本前${rows.length}`;
  const links = row => row.source_url ? `<a href="${esc(row.source_url)}" target="_blank" rel="noopener noreferrer">详情 ↗</a>` : '未知';
  const body = rows.map(row => `<tr><td>${row.rank}</td><td class="prod">${esc(row.product)}</td><td class="num">${row.video_count}</td><td class="num">${esc(row.total_units)}</td><td class="num">${esc(row.total_gmv)}</td><td class="num">${esc(row.total_play)}</td><td class="num">${esc(row.total_like)}</td><td>${links(row)}</td></tr>`).join('');
  const phoneTable = phoneRows.length ? `<section class="card"><h2>商品名称规则筛出的手机壳（${phoneRows.length}件）</h2><p class="note">从全部有效样本筛选，属于名称规则推断，边界商品需核实。</p><table><thead><tr><th>#</th><th>商品</th><th>新发布视频数</th><th>来源</th></tr></thead><tbody>${phoneRows.map(row => `<tr><td>${row.rank}</td><td>${esc(row.product)}</td><td>${row.video_count}</td><td>${links(row)}</td></tr>`).join('')}</tbody></table></section>` : '';
  const pagesRead = Array.isArray(meta.page_log) ? meta.page_log.filter(p => !p.stop).length : null;
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${reportStyle}</style></head>
<body><main class="wrap"><h1>${esc(title)}</h1>
<div class="meta">采集时间 ${esc(meta.collected_at)} · 国家/币种 ${esc(meta.country)} / ${esc(meta.currency)} · 周期 ${esc(meta.time_range)} · 采集状态 ${esc(meta.status)}</div>
<section class="card"><div class="kpi"><div class="item"><div class="v">${rows.length}</div><div class="l">有效入表商品</div></div><div class="item"><div class="v">${esc(maxV)}</div><div class="l">样本最高新发布视频数</div></div><div class="item"><div class="v">${esc(sumUnits)}</div><div class="l">全部入表商品累计销量合计（缺项不合计）</div></div></div></section>
<section class="card"><h2>按新发布带货视频数降序</h2><table><thead><tr><th>#</th><th>商品</th><th>新发布视频数</th><th>累计销量</th><th>累计GMV</th><th>累计播放</th><th>累计点赞</th><th>来源</th></tr></thead><tbody>${body || '<tr><td colspan="8">没有有效视频计数，不能视为零销量</td></tr>'}</tbody></table></section>
${phoneTable}<section class="card"><h2>范围与口径</h2><ul class="note"><li>榜单原始排序 ${esc(meta.sort_default)}；本报告仅在已采集的 ${byId.size} 个唯一商品内取前 ${top}，不代表全站前N。</li><li>实际页数 ${esc(pagesRead)} / 请求 ${esc(meta.pages_requested)}；缺少有效视频计数 ${byId.size - valid.length} 件，未参与排序。</li><li>视频数为页面所选周期内新发布带货视频数，销量和GMV为累计口径。周期未知时不宣称近7天。</li><li>筛选ID：一级 ${esc(meta.category_id)}，二级 ${esc(meta.category_id2)}，三级 ${esc(meta.category_id3)}。商品名或分类不能证明利润、转化率或合作关系。</li></ul></section></main></body></html>`;
  return { html, data: { meta: { ...meta, top_requested: top, sample_unique: byId.size, missing_video_count: byId.size - valid.length, report_scope: '已采集样本内排序' }, products: rows, phonecase_products: phoneRows } };
}

export function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(['hot-video-report', ...argv]);
  if (opts.help) { console.log('render-hot-video-report.mjs --file hotvideo.json [--top 50] [--out report.html] [--json report.json]'); return; }
  const input = path.resolve(opts.file || path.join(opts.dir || path.join(SKILL_ROOT, 'outputs', 'latest'), 'hotvideo.json'));
  const out = path.resolve(opts.out || path.join(path.dirname(input), '视频商品榜.html'));
  const json = path.resolve(opts.json || out.replace(/\.html$/i, '.json'));
  if (!out.toLowerCase().endsWith('.html') || !json.toLowerCase().endsWith('.json') || [out, json].includes(input) || out === json) throw new Error('输出需为独立的.html和.json文件，不能覆盖输入');
  const rendered = renderHotVideoReport(JSON.parse(fs.readFileSync(input, 'utf8')), { top: Number(opts.top ?? 50) });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.mkdirSync(path.dirname(json), { recursive: true });
  fs.writeFileSync(out, rendered.html, 'utf8');
  fs.writeFileSync(json, JSON.stringify(rendered.data, null, 2), 'utf8');
  console.log('报告写出：', out, json);
  return { out, json };
}
if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error('报告失败：', error.message); process.exitCode = 1; }
}
