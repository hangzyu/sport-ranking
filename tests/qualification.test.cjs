const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),C=require('../src/ranking-core.js'),E=require('../src/qualification-engine.js');
const state={teams:['J','U','V','A'],method:'I',qualifiers:2,cycle:'single',matches:[['J','U',4,1,1,true],['A','V',1,1,1,true],['J','V',1,1,2,true],['U','A',2,0,2,true],['J','A','','',3,false],['V','U','','',3,false]]};
const out=(a,b)=>a>b?'W':a<b?'L':'D';
function includes(clauses,scores){return clauses.some(cs=>cs.every(c=>{const value=c.coefficients.reduce((sum,co,i)=>sum+BigInt(co)*BigInt(scores[i]),0n);return c.op==='='?value===BigInt(c.rhs):value>=BigInt(c.rhs)}))}
function status(report,scores){const matches=Object.entries(report.conditions_by_status).filter(([,cs])=>includes(cs,scores)).map(([status])=>status);assert.equal(matches.length,1,'Each score has exactly one qualification status');return matches[0]}
function actual(input,target,scores){const ranking=C.rank(input.teams,[...input.completed,...input.remaining.map((m,i)=>[m.home,m.away,scores[i*2],scores[i*2+1]])],input.rule);return C.qualification(ranking.groups.find(g=>g.teams.includes(target)),input.topK)}
(async()=>{
  const fixtures=[['A','B',3,0],['A','C',1,2],['B','C',2,0],['A','D',1,0],['B','D',1,0],['C','D',5,0]];
  for(const [rule,expected] of [['I','ACBD'],['II','ABCD'],['III','CABD']])assert.equal(C.rank(['A','B','C','D'],fixtures,rule).groups.flatMap(g=>g.teams).join(''),expected);
  const invalid=structuredClone(state);invalid.matches[0][5]=false;assert.throws(()=>E.fromState(invalid),/前几轮/);
  const absent=structuredClone(state);absent.matches.shift();assert.throws(()=>E.fromState(absent),/不完整/);
  const blank=structuredClone(state);blank.matches[0][2]='';assert.throws(()=>E.fromState(blank),/非负整数/);
  assert.throws(()=>C.rank(['A','B'],[['A','B',-1,0]],'I'),/非负/);
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.equal((html.match(/function renderSimulation\(/g)||[]).length,1);assert.equal((html.match(/function compute\(/g)||[]).length,1);
  for(const old of ['reverseQualificationMany','scoresForResult','qualificationText','function compareGroup'])assert.ok(!html.includes(old),'Obsolete simulation code removed: '+old);
  const {Z3,em}=await require('../vendor/z3/z3-low-level.js').init(()=>require('../vendor/z3/z3-built.js')({wasmBinary:zlib.gunzipSync(fs.readFileSync(path.join(root,'vendor/z3/z3-built.wasm.gz')))}));
  try{
    const query=E.createOracle(Z3),reports={};let checked=0;
    for(const rule of ['I','II','III']){
      const input=E.fromState({...state,method:rule});reports[rule]={};
      for(const target of state.teams){
        const cells={};reports[rule][target]=cells;
        for(const x of ['W','D','L'])for(const y of ['W','D','L']){const r=await E.analyze(input,target,[x,y],query);assert.equal(r.complete,true,`${rule} ${target} ${x},${y}`);cells[x+y]=r;}
        for(let a=0;a<5;a++)for(let b=0;b<5;b++)for(let c=0;c<5;c++)for(let d=0;d<5;d++){
          const scores=[a,b,c,d],r=cells[out(a,b)+out(c,d)];assert.equal(status(r,scores),actual(input,target,scores),`${rule} ${target} ${scores}`);checked++;
        }
      }
    }
    for(const [rule,expected] of [['I','pending'],['II','eliminated'],['III','eliminated']])assert.equal(status(reports[rule].A.LD,[2,3,1,1]),expected);
    for(const rule of ['I','II','III'])for(const scores of [[1000000,1000001,9999999,9999999],[1000000,1000002,0,0],[900719925474099300n,900719925474099301n,1n,1n]])assert.equal(status(reports[rule].A.LD,scores),actual(E.fromState({...state,method:rule}),'A',scores));
    const incomplete=await E.analyze(E.fromState(state),'A',['L','D'],query,{maxRegions:1});assert.equal(incomplete.complete,false);assert.equal(incomplete.summary,'incomplete');
    assert.equal(status(reports.I.J.DW,[2,2,5,2]),'qualified');
    const noGames=structuredClone(state);noGames.matches[4]=['J','A',2,3,3,true];noGames.matches[5]=['V','U',1,1,3,true];assert.equal(E.fromState(noGames).remaining.length,0);
    if(process.env.RANKING_TEST_REPORT)fs.writeFileSync(process.env.RANKING_TEST_REPORT,JSON.stringify(reports));
    console.log(`Passed shared ranking rules, 108 exact scenarios, ${checked} concrete cross-checks, arbitrary-size scores, missing data and incomplete proof cases.`);
  }finally{em.PThread.terminateAllThreads()}
})().catch(error=>{console.error(error);process.exitCode=1});
