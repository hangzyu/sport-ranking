/* Shared by the standings and the final-round qualification worker. */
(function (global) {
  'use strict';
  const PENDING = '待公平积分/抽签决定/直接点球大战确定';
  function integer(value) {
    if (typeof value === 'bigint' && value >= 0n) return value;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
    if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
    throw new Error('已确认的比分必须是非负整数。');
  }
  function statistics(teams, matches) {
    const data = Object.fromEntries(teams.map(t => [t, {played:0,won:0,drawn:0,lost:0,points:0,goals_for:0n,goals_against:0n,goal_difference:0n}]));
    for (const [a,b,x,y] of matches) {
      if (!Object.hasOwn(data,a) || !Object.hasOwn(data,b)) continue;
      const ga=integer(x),gb=integer(y);
      for (const [t,gf,against] of [[a,ga,gb],[b,gb,ga]]) {
        const r=data[t];r.played++;r.goals_for+=gf;r.goals_against+=against;r.goal_difference+=gf-against;
        if(gf>against){r.won++;r.points+=3}else if(gf===against){r.drawn++;r.points++}else r.lost++;
      }
    }
    return data;
  }
  function rank(teams,matches,rule) {
    if(!['I','II','III'].includes(rule))throw new Error('请选择有效的排名方法。');
    if(new Set(teams).size!==teams.length||teams.some(t=>typeof t!=='string'||!t.trim()))throw new Error('球队名称不能为空或重复。');
    for(const [a,b,x,y] of matches){if(a===b||!teams.includes(a)||!teams.includes(b))throw new Error('比赛必须由两支已登记的不同球队参加。');integer(x);integer(y)}
    const overall=statistics(teams,matches),trace=[];
    const refine=(groups,data,fields,scope,scopeTeams)=>{
      for(const criterion of fields){
        const next=[];
        for(const group of groups){
          if(group.length<2){next.push(group);continue}
          const buckets=new Map();
          for(const t of group){const key=BigInt(data[t][criterion]);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(t)}
          const result=[...buckets.keys()].sort((a,b)=>a>b?-1:a<b?1:0).map(k=>buckets.get(k));
          trace.push({scope,scope_teams:[...scopeTeams],criterion,teams:[...group],values:Object.fromEntries(group.map(t=>[t,data[t][criterion]])),result});
          next.push(...result);
        }
        groups=next;
      }
      return groups;
    };
    const fullFields=['goal_difference','goals_for'],mutualFields=['points',...fullFields];
    const full=groups=>refine(groups,overall,fullFields,'overall',teams);
    const mutual=(group,reapply)=>{
      const groups=refine([group],statistics(group,matches),mutualFields,'head_to_head',group);
      if(!reapply||groups.length===1)return full(groups);
      return groups.flatMap(g=>g.length===1?[g]:mutual(g,true));
    };
    const ordered=[];
    for(const group of refine(teams.length?[teams]:[],overall,['points'],'overall',teams)){
      if(group.length===1)ordered.push(group);
      else if(rule==='III')for(const sub of full([group]))ordered.push(...refine([sub],statistics(sub,matches),mutualFields,'head_to_head',sub));
      else ordered.push(...mutual(group,rule==='II'));
    }
    let position=1;
    const groups=ordered.map(teams=>{const start=position;position+=teams.length;return{teams,rank:teams.length===1?start:null,position_from:start,position_to:position-1,status:teams.length===1?'已确定':PENDING}});
    return {rule,groups,statistics:overall,trace};
  }
  function qualification(group,topK){return group.position_to<=topK?'qualified':group.position_from>topK?'eliminated':'pending'}
  const api={integer,statistics,rank,qualification,PENDING};
  if(typeof module!=='undefined')module.exports=api;else global.RankingCore=api;
})(globalThis);
