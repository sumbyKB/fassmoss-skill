import { poolWithPage } from '../lib/pool.mjs';
import { resolveCountry } from '../lib/config.mjs';
import { openBrowser, assertLoggedIn, switchCountry, assertPageAccess } from '../lib/browser.mjs';
import { normalizeProductRows } from '../lib/product-input.mjs';
import { collectLinkedList } from '../lib/linked-lists.mjs';
import { followerRange, rankProductCreators, renderProductCreators } from '../lib/creator-match.mjs';
import { countOption, outputFiles, writeArtifacts, fileJson } from '../lib/task-output.mjs';

function readSelection({ id, ids, file, url }, country, label) {
  if ([id, ids, file, url].filter(value => value !== undefined).length !== 1) throw new Error(label + '请仅指定一种商品ID、链接或文件输入');
  let rows;
  if (file !== undefined) {
    const data = fileJson(file);
    const meta = data.meta || {};
    if ((meta.country && resolveCountry(meta.country).label !== country.label) || (meta.currency && meta.currency !== country.currency)) throw new Error(label + '名单站点或币种不一致');
    rows = Array.isArray(data) ? data : data.products ?? data.topProducts ?? data.ids;
    if (!Array.isArray(rows)) throw new Error(label + '文件需要products、topProducts或ids数组');
  } else if (url !== undefined) {
    if (typeof url !== 'string') throw new Error(label + '链接不能为空');
    rows = [{ source_url: url }];
  } else {
    const value = ids ?? id;
    if (typeof value !== 'string') throw new Error(label + 'ID必须为数字字符串');
    rows = value.split(',').map(value => value.trim());
  }
  const products = normalizeProductRows(rows);
  if (!products.length) throw new Error(label + '名单为空');
  return products;
}

export function productCreatorOptions(opts) {
  for (const key of ['days', 'start', 'end', 'date-type', 'date-value']) if (opts[key] !== undefined) throw new Error('关联达人请使用 --period，页面不提供指定周期时会标未确认；不支持 --' + key);
  if (!opts.country) throw new Error('商品反查达人请指定 --country，避免混用站点与币种');
  const country = resolveCountry(opts.country);
  if (opts.currency !== undefined && opts.currency !== country.currency) throw new Error('币种覆盖不能替代换汇，请使用站点实际币种');
  const period = opts.period === undefined ? null : Number(opts.period);
  if (period !== null && ![7, 28, 90].includes(period)) throw new Error('--period 仅支持7/28/90天；不传则保留页面原始口径');
  const top = countOption(opts.top, 20, '--top');
  const pages = countOption(opts.pages, 5, '--pages');
  const followers = followerRange(opts.follower);
  const seeds = readSelection({ id: opts.id, ids: opts.ids, file: opts['ids-file'], url: opts.url }, country, '本品').map(row => ({ ...row, role: 'seed' }));
  const hasPeers = opts['peer-file'] !== undefined || opts['peer-ids'] !== undefined;
  const peerRows = hasPeers ? readSelection({ file: opts['peer-file'], ids: opts['peer-ids'] }, country, '竞品') : [];
  const seen = new Set(seeds.map(row => row.id));
  const peers = peerRows.filter(row => !seen.has(row.id)).map(row => ({ ...row, role: 'peer' }));
  const files = outputFiles(opts, 'product-creators', [opts['ids-file'], opts['peer-file']]);
  return { country, period, top, pages, followers, products: [...seeds, ...peers], ...files };
}

export async function cmdProductCreators(opts) {
  const options = productCreatorOptions(opts);
  const result = { meta: { collected_at: new Date().toISOString(), country: options.country.label, currency: options.country.currency, period_days: options.period, status: 'running', top_requested: options.top, follower_range: options.followers },
    products: options.products.map(row => ({ ...row, status: 'not_attempted', authors: [], coverage: null })), creators: [], pending_creators: [] };
  const save = () => { Object.assign(result, rankProductCreators(result.products, options)); writeArtifacts(options, result, renderProductCreators); };
  let context;
  save();
  try {
    ({ context } = await openBrowser());
    const page = context.pages()[0];
    await assertLoggedIn(page, options.products[0].source_url);
    await switchCountry(page, options.country.label);
    await poolWithPage(context, result.products, Number(opts.concurrency ?? 5), async (page, product) => {
      try {
        if (page.url().split(/[?#]/)[0] !== product.source_url) await page.goto(product.source_url, { waitUntil: 'domcontentloaded' });
        await assertPageAccess(page);
        const listing = await collectLinkedList(page, { tab: '商品关联达人', period: options.period, pages: options.pages,
          onPage: data => { product.authors = data.rows; product.coverage = data.coverage; save(); } });
        product.authors = listing.rows;
        product.coverage = listing.coverage;
        product.status = (!options.period || listing.coverage.period_verified) && listing.coverage.complete ? 'ok' : 'partial';
      } catch (error) {
        product.status = error.code === 'FASTMOSS_BLOCKED' ? 'blocked' : 'error';
        product.error = error.message;
        if (error.code === 'FASTMOSS_BLOCKED') throw error;
      } finally { save(); }
    }, { firstPage: page });
    result.meta.status = result.products.every(p => p.status === 'ok') && result.matching_creators >= options.top ? 'complete' : 'partial';
    save();
    return { result, outFile: options.outFile, reportFile: options.reportFile };
  } catch (error) {
    result.meta.status = error.code === 'FASTMOSS_BLOCKED' ? 'blocked' : 'failed';
    result.meta.stopped_reason = error.message;
    save();
    throw error;
  } finally { if (context) await context.close(); }
}
