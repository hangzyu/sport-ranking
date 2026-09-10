const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const C=require('../src/ranking-core.js'),E=require('../src/qualification-engine.js');
const teams=['A','B','C','D'];
const fixtures=[['A','B',3,0],['A','C',3,4],['B','C',2,0],['A','D',1,0],['B','D',1,0],['C','D',1,0]];
// A/B/C have 6 points. H2H GD: A +2, B -1, C -1.
// Original-scope GF favors C (4 versus 2), but B beat C 2-0.
const order=r=>r.groups.flatMap(g=>g.teams).join('');
assert.equal(order(C.rank(teams,fixtures,'I')),'ACBD');
assert.equal(order(C.rank(teams,fixtures,'II')),'ABCD');
assert.equal(order(C.rank(teams,fixtures,'III')),'ACBD');
const h2h=C.rank(teams,fixtures,'II').trace.filter(s=>s.scope==='head_to_head');
assert.deepEqual(h2h.map(s=>s.criterion),['points','goal_difference','points']);
assert.deepEqual(h2h[2].scope_teams,['B','C']);
assert.deepEqual(h2h[2].values,{B:3,C:0});
for(const ts of [teams,[...teams].reverse(),['C','A','D','B']])assert.equal(order(C.rank(ts,[...fixtures].reverse(),'II')),'ABCD');
// Screenshot data: A +1, B/D 0, C -1. A-C and D-B draw.
// Reapplying B-D gives equal H2H values, so OVERALL GF still puts B second.
const screenshot=[['A','B',2,0],['D','A',1,0],['B','C',2,0],['C','D',1,0],['A','C',0,0],['D','B',0,0]];
const r=C.rank(teams,screenshot,'II');assert.equal(order(r),'ABDC');
const trace=r.trace;
const gd=trace.findIndex(s=>s.scope==='head_to_head'&&s.scope_teams.length===4&&s.criterion==='goal_difference');
assert.deepEqual(trace.slice(gd+1,gd+4).map(s=>[s.scope_teams,s.criterion]),[[['B','D'],'points'],[['B','D'],'goal_difference'],[['B','D'],'goals_for']]);
assert.equal(trace[gd+4].scope,'overall');assert.equal(trace[gd+5].criterion,'goals_for');
const allDraws=teams.flatMap((a,i)=>teams.slice(i+1).map(b=>[a,b,0,0]));
assert.equal(C.rank(teams,allDraws,'II').groups[0].status,C.PENDING);
(async()=>{
 const {Z3,em}=await require('../vendor/z3/z3-low-level.js').init(()=>require('../vendor/z3/z3-built.js')({wasmBinary:zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'../vendor/z3/z3-built.wasm.gz')))}));
 try{
  const input=E.fromState({teams,method:'II',qualifiers:2,cycle:'single',matches:[['A','B',3,0,1,true],['C','D',1,0,1,true],['A','D',1,0,2,true],['B','C',2,0,2,true],['A','C','','',3,false],['B','D','','',3,false]]});
  const report=await E.analyze(input,'B',['L','W'],E.createOracle(Z3));assert.equal(report.complete,true);
  const scores=[3n,4n,1n,0n];
  const accepts=groups=>groups.some(g=>g.every(c=>{const v=c.coefficients.reduce((a,k,i)=>a+BigInt(k)*scores[i],0n);return c.op==='='?v===BigInt(c.rhs):v>=BigInt(c.rhs)}));
  assert.equal(accepts(report.conditions_by_status.qualified),true);
  assert.equal(accepts(report.conditions_by_status.eliminated),false);
  assert.equal(accepts(report.conditions_by_status.pending),false);
  console.log('Passed immediate GD restart, changed qualification, fixed-scope I/III, fallback, unresolved and exact symbolic conditions.');
 }finally{em.PThread.terminateAllThreads()}
})().catch(e=>{console.error(e);process.exitCode=1});
