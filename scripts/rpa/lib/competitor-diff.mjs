// 两次已观察快照的差异。未出现在样本不等于下架，新增关联不证明付费合作。
import { resolveCountry, BASE } from './config.mjs';
import { parsePriceRange } from '../data-rules.mjs';
import { cell } from './report.mjs';
import { numericId } from '../data-rules.mjs';

export const SNAPSHOT_SCHEMA = 'fastmoss.shop-snapshot.v1';
const SECTIONS = ['products', 'creators', 'videos'];
const PREFIXES = { products: '/e-commerce/detail/', creators: '/influencer/detail/', videos: '/media-source/video/' };

export function normalizeShopSnapshot(data) {
  if (data?.schema !== SNAPSHOT_SCHEMA) throw new Error('快照格式不支持；请使用 competitor-diff 生成的店铺快照');
  const country = resolveCountry(data.country);
  if (!country || data.currency !== country.currency || !Number.isFinite(Date.parse(data.collected_at))) throw new Error('快照缺少有效国家、币种或采集时间');
  numericId(data.shop_id, '快照店铺ID');
  const sections = {};
  for (const key of SECTIONS) {
    const section = data.sections?.[key];
    if (!section || !Array.isArray(section.rows)) throw new Error('快照缺少模块：' + key);
    const rows = new Map();
    for (const row of section.rows) {
      numericId(row.id, key + ' ID');
      if (rows.has(row.id)) throw new Error('快照模块存在重复ID：' + key + '/' + row.id);
      rows.set(row.id, { ...row, source_url: BASE + PREFIXES[key] + row.id });
    }
    sections[key] = { ...section, rows: [...rows.values()] };
  }
  return { ...data, country: country.label, sections };
}

export function compareShopSnapshots(previous, current) {
  const now = normalizeShopSnapshot(current);
  if (!previous) {
    const unfinished = ['running', 'blocked', 'failed'].includes(now.status);
    return { status: unfinished ? now.status : 'baseline', current: now, previous_at: null, changes: {}, note: unfinished ? '本次采集未完成，未建立或更新基线' : '首次建立采样基线，尚无前次快照可比较' };
  }
  const before = normalizeShopSnapshot(previous);
  if (before.shop_id !== now.shop_id || before.country !== now.country || before.currency !== now.currency) throw new Error('不能比较不同店铺、国家或币种的快照');
  if (Date.parse(before.collected_at) > Date.parse(now.collected_at)) throw new Error('历史快照时间晚于当前快照');
  const changes = {};
  for (const key of SECTIONS) {
    const oldRows = new Map(before.sections[key].rows.map(row => [row.id, row]));
    const newRows = new Map(now.sections[key].rows.map(row => [row.id, row]));
    if ([before.sections[key].status, now.sections[key].status].includes('not_requested')) {
      changes[key] = { newly_observed: [], not_observed_now: [], price_changes: [], commission_changes: [], note: '有一次快照未请求此模块，不作增减比较', previous_complete: false, current_complete: false };
      continue;
    }
    const added = [...newRows.values()].filter(row => !oldRows.has(row.id));
    const absent = [...oldRows.values()].filter(row => !newRows.has(row.id));
    const price = [];
    const commission = [];
    if (key === 'products') for (const row of newRows.values()) {
      const old = oldRows.get(row.id);
      if (!old) continue;
      const a = parsePriceRange(old.price_raw), b = parsePriceRange(row.price_raw);
      if (a && b && (a.min !== b.min || a.max !== b.max)) price.push({ id: row.id, name: row.name, source_url: row.source_url, before: old.price_raw, after: row.price_raw, change: b.min <= a.min && b.max <= a.max ? '降价' : b.min >= a.min && b.max >= a.max ? '涨价' : '价格区间变化' });
      const ca = old.commission_raw, cb = row.commission_raw;
      if (ca != null && cb != null && String(ca).replace(/\s/g, '') !== String(cb).replace(/\s/g, '')) commission.push({ id: row.id, name: row.name, source_url: row.source_url, before: ca, after: cb });
    }
    changes[key] = { newly_observed: added, not_observed_now: absent, price_changes: price, commission_changes: commission,
      previous_complete: before.sections[key].coverage?.complete === true, current_complete: now.sections[key].coverage?.complete === true,
      note: '新增=本次首次观察；本次未见不证明下架/取消合作。样本覆盖或周期不一致时尤其不能作全量增减。' };
  }
  const status = ['running', 'blocked', 'failed'].includes(now.status) ? now.status : now.status === 'complete' && before.status === 'complete' ? 'complete' : 'partial';
  return { status, current: now, previous_at: before.collected_at, changes,
    note: '只比较稳定ID、标价、原始佣金和列表出现情况；不把两个滚动周期GMV之差当作期间新增GMV。' };
}

export function renderCompetitorDiff(result) {
  const current = result.current;
  const lines = ['# 竞品变化对照', '', `店铺：${cell(current.shop_name || current.shop_id)}；国家/币种：${current.country} / ${current.currency}。`,
    `前次：${cell(result.previous_at)}；本次：${cell(current.collected_at)}；状态：${cell(result.status)}。`, '', result.note, ''];
  for (const [key, title] of [['products', '商品'], ['creators', '关联达人'], ['videos', '关联视频']]) {
    const section = current.sections[key];
    lines.push(`## ${title}`, '', `本次读取 ${section.rows.length} 条；覆盖完整=${section.coverage?.complete === true}；状态=${cell(section.status)}。${cell(section.error || '')}`, '');
    const diff = result.changes[key];
    if (!diff) continue;
    lines.push(`首次观察 ${diff.newly_observed.length} 条，本次未见 ${diff.not_observed_now.length} 条。${diff.note}`, '', '| 变化 | 对象 | 前值 | 现值 | 来源 |', '|---|---|---|---|---|');
    for (const row of diff.newly_observed) lines.push(`| 首次观察 | ${cell(row.name || row.id)} | — | ${cell(row.price_raw)} | [详情](${row.source_url}) |`);
    for (const row of diff.not_observed_now) lines.push(`| 本次未见 | ${cell(row.name || row.id)} | ${cell(row.price_raw)} | 未确认 | [详情](${row.source_url}) |`);
    for (const row of diff.price_changes) lines.push(`| ${row.change} | ${cell(row.name || row.id)} | ${cell(row.before)} | ${cell(row.after)} | [商品](${row.source_url}) |`);
    for (const row of diff.commission_changes) lines.push(`| 佣金原文变化 | ${cell(row.name || row.id)} | ${cell(row.before)} | ${cell(row.after)} | [商品](${row.source_url}) |`);
  }
  if (current.stopped_reason) lines.push('', '停止原因：' + cell(current.stopped_reason));
  return lines.join('\n') + '\n';
}
