// 独立国家切换命令：单独切站并持久化到 profile（不抓数据）。
import { resolveCountry } from '../lib/config.mjs';
import { log } from '../lib/cli.mjs';
import { openBrowser, assertLoggedIn, switchCountry } from '../lib/browser.mjs';

/** country：单独切换国家并持久化到 profile，供其他人先切站再用别的子命令。 */
export async function cmdCountry(opts) {
  const key = opts.country || (Array.isArray(opts._) ? opts._[0] : opts._);
  if (!key) throw new Error('缺少国家参数：node scripts/rpa/fastmoss-rpa.mjs country 泰国');
  const { context, launchMs } = await openBrowser({ headed: opts.headed === true || opts.headed === 'true' });
  await assertLoggedIn(context.pages()[0]);
  const label = await switchCountry(context.pages()[0], key);
  log(`国家切换完成：${label}（已持久化到 profile，币种 ${resolveCountry(key).currency}）`);
  await context.close();
  return { label, launchMs };
}
