// 浏览器生命周期：启动 persistent context、登录检测、国家切换、SPA 安全的 DOM 求值。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { BASE, PROFILE_DIR, SKILL_ROOT, COUNTRY_LABELS, resolveCountry } from './config.mjs';
import { log } from './cli.mjs';

/** 所有存活的浏览器上下文，入口 finally 统一关闭，避免资源泄漏 */
export const activeContexts = new Set();

/** 加载技能目录 .tools 下本地安装的 playwright（不入库、不依赖全局安装） */
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

/** 打开持久化浏览器上下文（复用登录态）。返回 { context, launchMs }，context 登记到 activeContexts。 */
export async function openBrowser({ headed = false, channel = 'chrome' } = {}) {
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
  activeContexts.add(context);
  context.once('close', () => activeContexts.delete(context));
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
export async function safeEval(page, fn, arg) {
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

/** 校验登录态：轮询顶栏徽标，区分「未登录 / 风控验证 / 已登录」。 */
export async function assertLoggedIn(page, detectUrl) {
  const url = detectUrl || `${BASE}/influencer/search?page=1`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // SPA 会二次跳转，徽标要等 userinfo 接口回来；轮询判定，别一次性判死
  for (let i = 0; i < 20; i++) {
    const st = await safeEval(page, () => {
      const t = document.body.innerText;
      const loginBtns = [...document.querySelectorAll('button,a')].filter((e) =>
        /^(登录|登 录|Log in|Sign in)$/i.test((e.innerText || '').trim())
      ).length;
      const hasUser = /旗舰版|专业版|免费版|基础版/.test(t) || /\d{3}\*{4}\d{4}/.test(t);
      const risk = /正在保护|进一步确认|请求 ID/.test(t);
      return { hasUser, loginBtns, text: t.length, risk };
    }).catch(() => ({ hasUser: false, loginBtns: 0, text: 0, risk: false }));
    if (st.hasUser && st.loginBtns === 0) return;
    if (st.risk) {
      // 命中风控页：给出请求 ID 与建议，而非误判为「未登录」
      throw new Error('FastMoss 触发风控验证（页面提示需人工确认）。请在浏览器里完成验证后重试；若持续出现，复制请求 ID 联系客服。');
    }
    if (st.loginBtns > 0 && !st.hasUser) {
      throw new Error('FastMoss 未登录：请运行 node scripts/rpa/login-window.mjs 完成登录并关闭窗口，然后重跑。');
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('FastMoss 顶栏 8 秒内没渲染出来：检查网络或页面是否被拦（可先 --headed true 观察）。');
}

/**
 * 切换国家站点：点右上角国家按钮 → 弹层里点目标国家名。
 * 国家选择持久化到 profile，但 URL 不带参数，所以每次抓取前都要显式切换（幂等：已是目标国则跳过）。
 * 返回实际切换后的国家名（用于 meta 记录），失败抛错。
 */
export async function switchCountry(page, countryKey) {
  const target = resolveCountry(countryKey);
  if (!target) return null;

  // 1. 读当前右上角国家按钮文本
  const readCurrent = () =>
    safeEval(page, (labels) => {
      const btns = [...document.querySelectorAll('button')];
      const b = btns.find((x) => labels.includes((x.innerText || '').trim()));
      return b ? b.innerText.trim() : null;
    }, COUNTRY_LABELS).catch(() => null);

  let current = await readCurrent();
  if (current === target.label) {
    log(`国家已是「${target.label}」，跳过切换`);
    return target.label;
  }

  // 2. 点开国家切换弹层（右上角带国家名的 button）
  const opener = () =>
    page.evaluate((labels) => {
      const btns = [...document.querySelectorAll('button')];
      const b = btns.find((x) => labels.includes((x.innerText || '').trim()));
      if (!b) return false;
      b.click();
      return true;
    }, COUNTRY_LABELS).catch(() => false);

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
