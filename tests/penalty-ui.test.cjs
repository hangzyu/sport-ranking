const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const C=require('../src/ranking-core.js'),E=require('../src/qualification-engine.js');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const state={method:'IV',status:'草稿',teams:['A','B'],matches:[['A','B',1,1,1,true]],manualOrders:{}};
let renders=0;const method={value:'IV'};
const ctx={EventSettings:require('../src/event-settings.js'),saveCurrentGroup:()=>{},RankingCore:C,state,currentOperator:()=>({role:'创建者'}),$:()=>method,render:()=>renders++};
vm.createContext(ctx);
vm.runInContext(html.slice(html.indexOf('function penaltySuffix'),html.indexOf('function bindPenalties')),ctx);
vm.runInContext(html.slice(html.indexOf('function changeRankingMethod'),html.indexOf('function openMethodInfo')),ctx);
assert.equal(ctx.readyMatch(state.matches[0]),false);
assert.ok(ctx.penaltyControls(state.matches[0],0).includes('请选择点球胜方'));
ctx.changeRankingMethod('V');assert.equal(state.matches[0][5],false);
state.matches[0][7]='B';assert.equal(ctx.readyMatch(state.matches[0]),true);
assert.ok(ctx.penaltyControls(state.matches[0],0).includes('value="1" selected'));
assert.equal(ctx.penaltySuffix(state.matches[0]),'（B点球胜）');
state.status='进行中';ctx.changeRankingMethod('I');assert.equal(state.method,'V');
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.classList={add(){},contains:()=>true};}
 append(...children){this.children.push(...children)}
 replaceChildren(...children){this.children=children}
 setAttribute(name,value){this[name]=value}
}
const panel={QualificationEngine:E,RankingCore:C,document:{createElement:t=>new Element(t)}};
vm.createContext(panel);vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/qualification-panel.js'),'utf8'),panel);
const walk=n=>[n,...n.children.flatMap(walk)];
for(const [rule,count] of [['I',9],['IV',16],['V',16]]){
 const host=new Element('section'),s={teams:['A','B','C','D'],focusTeam:'B',method:rule,qualifiers:2,status:'草稿',cycle:'single',matches:[['A','B',1,0,1,true],['C','D',1,0,1,true],['A','D',1,0,2,true],['B','C',1,1,2,true,null,'B'],['A','C','','',3,false],['D','B','','',3,false]]};
 panel.QualificationApp.render(host,s);
 const cells=walk(host).filter(n=>n.className==='qualification-cell');assert.equal(cells.length,count);
 if(rule!=='I')assert.ok(cells.some(c=>c['aria-label'].includes('B点球胜')));
}
console.log('Passed shootout form validation, winner persistence, locked method and 9/16-cell render checks.');
