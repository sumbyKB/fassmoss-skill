#!/usr/bin/env node
// 兼容原安装入口；按标准锁文件安装，不猜测 npm 在 Node 旁边的路径。
import { execFileSync } from 'node:child_process';
import { SKILL_ROOT } from './lib/config.mjs';
import { assertNodeVersion } from './lib/runtime.mjs';

try {
  assertNodeVersion();
  const installOptions = { cwd: SKILL_ROOT, stdio: 'inherit', windowsHide: true };
  // npm.cmd 需要解释器；命令为固定值，不拼接用户输入或项目路径。
  if (process.platform === 'win32') {
    execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd ci --no-audit --no-fund'], installOptions);
  } else {
    execFileSync('npm', ['ci', '--no-audit', '--no-fund'], installOptions);
  }
  const { doctor } = await import('./doctor.mjs');
  await doctor();
  console.log('环境准备完成。首次使用请运行 node scripts/rpa/login-window.mjs，在打开的窗口登录并关闭窗口。');
} catch (error) {
  console.error('环境准备失败：', error.message);
  process.exitCode = 1;
}
