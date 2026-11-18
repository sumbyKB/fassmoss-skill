// 商品/店铺页中的关联达人、视频列表。只操作当前页面，不猜测或调用接口。
import { safeEval, assertPageAccess } from './browser.mjs';
import { parseAmount } from '../data-rules.mjs';

/** 可在页面上下文独立执行；控件范围限定在包含目标表的独立模块。 */
export function linkedListSnapshot({ kind = 'creator', action, period } = {}) {
  const prefix = kind === 'creator' ? '/influencer/detail/' : '/media-source/video/';
  const norm = value => value.replace(/\s|[↑↓▲▼]/g, '');
  const table = [...document.querySelectorAll('table')].find(t => {
    const headers = [...t.querySelectorAll('thead th')].map(h => norm(h.innerText));
    return kind === 'creator'
      ? headers.some(h => /^(达人|达人信息|带货达人|关联达人|Creator)$/i.test(h)) && headers.some(h => /粉丝|Followers/i.test(h))
      : headers.some(h => /^(视频|视频内容|视频信息|Video)$/i.test(h));
  });
  if (!table) return { ready: false, rows: [] };
  const headers = [...table.querySelectorAll('thead th')].map(h => norm(h.innerText));
  const headerPeriods = [...new Set(headers.map(h => h.match(/近(\d+)天/)?.[1]).filter(Boolean))];
  const headerPeriod = headerPeriods.length === 1 ? Number(headerPeriods[0]) : null;
  let root = table.parentElement;
  while (root?.parentElement && root.parentElement !== document.body) {
    if (root.querySelector('.ant-pagination-next, input[type=radio]')) break;
    if (root.parentElement.querySelectorAll('table tbody').length > 1) break;
    root = root.parentElement;
  }
  const radios = [...root.querySelectorAll('input[type=radio]')];
  if (action === 'period') {
    if (headerPeriod && headerPeriod !== period) return { clicked: false, checked: false };
    const target = radios.find(input => input.value === String(period));
    if (target && !target.checked) target.click();
    return { clicked: !!target, checked: !!target?.checked };
  }
  const next = root.querySelector('.ant-pagination-next');
  const canNext = !!next && !next.classList.contains('ant-pagination-disabled') && next.getAttribute('aria-disabled') !== 'true';
  if (action === 'next') {
    if (canNext) (next.querySelector('a,button') || next).click();
    return { clicked: canNext };
  }
  const aliases = {
    followers_raw: ['粉丝数', '粉丝', 'Followers'], gmv_raw: ['带货销售额', '商品销售额', '销售额', '带货GMV', 'GMV'],
    units_raw: ['商品总销量', '店铺商品销量', '带货销量', '商品销量', '销量'], views_raw: ['播放量', '总播放量'],
    video_count_raw: ['带货视频数', '视频数'], live_count_raw: ['带货直播数', '直播数'],
  };
  const rows = [...table.querySelectorAll('tbody tr')].flatMap(tr => {
    const link = tr.querySelector(`a[href*="${prefix}"]`);
    const id = link?.pathname.match(new RegExp(prefix + '(\\d+)/?$'))?.[1];
    if (!id || link.origin !== location.origin) return [];
    const cells = [...tr.querySelectorAll('td')];
    const raw = Object.fromEntries(headers.map((name, i) => [name, cells[i]?.innerText.trim() ?? null]));
    const fallbackName = link.innerText.split('\n').find(line => line.trim() && !/^(AD|时长[：:])/.test(line.trim()));
    const row = { id, name: (link.querySelector('h3,[class*="paragraph-text"]')?.innerText || fallbackName || '').trim(), source_url: link.href.split(/[?#]/)[0], raw };
    for (const [key, labels] of Object.entries(aliases)) {
      const index = headers.findIndex(h => labels.some(label => h === label || h.startsWith(label + '(') || h.startsWith(label + '（')));
      row[key] = index < 0 ? null : cells[index]?.innerText.trim() || null;
    }
    return [row];
  });
  const busy = !!root.querySelector('.ant-spin-spinning, .ant-spin-blur, [aria-busy=true]');
  const selected = Number(radios.find(input => input.checked)?.value);
  return { ready: !busy && (rows.length > 0 || !!root.querySelector('.ant-empty') || /暂无数据|没有数据|No data/i.test(table.innerText)), empty_total_confirmed: /共\s*0\s*条|总计\s*0\s*条/.test(root.innerText), rows, headers, busy, period_days: headerPeriod || ([7, 28, 90, 180].includes(selected) ? selected : null), dates: [...root.querySelectorAll('input')].map(x => x.value).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)), can_next: canNext, pagination_found: !!next };
}

function verifyListPeriod(state, period, periodResponseRows) {
    const responseById = new Map((periodResponseRows || []).map(row => [String(row.uid ?? row.author_id ?? row.id), row]));
    const sameMetrics = row => {
      const source = responseById.get(row.id);
      if (!source) return false;
      let checked = 0;
      for (const [raw, value] of [[row.gmv_raw, source.sale_amount ?? source.gmv], [row.units_raw, source.sold_count ?? source.units]]) {
        const shown = parseAmount(raw), expected = parseAmount(value);
        if (shown === null || expected === null) continue;
        const abbreviation = String(raw).match(/\d+(?:\.(\d+))?([万亿])/);
        const tolerance = abbreviation ? (abbreviation[2] === '亿' ? 1e8 : 1e4) / (10 ** (abbreviation[1]?.length || 0)) / 2 : 0;
        if (Math.abs(shown - expected) > tolerance) return false;
        checked++;
      }
      return checked > 0;
    };
    return !!period && state.period_days === period && periodResponseRows !== null && (state.rows.length ? state.rows.every(sameMetrics) : periodResponseRows.length === 0);
}

export async function collectLinkedList(page, { kind = 'creator', tab, period = 28, pages = 3, onPage = () => {} } = {}) {
  let pageNumber = 1;
  let confirmedEmpty = false;
  let periodResponseRows = null;
  const identity = new URL(page.url());
  const id = identity.pathname.match(/\/(\d+)\/?$/)?.[1];
  const onResponse = async response => {
    try {
      const url = new URL(response.url());
      if (url.origin !== identity.origin || !url.pathname.startsWith('/api/') || /summary/i.test(url.pathname) || !new RegExp(kind === 'creator' ? 'author|creator' : 'video', 'i').test(url.pathname)) return;
      if (id && ![...url.searchParams.values()].includes(id)) return;
      const ticket = pageNumber;
      if (url.searchParams.has('page') && Number(url.searchParams.get('page')) !== ticket) return;
      if (!response.ok()) return;
      const data = (await response.json())?.data;
      if (ticket === pageNumber && Array.isArray(data?.list)) {
        confirmedEmpty = data.list.length === 0 && data.total != null && Number(data.total) === 0;
        if (period && Number(url.searchParams.get('d_type') || url.searchParams.get('date_type')) === period) periodResponseRows = data.list;
      }
    } catch { /* 取消或非列表响应不构成空表证据 */ }
  };
  page.on('response', onResponse);
  try {
    await assertPageAccess(page);
    if (tab) {
      const control = page.getByText(tab, { exact: true }).first();
      await control.waitFor({ state: 'visible', timeout: 15000 });
      await control.click();
    }
    let previousKey = null;
    const records = new Map();
    const coverage = { pages_read: 0, complete: false, period_days: null, period_verified: false, reason: null };
    let allPeriodsVerified = true;
    const periodsSeen = new Set();
    let firstDates = null;
    let sameDates = true;
    for (let number = 1; number <= pages; number++) {
      pageNumber = number;
      const deadline = Date.now() + 15000;
      let lastKey = null;
      let state = null;
      let periodAttempted = false;
      let tabRetried = false;
      while (Date.now() < deadline) {
        await assertPageAccess(page);
        const current = await safeEval(page, linkedListSnapshot, { kind });
        if (!current.ready && tab && number === 1 && !tabRetried && deadline - Date.now() < 14000) {
          tabRetried = true;
          await page.getByText(tab, { exact: true }).first().click();
        }
        if (current.ready && current.rows.length === 0 && !confirmedEmpty && !current.empty_total_confirmed) { lastKey = null; await page.waitForTimeout(100); continue; }
        if (number === 1 && current.ready && period && current.period_days !== period && !periodAttempted) {
          periodAttempted = true;
          const changed = await safeEval(page, linkedListSnapshot, { kind, action: 'period', period });
          if (changed.clicked) { lastKey = null; continue; }
        }
        if (current.ready && period && current.period_days === period && periodResponseRows === null) { lastKey = null; await page.waitForTimeout(100); continue; }
        if (current.ready && periodResponseRows !== null && current.period_days === period && !verifyListPeriod(current, period, periodResponseRows)) { lastKey = null; await page.waitForTimeout(100); continue; }
        const key = JSON.stringify([current.period_days, current.rows]);
        if (current.ready && key !== previousKey && key === lastKey) { state = current; break; }
        lastKey = current.ready ? key : null;
        await page.waitForTimeout(100);
      }
      if (!state) throw new Error('关联列表未就绪或分页重复；未把未加载视为零条');
      previousKey = JSON.stringify([state.period_days, state.rows]);
      coverage.pages_read++;
      const pageVerified = verifyListPeriod(state, period, periodResponseRows);
      allPeriodsVerified = allPeriodsVerified && pageVerified;
      periodsSeen.add(state.period_days);
      if (firstDates === null) firstDates = state.dates;
      else if (JSON.stringify(firstDates) !== JSON.stringify(state.dates)) sameDates = false;
      coverage.periods_seen = [...periodsSeen];
      coverage.period_days = periodsSeen.size === 1 ? state.period_days : null;
      coverage.period_verified = allPeriodsVerified && periodsSeen.size === 1 && sameDates;
      coverage.dates = sameDates ? firstDates : [];
      coverage.scope = coverage.period_verified ? 'page_selected_period' : 'page_displayed_unverified_period';
      for (const row of state.rows) if (!records.has(row.id)) records.set(row.id, { ...row, observed_position: records.size + 1, period_days: state.period_days, period_verified: pageVerified, dates: state.dates });
      coverage.complete = state.rows.length === 0 || (state.pagination_found && !state.can_next);
      coverage.reason = coverage.complete ? null : '仅已采集页面，未确认全量';
      await onPage({ rows: [...records.values()], coverage: { ...coverage } });
      if (coverage.complete || !state.can_next) break;
      if (number < pages) {
        pageNumber = number + 1;
        confirmedEmpty = false;
        periodResponseRows = null;
        if (!(await safeEval(page, linkedListSnapshot, { kind, action: 'next' })).clicked) break;
      }
    }
    return { rows: [...records.values()], coverage };
  } finally { page.off('response', onResponse); }
}
