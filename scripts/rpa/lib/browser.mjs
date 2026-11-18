// 浏览器生命周期：启动 persistent context、登录检测、国家切换、SPA 安全的 DOM 求值。
import fs from 'node:fs';
import { loadPlaywright, browserLaunchOptions, browserLaunchError } from './runtime.mjs';
import { BASE, PROFILE_DIR, COUNTRY_LABELS, resolveCountry } from './config.mjs';
import { log } from './cli.mjs';

/** 所有存活的浏览器上下文，入口 finally 统一关闭，避免资源泄漏 */
export const activeContexts = new Set();

/** 记录每个 context 是否拦截图片（WeakMap：运行时可动态切换，用于「默认拦图加速、触发验证码时放行」） */
const blockImages = new WeakMap();

/** 打开持久化浏览器上下文（复用登录态）。返回 { context, launchMs }，context 登记到 activeContexts。 */
export async function openBrowser({ allowImages = false } = {}) {
  const { chromium } = loadPlaywright();
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const t0 = Date.now();
  let context;
  try {
    context = await chromium.launchPersistentContext(PROFILE_DIR, browserLaunchOptions());
  } catch (error) {
    throw browserLaunchError(error);
  }
  activeContexts.add(context);
  context.once('close', () => activeContexts.delete(context));
  const launchMs = Date.now() - t0;
  // 只抓 DOM：图片/字体/视频默认拦掉，页面加载明显更快（列表与详情都不依赖这些资源）。
  // 人工登录窗口始终显示图片，采集窗口在人工验证期间临时放行。
  blockImages.set(context, !allowImages);
  try {
    await context.route('**/*', (route) => {
      const t = route.request().resourceType();
      if (blockImages.get(context) && !verificationCounts.get(context) && (t === 'image' || t === 'media' || t === 'font')) return route.abort();
      return route.fallback();
    });
    context.setDefaultTimeout(20000);
    context.setDefaultNavigationTimeout(45000);
    return { context, launchMs };
  } catch (error) {
    await context.close();
    throw error;
  }
}

const pendingVerification = new WeakMap();
const verificationCounts = new WeakMap();

async function waitForManualVerification(page) {
  const context = page.context?.();
  if (!context || !blockImages.has(context)) return false;
  const existing = pendingVerification.get(page);
  if (existing) return existing;

  verificationCounts.set(context, (verificationCounts.get(context) || 0) + 1);
  const waiting = (async () => {
    log('请在当前独立 Chrome 窗口完成验证码。已放行图片，若图片仍空白，请使用验证码面板的刷新按钮。最多等待 3 分钟。');
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline && !page.isClosed()) {
      await page.waitForTimeout(400);
      if (!await safeEval(page, hasCaptchaPopup)) return true;
    }
    return false;
  })();
  pendingVerification.set(page, waiting);
  try {
    return await waiting;
  } finally {
    pendingVerification.delete(page);
    verificationCounts.set(context, verificationCounts.get(context) - 1);
  }
}

function hasCaptchaPopup() {
  const popup = document.querySelector('#tCaptchaMaskLayer');
  return !!popup?.getClientRects().length && getComputedStyle(popup).visibility !== 'hidden';
}

/** 只读取可见拦截状态；后台任务不得通过弹窗或等待人工来继续采集。 */
export function pageAccessBlocker() {
  const text = document.body?.innerText || '';
  const popup = document.querySelector('#tCaptchaMaskLayer');
  if ((popup?.getClientRects().length && getComputedStyle(popup).visibility !== 'hidden') || /Web\s*Security|Access Denied/i.test(document.title) || /正在保护|进一步确认|请求 ID/.test(text)) return 'FastMoss 访问验证尚未通过，请在独立窗口完成人工验证后重试';
  if (/功能使用次数已达|已达.*(?:上限|限制)|升级.*(?:解锁|查看完整)/.test(text)) return 'FastMoss 网页次数或权限受限';
  if (/您当前是游客身份/.test(text) || [...document.querySelectorAll('button')].some(e => /^(登录|登 录|Log in|Sign in)$/.test(e.innerText.trim()))) return 'FastMoss 当前采集窗口未登录';
  return null;
}

export async function assertPageAccess(page) {
  if (await safeEval(page, hasCaptchaPopup)) await waitForManualVerification(page);
  const message = await safeEval(page, pageAccessBlocker);
  if (message) { const error = new Error(message); error.code = 'FASTMOSS_BLOCKED'; throw error; }
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
  // SPA 会二次跳转，徽标要等 userinfo 接口回来；轮询判定，别一次性判死。
  // 默认等 30s：风控/慢网下首屏渲染实测约 30s，原 8s 会误判成「页面被拦」。
  // 可用环境变量 FMS_ASSERT_TIMEOUT_MS 覆盖（毫秒，最小 2000）。
  const timeoutMs = Math.max(2000, Number(process.env.FMS_ASSERT_TIMEOUT_MS) || 30000);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const st = await safeEval(page, () => {
      const t = document.body.innerText;
      const loginBtns = [...document.querySelectorAll('button,a')].filter((e) =>
        /^(登录|登 录|Log in|Sign in)$/i.test((e.innerText || '').trim())
      ).length;
      const hasUser = /旗舰版|专业版|免费版|基础版/.test(t) || /\d{3}\*{4}\d{4}/.test(t);
      const popup = document.querySelector('#tCaptchaMaskLayer');
      const risk = (!!popup?.getClientRects().length && getComputedStyle(popup).visibility !== 'hidden') || /Web\s*Security|Access Denied/i.test(document.title) || /正在保护|进一步确认|请求 ID/.test(t);
      return { hasUser, loginBtns, text: t.length, risk };
    }).catch(() => ({ hasUser: false, loginBtns: 0, text: 0, risk: false }));
    if (st.risk) {
      if (await safeEval(page, hasCaptchaPopup) && await waitForManualVerification(page)) continue;
      // 命中风控页：给出请求 ID 与建议，而非误判为「未登录」
      const error = new Error('FastMoss 触发风控验证。请单独运行登录窗口完成人工验证后重试。');
      error.code = 'FASTMOSS_BLOCKED';
      throw error;
    }
    if (st.hasUser && st.loginBtns === 0) return;
    if (st.loginBtns > 0 && !st.hasUser) {
      const error = new Error('FastMoss 未登录：请运行 node scripts/rpa/login-window.mjs 完成登录并关闭窗口，然后重跑。');
      error.code = 'FASTMOSS_BLOCKED';
      throw error;
    }
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`FastMoss 顶栏 ${Math.round(timeoutMs / 1000)} 秒内没渲染出来：检查网络或页面是否被拦。`);
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
