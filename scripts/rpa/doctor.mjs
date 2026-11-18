#!/usr/bin/env node
// 无界面自检，不访问 FastMoss、不使用登录态、不弹窗。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SKILL_ROOT, PROFILE_DIR } from './lib/config.mjs';
import { loadPlaywright, browserLaunchOptions, browserLaunchError } from './lib/runtime.mjs';

export async function doctor() {
  const { chromium } = loadPlaywright();
  const options = { ...browserLaunchOptions(), headless: true };
  const probe = fs.mkdtempSync(path.join(SKILL_ROOT, '.doctor-'));
  fs.rmdirSync(probe);
  let browser;
  try {
    browser = await chromium.launch(options);
    const page = await browser.newPage();
    await page.setContent('<title>FastMoss environment check</title>');
    if (await page.title() !== 'FastMoss environment check') throw new Error('浏览器页面读取失败');
    console.log('PASS：Node ' + process.versions.node + ' / ' + process.platform + '-' + process.arch);
    console.log('PASS：项目依赖、目录写入、无界面浏览器 ' + (options.channel || 'chromium') + ' ' + browser.version());
    console.log('项目目录：' + SKILL_ROOT);
    console.log('登录目录：' + PROFILE_DIR + '（本机独立使用，请勿分享）');
    console.log('此检查不验证 FastMoss 登录、会员权限或网络；采集时另行检查。');
  } catch (error) {
    throw browserLaunchError(error);
  } finally {
    if (browser) await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  doctor().catch(error => { console.error('环境自检失败：', error.message); process.exitCode = 1; });
}
