// 达人域命令：达人搜索(search)、达人详情(detail)、达人一条龙(pipeline)。
import fs from 'node:fs';
import path from 'node:path';
import { BASE, SKILL_ROOT, resolveCountry } from '../lib/config.mjs';
import { log } from '../lib/cli.mjs';
import { openBrowser, safeEval, assertLoggedIn, switchCountry } from '../lib/browser.mjs';
import { poolWithPage } from '../lib/pool.mjs';
import { parseAmount, BAG_CATEGORY, moduleLoaded } from '../data-rules.mjs';

const DEFAULT_PERIOD = '近28天';

/** 等到「带详情链接的首行」出现——数据落地的第一个瞬间 */
async function waitRows(page, { selector = 'table tbody tr a[href*="/influencer/detail/"]', timeout = 15000 } = {}) {
  await page.waitForSelector(selector, { timeout, state: 'attached' });
}

/** 抓单页达人搜索列表 */
async function grabSearchPage(page, url) {
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const navMs = Date.now() - t0;
  await waitRows(page);
  const tData = Date.now();
  const payload = await safeEval(page, () => {
    const table = [...document.querySelectorAll('table')].find((t) =>
      (t.querySelector('thead') || t).innerText.includes('达人信息')
    ) || document.querySelector('table');
    if (!table) return { headers: [], rows: [] };
    const headers = [...table.querySelectorAll('thead th')].map((x) => x.innerText.trim());
    const rows = [...table.querySelectorAll('tbody tr')]
      .filter((r) => r.querySelector('td'))
      .map((r) => {
        const a = r.querySelector('a[href*="/influencer/detail/"]');
        return {
          id: a ? a.href.split('/').pop() : '',
          source_url: a ? a.href : '',
          cells: [...r.querySelectorAll('td')].map((c) => c.innerText.trim()),
        };
      })
      .filter((r) => r.cells.length > 1);
    return { headers, rows };
  });
  const extractMs = Date.now() - tData;
  return { ...payload, url, timings: { navMs, extractMs, totalMs: Date.now() - t0 } };
}

/** 构建达人搜索 URL（follower=粉丝区间，sale_category_l1=带货分类） */
function buildSearchUrl({ follower, category, page = 1, extra = '' }) {
  const qs = new URLSearchParams();
  if (follower) qs.set('follower', String(follower).replace(/\s/g, ''));
  if (category) qs.set('sale_category_l1', String(category));
  qs.set('page', String(page));
  return `${BASE}/influencer/search?${qs.toString()}${extra}`;
}

/* ---------------- 达人搜索 ---------------- */
export async function cmdSearch(opts) {
  const pages = Number(opts.pages || 1);
  const concurrency = Number(opts.concurrency || 6);
  const outFile = opts.out || path.join(SKILL_ROOT, 'outputs', `search-${Date.now()}.json`);
  const t0 = Date.now();
  const { context, launchMs } = await openBrowser({ headed: opts.headed === true || opts.headed === 'true' });

  const [first] = context.pages();
  await assertLoggedIn(first);
  const country = opts.country ? await switchCountry(first, opts.country) : null;
  const currency = country ? resolveCountry(country).currency : (opts.currency || 'USD');

  const urls = Array.from({ length: pages }, (_, i) =>
    buildSearchUrl({ follower: opts.follower, category: opts.category, page: i + 1, extra: opts.extra || '' })
  );

  // 复用第一个页面 + 其余并发开新页
  const results = await poolWithPage(context, urls, concurrency, async (page, url) => {
    try {
      return await grabSearchPage(page, url);
    } catch (e) {
      return { url, headers: [], rows: [], error: String(e).slice(0, 120) };
    }
  });

  // 去重
  const byId = new Map();
  let dupConflict = 0;
  for (const r of results) {
    for (const row of r.rows || []) {
      if (!row.id) continue;
      const prev = byId.get(row.id);
      if (prev && JSON.stringify(prev.cells) !== JSON.stringify(row.cells)) dupConflict++;
      if (!prev) byId.set(row.id, { ...row, page: r.url.match(/page=(\d+)/)?.[1] });
    }
  }

  const meta = {
    collected_at: new Date().toISOString(),
    country: country || null,
    currency,
    filters: { follower: opts.follower, sale_category_l1: opts.category, extra: opts.extra || '' },
    pages_requested: pages,
    pages_ok: results.filter((r) => !r.error).length,
    page_errors: results.filter((r) => r.error).map((r) => ({ url: r.url, error: r.error })),
    raw_rows: results.reduce((s, r) => s + (r.rows?.length || 0), 0),
    unique_ids: byId.size,
    duplicate_conflicts: dupConflict,
    coverage: `page 1-${pages}（并发 ${concurrency}）`,
    timings: {
      launchMs,
      crawlMs: Date.now() - t0 - launchMs,
      totalMs: Date.now() - t0,
      per_page_nav: results.map((r) => r.timings?.navMs).filter(Boolean),
    },
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ meta, records: [...byId.values()] }, null, 2), 'utf8');
  log(`search 完成：${meta.pages_ok}/${pages} 页，${meta.unique_ids} 位达人，耗时 ${meta.timings.totalMs} ms（启动 ${launchMs} ms）`);
  log(`写出 ${outFile}`);
  await context.close();
  return { meta, outFile };
}

/* ---------------- 达人详情 ---------------- */

/**
 * 详情页 4 张表分别由 4 个接口喂数据，且都是「滚到可视区才发请求」。
 * 就绪判据 = 这 4 个接口都返回过（有数据没数据都会返回 200）。
 */
const LIST_ENDPOINTS = ['/detail/videoList', '/detail/liveList', '/detail/goodsList', '/detail/shopList'];

/** 滚动触发详情页 4 张懒加载表，等接口齐 + DOM 稳定 */
async function triggerLazyAndWait(page, { timeout = 16000, steps = 12, stepMs = 100, passes = 2 } = {}) {
  const t0 = Date.now();
  const seen = new Set();
  const onResp = (res) => {
    if (!res.ok()) return;
    const u = res.url();
    for (const k of LIST_ENDPOINTS) if (u.includes(k)) seen.add(k);
  };
  page.on('response', onResp);
  try {
    // 慢页面第一轮可能只触发部分接口，回到顶部再滚一遍补触发
    for (let p = 0; p < passes && seen.size < LIST_ENDPOINTS.length; p++) {
      if (p > 0) {
        await safeEval(page, () => window.scrollTo(0, 0));
        await page.waitForTimeout(120);
      }
      for (let i = 1; i <= steps && seen.size < LIST_ENDPOINTS.length; i++) {
        await safeEval(page, (f) => window.scrollTo(0, document.body.scrollHeight * f), i / steps);
        await page.waitForTimeout(stepMs);
      }
    }
    const deadline = Date.now() + Math.max(1500, timeout - (Date.now() - t0));
    while (seen.size < LIST_ENDPOINTS.length && Date.now() < deadline) await page.waitForTimeout(60);
  } finally {
    page.off('response', onResp);
  }
  // 接口回来 ≠ DOM 渲染完。逐表判定就绪：有真实数据行 → 就绪；接口已返回且表内显示「无数据」且连续 2 轮不变 → 也视为就绪。
  const TABLE_OF = {
    '/detail/videoList': '视频销量',
    '/detail/liveList': '直播销量',
    '/detail/goodsList': '商品价格',
    '/detail/shopList': '合作商品数',
  };
  const probe = () =>
    page
      .evaluate((pairs) => {
        const tables = [...document.querySelectorAll('table')].map((t) => ({
          headers: [...t.querySelectorAll('thead th')].map((x) => x.innerText.trim()),
          txt: (t.innerText || '').replace(/\s/g, ''),
          real: [...t.querySelectorAll('tbody tr')].filter((r) => {
            const tds = r.querySelectorAll('td');
            return tds.length >= 2 && (r.innerText || '').replace(/\s/g, '').length > 0;
          }).length,
        }));
        return pairs.map(([ep, kw]) => {
          const t = tables.find((x) => x.headers.some((h) => h.includes(kw)));
          if (!t) return { ep, kw, state: 'absent' };
          if (t.real > 0) return { ep, kw, state: 'data', n: t.real };
          return { ep, kw, state: /无数据|暂无数据/.test(t.txt) ? 'empty' : 'blank' };
        });
      }, Object.entries(TABLE_OF))
      .catch(() => null);

  const settleStart = Date.now();
  const until = settleStart + 3200;
  let counts = null;
  let moduleStates = [];
  let lastKey = '';
  let same = 0;
  while (Date.now() < until) {
    const st = await probe();
    if (st) {
      counts = st.map((x) => x.n ?? (x.state === 'data' ? 1 : 0));
      const key = st.map((x) => x.state + (x.n ?? '')).join(',');
      if (key === lastKey) same++;
      else { same = 0; lastKey = key; }
      moduleStates = st.map((x) => ({ ...x, loaded: moduleLoaded(x.state, seen.has(x.ep), same) }));
      const settled = st.every((x) => moduleLoaded(x.state, seen.has(x.ep), same));
      if (settled) break;
    }
    await page.waitForTimeout(100);
  }
  return { ms: Date.now() - t0, done: seen.size, missing: LIST_ENDPOINTS.filter((k) => !moduleStates.some((x) => x.ep === k && x.loaded)), modules: moduleStates, counts };
}

/** 抓单个达人详情（总览 + 4 张懒加载表） */
async function grabDetail(page, id, opts = {}) {
  const t0 = Date.now();
  const url = `${BASE}/influencer/detail/${id}`;
  const timings = {};
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // SPA 在 domcontentloaded 后还会再跳一次；h1 出现才算应用渲染完
  await page.waitForSelector('h1', { timeout: 20000 });
  timings.renderMs = Date.now() - t0;

  // 首屏就是总览，h1 出来即可读，不用再等别的
  await page
    .waitForFunction(() => /带货\s?GMV/.test(document.body.innerText), undefined, { timeout: 8000 })
    .catch(() => {});
  timings.overviewMs = Date.now() - t0;

  const overview = await safeEval(page, () => {
    const main = document.querySelector('main') || document.body;
    const h1 = document.querySelector('h1');
    return { pageName: h1 ? h1.innerText.trim() : null, text: main.innerText.slice(0, 16000) };
  });

  // 页面自带周期就是近28天；需要长周期历史时显式传 --period 近90天（点周期会重新请求，再走一遍懒加载等待）
  const period = opts.period || 'default';
  const tt = Date.now();
  const ready = await triggerLazyAndWait(page);
  if (ready.missing.length) throw new Error('详情模块未完成：' + ready.missing.join(','));
  // 90 天历史要等 4 张表都到齐之后才点周期，否则点了会被重新渲染覆盖
  if (period !== 'default') {
    for (const [section, endpoint] of [['#video_list', 'videoList'], ['#live_analysis', 'liveList']]) {
      const button = page.locator(section).getByRole('radio', { name: period, exact: true });
      if (await button.isChecked()) continue;
      const previousRows = await page.locator(section).locator('tbody').innerText();
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/detail/' + endpoint) && r.ok()),
        button.click(),
      ]);
      if (await response.finished() || !await button.isChecked()) throw new Error('周期切换失败：' + section);
      await page.waitForFunction(({ section, previousRows }) => {
        const root = document.querySelector(section);
        const body = root?.querySelector('tbody');
        return body && body.innerText !== previousRows &&
          !root.querySelector('[aria-busy="true"], .ant-spin-spinning') &&
          (body.querySelector('a[href]') || /无数据|暂无数据/.test(body.innerText));
      }, { section, previousRows }, { timeout: 15000 });
    }
  }
  timings.tablesMs = Date.now() - tt;
  timings.ready = ready.missing.length ? `missing:${ready.missing.length}` : 'done';
  timings.counts = ready.counts;

  const tables = await safeEval(page, () => {
    const out = [];
    for (const t of document.querySelectorAll('table')) {
      const headers = [...t.querySelectorAll('thead th')].map((x) => x.innerText.trim());
      if (!headers.length) continue;
      const rows = [...t.querySelectorAll('tbody tr')]
        .map((r) => {
          const route = headers.includes('直播销量') ? '/live/detail/' : headers.includes('视频销量') ? '/media-source/video/' : '/e-commerce/detail/';
          const link = r.querySelector('a[href*="' + route + '"]');
          const productIds = [...new Set([...r.querySelectorAll('a[href*="/e-commerce/detail/"]')].map((a) => a.pathname.split('/').pop()))];
          return {
            href: link ? link.href : '', productIds,
            cells: [...r.querySelectorAll('td')].map((c) => c.innerText.replace(/\s*\n\s*/g, ' | ').trim()),
          };
        })
        .filter((r) => r.cells.length >= 2 && r.cells.join('').replace(/\s/g, '').length > 0);
      const section = t.closest('#video_list, #live_analysis, #cargo_product_list');
      const selected = section?.querySelector('input[type=radio]:checked, [role=radio][aria-checked=true]');
      const dates = section ? [...section.querySelectorAll('input')].map((x) => x.value).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)) : [];
      out.push({ headers, rows, period: selected?.closest('label')?.innerText?.trim() || null, dates });
    }
    return out;
  });

  timings.totalMs = Date.now() - t0;
  return { id, url, overview, tables, timings };
}

/* ---------------- 达人详情 ---------------- */
export async function cmdDetail(opts) {
  let ids = [];
  if (opts['ids-file']) {
    const raw = JSON.parse(fs.readFileSync(opts['ids-file'], 'utf8'));
    ids = Array.isArray(raw) ? raw.map((x) => (typeof x === 'string' ? x : x.id)) : raw.ids || [];
  }
  if (opts.ids) ids = String(opts.ids).split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) throw new Error('缺少 --ids 或 --ids-file');

  const concurrency = Number(opts.concurrency || 1);
  const outFile = opts.out || path.join(SKILL_ROOT, 'outputs', `details-${Date.now()}.json`);
  const t0 = Date.now();
  const { context, launchMs } = await openBrowser({ headed: opts.headed === true || opts.headed === 'true' });
  await assertLoggedIn(context.pages()[0]);
  const country = opts.country ? await switchCountry(context.pages()[0], opts.country) : null;
  const currency = country ? resolveCountry(country).currency : (opts.currency || 'USD');

  const results = await poolWithPage(context, ids, concurrency, async (page, id) => {
    try {
      return await grabDetail(page, id, { period: opts.period });
    } catch (e) {
      return { id, error: String(e).slice(0, 150) };
    }
  });

  // 已确认空表是有效结果，只补抓失败项。
  const needRetry = results.filter((r) => Boolean(r.error));
  if (needRetry.length) {
    log(`补抓 ${needRetry.length} 位空表/失败项…`);
    const retried = await poolWithPage(context, needRetry.map((r) => r.id), 1, async (page, id) => {
      try {
        return await grabDetail(page, id, { period: opts.period });
      } catch (e) {
        return { id, error: String(e).slice(0, 150) };
      }
    });
    const byId = new Map(retried.map((r) => [r.id, r]));
    for (let i = 0; i < results.length; i++) {
      const rep = byId.get(results[i].id);
      if (needRetry.some((x) => x.id === results[i].id) && rep && !rep.error) results[i] = rep;
    }
  }

  const meta = {
    collected_at: new Date().toISOString(),
    country: country || null,
    period: opts.period || DEFAULT_PERIOD,
    currency,
    requested: ids.length,
    ok: results.filter((r) => !r.error).length,
    timings: {
      launchMs,
      wallMs: Date.now() - t0,
      per_creator: results.map((r) => ({ id: r.id, totalMs: r.timings?.totalMs ?? null, error: r.error || null })),
    },
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ meta, details: results }, null, 2), 'utf8');
  log(`detail 完成：${meta.ok}/${ids.length} 位，墙钟 ${meta.timings.wallMs} ms（启动 ${launchMs} ms，并发 ${concurrency}）`);
  log(`写出 ${outFile}`);
  await context.close();
  return { meta, outFile };
}

/* ---------------- 达人一条龙 ---------------- */
const MV = (value) => parseAmount(value) ?? 0;

export async function cmdPipeline(opts) {
  // 品类筛选正则：默认箱包（BAG_CATEGORY 中英泰三语）；也可用 --category-keyword 传自定义关键词（逗号分隔，支持多语）
  const categoryKeyword = opts['category-keyword'] || null;
  const categoryRe = categoryKeyword
    ? new RegExp(String(categoryKeyword).split(/[,，|]/).map((s) => s.trim()).filter(Boolean).join('|'), 'i')
    : BAG_CATEGORY;
  const outDir = opts['out-dir'] || path.join(SKILL_ROOT, 'outputs', `rpa-${new Date().toISOString().slice(0, 10)}`);
  fs.mkdirSync(outDir, { recursive: true });
  const pages = Number(opts.pages || 60);
  const concurrency = Number(opts.concurrency || 6);
  // 详情页必须串行：实测并发 3 会让约 40% 的后台 tab 懒加载接口不触发（丢数据 + 等满超时更慢）。
  // 串行单页稳定 3s、100% 成功；列表页很轻（只读搜索表格），可高并发。
  const dConc = Number(opts['detail-concurrency'] || 1);
  const top = Number(opts.top || 18);

  const t0 = Date.now();
  const { context, launchMs } = await openBrowser({ headed: opts.headed === true || opts.headed === 'true' });
  await assertLoggedIn(context.pages()[0]);
  const country = opts.country ? await switchCountry(context.pages()[0], opts.country) : null;
  const currency = country ? resolveCountry(country).currency : (opts.currency || 'USD');
  log(`浏览器就绪（${launchMs} ms），开始抓 ${pages} 页列表`);

  const urls = Array.from({ length: pages }, (_, i) =>
    buildSearchUrl({ follower: opts.follower, category: opts.category, page: i + 1, extra: opts.extra || '' })
  );
  const listPages = await poolWithPage(context, urls, concurrency, async (page, url) => {
    try { return await grabSearchPage(page, url); }
    catch (e) { return { url, rows: [], error: String(e).slice(0, 120) }; }
  });

  const byId = new Map();
  for (const r of listPages) for (const row of r.rows || []) if (row.id && !byId.has(row.id)) byId.set(row.id, row);
  const records = [...byId.values()];
  const bagRows = records.filter((r) => categoryRe.test(r.cells[1] || ''));
  const ranked = bagRows
    .map((r) => ({ ...r, gmvN: MV(r.cells[3]) }))
    .sort((a, b) => b.gmvN - a.gmvN);
  const picked = ranked.slice(0, top);

  fs.writeFileSync(path.join(outDir, 'candidates.json'), JSON.stringify({ meta: {
    collected_at: new Date().toISOString(), country: country || null, currency,
    filters: { follower: opts.follower, category: opts.category },
    pages, unique_ids: records.length, bag_relevant: bagRows.length, picked: picked.length,
    timings: { launchMs, crawlMs: Date.now() - t0 - launchMs },
  }, records, bagRelevant: bagRows.map((r) => r.id) }, null, 2), 'utf8');
  log(`列表完成：${records.length} 位 → 含目标品类 ${bagRows.length} 位 → 取前 ${picked.length} 位做详情`);

  const tDetail = Date.now();
  const details = await poolWithPage(context, picked.map((p) => p.id), dConc, async (page, id) => {
    try { return await grabDetail(page, id, { period: opts.period }); }
    catch (e) { return { id, error: String(e).slice(0, 150) }; }
  });
  // 已确认空表是有效结果，只补抓失败项。
  const needRetry = details.filter((d) => Boolean(d.error));
  if (needRetry.length) {
    log(`补抓 ${needRetry.length} 位空表/失败项…`);
    const retried = await poolWithPage(context, needRetry.map((d) => d.id), 1, async (page, id) => {
      try { return await grabDetail(page, id, { period: opts.period }); }
      catch (e) { return { id, error: String(e).slice(0, 150) }; }
    });
    const m = new Map(retried.map((r) => [r.id, r]));
    for (let i = 0; i < details.length; i++) {
      const rep = m.get(details[i].id);
      if (needRetry.some((x) => x.id === details[i].id) && rep && !rep.error) details[i] = rep;
    }
  }
  const detailMs = Date.now() - tDetail;

  const meta = {
    collected_at: new Date().toISOString(),
    country: country || null,
    filters: { follower: opts.follower, category: opts.category, period: opts.period || DEFAULT_PERIOD, currency },
    list: { pages, unique_ids: records.length, bag_relevant: bagRows.length },
    detail: { requested: picked.length, ok: details.filter((d) => !d.error).length },
    timings: { launchMs, listMs: tDetail - t0 - launchMs, detailMs, totalMs: Date.now() - t0 },
  };
  fs.writeFileSync(path.join(outDir, 'details.json'), JSON.stringify({ meta, details }, null, 2), 'utf8');
  log(`详情完成：${meta.detail.ok}/${picked.length} 位，${detailMs} ms；总耗时 ${meta.timings.totalMs} ms`);
  log(`产物目录 ${outDir}`);
  await context.close();
  return { meta, outDir };
}
