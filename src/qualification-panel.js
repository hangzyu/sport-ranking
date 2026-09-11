(function(global){
  'use strict';
  const E=global.QualificationEngine,C=global.RankingCore,OUT=['W','D','L'],WORD={W:'胜',D:'平',L:'负',PW:'点球胜',PL:'点球负'},FLIP={W:'L',D:'D',L:'W',PW:'PL',PL:'PW'};
  const TEXT={qualified:'必定出线',eliminated:'确定淘汰',pending:'出线资格待决胜',conditional:'需满足比分条件',incomplete:'推演未完成'};
  const ICON={qualified:'✓',eliminated:'×',pending:'○',conditional:'◇',incomplete:'?'};
  const METHODS={I:'类型Ⅰ · 相互比较不重启',II:'类型Ⅱ · 分组后立即重新比较',III:'类型Ⅲ · 全组数据优先',IV:'类型Ⅳ · 点球胜2分、负0分',V:'类型Ⅴ · 点球胜2分、负1分'};
  let revision=0,worker=null,request=0,inflight=null,selected='W,D';const cache=new Map();
  const make=(tag,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e};
  function stop(reason='已切换推演条件'){if(worker)worker.terminate();worker=null;if(inflight){clearTimeout(inflight.timer);inflight.reject(new Error(reason));inflight=null}}
  function ask(payload){

    if(!worker){
      worker=new Worker(new URL('./qualification-worker.js',new URL('src/qualification-panel.js',document.baseURI)));
      const instance=worker;
      worker.onmessage=event=>{if(!inflight||event.data.id!==inflight.id)return;const task=inflight;inflight=null;clearTimeout(task.timer);event.data.error?task.reject(new Error(event.data.error)):task.resolve(event.data.result)};
      worker.onerror=()=>{if(worker!==instance)return;const task=inflight;inflight=null;if(task){clearTimeout(task.timer);task.reject(new Error('推演组件未能启动，请刷新后重试。'))}worker.terminate();worker=null};
    }
    return new Promise((resolve,reject)=>{const id=++request;const timer=setTimeout(()=>{stop('推演用时较长，尚未得出完整结论，请重试。')},45000);inflight={id,resolve,reject,timer};worker.postMessage({id,...payload})});
  }
  function words(c,variables){
    let entries=c.coefficients.map((v,i)=>[v,variables[i]]).filter(([v])=>v),rhs=BigInt(c.rhs),op=c.op;
    if(op==='='&&rhs<0n){rhs=-rhs;entries=entries.map(([v,t])=>[-v,t])}
    if(entries.length===1&&Math.abs(entries[0][0])===1){const [v,t]=entries[0];if(v<0){rhs=-rhs;if(op==='>=')op='<='}return`${t.team}本场${op==='='?'进':op==='>='?'至少进':'至多进'}${rhs}球`}
    if(entries.length===2&&entries.some(([v])=>v===1)&&entries.some(([v])=>v===-1)){
      const p=entries.find(([v])=>v===1)[1],m=entries.find(([v])=>v===-1)[1];
      if(p.match_id===m.match_id)return`${p.team}本场净胜球${op==='='?'等于':'至少为'}${rhs}`;
      if(rhs>=0n)return`${p.team}本场进球比${m.team}${op==='='?'恰好多':'至少多'}${rhs}个`;
    }
    const expr=entries.sort((a,b)=>(a[0]<0)-(b[0]<0)).map(([v,t],i)=>`${v<0?' − ':i?' + ':''}${Math.abs(v)===1?'':`${Math.abs(v)}×`}${t.team}本场进球`).join('');
    return`${expr.trim()} ${op==='>='?'≥':'='} ${rhs}`;
  }
  function detailContent(detail,cell,input,retry){
    detail.scoreHost?.replaceChildren();
    detail.replaceChildren(make('h3',cell.label));
    if(!cell.report){detail.append(make('p',cell.error||'正在计算这一组合的出线条件…','qualification-note'));return}
    const r=cell.report;
    detail.append(make('p',Object.entries(r.final_points||{}).map(([t,p])=>`${t} ${p}分`).join(' · '),'qualification-points'));
    if(!r.complete){detail.append(make('p',r.incomplete_reason||'推演尚未完成，不能对未覆盖的比分作出结论。'));const button=make('button','重新计算','secondary');button.onclick=retry;detail.append(button);return}
    if(r.score_limit!==undefined){
      detail.append(make('p','仅推演每队进球 0～10 球的比分；结论仅适用于此范围。'));
      detail.append(make('p',Object.entries(r.counts).map(([s,n])=>`${{qualified:'出线',pending:'待决胜',eliminated:'淘汰'}[s]} ${n} 组`).join(' · ')));
      if(detail.scoreHost)global.ScoreTable.render(detail.scoreHost,input,r);
      return;
    }
    for(const [status,label] of [['qualified','确定出线'],['pending','出线资格待决胜']]){
      const rules=r.conditions_by_status[status];if(!rules.length)continue;
      detail.append(make('h4',`${label} · ${rules.some(g=>g.length===0)?'本格所有比分':'满足以下任一组'}`));
      if(!rules.some(g=>g.length===0)){const list=make('ol');for(const cs of rules)list.append(make('li',cs.map(c=>words(c,r.variables)).join('；并且')));detail.append(list)}
      if(status==='pending')detail.append(make('p',C.pendingLabel(input.rule)));
    }
    if(r.conditions_by_status.eliminated.length)detail.append(make('p',r.conditions_by_status.qualified.length||r.conditions_by_status.pending.length?'其他比分：确定淘汰':'本格所有比分：确定淘汰'));
    const samples=make('details');samples.append(make('summary','比分核对示例（不是额外条件）'));const list=make('ul');
    for(const [status,example] of Object.entries(r.examples)){
      const fixtureText=input.remaining.map((m,i)=>`${m.home} ${example.scores[m.id].join('∶')} ${m.away}${r.outcomes[i]==='PW'?`（${m.home}点球胜）`:r.outcomes[i]==='PL'?`（${m.away}点球胜）`:''}`).join('；');
      const item=make('li',`${{qualified:'出线',eliminated:'淘汰',pending:'资格待决胜'}[status]}：${fixtureText}`);
      item.append(make('p',example.ranking.map(g=>`${g.position_from===g.position_to?g.position_from:`${g.position_from}—${g.position_to}`}名 ${g.teams.join(' / ')}${g.rank===null?'（未分先后）':''}`).join('；'),'qualification-note'));
      const chain=make('details');chain.append(make('summary','此示例的比较过程'));const steps=make('ol');
      const metric={points:'积分',goal_difference:'净胜球',goals_for:'进球数'};
      for(const s of example.trace){
        const scope=s.scope==='overall'?'全组':`${s.scope_teams.join('、')}之间的相互比赛`;
        const text=s.teams.map(t=>`${t} ${s.before_values[t]}→${s.after_values[t]}`).join('；');
        steps.append(make('li',`${scope}${metric[s.criterion]}（赛前→本例赛后）：${text}`));
      }
      chain.append(steps);item.append(chain);list.append(item);
    }
    samples.append(list);detail.append(samples);
    if(detail.scoreHost)global.ScoreTable.render(detail.scoreHost,input,r);
  }
  function render(host,state,callbacks={}){
    const token=++revision;if(inflight)stop();host.replaceChildren();host.classList.add('qualification-view');
    host.append(make('h2','末轮出线条件'));host.append(make('p','比分范围：每队 0～10 球，出线结论仅适用于此范围。','qualification-note'));
    const confirmed=state.matches.filter(m=>m[5]).length;
    host.append(make('p',`前${state.qualifiers}名出线 · 已确认${confirmed}/${state.matches.length}场`,'qualification-note'));
    const controls=make('div',undefined,'qualification-controls'),teamLabel=make('label','关注球队'),teamSelect=make('select',undefined,'field');
    teamSelect.setAttribute('aria-label','关注球队');
    for(const t of state.teams){const option=make('option',t);option.value=t;teamSelect.append(option)}
    teamSelect.value=state.teams.includes(state.focusTeam)?state.focusTeam:state.teams[0];teamSelect.onchange=()=>callbacks.onTarget?.(teamSelect.value);teamLabel.append(teamSelect);
    const methodLabel=make('label','排名方法'),method=make('select',undefined,'field');method.setAttribute('aria-label','推演排名方法');
    for(const [value,text] of Object.entries(METHODS)){const o=make('option',text);o.value=value;method.append(o)}
    method.value=state.method;method.disabled=state.status!=='草稿'||callbacks.canChangeMethod===false;method.onchange=()=>callbacks.onMethod?.(method.value);methodLabel.append(method);controls.append(teamLabel,methodLabel);host.append(controls);
    let input;try{input=E.fromState(state)}catch(error){host.append(make('div',error.message,'qualification-empty'));const button=make('button','前往赛程补齐赛果','secondary');button.onclick=()=>document.querySelector('[data-view="schedule"]')?.click();host.append(button);return}
    const target=teamSelect.value,OUT=C.outcomes(input.rule);
    if(C.penaltyRule(input.rule))host.append(make('p','胜／负指常规比赛结果；常规比赛打平后分为点球胜、点球负。点球进球不计入进球数及净胜球。','qualification-note'));
    if(!input.remaining.length){
      const ranked=C.rank(input.teams,input.completed,input.rule),group=ranked.groups.find(g=>g.teams.includes(target)),status=C.qualification(group,input.topK);
      host.append(make('div',`比赛已全部确认。${target}：${TEXT[status]}${group.rank===null?`；第${group.position_from}—${group.position_to}名尚未分出先后`: `，第${group.rank}名`}。${status==='pending'?C.pendingLabel(input.rule):''}`,'qualification-empty'));return;
    }
    host.append(make('p',input.remaining.map(m=>`${m.home} vs ${m.away}`).join('；'),'qualification-fixtures'));
    const ownIndex=input.remaining.findIndex(m=>m.home===target||m.away===target),rowIndex=ownIndex<0?0:ownIndex;
    const otherIndex=input.remaining.findIndex((_,i)=>i!==rowIndex),fixedIndices=input.remaining.map((_,i)=>i).filter(i=>i!==rowIndex&&i!==otherIndex);
    const fixed={};
    if(ownIndex<0)host.append(make('p',`${target}本轮已无待赛比赛；以下按其余比赛推演。`,'qualification-note'));
    const extraControls=make('div',undefined,'qualification-controls');
    for(const i of fixedIndices){const m=input.remaining[i],label=make('label',`固定另一场：${m.home} vs ${m.away}`),select=make('select',undefined,'field');for(const o of OUT){const option=make('option',`${m.home}${WORD[o]}`);option.value=o;select.append(option)}fixed[i]='W';select.onchange=()=>{fixed[i]=select.value;rebuild()};label.append(select);extraControls.append(label)}
    if(fixedIndices.length)host.append(extraControls);
    const tableWrap=make('div',undefined,'qualification-table-wrap'),table=make('table',undefined,'qualification-matrix');table.setAttribute('aria-label','末轮胜平负出线条件');tableWrap.append(table);host.append(tableWrap);
    const detail=make('section',undefined,'qualification-detail');detail.setAttribute('aria-live','polite');host.append(detail);
    const history=make('details',undefined,'qualification-history');history.append(make('summary','已确认赛果'));const hl=make('ul');for(const [a,b,x,y,w]of input.completed)hl.append(make('li',`${a} ${x}∶${y} ${b}${C.penaltyRule(input.rule)&&x===y?`（${w}点球胜）`:''}`));history.append(hl);host.append(history);
    detail.scoreHost=make('section');host.append(detail.scoreHost);
    let generation=0;
    const snapshot={teams:[...state.teams],qualifiers:state.qualifiers,method:state.method,cycle:state.cycle,matches:state.matches.map(m=>[...m])};
    const fingerprint=JSON.stringify(snapshot);
    function rebuild(){
      const current=++generation;if(inflight)stop();table.replaceChildren();
      const rowTeam=ownIndex<0?input.remaining[rowIndex].home:target,columns=otherIndex<0?['D']:OUT,cells=[];
      const header=make('tr');header.append(make('th',otherIndex<0?'本场赛果':'本队 / 另一场'));
      for(const o of columns){const th=make('th',otherIndex<0?'出线结论':`${input.remaining[otherIndex].home}${WORD[o]}`);th.scope='col';header.append(th)}const thead=make('thead');thead.append(header);table.append(thead);const body=make('tbody');
      for(const row of OUT){const tr=make('tr'),th=make('th',`${rowTeam}${WORD[row]}`);th.scope='row';tr.append(th);
        for(const column of columns){
          const outcomes=input.remaining.map((_,i)=>fixed[i]);outcomes[rowIndex]=rowTeam===input.remaining[rowIndex].home?row:FLIP[row];if(otherIndex>=0)outcomes[otherIndex]=column;
          const label=`${rowTeam}${WORD[row]}${otherIndex<0?'':` · ${input.remaining[otherIndex].home}${WORD[column]}`}`;
          const key=JSON.stringify([fingerprint,target,outcomes]),id=`${row},${column}`,cell={id,key,outcomes,label,report:cache.get(key)};
          const td=make('td'),button=make('button',undefined,'qualification-cell');button.type='button';cell.button=button;
          button.onclick=()=>{selected=id;for(const c of cells)c.button.setAttribute('aria-pressed',String(c.id===selected));detailContent(detail,cell,input,rebuild)};
          td.append(button);tr.append(td);cells.push(cell);
        }body.append(tr);
      }table.append(body);
      if(!cells.some(c=>c.id===selected))selected=cells[0].id;
      function paint(cell){const r=cell.report;cell.button.textContent=r?`${ICON[r.summary]} ${TEXT[r.summary]}`:cell.error?'? 暂未完成':'计算中…';cell.button.dataset.status=r?.summary||'loading';cell.button.setAttribute('aria-label',`${cell.label}：${r?TEXT[r.summary]:'计算中'}`);cell.button.setAttribute('aria-pressed',String(cell.id===selected));if(cell.id===selected)detailContent(detail,cell,input,rebuild)}
      cells.forEach(paint);
      if(host.classList.contains('hidden'))return;
      const ordered=[...cells].sort((a,b)=>Number(b.id===selected)-Number(a.id===selected));
      (async()=>{
        for(const cell of ordered){
          if(token!==revision||current!==generation)return;
          if(cell.report)continue;
          try{const result=await ask({state:snapshot,target,outcomes:cell.outcomes});if(token!==revision||current!==generation)return;cell.report=result;if(result.complete){cache.set(cell.key,result);if(cache.size>256)cache.delete(cache.keys().next().value)}paint(cell)}
          catch(error){
            if(token!==revision||current!==generation)return;
            for(const c of cells)if(!c.report){c.error=error.message;paint(c)}
            const retry=make('button','重新计算','secondary');
            retry.onclick=()=>{for(const c of cells)c.error=null;stop();rebuild()};detail.append(retry);return;
          }
        }
      })();
    }
    rebuild();
  }
  global.QualificationApp={render,words,stop};
})(globalThis);
