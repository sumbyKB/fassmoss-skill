import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { analyzeShopDetail } from './analyze-shop-detail.mjs';
import { COMMAND_NAMES } from './fastmoss-rpa.mjs';

test('entry registers all commands and closes contexts in finally', () => {
  // 命令数合理（HANDLERS 是命令清单的唯一权威来源，run-background / 测试都从这里复用，不重复维护）
  assert.ok(COMMAND_NAMES.length >= 15, `命令数不足：${COMMAND_NAMES.length}`);
  const source = readFileSync(new URL('./fastmoss-rpa.mjs', import.meta.url), 'utf8');
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
  assert.match(launcher, /COMMAND_NAMES/);
  assert.match(launcher, /'--headed', 'false'/);
});

test('shop detail report uses input currency and preserves missing data', () => {
  const { report, summary } = analyzeShopDetail({ meta: { currency: 'USD' }, detail: { products: [] } });
  assert.match(report, /价格带\(USD\)/);
  assert.match(report, /未采集到商品明细/);
  assert.equal(summary.totalGmv, '—');
  assert.doesNotMatch(report, /近28天无动销商品/);
});
