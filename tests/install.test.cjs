const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),events={},status={dataset:{}};
const context={navigator:{userAgent:'',platform:'',maxTouchPoints:0},document:{getElementById:()=>status},addEventListener:(name,fn)=>events[name]=fn};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'src/install.js'),'utf8'),context);
assert.equal(context.RankingInstall.device('iPhone MicroMessenger'),'wechat');assert.equal(context.RankingInstall.device('iPhone Safari'),'ios');assert.equal(context.RankingInstall.device('Android'),'android');assert.equal(context.RankingInstall.device('Windows'),'desktop');
let prevented=false;events.beforeinstallprompt({preventDefault(){prevented=true}});assert.equal(prevented,true);
context.RankingInstall.saved(false);assert.equal(status.dataset.failed,'true');assert.match(status.textContent,/失败/);
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');let fail=true;
const saveContext={saveCurrentGroup(){},localStorage:{setItem(){if(fail)throw Error('quota')}},activeEventId:'test',state:{name:'test'},updateEventIndex(){},window:{RankingInstall:context.RankingInstall}};vm.createContext(saveContext);vm.runInContext(html.slice(html.indexOf('function persistActiveEvent(){'),html.indexOf('function saveImportedActiveEvent')),saveContext);
assert.equal(saveContext.persistActiveEvent(),false);assert.equal(status.dataset.failed,'true');fail=false;assert.equal(saveContext.persistActiveEvent(),true);assert.equal(status.dataset.failed,'false');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8'));assert.equal(manifest.id,'./index.html');assert.equal(manifest.display,'standalone');for(const icon of manifest.icons){const png=fs.readFileSync(path.join(root,icon.src));assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`,icon.sizes)}
assert.ok(manifest.icons.some(i=>i.sizes==='192x192'));assert.ok(manifest.icons.some(i=>i.sizes==='512x512'));
console.log('Passed installation detection, prompt capture, storage failure reporting, stable app identity and actual icon sizes.');
