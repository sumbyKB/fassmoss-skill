// 店铺趋势命令：近N天 vs 上个N天涨跌对比 + 商品级归因。
// 数据源：店铺级 /api/shop/v3/recentData（date_type=90 拿 90 天逐日），商品级 /api/goods/v3/overview（d_type=90）。
// 接口有 MSG_SAFE_0001 签名，只能通过「页面正常操作(点击近90天) + 监听响应」拿数据，不能直接 fetch。
import fs from 'node:fs';
import path from 'node:path';
import { BASE, SKILL_ROOT, resolveCountry } from '../lib/config.mjs';
import { log } from '../lib/cli.mjs';
import { openBrowser, safeEval, assertLoggedIn, switchCountry, enableImages } from '../lib/browser.mjs';
import { makeTracker, waitTracked } from '../lib/tracker.mjs';
import { resolveShopId, grabShopOverview } from '../lib/shop.mjs';
import { cell, short, pct, money } from '../lib/report.mjs';

const SHOP_SEARCH = `${BASE}/shop-marketing/search`;
const SHOP_DETAIL = `${BASE}/shop-marketing/detail`;
const GOODS_DETAIL = `${BASE}/e-commerce/detail`;

/** 点击文本匹配的周期按钮（如「近90天」）。用 playwright 真实点击（antd radio 需完整鼠标事件序列）。 */
async function clickLeaf(page, text) {
  try {
    const btn = page.locator(`text="${text}"`).first();
    if (await btn.count() > 0) { await btn.click(); return true; }
  } catch (e) { /* 点击失败，返回 false */ }
  return false;
}

/** 检测是否出现腾讯验证码（遮罩层或风控提示） */
async function detectCaptcha(page) {
  return await page.evaluate(() => {
    return !!document.querySelector('#tCaptchaMaskLayer') || /正在保护|进一步确认|请求 ID/.test(document.body.innerText || '');
  }).catch(() => false);
}

/** 点击周期按钮并等待目标响应；若触发验证码，放行图片并等待人工完成后重试。 */
async function clickPeriodAndWait(page, context, tracker, text, condition, timeout = 15000) {
  await clickLeaf(page, text);
  let body = await waitTracked(tracker, condition, { timeout });
  if (body) return body;
  if (await detectCaptcha(page)) {
    enableImages(context); // 放行图片，让验证码可见
    log('触发访问验证，已放行图片，请在浏览器里完成验证（最多等待 120 秒）…');
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (!(await detectCaptcha(page))) break;
    }
    await clickLeaf(page, text);
    body = await waitTracked(tracker, condition, { timeout });
  }
  return body;
}

/** 从逐日趋势数组计算近N天 / 上个N天的增量销量与销售额 */
function comparePeriod(trend, days) {
  const inc = (d, k) => Number(d[k]) || 0;
  const last = trend.slice(-days).reduce((s, d) => ({ sold: s.sold + inc(d, 'inc_sold_count'), amount: s.amount + inc(d, 'inc_sale_amount') }), { sold: 0, amount: 0 });
  const prev = trend.slice(-2 * days, -days).reduce((s, d) => ({ sold: s.sold + inc(d, 'inc_sold_count'), amount: s.amount + inc(d, 'inc_sale_amount') }), { sold: 0, amount: 0 });
  const pct = (cur, pre) => (pre > 0 ? ((cur - pre) / pre) * 100 : null);
  return {
    cur: last, prev,
    sold_pct: pct(last.sold, prev.sold),
    amount_pct: pct(last.amount, prev.amount),
    trend_days: trend.length,
    first_date: trend[0]?.dt, last_date: trend[trend.length - 1]?.dt,
  };
}

/** shop-trend：近N天 vs 上个N天涨跌 + 商品归因。店铺名/国家/天数均为变量。 */
export async function cmdShopTrend(opts) {
  const days = Math.max(1, Number(opts.days || 30));
  const shopName = opts.shop || opts['shop-name'] || (Array.isArray(opts._) ? opts._[0] : null);
  const shopId = opts['shop-id'] || opts.id || null;
  if (!shopName && !shopId) throw new Error('缺少店铺名或 ID：node scripts/rpa/fastmoss-rpa.mjs shop-trend --shop <店铺名> [--country 泰国] [--days 30]');
  const outFile = path.resolve(opts.out || path.join(SKILL_ROOT, 'outputs', `shop-trend-${(shopName || shopId).replace(/[^\w.-]/g, '_')}-${Date.now()}.json`));
  if (!outFile.toLowerCase().endsWith('.json')) throw new Error('--out 请使用 .json 文件名');
  const reportFile = outFile.slice(0, -5) + '.md';
  const t0 = Date.now();

  const { context, launchMs } = await openBrowser({ headed: opts.headed === true || opts.headed === 'true' });
  await assertLoggedIn(context.pages()[0], SHOP_SEARCH);
  const country = opts.country ? await switchCountry(context.pages()[0], opts.country) : null;
  const currency = country ? resolveCountry(country).currency : (opts.currency || 'THB');
  const page = context.pages()[0];

  const resolvedId = shopId || (await resolveShopId(page, shopName));

  // === 店铺级趋势 ===
  const recentTracker = makeTracker(page, '/api/shop/v3/recentData');
  await page.goto(`${SHOP_DETAIL}/${resolvedId}`, { waitUntil: 'domcontentloaded' });
  // 页面默认加载近28天；等默认数据后再抓总览（此时 overview 8 项已渲染）
  await waitTracked(recentTracker, (v) => { try { return JSON.parse(v)?.data?.list?.trend?.length > 0; } catch { return false; } });
  await page.waitForTimeout(1500);
  // 抓总览 8 项（含「分类排名」= 运动鞋类目排名）
  const shopOverview = await grabShopOverview(page);
  recentTracker.reset();
  const recentBody = await clickPeriodAndWait(page, context, recentTracker, '近90天', (v) => { try { return JSON.parse(v)?.data?.list?.trend?.length > 28; } catch { return false; } });
  if (!recentBody) {
    const latest = recentTracker.get();
    let latestLen = null;
    try { latestLen = JSON.parse(latest)?.data?.list?.trend?.length ?? null; } catch { latestLen = null; }
    recentTracker.dispose();
    throw new Error(`未拿到店铺近90天趋势数据（最近一次 trend 长度=${latestLen ?? '未捕获'}）`);
  }
  recentTracker.dispose();
  const recentJson = JSON.parse(recentBody);
  const shopTrend = recentJson.data.list.trend;
  const shopCmp = comparePeriod(shopTrend, days);
  // 用接口返回的真实店铺名（total_info.shop_name），比搜索词或 ID 更准确
  const resolvedShopName = recentJson.data.list.total_info?.shop_name || shopName || resolvedId;

  // === 商品列表 ===
  const goodsTracker = makeTracker(page, '/api/shop/v3/goods');
  await page.reload({ waitUntil: 'domcontentloaded' });
  const goodsBody = await waitTracked(goodsTracker, (v) => { try { return Array.isArray(JSON.parse(v)?.data?.product_list); } catch { return false; } });
  if (!goodsBody) throw new Error('未拿到店铺商品列表');
  const productList = (JSON.parse(goodsBody).data.product_list || []).filter((p) => (Number(p.sold_count) || 0) > 0);
  log(`店铺趋势 OK（${shopTrend.length} 天），有动销商品 ${productList.length} 个，开始逐个抓商品趋势`);

  // === 商品级趋势（逐个进商品详情，点近90天拿 overview 的 chart_list）===
  const products = [];
  const goodsTracker2 = makeTracker(page, '/api/goods/v3/overview');
  for (const p of productList) {
    const pid = String(p.product_id || p.id);
    try {
      goodsTracker2.reset(); // 先重置，避免上一个商品的残留数据被误判为当前商品
      await page.goto(`${GOODS_DETAIL}/${pid}`, { waitUntil: 'domcontentloaded' });
      // 等当前商品默认 overview（28天）发出
      const def = await waitTracked(goodsTracker2, (v) => { try { return JSON.parse(v)?.data?.chart_list?.length > 0; } catch { return false; } }, { timeout: 12000 });
      if (!def) throw new Error('默认 overview 未加载');
      goodsTracker2.reset();
      const ovBody = await clickPeriodAndWait(page, context, goodsTracker2, '近90天', (v) => { try { return JSON.parse(v)?.data?.chart_list?.length > 28; } catch { return false; } }, 12000);
      const chart = ovBody ? JSON.parse(ovBody).data.chart_list : null;
      const cmp = chart ? comparePeriod(chart, days) : null;
      products.push({
        id: pid,
        title: p.title,
        price: p.price,
        ori_price: p.ori_price,
        crate: p.crate,
        ctime: p.ctime,
        category_l2: (p.category_name_l2 || []).join('/'),
        product_rating: p.product_rating,
        relate_author_count: p.relate_author_count,
        tiktok_url: p.detail_url,
        fastmoss_url: `${GOODS_DETAIL}/${pid}`,
        sold_28d: Number(p.sold_count) || 0,
        amount_28d: Number(p.sale_amount) || 0,
        cmp,
      });
      const trendStr = cmp ? `近${days}天销量${cmp.cur.sold} vs 上个${days}天${cmp.prev.sold} → ${cmp.sold_pct == null ? '—' : (cmp.sold_pct >= 0 ? '涨' : '跌') + Math.abs(cmp.sold_pct).toFixed(1) + '%'}` : '无趋势数据';
      log(`商品 ${pid} ${(p.title || '').slice(0, 20)}：${trendStr}`);
    } catch (e) {
      products.push({ id: pid, title: p.title, price: p.price, crate: p.crate, sold_28d: Number(p.sold_count) || 0, amount_28d: Number(p.sale_amount) || 0, fastmoss_url: `${GOODS_DETAIL}/${pid}`, cmp: null, error: String(e).slice(0, 100) });
      log(`商品 ${pid} 抓取失败：${String(e).slice(0, 80)}`);
    }
  }
  goodsTracker2.dispose();

  // === 归因：按商品涨跌幅度排序，找拖后腿 vs 领涨 ===
  const withCmp = products.filter((p) => p.cmp && p.cmp.sold_pct != null);
  withCmp.sort((a, b) => b.cmp.sold_pct - a.cmp.sold_pct);
  const risers = withCmp.filter((p) => p.cmp.sold_pct > 0);
  const decliners = withCmp.filter((p) => p.cmp.sold_pct < 0);
  const attrItem = (p) => ({ id: p.id, title: p.title, price: p.price, crate: p.crate, fastmoss_url: p.fastmoss_url, sold_pct: p.cmp.sold_pct, amount_pct: p.cmp.amount_pct, cur_sold: p.cmp.cur.sold, prev_sold: p.cmp.prev.sold, cur_amount: p.cmp.cur.amount, prev_amount: p.cmp.prev.amount });

  const result = {
    collected_at: new Date().toISOString(),
    shop_name: resolvedShopName,
    shop_id: resolvedId,
    country: country || null,
    currency,
    compare_days: days,
    overview: shopOverview,
    shop: shopCmp,
    products,
    attribution: {
      risers: risers.map(attrItem),
      decliners: decliners.map(attrItem),
    },
    timings: { launchMs, totalMs: Date.now() - t0 },
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(reportFile, renderShopTrendReport(result), 'utf8');
  log(`写出 ${outFile} / ${reportFile}`);
  await context.close();
  return { result, outFile, reportFile };
}

/** 生成店铺趋势报告（数据驱动，不硬编码） */
function renderShopTrendReport(r) {
  const s = r.shop;
  const ov = r.overview || {};
  const moneyOf = (n) => money(n, r.currency);
  const lines = [
    `# ${r.shop_name || r.shop_id} 店铺趋势分析（近${r.compare_days}天 vs 上个${r.compare_days}天）`,
    '',
    `> 采集 ${(r.collected_at || '').slice(0, 10)} · 国家 ${r.country || '未知'} · 币种 ${r.currency} · 趋势区间 ${s.first_date} ~ ${s.last_date}（${s.trend_days} 天逐日）`,
    '',
    '## 一、店铺总览（累计口径）',
    '',
    '| 指标 | 数值 | 指标 | 数值 |',
    '|---|---|---|---|',
    `| 总销量 | ${cell(ov['总销量'])} | 总销售额 | ${cell(ov['总销售额'])} |`,
    `| 在售商品数 | ${cell(ov['在售商品数'])} | 全国排名 | ${cell(ov['全国排名'])} |`,
    `| 带货直播数 | ${cell(ov['带货直播数'])} | 带货视频数 | ${cell(ov['带货视频数'])} |`,
    `| 带货达人数 | ${cell(ov['带货达人数'])} | **分类排名** | **${cell(ov['分类排名'])}** |`,
    '',
    `## 二、近${r.compare_days}天 vs 上个${r.compare_days}天`,
    '',
    '| 指标 | 近' + r.compare_days + '天 | 上个' + r.compare_days + '天 | 环比 |',
    '|---|---|---|---|',
    `| 销量 | ${cell(s.cur.sold)} | ${cell(s.prev.sold)} | ${pct(s.sold_pct)} |`,
    `| GMV | ${moneyOf(s.cur.amount)} | ${moneyOf(s.prev.amount)} | ${pct(s.amount_pct)} |`,
    '',
  ];
  const over = s.amount_pct == null ? '未知' : s.amount_pct >= 0 ? '上涨' : '下跌';
  lines.push(`**结论：整体 GMV ${over}**（${pct(s.amount_pct)}），销量 ${pct(s.sold_pct)}。`);
  lines.push('');

  const goodsTable = (title, arr) => {
    const out = [`### ${title}`, '', '| 商品 | 价格 | 佣金 | 近' + r.compare_days + '天销量 | 上个' + r.compare_days + '天 | 销量环比 | 近' + r.compare_days + '天GMV | 上个' + r.compare_days + '天 | GMV环比 | 链接 |', '|---|---|---|---|---|---|---|---|---|---|'];
    for (const p of arr) {
      const link = p.fastmoss_url ? `[FastMoss](${p.fastmoss_url})` : '—';
      out.push(`| ${cell(short(p.title))} | ${cell(p.price)} | ${cell(p.crate)} | ${cell(p.cur_sold)} | ${cell(p.prev_sold)} | ${pct(p.sold_pct)} | ${moneyOf(p.cur_amount)} | ${moneyOf(p.prev_amount)} | ${pct(p.amount_pct)} | ${link} |`);
    }
    out.push('');
    return out.join('\n');
  };

  lines.push('## 三、商品归因（近' + r.compare_days + '天销量环比）', '');
  if (r.attribution.decliners.length) lines.push(goodsTable('拖后腿（销量下跌）', r.attribution.decliners));
  else lines.push('### 拖后腿（销量下跌）', '', '无下跌商品。', '');
  if (r.attribution.risers.length) lines.push(goodsTable('领涨（销量上涨）', r.attribution.risers));

  lines.push('---', '', '*数据可追溯至 JSON 产物；涨跌基于逐日增量（inc_sold_count/inc_sale_amount）精确求和，非估算；「分类排名」即店铺在该类目（运动鞋）内的排名；商品级趋势缺失时如实标注。*');
  return lines.join('\n');
}
