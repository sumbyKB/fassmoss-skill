import { verifiedNewTrend } from './product-trend.mjs';
import { cell } from './report.mjs';

export function assessOpportunity(product, options, asOf) {
  const trend = verifiedNewTrend(product);
  const listed = String(product.list_date || '');
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(listed) && Number.isFinite(Date.parse(listed)) && new Date(listed).toISOString().slice(0, 10) === listed;
  const days = validDate ? Math.floor((Date.parse(asOf.slice(0, 10)) - Date.parse(listed)) / 86400000) : null;
  const age = days !== null && days >= 0 ? days : null;
  const pending = [];
  let eligible = true;
  if (options.maxAge !== null && age === null) { eligible = false; pending.push('上架日期未确认'); }
  if (options.maxAge !== null && age !== null && age > options.maxAge) { eligible = false; pending.push('超过上架天数限制'); }
  if (trend.units_7d === null) { eligible = false; pending.push(trend.reason || '近7天数据未确认'); }
  else if (trend.units_7d < options.minUnits) { eligible = false; pending.push('未达到近7天销量门槛'); }
  const points = { 上升: 60, 新近起量: 55, 稳定: 30, 下滑: 5 }[trend.trend];
  const volume = trend.units_7d === null ? null : Math.min(40, Math.log10(trend.units_7d + 1) * 10);
  const score = points === undefined || volume === null ? null : trend.units_7d === 0 ? 0 : Math.round((points + volume) * 10) / 10;
  const signals = [trend.trend === '新近起量' ? '最近3日开始有销量，尚无稳定历史' : '趋势：' + trend.trend];
  if (trend.units_7d === 0) signals.push('近7天零销量');
  if (product.author_count != null) signals.push('页面带货达人：' + product.author_count);
  if (product.ads?.raw?.ad_share) signals.push('投流分析广告成交占比：' + product.ads.raw.ad_share);
  if (product.author_count == null) pending.push('带货达人数量未知');
  if (product.warning) pending.push(product.warning);
  if (!product.ads) pending.push('未采投流模块，广告依赖未知');
  else if (product.ads.status !== 'ok') pending.push('投流指标未完整确认：' + product.ads.status);
  return { ...product, ...trend, age_days: age, age_basis: '采集日UTC日期与页面上架日期的日历差', eligible, opportunity_score: score, signals, pending };
}

export function rankOpportunities(products, options, asOf) {
  const assessed = products.map(row => assessOpportunity(row, options, asOf));
  const qualified = assessed.filter(row => row.eligible && row.opportunity_score !== null).sort((a, b) => b.opportunity_score - a.opportunity_score || b.recent_3d_units - a.recent_3d_units || a.id.localeCompare(b.id));
  return { products: assessed, recommendations: qualified.slice(0, options.top), eligible_products: qualified.length };
}

export function renderOpportunities(result) {
  const meta = result.meta;
  const lines = ['# 通用新品机会分析', '', `国家/币种：${cell(meta.country)} / ${cell(meta.currency)}；分类：${cell(meta.category)}；状态：${cell(meta.status)}。`,
    `三日榜单候选 ${meta.candidates_observed || 0} 件，详情选取 ${result.products.length} 件，满足已验证条件 ${result.eligible_products || 0} 件，展示 ${result.recommendations.length} 件。`, '',
    '## 观察名单', '', '| 商品 | 三日榜销量 | 详情近7天销量 | 最近3日 | 趋势 | 上架天数 | 规则分 | 来源 |', '|---|---|---|---|---|---|---|---|'];
  for (const p of result.recommendations) lines.push(`| ${cell(p.product || p.id)} | ${cell(p.units_3d)} | ${cell(p.units_7d)} | ${cell(p.recent_3d_units)} | ${cell(p.trend)} | ${cell(p.age_days)} | ${cell(p.opportunity_score)} | [商品](${p.source_url}) |`);
  lines.push('', '## 规则与缺口', '',
    '规则分只用于本批样本排序：趋势分（上升60/新近起量55/稳定30/下滑5）+销量分 min(40,10×log10(近7天销量+1))；零销量为0。它不是爆款概率、合作ROI或利润预测。',
    '趋势从同一商品详情完整连续近7天逐日序列的最近3日日均与前4日日均比较；不跨榜单日期相减。未确认周期或缺数据不进入可评分名单。',
    '上架日期按采集UTC日做日历差，缺日期时不假定“刚上架”；带货达人和广告数据只显示已观察值，不据此断言竞争低或纯自然流量。');
  for (const p of result.products) lines.push(`- ${cell(p.product || p.id)}：${p.signals.map(cell).join('；')}。待核实：${p.pending.map(cell).join('；') || '无新增缺项'}${p.error ? '；采集错误：' + cell(p.error) : ''}。`);
  if (meta.stopped_reason) lines.push('', '停止原因：' + cell(meta.stopped_reason));
  return lines.join('\n') + '\n';
}
