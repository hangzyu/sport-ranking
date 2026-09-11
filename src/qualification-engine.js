/* Exact path partitioning over unbounded integer score variables. No score sampling. */
(function(global){
  'use strict';
  const Core=typeof module!=='undefined'?require('./ranking-core.js'):global.RankingCore;
  const namesFor=n=>Array.from({length:n},(_,i)=>`s${i}`);
  const num=n=>BigInt(n)<0n?`(- ${-BigInt(n)})`:String(n);
  const and=xs=>xs.length?`(and ${xs.join(' ')})`:'true';
  const or=xs=>xs.length?`(or ${xs.join(' ')})`:'false';
  const not=x=>`(not ${x})`;
  const gcd=(a,b)=>b?gcd(b,a%b):Math.abs(a);
  const zero=n=>({co:Array(n).fill(0),constant:0n});
  const add=(a,b)=>({co:a.co.map((c,i)=>c+b.co[i]),constant:a.constant+b.constant});
  const sub=(a,b)=>({co:a.co.map((c,i)=>c-b.co[i]),constant:a.constant-b.constant});
  function condition(diff,equal=false){
    let co=[...diff.co],rhs=(equal?0n:1n)-diff.constant;
    const divisor=co.reduce((g,c)=>gcd(g,c),0);
    if(divisor&&(!equal||rhs%BigInt(divisor)===0n)){
      co=co.map(c=>c/divisor);const d=BigInt(divisor);rhs=equal?rhs/d:rhs>=0n?(rhs+d-1n)/d:rhs/d;
    }
    if(equal&&co.find(c=>c)!==undefined&&co.find(c=>c)<0){co=co.map(c=>-c);rhs=-rhs}
    return{co,op:equal?'=':'>=',rhs};
  }
  function formula(c,names){const terms=c.co.flatMap((v,i)=>v?[v===1?names[i]:`(* ${num(v)} ${names[i]})`]:[]);const lhs=terms.length===0?'0':terms.length===1?terms[0]:`(+ ${terms.join(' ')})`;return`(${c.op} ${lhs} ${num(c.rhs)})`}
  const unique=cs=>[...new Map(cs.map(c=>[`${c.co}|${c.op}|${c.rhs}`,c])).values()];
  const serialize=c=>({coefficients:c.co,op:c.op,rhs:String(c.rhs)});
  const jsonSafe=value=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?String(v):v));

  function fromState(state){
    const teams=[...state.teams],topK=Number(state.qualifiers),rule=state.method;
    if(!Number.isInteger(topK)||topK<1||topK>teams.length)throw new Error('请设置有效的出线名额。');
    Core.rank(teams,[],rule);
    if(!state.matches.length)throw new Error('请先安排完整赛程。');
    const rounds=state.matches.map(m=>Number(m[4]));
    if(rounds.some(r=>!Number.isInteger(r)||r<1))throw new Error('比赛轮次必须是正整数。');
    const lastRound=Math.max(...rounds),counts=new Map(),seen=new Set(),completed=[],remaining=[];
    const meetingCount=state.cycle==='double'?2:1;
    for(let i=0;i<state.matches.length;i++){
      const m=state.matches[i],[a,b]=m;
      if(!teams.includes(a)||!teams.includes(b)||a===b)throw new Error('赛程中有无效的对阵。');
      const key=[teams.indexOf(a),teams.indexOf(b)].sort((x,y)=>x-y).join(',');counts.set(key,(counts.get(key)||0)+1);
      for(const t of [a,b]){const key=JSON.stringify([rounds[i],t]);if(seen.has(key))throw new Error(`第${rounds[i]}轮有球队被重复安排比赛。`);seen.add(key)}
      if(m[5])completed.push([a,b,Core.integer(m[2]),Core.integer(m[3]),m[7]]);
      else if(rounds[i]!==lastRound)throw new Error(`请先确认前几轮的赛果：第${rounds[i]}轮 ${a} vs ${b}。`);
      else remaining.push({id:String(i),home:a,away:b});
    }
    for(let a=0;a<teams.length;a++)for(let b=a+1;b<teams.length;b++)if(counts.get(`${a},${b}`)!==meetingCount)throw new Error('赛程尚不完整或存在重复对阵，请先补齐本组循环赛程。');
    return{teams,topK,rule,lastRound,completed,remaining,current:Core.statistics(teams,completed,rule)};
  }

  function symbolicStats(input,scope,outcomes){
    const n=outcomes.length*2,data=Object.fromEntries(scope.map(t=>[t,{points:zero(n),goal_difference:zero(n),goals_for:zero(n)}]));
    const constant=v=>({...zero(n),constant:BigInt(v)});
    const games=input.completed.map(([a,b,x,y,w])=>[a,b,constant(x),constant(y),Core.result(a,b,x,y,w,input.rule)]);
    input.remaining.forEach((m,i)=>{const x=zero(n),y=zero(n);x.co[2*i]=1;y.co[2*i+1]=1;games.push([m.home,m.away,x,['D','PW','PL'].includes(outcomes[i])?x:y,outcomes[i]])});
    for(const [a,b,x,y,o] of games){
      if(!Object.hasOwn(data,a)||!Object.hasOwn(data,b))continue;
      const pts=Core.pointsFor(input.rule,o);
      for(const [t,gf,ga,p] of [[a,x,y,pts[0]],[b,y,x,pts[1]]]){
        const r=data[t];r.points=add(r.points,constant(p));r.goals_for=add(r.goals_for,gf);r.goal_difference=add(r.goal_difference,sub(gf,ga));
      }
    }
    return data;
  }

  /* The only solver boundary. SMT symbols are generated internally, never team names. */
  function createOracle(Z3,{timeoutMs=3000}={}){
    return async function query(names,assertions,withModel=false){
      const cfg=Z3.mk_config();Z3.set_param_value(cfg,'timeout',String(timeoutMs));
      const ctx=Z3.mk_context(cfg);Z3.del_config(cfg);
      const solver=Z3.mk_solver(ctx);Z3.solver_inc_ref(ctx,solver);
      try{
        const text=names.map(n=>`(declare-const ${n} Int)`).join('\n')+'\n'+assertions.map(x=>`(assert ${x})`).join('\n');
        Z3.solver_from_string(ctx,solver,text);
        if(Z3.get_error_code(ctx)!==0)throw new Error('无法解析排名约束。');
        const status=await Z3.solver_check(ctx,solver);
        if(status!==1)return{status:status===-1?'unsat':'unknown'};
        const values=[];
        if(withModel){
          const model=Z3.solver_get_model(ctx,solver);Z3.model_inc_ref(ctx,model);
          try{for(const n of names){const term=Z3.mk_const(ctx,Z3.mk_string_symbol(ctx,n),Z3.mk_int_sort(ctx));const ast=Z3.model_eval(ctx,model,term,true);values.push(BigInt(Z3.get_numeral_string(ctx,ast)))}}finally{Z3.model_dec_ref(ctx,model)}
        }
        return{status:'sat',values};
      }finally{Z3.solver_dec_ref(ctx,solver);Z3.del_context(ctx)}
    };
  }

  async function analyze(input,target,outcomes,query,{maxRegions=1000,maxMs=25000,simplify=true}={}){
    if(!input.teams.includes(target)||outcomes.length!==input.remaining.length||outcomes.some(o=>!Core.outcomes(input.rule).includes(o)))throw new Error('无效的球队或胜平负组合。');
    const names=namesFor(outcomes.length*2),base=names.map(n=>`(>= ${n} 0)`),started=Date.now();
    outcomes.forEach((o,i)=>base.push(`(${o==='W'?'>':o==='L'?'<':'='} ${names[2*i]} ${names[2*i+1]})`));
    const covered=[],paths=[],examples={};let complete=false,reason='推演达到时间限制，请重试。',finalPoints=null;
    async function minimize(cs,extra=[]){
      cs=unique(cs);
      for(let i=0;simplify&&i<cs.length&&Date.now()-started<maxMs;){
        const others=cs.filter((_,j)=>j!==i).map(c=>formula(c,names));
        const check=await query(names,[...base,...extra,...others,not(formula(cs[i],names))]);
        if(check.status==='unsat')cs.splice(i,1);else i++;
      }
      return cs;
    }
    while(Date.now()-started<maxMs){
      const check=await query(names,[...base,not(or(covered))],true);
      if(check.status==='unsat'){complete=true;break}
      if(check.status!=='sat'){reason='本次未能完成全部比分的验证，请重试。';break}
      if(paths.length>=maxRegions){reason='比赛组合较复杂，本次推演尚未覆盖全部条件。';break}
      const matches=[...input.completed,...input.remaining.map((m,i)=>[m.home,m.away,check.values[2*i],check.values[2*i+1],outcomes[i]==='PW'?m.home:outcomes[i]==='PL'?m.away:null])];
      const ranked=Core.rank(input.teams,matches,input.rule),cache=new Map(),history=new Map(),symbolicTrace=[];let conditions=[];
      finalPoints=Object.fromEntries(input.teams.map(t=>[t,ranked.statistics[t].points]));
      for(const step of ranked.trace){
        const key=JSON.stringify([step.scope,step.scope_teams]);
        if(!cache.has(key)){cache.set(key,symbolicStats(input,step.scope_teams,outcomes));history.set(key,Core.statistics(step.scope_teams,input.completed,input.rule))}
        const data=cache.get(key),field=step.criterion;
        for(const g of step.result)for(const t of g.slice(1))conditions.push(condition(sub(data[g[0]][field],data[t][field]),true));
        for(let i=0;i+1<step.result.length;i++)conditions.push(condition(sub(data[step.result[i][0]][field],data[step.result[i+1][0]][field])));
        symbolicTrace.push({scope:step.scope,scope_teams:step.scope_teams,criterion:field,teams:step.teams,
          before_values:Object.fromEntries(step.teams.map(t=>[t,history.get(key)[t][field]])),after_values:step.values,result:step.result});
      }
      conditions=await minimize(conditions);
      const path=and(conditions.map(c=>formula(c,names))),group=ranked.groups.find(g=>g.teams.includes(target));
      const status=Core.qualification(group,input.topK);
      paths.push({status,conditions});covered.push(path);
      if(!examples[status])examples[status]={scores:Object.fromEntries(input.remaining.map((m,i)=>[m.id,[String(check.values[2*i]),String(check.values[2*i+1])]])),ranking:ranked.groups,trace:symbolicTrace};
    }
    const conditionsByStatus={qualified:[],pending:[],eliminated:[]};
    for(const status of Object.keys(conditionsByStatus)){
      const relevant=paths.filter(p=>p.status===status),union=or(relevant.map(p=>and(p.conditions.map(c=>formula(c,names)))));
      let groups=[];
      for(const p of relevant){
        let cs=[...p.conditions];
        for(let i=0;simplify&&i<cs.length&&Date.now()-started<maxMs;){
          const check=await query(names,[...base,not(union),...cs.filter((_,j)=>j!==i).map(c=>formula(c,names))]);
          if(check.status==='unsat')cs.splice(i,1);else i++;
        }
        if(!groups.some(g=>g.length===cs.length&&g.every(c=>cs.some(x=>formula(c,names)===formula(x,names)))))groups.push(cs);
      }
      for(let i=0;simplify&&i<groups.length&&Date.now()-started<maxMs;){
        const other=or(groups.filter((_,j)=>j!==i).map(g=>and(g.map(c=>formula(c,names)))));
        const check=await query(names,[...base,...groups[i].map(c=>formula(c,names)),not(other)]);
        if(check.status==='unsat')groups.splice(i,1);else i++;
      }
      conditionsByStatus[status]=groups.map(g=>g.map(serialize));
    }
    const statuses=[...new Set(paths.map(p=>p.status))];
    return jsonSafe({target,rule:input.rule,outcomes,complete,incomplete_reason:complete?null:reason,
      summary:!complete?'incomplete':statuses.length===1?statuses[0]:'conditional',final_points:finalPoints,
      variables:input.remaining.flatMap(m=>[{match_id:m.id,team:m.home},{match_id:m.id,team:m.away}]),
      conditions_by_status:conditionsByStatus,examples});
  }

  // Finite score domain for the interactive view; retain symbolic API for other callers.
  function analyzeBounded(input,target,outcomes,{maxMs=20000}={}){
    if(!input.teams.includes(target)||outcomes.length!==input.remaining.length||outcomes.some(o=>!Core.outcomes(input.rule).includes(o)))throw Error('无效的球队或胜平负组合。');
    const choices=outcomes.map(o=>{const list=[];for(let a=0;a<=10;a++)for(let b=0;b<=10;b++)if(o==='W'?a>b:o==='L'?a<b:a===b)list.push([a,b]);return list});
    const score_status={},counts={qualified:0,pending:0,eliminated:0},scores=[],started=Date.now();let complete=true,final_points=null;
    function visit(i){
      if(Date.now()-started>maxMs){complete=false;return}
      if(i<choices.length){for(const pair of choices[i]){scores[i]=pair;visit(i+1);if(!complete)break}return}
      const matches=[...input.completed,...input.remaining.map((m,k)=>[m.home,m.away,...scores[k],outcomes[k]==='PW'?m.home:outcomes[k]==='PL'?m.away:null])];
      const ranked=Core.rank(input.teams,matches,input.rule),status=Core.qualification(ranked.groups.find(g=>g.teams.includes(target)),input.topK);
      score_status[scores.flat().join(',')]=status;counts[status]++;
      if(!final_points)final_points=Object.fromEntries(input.teams.map(t=>[t,ranked.statistics[t].points]));
    }
    visit(0);const statuses=Object.keys(counts).filter(s=>counts[s]);
    return jsonSafe({target,rule:input.rule,outcomes,score_limit:10,score_status,counts,complete,final_points,
      summary:!complete?'incomplete':statuses.length===1?statuses[0]:'conditional',incomplete_reason:complete?null:'组合较多，尚未完成，请减少待赛场次。'});
  }
  const api={analyzeBounded,fromState,analyze,createOracle,symbolicStats,formula,condition,jsonSafe};
  if(typeof module!=='undefined')module.exports=api;else global.QualificationEngine=api;
})(globalThis);
