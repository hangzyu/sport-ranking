importScripts('../vendor/z3/z3-built.js','../vendor/z3/z3-low-level.js','ranking-core.js','qualification-engine.js');
let ready;
async function initialize(){
  const base=new URL('../vendor/z3/',self.location.href);
  const response=await fetch(new URL('z3-built.wasm.gz',base));
  if(!response.ok)throw new Error('推演组件未能下载，请检查网络后重试。');
  const wasmBinary=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const {Z3}=await RankingZ3.init(()=>initZ3({wasmBinary,mainScriptUrlOrBlob:new URL('z3-built.js',base).href,locateFile:file=>new URL(file,base).href}));
  return QualificationEngine.createOracle(Z3);
}
self.onmessage=async event=>{
  const {id,state,target,outcomes}=event.data;
  try{
    ready||=initialize();
    const query=await ready,input=QualificationEngine.fromState(state);
    const result=await QualificationEngine.analyze(input,target,outcomes,query);
    self.postMessage({id,result});
  }catch(error){self.postMessage({id,error:String(error.message||error)})}
};
