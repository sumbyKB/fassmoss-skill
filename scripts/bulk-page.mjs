// Run through the connected browser's documented Playwright surface.
// No HTTP requests, cookies, hidden application state, or FastMoss API.
export async function collectTables(tab) {
  const started = Date.now();
  const tables = await tab.playwright.getByRole('table').evaluateAll(elements =>
    elements.map(table => ({
      headers: Array.from(table.querySelectorAll('th')).map(x => x.innerText.trim()),
      rows: Array.from(table.querySelectorAll('tr')).filter(row => row.querySelector('td')).map(row => ({
        cells: Array.from(row.querySelectorAll('td')).map(cell => cell.innerText.trim()),
        links: Array.from(row.querySelectorAll('a[href]')).map(a => ({text: a.innerText.trim(), url: a.href}))
      }))
    }))
  );
  return { elapsed_ms: Date.now() - started, tables };
}

export function creatorRows(tables) {
  const found = new Map();
  for (const table of tables) {
    if (!table.headers.some(x => x.includes('达人信息'))) continue;
    for (const row of table.rows) {
      const link = row.links.find(x => /^https:\/\/www\.fastmoss\.com\/zh\/influencer\/detail\/\d+$/.test(x.url));
      if (!link) continue;
      const id = link.url.split('/').at(-1);
      const record = { id, source_url: link.url, headers: table.headers, cells: row.cells };
      if (found.has(id) && JSON.stringify(found.get(id)) !== JSON.stringify(record)) {
        throw new Error('Conflicting creator rows: ' + id);
      }
      found.set(id, record);
    }
  }
  return [...found.values()];
}
