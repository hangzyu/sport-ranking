const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const handlers={},stored=new Map();let online=true;
const key=request=>typeof request==='string'?request:request.url;
const cache={addAll:async items=>{assert.ok(items.includes('./src/qualification-worker.js'))},put:async(req,res)=>stored.set(key(req),res),match:async req=>stored.get(key(req))?.clone()};
const context={self:{location:{origin:'https://ranking.test'},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>{},clients:{claim:async()=>{}}},caches:{open:async()=>cache,keys:async()=>['ranking-shell-v1','another-app-cache'],delete:async name=>{assert.equal(name,'ranking-shell-v1')}},Headers,Response,URL,fetch:async()=>{if(!online)throw Error('offline');return new Response('new application source',{headers:{'Content-Type':'text/javascript'}})}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../service-worker.js'),'utf8'),context);
(async()=>{
  for(const phase of ['install','activate'])await new Promise((resolve,reject)=>handlers[phase]({waitUntil:p=>p.then(resolve,reject)}));
  async function get(url,mode='same-origin'){let pending;handlers.fetch({request:{url,method:'GET',mode},respondWith:p=>pending=p});return pending}
  const live=await get('https://ranking.test/src/ranking-core.js');assert.equal(live.headers.get('Cross-Origin-Embedder-Policy'),'require-corp');assert.equal(live.headers.get('Cross-Origin-Opener-Policy'),'same-origin');assert.equal(await live.text(),'new application source');
  online=false;assert.equal(await(await get('https://ranking.test/src/ranking-core.js')).text(),'new application source');
  assert.equal((await get('https://ranking.test/missing.js')).status,503);
  assert.equal(await get('https://elsewhere.test/image.png'),undefined);
  console.log('Passed cache refresh, isolation headers, offline asset and unrelated cache checks.');
})().catch(error=>{console.error(error);process.exitCode=1});
