#!/usr/bin/env node
/** 打开 FastMoss 供手动登录一次，登录态持久化到 .browser-profile/ */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, '../..');
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(SKILL_ROOT, '.tools/node_modules/playwright'));

const ctx = await chromium.launchPersistentContext(path.join(SKILL_ROOT, '.browser-profile'), {
  channel: 'chrome',
  headless: false,
  viewport: { width: 1440, height: 900 },
  args: [
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
});
const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto('https://www.fastmoss.com/zh', { waitUntil: 'domcontentloaded' });
console.log('浏览器已打开，请在窗口里登录 FastMoss。登录完成后可直接关闭本窗口（登录态已持久化）。');
