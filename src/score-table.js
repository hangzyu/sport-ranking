(function(global){
'use strict';
const C=typeof module!=='undefined'?require('./ranking-core.js'):global.RankingCore;
const labels={qualified:'✓ 出线',eliminated:'× 淘汰',pending:'○ 待决胜',incomplete:'? 未确认'};
// Each index represents one concrete score. Paging covers all nonnegative scores.
function scoreAt(index,outcome){
 if(!Number.isSafeInteger(index)||index<0)throw Error('比分序号必须是非负安全整数');
 if(['D','PW','PL'].includes(outcome))return [BigInt(index),BigInt(index)];
 let n=Math.floor((Math.sqrt(8*index+1)-1)/2);
 while(n*(n+1)/2>index)n--;while((n+1)*(n+2)/2<=index)n++;
 const away=BigInt(index-n*(n+1)/2),home=BigInt(n+1);
 return outcome==='W'?[home,away]:[away,home];
}
function classify(report,scores){
 const matches=Object.entries(report.conditions_by_status).filter(([,groups])=>groups.some(cs=>cs.every(c=>{
  const value=c.coefficients.reduce((sum,k,i)=>sum+BigInt(k)*scores[i],0n);
  return c.op==='='?value===BigInt(c.rhs):value>=BigInt(c.rhs);
 })));
 return report.complete&&matches.length===1?matches[0][0]:'incomplete';
}
function render(host,input,report){
 host.replaceChildren();const make=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e};
 host.className='score-view';host.append(make('h3',`${report.target} · 比分出线表`));
 host.append(make('p','✓ 出线　× 淘汰　○ 待决胜。每格对应具体比分；翻页查看更多，当前表格不代表全部比分。'));
 const own=input.remaining.findIndex(m=>m.home===report.target||m.away===report.target),row=own<0?0:own,col=input.remaining.findIndex((_,i)=>i!==row);
 const valid=input.remaining.map(()=>true),pages=[0,0],fixed=input.remaining.map((_,i)=>scoreAt(0,report.outcomes[i]));
 const title=i=>{const m=input.remaining[i];return `${m.home}—${m.away}${report.outcomes[i]==='PW'?`（${m.home}点球胜）`:report.outcomes[i]==='PL'?`（${m.away}点球胜）`:''}`};
 const extra=make('div');
 input.remaining.forEach((m,i)=>{if(i===row||i===col)return;
  const label=make('label',`固定 ${title(i)} 比分：`),x=make('input'),y=make('input'),note=make('span');
  for(const [j,e]of [x,y].entries()){e.type='number';e.min='0';e.value=String(fixed[i][j]);e.setAttribute('aria-label',`${j?m.away:m.home}进球`)}
  const change=()=>{try{const a=C.integer(x.value),b=C.integer(y.value),o=report.outcomes[i];if(o==='W'?a<=b:o==='L'?a>=b:a!==b)throw Error('比分须符合所选情景');fixed[i]=[a,b];valid[i]=true;note.textContent='';draw()}catch(e){valid[i]=false;note.textContent=e.message;grid.replaceChildren();selection.replaceChildren()}};
  x.onchange=y.onchange=change;label.append(x,make('span','∶'),y,note);extra.append(label);
 });host.append(extra);
 const controls=make('div');controls.className='score-controls';
 [row,col].forEach((axis,k)=>{if(axis<0)return;const box=make('div');box.append(make('span',`${k?'列':'行'}：${title(axis)} `));
  const prev=make('button','上一页'),next=make('button','下一页'),page=make('input');page.type='number';page.min='1';page.value='1';page.setAttribute('aria-label',`${k?'列':'行'}比分页码`);
  const update=n=>{if(!Number.isSafeInteger(n)||n<0||n>1000000){page.value=String(pages[k]+1);return}pages[k]=n;page.value=String(n+1);prev.disabled=n===0;draw()};
  prev.disabled=true;prev.onclick=()=>update(pages[k]-1);next.onclick=()=>update(pages[k]+1);page.onchange=()=>update(Number(page.value)-1);box.append(prev,page,next);controls.append(box);
 });host.append(controls);
 const grid=make('div');grid.className='score-scroll';const selection=make('div');selection.className='score-selection';selection.setAttribute('aria-live','polite');host.append(grid,selection);
 function draw(){
  grid.replaceChildren();selection.replaceChildren();if(valid.some(v=>!v))return;const table=make('table'),head=make('thead'),hr=make('tr');
  hr.append(make('th',col<0?title(row):`${title(row)} ↓ / ${title(col)} →`));
  const columns=col<0?[null]:Array.from({length:6},(_,j)=>scoreAt(pages[1]*6+j,report.outcomes[col]));
  columns.forEach(s=>{const th=make('th',s?s.join('∶'):'结论');th.scope='col';hr.append(th)});head.append(hr);table.append(head);const body=make('tbody');
  for(let i=0;i<6;i++){const rs=scoreAt(pages[0]*6+i,report.outcomes[row]),tr=make('tr'),th=make('th',rs.join('∶'));th.scope='row';tr.append(th);
   for(const cs of columns){const values=fixed.map(s=>[...s]);values[row]=rs;if(col>=0)values[col]=cs;
    const status=classify(report,values.flat()),td=make('td'),button=make('button',labels[status]);button.dataset.status=status;
    button.setAttribute('aria-label',`${title(row)} ${rs.join('∶')}${cs?`；${title(col)} ${cs.join('∶')}`:''}：${labels[status]}`);
    button.onclick=()=>{
     selection.replaceChildren();selection.append(make('strong',`${report.target}：${labels[status]}`));
     selection.append(make('p',input.remaining.map((m,k)=>`${title(k)} ${values[k].join('∶')}`).join('；')));
     const matches=[...input.completed,...input.remaining.map((m,k)=>[m.home,m.away,...values[k],report.outcomes[k]==='PW'?m.home:report.outcomes[k]==='PL'?m.away:null])];
     const ranked=C.rank(input.teams,matches,input.rule);
     selection.append(make('p',ranked.groups.map(g=>`第${g.position_from===g.position_to?g.position_from:`${g.position_from}—${g.position_to}`}名：${g.teams.join('、')}`).join('；')));
     const details=make('details');details.append(make('summary','查看排名依据'));const list=make('ol');
     for(const s of ranked.trace)list.append(make('li',`${s.scope==='overall'?'全组':s.scope_teams.join('、')+'之间的相互比赛'}${{points:'积分',goal_difference:'净胜球',goals_for:'进球数'}[s.criterion]}：${s.teams.map(t=>`${t} ${s.values[t]}`).join('；')}`));
     details.append(list);selection.append(details);
    };td.append(button);tr.append(td);
   }body.append(tr);
  }table.append(body);grid.append(table);
 }
 draw();
}
const api={scoreAt,classify,render};if(typeof module!=='undefined')module.exports=api;else global.ScoreTable=api;
})(globalThis);
