// Single-call multi-page collection.
//
// Why this file exists: every browser tool call in an agent harness costs one
// model round-trip (~21s measured in this project), while the DOM work itself
// is ~0.1s. So pagination must NOT be driven by the agent. pagesScript() returns
// one JS string that filters, paginates and extracts everything inside the tab,
// and the agent receives a single payload.
//
// Measured on the creator board (2026-11-09, 3 pages):
//   fixed 4.2s sleep per page  -> 8.5s wall, 30 unique ids
//   adaptive poll (150ms)      -> 1.5s wall, 30 unique ids   <- use this
//   no wait at all             -> 0.5s wall, 10 unique ids   (silently重复页)
//
// Usage (any harness that can evaluate JS in the logged-in tab):
//   const payload = await evaluateInTab(pagesScript({maxPages: 5}));
//   const {records, meta} = toPoolRecords(payload);
export function pagesScript({maxPages = 1, pollMs = 150, timeoutMs = 9000, headerHint = '达人信息'} = {}) {
  return `(async () => {
  const MAX = ${maxPages};
  const POLL = ${pollMs};
  const TIMEOUT = ${timeoutMs};
  const HINT = ${JSON.stringify(headerHint)};

  const pickTable = () => {
    const all = Array.from(document.querySelectorAll('table'));
    const hit = all.find(t => (t.querySelector('thead') || t).innerText.includes(HINT));
    return hit || all[all.length - 1];
  };
  // Signature must be built from the STABLE ID, not from text: during a page
  // turn the table briefly renders skeletons, so innerText changes ~150ms before
  // the real rows arrive. Using text as the signal made this loop snapshot the
  // stale page and return three identical pages (10 unique ids instead of 30).
  const firstId = () => {
    const t = pickTable();
    if (!t) return '';
    const a = t.querySelector('tbody tr a[href*="/influencer/detail/"]');
    return a ? a.href.split('/').pop() : '';
  };
  const sig = () => {
    const t = pickTable();
    if (!t) return '';
    const rows = t.querySelectorAll('tbody tr').length;
    return firstId() + '#' + rows;
  };
  const grab = () => {
    const t = pickTable();
    if (!t) return null;
    const headers = Array.from(t.querySelectorAll('thead th')).map(x => x.innerText.trim());
    const rows = Array.from(t.querySelectorAll('tbody tr'))
      .filter(r => r.querySelector('td'))
      .map(r => {
        const a = r.querySelector('a[href*="/influencer/detail/"]');
        return {
          id: a ? a.href.split('/').pop() : '',
          source_url: a ? a.href : '',
          cells: Array.from(r.querySelectorAll('td')).map(c => c.innerText.trim())
        };
      });
    return {headers: headers, rows: rows};
  };
  const nextBtn = () =>
    document.querySelector('li[title="\\u4e0b\\u4e00\\u9875"]:not([class*=disabled])') ||
    document.querySelector('li[class*=next]:not([class*=disabled])');

  const pages = [];
  const waits = [];
  let prev = sig();
  let stop = 'maxPages';
  for (let p = 0; p < MAX; p++) {
    const shot = grab();
    if (!shot) { stop = 'no table'; break; }
    pages.push({index: p + 1, headers: shot.headers, rows: shot.rows});
    if (p === MAX - 1) break;
    const btn = nextBtn();
    if (!btn) { stop = 'no next button'; break; }
    const t0 = Date.now();
    btn.click();
    // settle = first row id changed AND stayed changed for two consecutive polls
    let settled = false;
    let stableHits = 0;
    let last = '';
    while (Date.now() - t0 < TIMEOUT) {
      await new Promise(r => setTimeout(r, POLL));
      const now = sig();
      if (now && now !== prev) {
        stableHits = now === last ? stableHits + 1 : 1;
        last = now;
        if (stableHits >= 2) { prev = now; settled = true; break; }
      } else {
        stableHits = 0;
        last = '';
      }
    }
    waits.push({after_page: p + 1, waited_ms: Date.now() - t0, settled: settled});
    if (!settled) { stop = 'page did not change'; break; }
  }
  return JSON.stringify({
    collected_at: new Date().toISOString(),
    url: location.href,
    stop_reason: stop,
    pages: pages,
    waits: waits
  });
})()`;
}

// Pure transform: one payload -> pool-ready records + coverage metadata.
// Deduplicates by stable id across pages and refuses conflicting rows for the
// same id (same rule as bulk-page.mjs), so a silent UI change cannot pass as data.
export function toPoolRecords(payload) {
  if (!payload || !Array.isArray(payload.pages)) throw new Error('payload.pages missing');
  const byId = new Map();
  let rawRows = 0;
  let noIdRows = 0;
  const pageSizes = [];

  for (const page of payload.pages) {
    const rows = Array.isArray(page.rows) ? page.rows : [];
    pageSizes.push(rows.length);
    for (const row of rows) {
      rawRows += 1;
      const id = row.id || '';
      if (!id) { noIdRows += 1; continue; }
      const record = {id: id, source_url: row.source_url || '', headers: page.headers || [], cells: row.cells || []};
      const prev = byId.get(id);
      if (prev && JSON.stringify(prev.cells) !== JSON.stringify(record.cells)) {
        throw new Error('Conflicting rows for creator ' + id);
      }
      if (!prev) byId.set(id, record);
    }
  }

  return {
    records: [...byId.values()],
    meta: {
      url: payload.url || '',
      collected_at: payload.collected_at || '',
      stop_reason: payload.stop_reason || '',
      pages_read: pageSizes.length,
      page_sizes: pageSizes,
      raw_rows: rawRows,
      unique_ids: byId.size,
      rows_without_id: noIdRows,
      waits: payload.waits || [],
      // 覆盖范围必须随数据一起交付：第一页不等于全量
      coverage: 'partial (first ' + pageSizes.length + ' page(s))'
    }
  };
}
