import {test} from 'node:test';
import assert from 'node:assert/strict';
import {creatorRows} from './bulk-page.mjs';

test('deduplicate exact creator ID and preserve raw cells', () => {
  const row = {cells:['name','2千'],links:[{url:'https://www.fastmoss.com/zh/influencer/detail/1234567890123456789'}]};
  const tables = [{headers:['达人信息','粉丝数'],rows:[row,row]}];
  const result = creatorRows(tables);
  assert.equal(result.length,1);
  assert.equal(result[0].id,'1234567890123456789');
  assert.deepEqual(result[0].cells,['name','2千']);
  assert.deepEqual(creatorRows([{headers:['商品'],rows:[row]}]),[]);
  tables[0].rows.push({...row,cells:['different']});
  assert.throws(() => creatorRows(tables), /Conflicting/);
});
