import { poolWithPage } from '../lib/pool.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { resolveCountry, BASE } from '../lib/config.mjs';
import { openBrowser, assertLoggedIn, switchCountry } from '../lib/browser.mjs';
import { scrapeDetail7d } from '../lib/product-detail.mjs';
import { safeProductLink } from '../lib/product-trend.mjs';
import { scrapeProductRoi } from '../product-roi.mjs';
import { rankOpportunities, renderOpportunities } from '../lib/opportunities.mjs';
import { collectNewProductBoard, newProductOptions } from './new-products.mjs';
import { countOption, outputFiles, writeArtifacts, fileJson, numericId } from '../lib/task-output.mjs';

export function opportunityOptions(opts) {
  for (const key of ['days', 'period', 'date-type', 'date-value', 'start', 'end']) if (opts[key] !== undefined) throw new Error('新品列表固定三日、详情固定近7天，不支持 --' + key);
  const top = countOption(opts.top, 10, '--top');
  const scan = countOption(opts.scan, Math.max(30, top), '--scan');
  if (scan < top) throw new Error('--scan 不能小于 --top');
  const maxAge = opts['max-age-days'] === undefined ? null : countOption(opts['max-age-days'], null, '--max-age-days');
  const minUnits = opts['min-units7d'] ?? 1;
  if (!/^\d+$/.test(String(minUnits)) || !Number.isSafeInteger(Number(minUnits))) throw new Error('--min-units7d 必须为非负整数');
  if (opts['with-roi'] !== undefined && ![true, 'true', 'false'].includes(opts['with-roi'])) throw new Error('--with-roi 只接受true或false');
  for (const key of ['include-keywords', 'exclude-keywords']) if (opts[key] !== undefined && (typeof opts[key] !== 'string' || !opts[key].trim())) throw new Error('--' + key + ' 需要非空逗号分隔关键词');
  const source = opts.input ? fileJson(opts.input) : null;
  if (source && (!Array.isArray(source.products) || source.meta?.period_days !== 3)) throw new Error('--input 必须为新品榜三日口径JSON');
  const country = resolveCountry(opts.country || source?.meta?.country);
  if (!country) throw new Error('请指定 --country 或提供含站点的新品榜输入');
  if (opts.currency !== undefined && opts.currency !== country.currency) throw new Error('币种覆盖不能替代换汇，请使用站点实际币种');
  if (source?.meta?.country && resolveCountry(source.meta.country).label !== country.label || source?.meta?.currency && source.meta.currency !== country.currency) throw new Error('新品输入站点或币种不一致');
  if (source && opts.category && source.meta?.category !== opts.category) throw new Error('输入分类不一致；请沿用输入分类或重新采集');
  const files = outputFiles(opts, 'new-opportunities', [opts.input]);
  const sourceFile = files.outFile.slice(0, -5) + '.source.json';
  const boardOptions = !source ? newProductOptions({ ...opts, country: country.label, top: scan, out: sourceFile }) : null;
  return { top, scan, maxAge, minUnits: Number(minUnits), boardOptions, withRoi: opts['with-roi'] === true || opts['with-roi'] === 'true', source, sourceFile, country, ...files };
}

export async function cmdNewOpportunities(opts) {
  const options = opportunityOptions(opts);
  const result = { meta: { collected_at: new Date().toISOString(), country: options.country.label, currency: options.country.currency, category: opts.category || options.source?.meta?.category || null, status: 'running', top_requested: options.top, scan_requested: options.scan }, products: [], recommendations: [] };
  const save = (ranked = rankOpportunities(result.products, options, result.meta.collected_at)) => {
    const snapshot = { ...result, ...ranked };
    writeArtifacts(options, snapshot, renderOpportunities);
    return snapshot;
  };
  let context;
  const openBoardSession = async () => {
    ({ context } = await openBrowser());
    const page = context.pages()[0];
    await assertLoggedIn(page, `${BASE}/e-commerce/newProducts`);
    await switchCountry(page, options.country.label);
    return page;
  };
  let page;
  save();
  try {
    if (!options.source) {
      page = await openBoardSession();
      result.meta.source_file = options.sourceFile;
      options.source = await collectNewProductBoard(page, options.boardOptions, { onPage: source => {
        result.meta.source = source.meta;
        fs.writeFileSync(options.sourceFile, JSON.stringify(source, null, 2), 'utf8');
      } });
    }
    result.meta.source = options.source.meta;
    result.meta.source_file = opts.input ? path.resolve(opts.input) : options.sourceFile;
    const include = opts['include-keywords'] ? String(opts['include-keywords']).split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
    const exclude = opts['exclude-keywords'] ? String(opts['exclude-keywords']).split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
    const candidates = new Map();
    for (const row of options.source.products) {
      numericId(row.id, '商品ID');
      const url = safeProductLink(row.source_url);
      if (!url || new URL(url).pathname.split('/').pop() !== row.id) throw new Error('新品ID与来源链接不一致');
      const name = String(row.product || '').toLowerCase();
      if (include.length && !include.some(word => name.includes(word)) || exclude.some(word => name.includes(word))) continue;
      if (!candidates.has(row.id)) candidates.set(row.id, { ...row, source_url: url });
    }
    result.meta.candidates_observed = options.source.products.length;
    result.meta.name_filter = { include, exclude };
    result.products = [...candidates.values()].slice(0, options.scan).map(row => ({ ...row, status: 'not_attempted', units_7d: null }));
    save();
    if (result.products.length) {
      page ??= await openBoardSession();
      await poolWithPage(context, result.products, Number(opts.concurrency ?? 5), async (page, product) => {
        try {
          Object.assign(product, await scrapeDetail7d(page, product.id));
          product.status = product.units_7d === null ? 'incomplete' : 'ok';
          if (options.withRoi) {
            try { product.ads = await scrapeProductRoi(page, product, { period: 7, currency: options.country.currency, navigate: false }); }
            catch (error) { product.ads = { status: 'error', error: error.message }; if (error.code === 'FASTMOSS_BLOCKED') throw error; }
          }
        } catch (error) {
          product.status = error.code === 'FASTMOSS_BLOCKED' ? 'blocked' : 'error';
          product.error = error.message;
          if (error.code === 'FASTMOSS_BLOCKED') throw error;
        } finally { save(); }
      }, { firstPage: page });
    }
    const ranked = rankOpportunities(result.products, options, result.meta.collected_at);
    result.meta.status = result.products.every(p => p.status === 'ok' && (!options.withRoi || p.ads?.status === 'ok')) && options.source.meta?.status === 'complete' && ranked.recommendations.length >= options.top ? 'complete' : 'partial';
    const snapshot = save(ranked);
    return { result: snapshot, outFile: options.outFile, reportFile: options.reportFile };
  } catch (error) {
    result.meta.status = error.code === 'FASTMOSS_BLOCKED' ? 'blocked' : 'failed';
    result.meta.stopped_reason = error.message;
    save();
    throw error;
  } finally { if (context) await context.close(); }
}
