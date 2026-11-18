// 安装、自检、登录和采集共用的运行环境；不读取用户浏览器的个人配置。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SKILL_ROOT } from './config.mjs';

const require = createRequire(import.meta.url);

export function assertNodeVersion(version = process.versions.node) {
  if (Number(version.split('.')[0]) < 22) throw new Error('需要 Node.js 22 或更高版本，建议安装 Node.js 24 LTS；当前为 ' + version);
}

export function loadPlaywright() {
  assertNodeVersion();
  const directory = path.join(SKILL_ROOT, 'node_modules', 'playwright');
  const expected = JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, 'package.json'), 'utf8')).dependencies.playwright;
  try {
    const installed = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).version;
    if (installed !== expected) throw new Error('Playwright 版本不匹配：需要 ' + expected + '，当前为 ' + installed);
    return require(directory);
  } catch (error) {
    throw new Error('采集依赖未就绪，请在项目目录运行 node scripts/rpa/setup.mjs。原因：' + error.message, { cause: error });
  }
}

/** 浏览器选择只在启动前确定，不因网页验证/权限失败自动切换。 */
export function browserLaunchOptions() {
  return {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'America/New_York',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      // 保持后台标签页渲染，供详情模块的懒加载使用。
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  };
}

export function browserLaunchError(error) {
  const hint = /ProcessSingleton|SingletonLock|user data directory is already in use/i.test(error.message)
    ? '请关闭使用同一项目的登录窗口或采集任务后重试。'
    : '请确认所选浏览器已安装，并运行 node scripts/rpa/doctor.mjs 查看环境。';
  return new Error('浏览器启动失败。' + hint + '\n' + error.message, { cause: error });
}
