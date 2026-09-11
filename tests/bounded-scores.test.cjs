const assert=require('node:assert/strict');
const E=require('../src/qualification-engine.js'),C=require('../src/ranking-core.js'),S=require('../src/score-table.js');
const start=Date.now();let checks=0;
for(const rule of ['I','II','III','IV','V']){
 const input=E.fromState({teams:['A','B','C','D'],qualifiers:2,method:rule,cycle:'single',matches:[['A','B',1,0,1,true],['C','D',1,0,1,true],['B','C',1,0,2,true],['D','A',1,0,2,true],['A','C','','',3,false],['D','B','','',3,false]]});
 for(const x of C.outcomes(rule))for(const y of C.outcomes(rule)){
  const os=[x,y],r=E.analyzeBounded(input,'A',os);assert.equal(r.complete,true);
  const count=o=>['D','PW','PL'].includes(o)?11:55;
  assert.equal(Object.keys(r.score_status).length,count(x)*count(y));
  for(const [key,status] of Object.entries(r.score_status)){
   const values=key.split(',').map(Number);assert(values.every(v=>v>=0&&v<=10));
   const ranked=C.rank(input.teams,[...input.completed,...input.remaining.map((m,i)=>[m.home,m.away,values[i*2],values[i*2+1],os[i]==='PW'?m.home:os[i]==='PL'?m.away:null])],rule);
   assert.equal(status,C.qualification(ranked.groups.find(g=>g.teams.includes('A')),2));
   assert.equal(S.classify(r,values.map(BigInt)),status);checks++;
  }
  assert.equal(S.classify(r,[11n,0n,1n,0n]),'incomplete');
 }
}
console.log(`Verified ${checks} bounded score combinations across five ranking rules in ${Date.now()-start}ms`);
