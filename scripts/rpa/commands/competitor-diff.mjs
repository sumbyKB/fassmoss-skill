import fs from 'node:fs';
import path from 'node:path';
import { BASE, SKILL_ROOT, resolveCountry } from '../lib/config.mjs';
import { openBrowser, assertLoggedIn, switchCountry, assertPageAccess, safeEval } from '../lib/browser.mjs';
import { makeTracker } from '../lib/tracker.mjs';
import { resolveShopId, collectShopProducts } from '../lib/shop.mjs';
import { collectLinkedList } from '../lib/linked-lists.mjs';
import { SNAPSHOT_SCHEMA, normalizeShopSnapshot, compareShopSnapshots, renderCompetitorDiff } from '../lib/competitor-diff.mjs';
import { countOption, outputFiles, writeArtifacts, fileJson, numericId } from '../lib/task-output.mjs';

export function competitorOptions(opts) {
  const current = opts.current ? normalizeShopSnapshot(fileJson(opts.current)) : null;
  const previous = opts.previous ? normalizeShopSnapshot(fileJson(opts.previous)) : null;
  const shopId = opts['shop-id'] ?? current?.shop_id ?? null;
  if (shopId !== null) numericId(shopId, '店铺ID');
  if (!current && !shopId && (typeof opts.shop !== 'string' || !opts.shop.trim())) throw new Error('需要 --shop-id、--shop 或 --current');
  const country = resolveCountry(opts.country || current?.country);
  if (!country) throw new Error('在线采集请指定 --country');
  if (opts.currency !== undefined && opts.currency !== country.currency) throw new Error('币种覆盖不能替代换汇，请使用站点实际币种');
  if (current && (current.shop_id !== shopId || current.country !== country.label)) throw new Error('当前快照与指定店铺/站点不一致');
  if (previous && (previous.country !== country.label || shopId && previous.shop_id !== shopId)) throw new Error('历史快照店铺或站点不一致');
  const pages = countOption(opts.pages, 5, '--pages');
  const sections = String(opts.sections ?? 'products,creators,videos').split(',').map(s => s.trim());
  if (!sections.length || sections.some(s => !['products', 'creators', 'videos'].includes(s))) throw new Error('--sections 支持 products,creators,videos');
  const files = outputFiles(opts, 'competitor-diff', [opts.current, opts.previous]);
  const protectedRoot = path.join(SKILL_ROOT, 'outputs', 'competitor-baselines');
  const relative = path.relative(protectedRoot, files.outFile);
  if (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep)) throw new Error('--out 不能放入自动基线目录，请使用独立的任务输出目录');
  return { current, previous, shopId, country, pages, sections, ...files };
}

export async function cmdCompetitorDiff(opts) {
  const options = competitorOptions(opts);
  const current = options.current || { schema: SNAPSHOT_SCHEMA, collected_at: new Date().toISOString(), shop_id: options.shopId, shop_name: opts.shop || null,
    country: options.country.label, currency: options.country.currency, status: 'running', sections: Object.fromEntries(['products', 'creators', 'videos'].map(key => [key, { rows: [], coverage: { complete: false }, status: options.sections.includes(key) ? 'not_attempted' : 'not_requested' }])) };
  let previous = options.previous;
  let context, goods;
  let baselineFile;
  const snapshotFile = options.outFile.slice(0, -5) + '.snapshot.json';
  if ([opts.current, opts.previous].filter(Boolean).some(file => path.resolve(file).toLowerCase() === snapshotFile.toLowerCase())) throw new Error('快照输出不能覆盖输入');
  const save = () => {
    // 店铺名尚未解析为ID时仍保存失败报告，但不生成可用基线。
    const report = current.shop_id ? compareShopSnapshots(previous, current) : { status: current.status, current, previous_at: previous?.collected_at || null, changes: {}, note: '店铺身份尚未确认，未更新基线' };
    writeArtifacts(options, report, renderCompetitorDiff);
    fs.writeFileSync(snapshotFile, JSON.stringify(current, null, 2), 'utf8');
    return report;
  };
  const loadBaseline = () => {
    baselineFile = path.join(SKILL_ROOT, 'outputs', 'competitor-baselines', options.country.label, current.shop_id + '.json');
    if (!options.current && !previous && fs.existsSync(baselineFile)) previous = normalizeShopSnapshot(fileJson(baselineFile));
    if (previous) compareShopSnapshots(previous, current);
  };
  try {
    if (!options.current) {
      ({ context } = await openBrowser());
      const page = context.pages()[0];
      await assertLoggedIn(page, `${BASE}/shop-marketing/search`);
      await switchCountry(page, options.country.label);
      current.shop_id = options.shopId || await resolveShopId(page, opts.shop);
      loadBaseline();
      save();
      goods = makeTracker(page, '/api/shop/v3/goods');
      await page.goto(`${BASE}/shop-marketing/detail/${current.shop_id}`, { waitUntil: 'domcontentloaded' });
      await assertPageAccess(page);
      if (options.sections.includes('products')) try {
        await safeEval(page, () => window.scrollTo(0, 1400));
        const onPage = listing => {
          current.sections.products = { status: 'partial', coverage: { ...listing.coverage, complete: listing.coverage.pagination_complete === true }, rows: listing.products.map(row => ({ id: row.product_id, name: row.title || row.product_name || null, price_raw: row.price ?? null, commission_raw: row.crate ?? null, listed_at_raw: row.ctime ?? null, source_url: `${BASE}/e-commerce/detail/${row.product_id}` })) };
          save();
        };
        const listing = await collectShopProducts(page, goods, { maxPages: options.pages, onPage, select90Days: false });
        onPage(listing);
        current.sections.products.status = listing.coverage.pagination_complete ? 'ok' : 'partial';
      } catch (error) { current.sections.products.status = 'error'; current.sections.products.error = error.message; if (error.code === 'FASTMOSS_BLOCKED') throw error; }
      save();
      for (const [key, kind, tab] of [['creators', 'creator', '达人分析'], ['videos', 'video', '视频分析']]) {
        if (!options.sections.includes(key)) continue;
        try {
          const listing = await collectLinkedList(page, { kind, tab, period: null, pages: options.pages, onPage: data => { current.sections[key] = { rows: data.rows, coverage: data.coverage, status: 'partial' }; save(); } });
          current.sections[key] = { rows: listing.rows, coverage: listing.coverage, status: listing.coverage.complete ? 'ok' : 'partial' };
        } catch (error) { current.sections[key].status = 'error'; current.sections[key].error = error.message; if (error.code === 'FASTMOSS_BLOCKED') throw error; }
        save();
      }
      current.status = options.sections.every(key => current.sections[key].status === 'ok') ? 'complete' : 'partial';
    } else loadBaseline();
    const result = save();
    // 所请求采样成功才更新索引；覆盖非全量可留基线，但验证阻挡或模块错误不覆盖历史。
    if (!options.current && options.sections.every(key => ['ok', 'partial'].includes(current.sections[key].status))) { fs.mkdirSync(path.dirname(baselineFile), { recursive: true }); fs.writeFileSync(baselineFile, JSON.stringify(current, null, 2), 'utf8'); }
    return { result, outFile: options.outFile, reportFile: options.reportFile, snapshotFile, baselineFile };
  } catch (error) {
    current.status = error.code === 'FASTMOSS_BLOCKED' ? 'blocked' : 'failed'; current.stopped_reason = error.message;
    // 输入不兼容时保留历史，不以错误快照反复触发比较异常。
    previous = previous && previous.shop_id === current.shop_id && previous.country === current.country && Date.parse(previous.collected_at) <= Date.parse(current.collected_at) ? previous : null;
    save(); throw error;
  } finally { goods?.dispose(); if (context) await context.close(); }
}
