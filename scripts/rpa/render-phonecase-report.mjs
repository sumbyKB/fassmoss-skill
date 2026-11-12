// 手机壳趋势Markdown报告，使用与分析和HTML相同的趋势规则。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SKILL_ROOT } from './lib/config.mjs';
import { parseArgs } from './lib/cli.mjs';
import { preparePhonecaseReport } from './lib/product-trend.mjs';

export function renderPhonecaseReport(r) {
  const { salesRows, newRows, st, nt } = preparePhonecaseReport(r);
  const esc = value => String(value ?? '未知').replace(/\|/g, '\\|').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\s+/g, ' ').trim();
  const short = value => { const text = String(value || ''); return text.length > 60 ? text.slice(0, 60) + '…' : text; };
  const link = row => row.source_url ? `[详情](${row.source_url})` : '未知';
  const lines = [
    `# ${esc(r.country)} 手机壳双榜销量趋势`, '',
    `采集时间：${esc(r.collected_at)}；国家/币种：${esc(r.country)} / ${esc(r.currency)}；状态：${esc(r.status)}。`, '',
    `筛选：${esc(r.category)}。实际销量榜样本 ${salesRows.length} 件、新品榜样本 ${newRows.length} 件。`, '',
    '## 数据口径', '',
    `- 销量榜：date_type=${esc(r.saleslist?.date_type)}，date_value=${esc(r.saleslist?.date_value)}；销量为该榜单周期，环比按平台显示值分级。`,
    '- 新品榜列表为三日口径。近7天销量和趋势从详情页同一完整近7天逐日序列计算，不跨榜单日期相减。',
    '- 最近3日日均÷前4日日均：>1.1上升、<0.9下滑，其余稳定；前4日零销量且最近3日有销量标为“新近起量”，不据此认定上架年龄或长期走势。',
    '- 缺少已验证周期、连续日期或逐日销量时，趋势保持未知；旧结果缺少上述证据也不沿用旧的上涨标签。', '',
    '## 趋势汇总', '', '| 榜单 | 上升 | 稳定 | 下滑 | 新近起量 | 未知 |', '|---|---|---|---|---|---|',
    `| 销量榜样本 | ${st.上升} | ${st.稳定} | ${st.下滑} | — | ${st.未知} |`,
    `| 新品榜样本 | ${nt.上升} | ${nt.稳定} | ${nt.下滑} | ${nt.新近起量} | ${nt.未知} |`, '',
    '## 销量榜样本', '', '| 序号 | 商品 | 店铺 | 榜单周期销量 | 销量环比 | 总销量 | 趋势 | 链接 |', '|---|---|---|---|---|---|---|---|',
  ];
  salesRows.forEach((row, index) => lines.push(`| ${index + 1} | ${esc(short(row.product))} | ${esc(row.shop)} | ${esc(row.units ?? row.units_7d)} | ${esc(row.units_wow)} | ${esc(row.total_units)} | ${row.trend} | ${link(row)} |`));
  lines.push('', '## 新品榜样本', '', '| 序号 | 商品 | 上架时间 | 列表三日销量 | 详情同周期近7天销量 | 总销量 | 趋势 | 原因 | 链接 |', '|---|---|---|---|---|---|---|---|---|');
  newRows.forEach((row, index) => lines.push(`| ${index + 1} | ${esc(short(row.product))} | ${esc(row.list_date)} | ${esc(row.units_3d)} | ${esc(row.units_7d)} | ${esc(row.total_units)} | ${row.trend} | ${esc(row.reason || row.error || '')} | ${link(row)} |`));
  lines.push('', '## 已知限制', '', `- 新品趋势未知 ${nt.未知} 件，销量榜缺少可用环比 ${st.未知} 件；缺失原因逐条保留，不推断为“商品过新”。`, '- 手机壳由商品名称规则筛选，边界商品仍需人工核对；榜单样本不代表全站全量。', '- 读取FastMoss网页正常操作触发的数据，销量为平台口径，未据此计算退货率或利润。', '');
  if (r.stopped_reason) lines.push(`采集停止：${esc(r.stopped_reason)}。`, '');
  return lines.join('\n');
}

export function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(['phonecase-report', ...argv]);
  if (opts.help) { console.log('render-phonecase-report.mjs --file result.json [--out report.md]，或 --dir <结果目录>'); return; }
  const file = path.resolve(opts.file || path.join(opts.dir || path.join(SKILL_ROOT, 'outputs', 'latest'), 'result.json'));
  const out = path.resolve(opts.out || path.join(path.dirname(file), '手机壳趋势分析.md'));
  if (!out.toLowerCase().endsWith('.md') || out === file) throw new Error('报告输出需为独立.md文件');
  const report = renderPhonecaseReport(JSON.parse(fs.readFileSync(file, 'utf8')));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, report, 'utf8');
  console.log('报告写出：', out);
  return out;
}
if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error('报告失败：', error.message); process.exitCode = 1; }
}
