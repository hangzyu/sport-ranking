importScripts('ranking-core.js','qualification-engine.js');
self.onmessage=event=>{
  const {id,state,target,outcomes}=event.data;
  try{const input=QualificationEngine.fromState(state);self.postMessage({id,result:QualificationEngine.analyzeBounded(input,target,outcomes)})}
  catch(error){self.postMessage({id,error:String(error.message||error)})}
};
