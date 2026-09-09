/* No package manager or build server required; keep the existing static app. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=__dirname,dist=path.join(root,'dist');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(match[1].trim())new vm.Script(match[1]);
for(const name of fs.readdirSync(path.join(root,'src')).filter(n=>n.endsWith('.js')))new vm.Script(fs.readFileSync(path.join(root,'src',name),'utf8'),{filename:name});
fs.mkdirSync(dist,{recursive:true});
for(const name of ['index.html','manifest.webmanifest','service-worker.js','_headers'])fs.copyFileSync(path.join(root,name),path.join(dist,name));
for(const name of ['src','vendor','assets'])fs.cpSync(path.join(root,name),path.join(dist,name),{recursive:true});
for(const name of ['qualification-engine.js','qualification-panel.js','qualification-worker.js','ranking-core.js','qualification.css'])if(!fs.existsSync(path.join(dist,'src',name)))throw new Error('Missing build asset: '+name);
console.log('Ranking static build completed.');
