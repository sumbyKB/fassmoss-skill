#!/usr/bin/env node
/**
 * FastMoss RPA —— 打开即抓，不再逐条轮询
 *
 * 设计要点（2026-11-09 实测结论）：
 * 1. 筛选条件全部走 URL 参数，不做点击：省掉 3~4 次控件交互往返。
 * 2. 就绪判据换成「DOM 里出现带 /influencer/detail/ 链接的首行」或
 *    「表格行数>0」，这是数据真正落地的第一个瞬间；旧的
 *    “首行ID变化 + 连续两次不变”要多等 800~1000ms，纯属等空气。
 * 3. 列表分页与详情页全部并发（默认 6 路），一个 Node 进程跑完整个抓取，
 *    不再让 agent 一步步点。
 * 4. 只读页面 DOM（含 href），不调用 FastMoss 后端接口、不导出 Cookie。
 *
 * 用法：
 *   node scripts/rpa/fastmoss-rpa.mjs search  --follower 5000,50000 --category 7 --pages 60 --out out.json
 *   node scripts/rpa/fastmoss-rpa.mjs detail  --ids 123,456 --out details.json
 *   node scripts/rpa/fastmoss-rpa.mjs detail  --ids-file ids.json --concurrency 6 --out details.json
 *   node scripts/rpa/fastmoss-rpa.mjs pipeline --follower 5000,50000 --category 7 --pages 60 --top 18 --out-dir outputs/xxx
 *
 * 切换国家（国家选择持久化到 profile，URL 不带参数）：
 *   node scripts/rpa/fastmoss-rpa.mjs country 泰国        # 单独切站（泰国=THB）
 *   node scripts/rpa/fastmoss-rpa.mjs pipeline ... --country 泰国   # 抓取时顺带切站
 *   支持：美国(us) 泰国(th) 印尼 越南 马来西亚 菲律宾 日本 新加坡 英国 德国 法国 西班牙 意大利 墨西哥 巴西
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, '../..');

// playwright 装在技能目录的 .tools（本地、不入库），按序尝试
function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = [
    'playwright',
    path.join(SKILL_ROOT, '.tools/node_modules/playwright'),
    path.join(SKILL_ROOT, 'node_modules/playwright'),
  ];
  for (const c of candidates) {
    try { return require(c); } catch (e) { /* next */ }
  }
  throw new Error('未找到 playwright。请先执行：node scripts/rpa/setup.mjs');
}

const BASE = 'https://www.fastmoss.com/zh';
const PROFILE_DIR = path.join(SKILL_ROOT, '.browser-profile');
const DEFAULT_UA = undefined;

/**
 * 国家站点映射：`--country` 的值 → 页面右上角国家切换按钮的显示文本 + 该站币种。
 * 国家切换是「点右上角国家按钮 → 弹层里点国家名」，选择结果持久化到登录态（profile），
 * URL 上不带 country 参数，所以每次抓取前都要显式切换一次（幂等）。
 * 币种：美国/英/德/法/西/意 = USD；泰国 = THB；印尼 = IDR；越南 = VND；马来 = MYR；日本 = JPY；新加坡 = SGD；菲律宾 = PHP；墨西哥 = MXN；巴西 = BRL。
 */
const COUNTRIES = {
  '美国':       { label: '美国',       currency: 'USD' },
  'us':         { label: '美国',       currency: 'USD' },
  'usa':        { label: '美国',       currency: 'USD' },
  'united states': { label: '美国',    currency: 'USD' },
  '泰国':       { label: '泰国',       currency: 'THB' },
  'th':         { label: '泰国',       currency: 'THB' },
  'thailand':   { label: '泰国',       currency: 'THB' },
  '印尼':       { label: '印尼',       currency: 'IDR' },
  '印度尼西亚': { label: '印尼',       currency: 'IDR' },
  'indonesia':  { label: '印尼',       currency: 'IDR' },
  '越南':       { label: '越南',       currency: 'VND' },
  'vietnam':    { label: '越南',       currency: 'VND' },
  '马来西亚':   { label: '马来西亚',   currency: 'MYR' },
  'malaysia':   { label: '马来西亚',   currency: 'MYR' },
  '菲律宾':     { label: '菲律宾',     currency: 'PHP' },
  'philippines':{ label: '菲律宾',     currency: 'PHP' },
  '日本':       { label: '日本',       currency: 'JPY' },
  'japan':      { label: '日本',       currency: 'JPY' },
  '新加坡':     { label: '新加坡',     currency: 'SGD' },
  'singapore':  { label: '新加坡',     currency: 'SGD' },
  '英国':       { label: '英国',       currency: 'USD' },
  'uk':         { label: '英国',       currency: 'USD' },
  '德国':       { label: '德国',       currency: 'USD' },
  'germany':    { label: '德国',       currency: 'USD' },
  '法国':       { label: '法国',       currency: 'USD' },
  'france':     { label: '法国',       currency: 'USD' },
  '西班牙':     { label: '西班牙',     currency: 'USD' },
  'spain':      { label: '西班牙',     currency: 'USD' },
  '意大利':     { label: '意大利',     currency: 'USD' },
  'italy':      { label: '意大利',     currency: 'USD' },
  '墨西哥':     { label: '墨西哥',     currency: 'MXN' },
  'mexico':     { label: '墨西哥',     currency: 'MXN' },
  '巴西':       { label: '巴西',       currency: 'BRL' },
  'brazil':     { label: '巴西',       currency: 'BRL' },
};

/** 解析 --country：接受中文名或英文名/ISO 代码，返回 {label, currency} */
function resolveCountry(raw) {
  if (!raw) return null;
  const key = String(raw).trim().toLowerCase();
  if (COUNTRIES[key]) return COUNTRIES[key];
  // 兜底：中文名直接查
  for (const [k, v] of Object.entries(COUNTRIES)) {
    if (k === String(raw).trim()) return v;
  }
  throw new Error(
    `未知国家「${raw}」。支持：美国(us)、泰国(th)、印尼、越南、马来西亚、菲律宾、日本、新加坡、英国、德国、法国、西班牙、意大利、墨西哥、巴西。`
  );
}

/* ---------------- 参数 ---------------- */
function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = { cmd };
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
      opts[k] = v;
    } else {
      positional.push(a);
    }
  }
  if (positional.length) opts._ = positional;
  return opts;
}

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

/* ---------------- 浏览器 ---------------- */
async function openBrowser({ headed = true, channel = 'chrome' } = {}) {
  const { chromium } = loadPlaywright();
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const t0 = Date.now();
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel,
    headless: !headed,
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'America/New_York',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      // 多 tab 并发时，后台 tab 会被 Chromium 降频：IntersectionObserver 不回调 → 懒加载接口根本不发请求。
      // 这三个开关让后台 tab 也正常渲染，并发才是真的并发。
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });
  const launchMs = Date.now() - t0;
  // 只抓 DOM：图片/字体/视频全拦掉，页面加载明显更快（列表与详情都不依赖这些资源）
  await context.route('**/*', (route) => {
    const t = route.request().resourceType();
    if (t === 'image' || t === 'media' || t === 'font') return route.abort();
    return route.fallback();
  });
  context.setDefaultTimeout(20000);
  context.setDefaultNavigationTimeout(45000);
  return { context, launchMs };
}

/** SPA 会在 goto 后再跳一次（加 page 参数），evaluate 要能容忍 context 被销毁 */
async function safeEval(page, fn, arg) {
  for (let i = 0; i < 4; i++) {
    try {
      return await page.evaluate(fn, arg);
    } catch (e) {
      if (!/Execution context was destroyed|Target closed|detached/i.test(e.message)) throw e;
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error('页面多次跳转，evaluate 失败');
}

async function assertLoggedIn(page) {
  await page.goto(`${BASE}/influencer/search?page=1`, { waitUntil: 'domcontentloaded' });
  // SPA 会二次跳转，徽标要等 userinfo 接口回来；轮询判定，别一次性判死
  for (let i = 0; i < 20; i++) {
    const st = await safeEval(page, () => {
      const t = document.body.innerText;
      const loginBtns = [...document.querySelectorAll('button,a')].filter((e) =>
        /^(登录|登 录|Log in|Sign in)$/i.test((e.innerText || '').trim())
      ).length;
      const hasUser = /旗舰版|专业版|免费版|基础版/.test(t) || /\d{3}\*{4}\d{4}/.test(t);
      return { hasUser, loginBtns, text: t.length };
    }).catch(() => ({ hasUser: false, loginBtns: 0, text: 0 }));
    if (st.hasUser && st.loginBtns === 0) return;
    if (st.loginBtns > 0 && !st.hasUser) {
      throw new Error('FastMoss 未登录：请在弹出的窗口里登录一次（登录态存进 .browser-profile），然后重跑。');
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('FastMoss 顶栏 8 秒内没渲染出来：检查网络或页面是否被拦（可先 --headed=false 观察）。');
}

/**
 * 切换国家站点：点右上角国家按钮 → 弹层里点目标国家名。
 * 国家选择持久化到 profile，但 URL 不带参数，所以每次抓取前都要显式切换（幂等：已是目标国则跳过）。
 * 返回实际切换后的国家名（用于 meta 记录），失败抛错。
 */
async function switchCountry(page, countryKey) {
  const target = resolveCountry(countryKey);
  if (!target) return null;

  // 1. 读当前右上角国家按钮文本
  const readCurrent = () =>
    safeEval(page, () => {
      const btns = [...document.querySelectorAll('button')];
      const b = btns.find((x) => ['美国', '泰国', '印尼', '越南', '马来西亚', '菲律宾', '日本', '新加坡', '英国', '德国', '法国', '西班牙', '意大利', '墨西哥', '巴西'].includes((x.innerText || '').trim()));
      return b ? b.innerText.trim() : null;
    }).catch(() => null);

  let current = await readCurrent();
  if (current === target.label) {
    log(`国家已是「${target.label}」，跳过切换`);
    return target.label;
  }

  // 2. 点开国家切换弹层（右上角带国家名的 button）
  const opener = () =>
    page.evaluate((label) => {
      const btns = [...document.querySelectorAll('button')];
      const b = btns.find((x) => ['美国', '泰国', '印尼', '越南', '马来西亚', '菲律宾', '日本', '新加坡', '英国', '德国', '法国', '西班牙', '意大利', '墨西哥', '巴西'].includes((x.innerText || '').trim()));
      if (!b) return false;
      b.click();
      return true;
    }, target.label).catch(() => false);

  if (!(await opener())) throw new Error('找不到右上角国家切换按钮，可能未登录或页面结构变化');

  // 3. 等弹层出现，点目标国家名（精确匹配，避免「印度」命中「印度尼西亚」等前缀）
  const clicked = await page
    .waitForSelector('button', { timeout: 8000 })
    .then(() => safeEval(page, (label) => {
      const btns = [...document.querySelectorAll('button')];
      const hit = btns.find((x) => (x.innerText || '').trim() === label);
      if (!hit) return false;
      hit.click();
      return true;
    }, target.label))
    .catch(() => false);

  if (!clicked) throw new Error(`国家切换弹层里找不到「${target.label}」选项`);

  // 4. 等切换生效：右上角按钮文本变为目标国
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(400);
    current = await readCurrent();
    if (current === target.label) {
      log(`已切换到「${target.label}」站（币种 ${target.currency}）`);
      return target.label;
    }
  }
  throw new Error(`切换「${target.label}」未生效（当前仍显示「${current}」）`);
}

/* ---------------- 列表抓取 ---------------- */
/** 等到“带详情链接的首行”出现——数据落地的第一个瞬间 */
async function waitRows(page, { selector = 'table tbody tr a[href*="/influencer/detail/"]', timeout = 15000 } = {}) {
  await page.waitForSelector(selector, { timeout, state: 'attached' });
}

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

function buildSearchUrl({ follower, category, page = 1, extra = '' }) {
  const qs = new URLSearchParams();
  if (follower) qs.set('follower', String(follower).replace(/\s/g, ''));
  if (category) qs.set('sale_category_l1', String(category));
  qs.set('page', String(page));
  return `${BASE}/influencer/search?${qs.toString()}${extra}`;
}

/** 并发跑 n 个任务，固定并发上限 */
async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * 带页面复用的并发池：每个 worker 只开一个 tab，串行处理自己的队列。
 * 复用同一个 tab 能吃到 SPA 的 JS/HTTP 缓存，实测 1.5s/页；
 * 若每页都 newPage，冷启动要 4.5s+。
 */
async function poolWithPage(context, items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async (_, wi) => {
    const page = await context.newPage();
    try {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await worker(page, items[i], i, wi);
      }
    } finally {
      await page.close().catch(() => {});
    }
  });
  await Promise.all(runners);
  return out;
}

async function cmdSearch(opts) {
  const pages = Number(opts.pages || 1);
  const concurrency = Number(opts.concurrency || 6);
  const outFile = opts.out || path.join(SKILL_ROOT, 'outputs', `search-${Date.now()}.json`);
  const t0 = Date.now();
  const { context, launchMs } = await openBrowser({ headed: opts.headed !== 'false' });

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

/* ---------------- 详情抓取 ---------------- */
const DEFAULT_PERIOD = '近28天';

/** 在指定标题所在分区里点周期单选（纯 DOM 派发，避免 locator 的多次往返） */
async function clickPeriod(page, headingText, period) {
  return safeEval(page, ({ headingText, period }) => {
    const heads = [...document.querySelectorAll('h2,h3')].filter((h) => h.innerText.trim().includes(headingText));
    for (const h of heads) {
      let box = h.parentElement;
      for (let i = 0; i < 8 && box; i++) {
        const hit = [...box.querySelectorAll('div,span,label')].find(
          (e) => e.childElementCount === 0 && e.innerText.trim() === period
        );
        if (hit) {
          const target = hit.closest('[cursor=pointer]') || hit.parentElement || hit;
          target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          hit.click?.();
          return true;
        }
        box = box.parentElement;
      }
    }
    return false;
  }, { headingText, period });
}


/**
 * 详情页 4 张表分别由 4 个接口喂数据，且都是「滚到可视区才发请求」：
 *   /detail/videoList  /detail/liveList  /detail/goodsList  /detail/shopList
 * 没触发时表格渲染的是 antd 占位行（隐藏测量行 + 「暂无数据」），
 * 所以「暂无数据」只代表还没请求，绝不能当加载完成。
 *
 * 就绪判据 = 这 4 个接口都返回过（有数据没数据都会返回 200）：
 * 边滚边听 response，4 个齐了立刻停，比固定 sleep 快且不丢数据。
 * 注意：同一帧里连续 scrollTo 只有最后一次会被绘制，IntersectionObserver 不会触发，必须步间让出。
 */
const LIST_ENDPOINTS = ['/detail/videoList', '/detail/liveList', '/detail/goodsList', '/detail/shopList'];

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
  // 接口回来 ≠ DOM 渲染完。逐表判定就绪：
  //   有真实数据行  → 就绪
  //   该表对应接口已返回，且表内明确显示「无数据/暂无数据」，且连续 2 轮不变 → 确实没有数据，也算就绪
  // 这样真实无数据的达人不会被白等，有数据的也不会被当空表放过。
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
  let lastKey = '';
  let same = 0;
  while (Date.now() < until) {
    const st = await probe();
    if (st) {
      counts = st.map((x) => x.n ?? (x.state === 'data' ? 1 : 0));
      const key = st.map((x) => x.state + (x.n ?? '')).join(',');
      if (key === lastKey) same++;
      else { same = 0; lastKey = key; }
      const settled = st.every(
        (x) => x.state === 'data' || (seen.has(x.ep) && x.state === 'empty' && same >= 2)
      );
      if (settled) break;
    }
    await page.waitForTimeout(100);
  }
  return { ms: Date.now() - t0, done: seen.size, missing: LIST_ENDPOINTS.filter((k) => !seen.has(k)), counts };
}

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

  // 页面自带周期就是近28天 —— 恰好对齐「近30天」诉求，不用点周期按钮。
  // 需要长周期历史时显式传 --period 近90天（点完周期会重新请求，再走一遍懒加载等待）。
  const period = opts.period || 'default';
  const tt = Date.now();
  const ready = await triggerLazyAndWait(page);
  // 90 天历史要等 4 张表都到齐之后才点周期，否则点了会被重新渲染覆盖
  if (period !== 'default') {
    for (const [section, endpoint] of [['#video_list', 'videoList'], ['#live_analysis', 'liveList']]) {
      const button = page.locator(section).getByRole('radio', { name: period, exact: true });
      if (await button.isChecked()) continue;
      const [response] = await Promise.all([
        page.waitForResponse(r => r.url().includes('/detail/' + endpoint) && r.ok()),
        button.click(),
      ]);
      if (await response.finished() || !await button.isChecked()) throw new Error('周期切换失败：' + section);
      await page.locator(section).locator('tbody tr').filter({ hasText: /\S/ }).first().waitFor();
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
          const productIds = [...new Set([...r.querySelectorAll('a[href*="/e-commerce/detail/"]')].map(a => a.pathname.split('/').pop()))];
          return {
            href: link ? link.href : '', productIds,
            cells: [...r.querySelectorAll('td')].map((c) => c.innerText.replace(/\s*\n\s*/g, ' | ').trim()),
          };
        })
        // 只留真实数据行：至少 2 个 td 且整行有非空白内容（排除 antd 隐藏测量行与「暂无数据」占位行）
        .filter((r) => r.cells.length >= 2 && r.cells.join('').replace(/\s/g, '').length > 0);
      const section = t.closest('#video_list, #live_analysis, #cargo_product_list');
      const selected = section?.querySelector('input[type=radio]:checked, [role=radio][aria-checked=true]');
      const dates = section ? [...section.querySelectorAll('input')].map(x => x.value).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)) : [];
      out.push({ headers, rows, period: selected?.closest('label')?.innerText?.trim() || null, dates });
    }
    return out;
  });

  timings.totalMs = Date.now() - t0;
  return { id, url, overview, tables, timings };
}

async function cmdDetail(opts) {
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
  const { context, launchMs } = await openBrowser({ headed: opts.headed !== 'false' });
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

  // 补抓两类：抛异常的 + 4 张表全空（懒加载接口没触发的假空）
  const needRetry = results.filter((r) => {
    if (r.error) return true;
    const has = (k) => (r.tables || []).some((t) => t.headers.join('').includes(k) && t.rows.length > 0);
    return !has('视频销量') && !has('商品价格') && !has('合作商品数');
  });
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

/* ---------------- 一条龙 ---------------- */
const BAG_RE = /(包|箱|手袋|钱包|托特|双肩|斜挎|单肩|手拿|化妆包|洗漱包|handbag|tote|backpack|purse|bag|satchel|clutch|กระเป๋า|ถุง|ย่าม)/i;
const MV = (s) => {
  if (!s) return 0;
  // 剥离货币符号（$ ฿ Rp ₫ ₱ 等）与逗号；泰国站金额形如 ฿424.17万
  const t = String(s).replace(/[$,฿₫₱¥€£\s]|Rp|S\$|MX\$|R\$/g, '');
  const n = parseFloat(t);
  if (isNaN(n)) return 0;
  return /万$/.test(t) ? n * 1e4 : n;
};

async function cmdPipeline(opts) {
  const outDir = opts['out-dir'] || path.join(SKILL_ROOT, 'outputs', `rpa-${new Date().toISOString().slice(0, 10)}`);
  fs.mkdirSync(outDir, { recursive: true });
  const pages = Number(opts.pages || 60);
  const concurrency = Number(opts.concurrency || 6);
  // 详情页必须串行：实测并发 3 会让约 40% 的后台 tab 懒加载接口不触发（丢数据 + 等满超时更慢）。
  // 串行单页稳定 3s、100% 成功；列表页很轻（只读搜索表格），可高并发。
  const dConc = Number(opts['detail-concurrency'] || 1);
  const top = Number(opts.top || 18);

  const t0 = Date.now();
  const { context, launchMs } = await openBrowser({ headed: opts.headed !== 'false' });
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
  const bagRows = records.filter((r) => BAG_RE.test(r.cells[1] || ''));
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
  log(`列表完成：${records.length} 位 → 含包 ${bagRows.length} 位 → 取前 ${picked.length} 位做详情`);

  const tDetail = Date.now();
  const details = await poolWithPage(context, picked.map((p) => p.id), dConc, async (page, id) => {
    try { return await grabDetail(page, id, { period: opts.period }); }
    catch (e) { return { id, error: String(e).slice(0, 150) }; }
  });
  // 补抓两类：抛异常的 + 4 张表全空（懒加载接口没触发的假空，第一位达人尤其常见）
  const needRetry = details.filter((d) => {
    if (d.error) return true;
    const has = (k) => (d.tables || []).some((t) => t.headers.join('').includes(k) && t.rows.length > 0);
    return !has('视频销量') && !has('商品价格') && !has('合作商品数');
  });
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

/* ---------------- 独立国家切换 ---------------- */
/** 单独切换国家并持久化到 profile（不抓数据），供其他人先切站再用别的子命令 */
async function cmdCountry(opts) {
  const key = opts.country || (Array.isArray(opts._) ? opts._[0] : opts._);
  if (!key) throw new Error('缺少国家参数：node scripts/rpa/fastmoss-rpa.mjs country 泰国');
  const { context, launchMs } = await openBrowser({ headed: opts.headed !== 'false' });
  await assertLoggedIn(context.pages()[0]);
  const label = await switchCountry(context.pages()[0], key);
  log(`国家切换完成：${label}（已持久化到 profile，币种 ${resolveCountry(key).currency}）`);
  await context.close();
  return { label, launchMs };
}

/* ---------------- 入口 ---------------- */
const main = async () => {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.cmd || opts.cmd === 'help') {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
    return;
  }
  if (opts.cmd === 'search') return cmdSearch(opts);
  if (opts.cmd === 'detail') return cmdDetail(opts);
  if (opts.cmd === 'pipeline') return cmdPipeline(opts);
  if (opts.cmd === 'country') return cmdCountry(opts);
  throw new Error('未知命令：' + opts.cmd);
};

main().catch((e) => {
  console.error('RPA 失败：', e.message);
  process.exit(1);
});
