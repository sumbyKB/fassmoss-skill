import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

test('two live sessions selling the same product retain separate evidence', t => {
  const dir = mkdtempSync(join(tmpdir(), 'fastmoss-test-'));
  t.after(() => rmSync(dir, {recursive:true, force:true}));
  const write = (file, data) => writeFileSync(join(dir,file), JSON.stringify(data));
  const read = file => JSON.parse(readFileSync(join(dir,file),'utf8'));
  write('candidates.json', {records:[{id:'1',cells:[]}]});
  const rows = ['100','101'].map(id => ({
    href:'https://www.fastmoss.com/zh/live/detail/'+id, productIds:['999'],
    cells:['直播','2026-11-01','10','$100','1','1','1000','0.1','箱包']
  }));
  write('details.json',{details:[{id:'1',url:'https://www.fastmoss.com/zh/influencer/detail/1',overview:{pageName:'Sample'},tables:[
    {headers:['直播销量'],dates:['2026-10-12','2026-11-08'],rows}
  ]}]});
  execFileSync(process.execPath,[fileURLToPath(new URL('./rpa/analyze.mjs',import.meta.url)),'--dir',dir,'--competitor-products','999']);
  assert.equal(read('creators-final.json')[0].competitorPromotions.live.observed,2);
  assert.deepEqual(read('evidence/1.json').records.map(r=>r.id),['100','101']);
  assert.equal(read('evidence/1.json').period,'2026-10-12/2026-11-08');
  assert.match(readFileSync(join(dir,'多维度分析报告.md'),'utf8'),/佣金未知/);
});
