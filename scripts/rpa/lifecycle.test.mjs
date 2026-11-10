import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { analyzeShopDetail } from './analyze-shop-detail.mjs';

const COMMANDS = ['search', 'detail', 'pipeline', 'country', 'product', 'product-roi', 'category-roi', 'shop', 'shop-detail', 'shop-detail-report', 'live', 'live-detail', 'video', 'ad', 'categories'];

test('entry registers all commands and closes contexts in finally', () => {
  const source = readFileSync(new URL('./fastmoss-rpa.mjs', import.meta.url), 'utf8');
  // HANDLERS 映射表覆盖全部 15 个命令
  for (const cmd of COMMANDS) {
    const key = cmd.includes('-') ? `'${cmd}'` : cmd;
    assert.match(source, new RegExp(`^\\s{2}${key.replace(/[-]/g, '\\-')}: cmd`, 'm'), `缺命令 ${cmd}`);
  }
  // main 在 finally 里统一关闭所有存活上下文，保证资源不泄漏
  assert.match(source, /finally\s*\{/);
  assert.match(source, /activeContexts[^]*?context\.close/);
});

test('every command module requires an explicit headed opt-in', () => {
  const dir = new URL('./commands/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.mjs'));
  let calls = 0;
  for (const f of files) {
    const source = readFileSync(new URL('./commands/' + f, import.meta.url), 'utf8');
    const matches = [...source.matchAll(/await openBrowser\(\{([^}]+)\}\)/g)];
    calls += matches.length;
    for (const [, args] of matches) assert.match(args, /headed: opts\.headed === true \|\| opts\.headed === 'true'/, f);
  }
  assert.ok(calls >= 10, `openBrowser 调用数不足：${calls}`);
  const launcher = readFileSync(new URL('./run-background.mjs', import.meta.url), 'utf8');
  assert.match(launcher, /'product-roi'/);
  assert.match(launcher, /'--headed', 'false'/);
});

test('shop detail report uses input currency and preserves missing data', () => {
  const { report, summary } = analyzeShopDetail({ meta: { currency: 'USD' }, detail: { products: [] } });
  assert.match(report, /价格带\(USD\)/);
  assert.match(report, /未采集到商品明细/);
  assert.equal(summary.totalGmv, '—');
  assert.doesNotMatch(report, /近28天无动销商品/);
});
