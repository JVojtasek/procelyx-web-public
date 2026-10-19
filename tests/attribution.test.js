import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
// Run the actual attribution block shipped in app.js, without executing unrelated UI or sending mail.
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const code=app.slice(app.indexOf('const leadSource=(()=>{'),app.indexOf('let submitting=false;'))+'\nJSON.stringify(leadSource);';
function visit(query,storage=new Map(),referrer='https://google.com/search?q=private'){
  return JSON.parse(vm.runInNewContext(code,{location:{search:query},document:{referrer},URL,URLSearchParams,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)}}));
}
test('direct first visit does not hide a subsequent paid campaign',()=>{
  const s=new Map();visit('',s);assert.equal(visit('?utm_source=facebook&utm_campaign=pilot',s).utmCampaign,'pilot');
});
test('first nonempty campaign survives later pages and another campaign',()=>{
  const s=new Map();visit('?utm_source=linkedin&utm_campaign=first',s);
  assert.equal(visit('',s).utmCampaign,'first');assert.equal(visit('?utm_campaign=second',s).utmCampaign,'first');
});
test('stored data is bounded and sanitized; arrays/malformed storage do not override campaign',()=>{
  const s=new Map([['pxsrc',JSON.stringify({utmCampaign:'x'.repeat(500),extra:'not forwarded',referrer:'https://external.example/path?token=private#fragment'})]]);
  const value=visit('',s);assert.equal(value.utmCampaign.length,200);assert.equal(value.extra,undefined);assert.equal(value.referrer,'https://external.example/path');
  for(const raw of ['[]','not-json'])assert.equal(visit('?utm_campaign=ok',new Map([['pxsrc',raw]])).utmCampaign,'ok');
});
