// 按商品关联证据聚合达人，数据缺失不伪造报价、转化率或合作次数。
import { parseAmount } from '../data-rules.mjs';
import { cell, money } from './report.mjs';

export function followerRange(raw) {
  if (raw === undefined) return null;
  if (typeof raw !== 'string' || !/^\d+,\d+$/.test(raw)) throw new Error('--follower 格式为 最小粉丝,最大粉丝');
  const values = raw.split(',').map(Number);
  if (values.some(value => !Number.isSafeInteger(value)) || values[0] > values[1]) throw new Error('粉丝范围无效');
  return values;
}

export function rankProductCreators(products, { followers = null, top = 20 } = {}) {
  const byId = new Map();
  for (const product of products) for (const row of product.authors || []) {
    let author = byId.get(row.id);
    if (!author) { author = { id: row.id, name: row.name, source_url: row.source_url, follower_count: null, evidence: [], quote: null, quote_currency: null }; byId.set(row.id, author); }
    const fans = parseAmount(row.followers_raw);
    if (fans !== null) author.follower_count = fans;
    if (!author.evidence.some(e => e.product_id === product.id)) author.evidence.push({
      product_id: product.id, product: product.product, role: product.role, source_url: product.source_url,
      period_days: product.coverage?.period_days ?? null, period_verified: product.coverage?.period_verified === true,
      dates: product.coverage?.dates || [], observed_position: row.observed_position,
      gmv: parseAmount(row.gmv_raw), units: parseAmount(row.units_raw), raw: row.raw,
    });
  }
  const rows = [...byId.values()].map(author => {
    const verified = author.evidence.filter(e => e.period_verified);
    const knownGmv = verified.filter(e => e.gmv !== null);
    const windows = new Set(knownGmv.map(e => JSON.stringify([e.period_days, e.dates])));
    const sameWindow = knownGmv.length <= 1 || windows.size === 1 && knownGmv.every(e => e.dates.length >= 2);
    const positions = author.evidence.filter(e => e.role === 'seed' && Number.isFinite(e.observed_position)).map(e => e.observed_position);
    return { ...author, seed_products: author.evidence.filter(e => e.role === 'seed').length, peer_products: author.evidence.filter(e => e.role === 'peer').length,
      verified_gmv: knownGmv.length === author.evidence.length && sameWindow ? knownGmv.reduce((sum, e) => sum + e.gmv, 0) : null,
      seed_position: positions.length ? Math.min(...positions) : null,
      followers_verified: author.follower_count !== null,
      pending: ['真实视频/直播报价与合作单位', '内容风格与粉丝画像', ...(!sameWindow || knownGmv.length < author.evidence.length ? ['部分商品贡献周期或GMV未确认'] : [])] };
  });
  const pending = followers ? rows.filter(a => a.follower_count === null) : [];
  const eligible = rows.filter(a => !followers || a.follower_count !== null && a.follower_count >= followers[0] && a.follower_count <= followers[1]);
  eligible.sort((a, b) => b.seed_products - a.seed_products || (b.verified_gmv ?? -1) - (a.verified_gmv ?? -1) || (a.seed_position ?? Number.MAX_SAFE_INTEGER) - (b.seed_position ?? Number.MAX_SAFE_INTEGER) || b.peer_products - a.peer_products || a.id.localeCompare(b.id));
  return { creators: eligible.slice(0, top), pending_creators: pending, observed_creators: rows.length, matching_creators: eligible.length };
}

export function renderProductCreators(result) {
  const meta = result.meta;
  const lines = ['# 商品反查达人', '', `国家/币种：${cell(meta.country)} / ${cell(meta.currency)}；请求周期：${meta.period_days ? '近' + meta.period_days + '天' : '页面原始口径'}；状态：${cell(meta.status)}。`,
    `读取 ${result.products.length} 个商品，观察 ${result.observed_creators || 0} 位唯一达人，满足已知筛选 ${result.matching_creators || 0} 位，展示 ${result.creators.length} 位。`, '',
    '排序：关联本品数量 → 已确认同一周期贡献GMV → 本品表内顺序 → 指定竞品覆盖。排名仅覆盖已采集样本，不代表全平台。报价、测评属性未验证，不称全条件通过。', '',
    '| 达人 | 粉丝 | 关联本品 | 关联指定竞品 | 本品表销售额（页面原值） | 同周期汇总GMV | 报价 | 来源 |', '|---|---|---|---|---|---|---|---|'];
  for (const a of result.creators) lines.push(`| ${cell(a.name || a.id)} | ${cell(a.follower_count)} | ${a.seed_products} | ${a.peer_products} | ${cell(a.evidence.filter(e => e.role === 'seed').map(e => e.product_id + ':' + money(e.gmv, meta.currency)).join('；'))} | ${money(a.verified_gmv, meta.currency)} | 未知 | [达人](${a.source_url}) |`);
  lines.push('', '## 逐商品证据', '');
  for (const p of result.products) lines.push(`- [${cell(p.product || p.id)}](${p.source_url})：${p.role === 'seed' ? '本品' : '用户指定竞品'}，${p.authors.length} 位达人，周期${cell(p.coverage?.period_days)}天，周期确认=${p.coverage?.period_verified === true}，覆盖完整=${p.coverage?.complete === true}，${cell(p.error || p.status)}。`);
  lines.push('', `粉丝数缺失且无法通过粉丝硬筛的达人：${result.pending_creators.length} 位。关联商品数不是推广视频/直播频次，更不证明付费合作。`,
    '页面没有可确认周期时保留原文贡献，不参与同周期GMV汇总。需要真实推广频次时再按历史视频/直播ID与挂车集合去重核验。');
  if (meta.stopped_reason) lines.push('', '停止原因：' + cell(meta.stopped_reason));
  return lines.join('\n') + '\n';
}
