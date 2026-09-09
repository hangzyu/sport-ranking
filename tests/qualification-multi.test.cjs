const assert=require('node:assert/strict'),fs=require('node:fs'),zlib=require('node:zlib'),path=require('node:path');
const E=require('../src/qualification-engine.js'),C=require('../src/ranking-core.js');
function schedule(teams,cycle='single'){
  const ring=[...teams];if(ring.length%2)ring.push(null);const rounds=[];
  for(let r=1;r<ring.length;r++){for(let i=0;i<ring.length/2;i++){const a=ring[i],b=ring[ring.length-1-i];if(a&&b)rounds.push([a,b,r===ring.length-1?'':0,r===ring.length-1?'':0,r,r!==ring.length-1])}ring.splice(1,0,ring.pop())}
  if(cycle==='double'){const first=rounds.map(m=>[...m.slice(0,2),0,0,m[4],true]);return [...first,...rounds.map(m=>[m[1],m[0],m[2],m[3],m[4]+ring.length-1,m[5]])]}
  return rounds;
}
(async()=>{
  const {Z3,em}=await require('../vendor/z3/z3-low-level.js').init(()=>require('../vendor/z3/z3-built.js')({wasmBinary:zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'../vendor/z3/z3-built.wasm.gz')))}));
  try{
    const query=E.createOracle(Z3);
    for(const teams of [['A','B','C','D','E','F'],['A','B','C'],['A','B','C','D']])for(const cycle of ['single','double']){
      const state={teams,qualifiers:2,method:'II',cycle,matches:schedule(teams,cycle)},input=E.fromState(state),outcomes=input.remaining.map(()=> 'W');
      const report=await E.analyze(input,'A',outcomes,query);assert.equal(report.complete,true);
      for(const k of [1,2,100000]){
        const scores=input.remaining.flatMap((_,i)=>[BigInt(k+i),0n]),rank=C.rank(teams,[...input.completed,...input.remaining.map((m,i)=>[m.home,m.away,scores[i*2],scores[i*2+1]])],'II'),expected=C.qualification(rank.groups.find(g=>g.teams.includes('A')),2);
        const actual=Object.entries(report.conditions_by_status).filter(([,cs])=>cs.some(conj=>conj.every(c=>{const value=c.coefficients.reduce((v,co,i)=>v+BigInt(co)*scores[i],0n);return c.op==='='?value===BigInt(c.rhs):value>=BigInt(c.rhs)}))).map(([s])=>s);
        assert.deepEqual(actual,[expected]);
      }
    }
    console.log('Passed six-team, bye-round and double round-robin qualification cases.');
  }finally{em.PThread.terminateAllThreads()}
})().catch(error=>{console.error(error);process.exitCode=1});
