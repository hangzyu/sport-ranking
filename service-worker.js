const CACHE_NAME='ranking-shell-v9-bounded-scores';
const APP_SHELL=['./','./index.html','./manifest.webmanifest','./src/install.js','./src/install.css','./assets/icon-192.png','./assets/icon-512.png','./assets/icon-180.png','./assets/icon-maskable-512.png','./assets/ranking-logo-v1.png',
  './src/ranking-core.js','./src/qualification-engine.js','./src/score-table.js','./src/event-settings.js','./src/qualification-panel.js','./src/qualification.css','./src/qualification-worker.js'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('ranking-shell-')&&key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
  const isolated=response=>{
    if(!response||response.type==='opaque')return response;
    const headers=new Headers(response.headers);
    headers.set('Cross-Origin-Opener-Policy','same-origin');
    headers.set('Cross-Origin-Embedder-Policy','require-corp');
    headers.set('Cross-Origin-Resource-Policy','same-origin');
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  };
  event.respondWith((async()=>{
    let cache;try{cache=await caches.open(CACHE_NAME)}catch{}
    try{
      const response=await fetch(event.request);
      if(response.ok&&cache)try{await cache.put(event.request,response.clone())}catch{}
      return isolated(response);
    }catch{
      const cached=cache?(await cache.match(event.request)||(event.request.mode==='navigate'?await cache.match('./index.html'):null)):null;
      return cached?isolated(cached):new Response('当前离线，所需组件尚未缓存。',{status:503});
    }
  })());
});
