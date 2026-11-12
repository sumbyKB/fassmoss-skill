import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { makeTracker, makeMultiTracker } from './lib/tracker.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
function request(page, params) {
  const req = { url: () => 'https://www.fastmoss.com/api/goods/v3/overview?' + new URLSearchParams(params) };
  page.emit('request', req);
  return req;
}
function respond(page, req, body, ok = true) {
  page.emit('response', { request: () => req, url: req.url, ok: () => ok, text: async () => await body });
}

test('reset discards old responses both before and after response processing starts', async () => {
  for (const started of [true, false]) {
    const page = new EventEmitter();
    const tracker = makeTracker(page, '/api/goods/v3/overview');
    let release;
    const body = new Promise(resolve => { release = resolve; });
    const old = request(page, { product_id: 'old' });
    if (started) respond(page, old, body);
    tracker.reset({ product_id: 'new', d_type: 90 });
    const wrong = request(page, { product_id: 'other', d_type: 90 });
    respond(page, wrong, 'wrong identity');
    const current = request(page, { product_id: 'new', d_type: 90 });
    respond(page, current, 'new data');
    if (!started) respond(page, old, body);
    await tick();
    release('old data');
    await tick();
    assert.equal(tracker.get(), 'new data');
    tracker.dispose();
    assert.equal(page.listenerCount('request'), 0);
    assert.equal(page.listenerCount('response'), 0);
  }
});

test('older responses cannot overwrite later requests and disposal prevents late writes', async () => {
  const page = new EventEmitter();
  const tracker = makeTracker(page, '/api/goods/v3/overview');
  let release;
  const old = request(page, { product_id: 'same' });
  respond(page, old, new Promise(resolve => { release = resolve; }));
  respond(page, request(page, { product_id: 'same' }), 'latest');
  await tick();
  release('older');
  await tick();
  assert.equal(tracker.get(), 'latest');
  let releaseAfterClose;
  respond(page, request(page, { product_id: 'same' }), new Promise(resolve => { releaseAfterClose = resolve; }));
  tracker.dispose();
  releaseAfterClose('disposed');
  await tick();
  assert.equal(tracker.get(), 'latest');
});

test('multi tracker ignores failed and similarly named endpoints without locking valid data', async () => {
  const page = new EventEmitter();
  const tracker = makeMultiTracker(page, { overview: '/api/goods/v3/overview?' });
  respond(page, request(page, {}), 'HTTP error', false);
  const summary = { url: () => 'https://www.fastmoss.com/api/goods/v3/overviewSummary' };
  page.emit('request', summary); respond(page, summary, 'summary');
  await tick();
  assert.equal(tracker.has('overview'), false);
  respond(page, request(page, {}), 'valid');
  await tick();
  assert.equal(tracker.get('overview'), 'valid');
  tracker.dispose();
});
