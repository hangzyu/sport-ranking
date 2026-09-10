const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const C=require('../src/ranking-core.js'),E=require('../src/qualification-engine.js');
const teams=['A','B','C','D'];
const matches=[['A','B',1,0],['A','C',1,1,'C'],['A','D',1,0],['B','C',1,1,'B'],['B','D',1,0],['C','D',1,0]];
for(const [rule,order,pts] of [['IV','ABCD',[6,5,5,0]],['V','ACBD',[7,5,6,0]]]){
 const r=C.rank(teams,matches,rule);assert.equal(r.groups.flatMap(g=>g.teams).join(''),order);
 assert.deepEqual(teams.map(t=>r.statistics[t].points),pts);
 assert.deepEqual(teams.map(t=>String(r.statistics[t].goals_for)),['3','2','3','0']);
 assert.equal(r.statistics.B.penalty_won,1);assert.equal(r.statistics.C.penalty_lost,1);
 assert.equal(C.rank([...teams].reverse(),[...matches].reverse(),rule).groups.flatMap(g=>g.teams).join(''),order);
 assert.throws(()=>C.rank(['A','B'],[['A','B',0,0]],rule),/点球/);
 assert.throws(()=>C.rank(['A','B'],[['A','B',0,0,'X']],rule),/点球/);
 assert.equal(C.rank(['A','B'],[['A','B',90071992547409930n,90071992547409930n,'B']],rule).groups[0].teams[0],'B');
}
assert.equal(C.rank(['A','B'],[['A','B',1,1]],'I').groups[0].rank,null);
const state={teams,qualifiers:2,method:'IV',cycle:'single',matches:[['A','B',1,0,1,true],['C','D',1,0,1,true],['A','D',1,0,2,true],['B','C',1,1,2,true,null,'B'],['A','C','','',3,false],['D','B','','',3,false]]};
const missing=structuredClone(state);missing.matches[3][7]=null;assert.throws(()=>E.fromState(missing),/点球/);
assert.equal(E.fromState(JSON.parse(JSON.stringify(state))).completed[3][4],'B');
const accepts=(clauses,scores)=>clauses.some(cs=>cs.every(c=>{const v=c.coefficients.reduce((sum,k,i)=>sum+BigInt(k)*BigInt(scores[i]),0n);return c.op==='='?v===BigInt(c.rhs):v>=BigInt(c.rhs)}));
(async()=>{
 const {Z3,em}=await require('../vendor/z3/z3-low-level.js').init(()=>require('../vendor/z3/z3-built.js')({wasmBinary:zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'../vendor/z3/z3-built.wasm.gz')))}));
 let cases=0,checked=0;
 try{
  const query=E.createOracle(Z3);
  for(const rule of ['IV','V']){
   const input=E.fromState({...state,method:rule});
   for(const target of teams)for(const x of C.outcomes(rule))for(const y of C.outcomes(rule)){
    const outcomes=[x,y],r=await E.analyze(input,target,outcomes,query);assert.equal(r.complete,true,`${rule} ${target} ${x}/${y}`);cases++;
    for(let k=0;k<5;k++){
     const scores=outcomes.flatMap((o,i)=>o==='W'?[k+i+1,i]:o==='L'?[i,k+i+1]:[k,k]);
     const actual=[...input.completed,...input.remaining.map((m,i)=>[m.home,m.away,scores[i*2],scores[i*2+1],outcomes[i]==='PW'?m.home:outcomes[i]==='PL'?m.away:null])];
     const ranked=C.rank(teams,actual,rule),expected=C.qualification(ranked.groups.find(g=>g.teams.includes(target)),2);
     assert.deepEqual(Object.entries(r.conditions_by_status).filter(([,cs])=>accepts(cs,scores)).map(([s])=>s),[expected]);checked++;
    }
   }
  }
  console.log(`Passed IV/V example, shootout validation, storage roundtrip, ${cases} exact scenarios and ${checked} score checks.`);
 }finally{em.PThread.terminateAllThreads()}
})().catch(e=>{console.error(e);process.exitCode=1});
