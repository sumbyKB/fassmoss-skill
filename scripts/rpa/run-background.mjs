#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const commands = new Set(['search', 'detail', 'pipeline', 'product', 'product-roi', 'category-roi', 'shop', 'categories', 'country', 'shop-detail', 'shop-detail-report', 'live', 'live-detail', 'video', 'ad']);
if (!commands.has(args[0])) throw new Error('请提供采集命令，如 search、pipeline、product 或 shop');
if (args.some(arg => arg === '--headed' || arg.startsWith('--headed='))) {
  throw new Error('后台启动器固定无界面运行。需要可见窗口时请直接运行 fastmoss-rpa.mjs --headed true');
}
const directory = path.join(root, 'outputs', 'background');
mkdirSync(directory, { recursive: true });
const logPath = path.join(directory, `${Date.now()}-${args[0]}.log`);
const log = openSync(logPath, 'a');
try {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fastmoss-rpa.mjs', import.meta.url)), ...args, '--headed', 'false'], {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log, log],
  });
  child.once('error', error => {
    console.error('后台进程启动失败：', error.message);
    process.exitCode = 1;
  });
  child.once('spawn', () => {
    child.unref();
    console.log(JSON.stringify({ pid: child.pid, log: logPath, status: 'started' }));
  });
} finally {
  closeSync(log);
}
