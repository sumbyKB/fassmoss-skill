#!/usr/bin/env node
// 只有用户运行此入口才打开前台窗口；与采集共用依赖及独立登录目录。
import { once } from 'node:events';
import { BASE } from './lib/config.mjs';
import { openBrowser } from './lib/browser.mjs';

let context;
try {
  ({ context } = await openBrowser({ allowImages: true }));
  const closed = once(context, 'close');
  const page = context.pages()[0] || await context.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  console.log('请在打开的窗口人工登录 FastMoss。登录完成后关闭整个窗口，登录态仅保存在本机；然后再运行采集。');
  await closed;
} catch (error) {
  console.error('登录窗口失败：', error.message);
  process.exitCode = 1;
} finally {
  if (context) await context.close();
}
