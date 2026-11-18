// 商品ID、链接及去重规则；与ROI周期和页面采集无关。
import { BASE } from './config.mjs';

export function normalizeProductRows(rows) {
  const products = new Map();
  for (const row of rows) {
    const value = typeof row === 'object' && row !== null ? row : { id: row };
    if (typeof value.id === 'number' && !Number.isSafeInteger(value.id)) throw new Error('商品ID必须使用字符串，数字ID已失去精度');
    const link = value.source_url ?? value.href;
    const url = link ? new URL(link, BASE + '/e-commerce/') : null;
    const linkedId = url?.pathname.match(/^\/zh\/e-commerce\/detail\/(\d+)\/?$/)?.[1];
    if (url && (url.origin !== 'https://www.fastmoss.com' || !linkedId)) throw new Error('商品来源必须是 FastMoss 商品详情链接');
    const id = String(value.id ?? linkedId ?? '');
    if (!/^\d+$/.test(id) || (linkedId && linkedId !== id)) throw new Error('商品ID缺失或与详情链接不一致');
    if (!products.has(id)) products.set(id, { id, product: value.product ?? value.name ?? null, source_url: `${BASE}/e-commerce/detail/${id}` });
  }
  return [...products.values()];
}
