(function(global){
'use strict';
const Core=typeof module!=='undefined'?require('./ranking-core.js'):global.RankingCore;
function normalize(state){
  if(!state.eventRules)state.eventRules={method:state.method||'II',cycle:state.cycle||'single'};
  const rules=state.eventRules;
  for(const item of [state,...(state.groups||[])]){
    if(item.method!==rules.method){item.manualOrders={};item.manualDrafts={};}
    item.method=rules.method;item.cycle=rules.cycle;
    if(Core.penaltyRule(rules.method))for(const m of item.matches||[])if(m[5]){
      try{Core.result(m[0],m[1],m[2],m[3],m[7],rules.method)}catch{m[5]=false;}
    }
  }
  return rules;
}
function update(state,patch){
  if(state.status!=='草稿')return false;
  normalize(state);
  if(patch.method&&!['I','II','III','IV','V'].includes(patch.method))throw Error('无效排名方法');
  if(patch.cycle&&!['single','double'].includes(patch.cycle))throw Error('无效循环方式');
  state.eventRules={...state.eventRules,...patch};normalize(state);return true;
}
const api={normalize,update};if(typeof module!=='undefined')module.exports=api;else global.EventSettings=api;
})(globalThis);
