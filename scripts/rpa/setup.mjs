#!/usr/bin/env node
/**
 * 一次性准备 playwright 到技能目录的 .tools（本地安装，不入库）
 *   node scripts/rpa/setup.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, '../..');
const TOOLS = path.join(SKILL_ROOT, '.tools');
const NODE = process.execPath;
const NPM_CLI = path.join(path.dirname(NODE), 'node_modules/npm/bin/npm-cli.js');

fs.mkdirSync(TOOLS, { recursive: true });

if (fs.existsSync(path.join(TOOLS, 'node_modules/playwright/package.json'))) {
  console.log('playwright 已存在：', path.join(TOOLS, 'node_modules/playwright'));
  process.exit(0);
}

console.log('安装 playwright 到', TOOLS);
execFileSync(NODE, [NPM_CLI, 'install', 'playwright@1.65.0-alpha-2026-10-30', '--no-audit', '--no-fund',
  '--cache', path.join(SKILL_ROOT, '.npmcache')], { cwd: TOOLS, stdio: 'inherit' });
console.log('完成。首次运行会使用系统 Chrome（channel=chrome），无需下载浏览器。');
