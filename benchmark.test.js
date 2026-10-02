const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({console,Map,Set,Number,Math});
vm.runInContext(fs.readFileSync('dist/benchmark.js','utf8'),context);
assert.equal(context.averageScore(300,300),70);
assert.equal(context.averageScore(600,300),90);
assert.equal(context.averageScore(150,300),35);
assert.equal(context.averageScore(450,300),80);
assert.equal(context.averageScore(750,300),100);
assert.equal(context.averageScore(30000,300),100);
assert.equal(context.averageScore(-1,300),null);
assert.equal(context.averageScore(undefined,300),null);
assert.equal(context.averageScore(0,300),0);
assert.equal(context.averageScore(0,0),null);
assert.equal(context.averageValues([50,null]),null);
assert.equal(context.placeCount([{type:{key:'culture'},items:[{id:'1'},{id:'2'}]},{type:{key:'karaoke'},items:[{id:'2'}]}],['culture','karaoke']),2);
const means={cctvCameras:300,facilities:4,convenience:50,parks:3,parkArea:10000,culture:20,attraction:5};
const scores=context.benchmarkScores({...means},means);
assert.ok(Object.values(scores).every(score=>score===70));
const doubled=context.benchmarkScores(Object.fromEntries(Object.entries(means).map(([key,value])=>[key,value*2])),means);
assert.ok(Object.values(doubled).every(score=>score===90));
assert.equal(context.benchmarkScores({parks:3,parkArea:0},means).환경,70);
assert.equal(context.benchmarkScores({parks:3,parkArea:999999999},means).환경,70);
assert.equal(context.benchmarkScores({parks:3},{parks:3}).환경,70);
assert.equal(context.benchmarkScores({parks:0},{parks:3}).환경,0);
assert.equal(context.benchmarkScores({parks:6},{parks:3}).환경,90);
assert.equal(context.benchmarkPhrase('CCTV',600,320.467638,'대'),'CCTV 현재 600대 · 평균 320대');
assert.equal(context.benchmarkPhrase('공원',6,7.0481,'곳'),'공원 현재 6곳 · 평균 7곳');
assert.equal(context.benchmarkPhrase('문화시설',20,19.6384,'곳'),'문화시설 현재 20곳 · 평균 20곳');
const elements={'#benchmarkStatus':{},'#benchmarkNote':{}};
context.document={querySelector:selector=>elements[selector]};
context.displayBenchmark({ready:true,radius:1000,dongCount:3430,excludedCount:125});
assert.equal(elements['#benchmarkStatus'].textContent,'1km 반경 · 3,430개 집계');
assert.ok(!elements['#benchmarkNote'].textContent.includes('제외'));
assert.equal(context.scoreBarWidth(null),0);
assert.equal(context.scoreBarWidth(undefined),0);
assert.equal(context.scoreBarWidth(71),71);
assert.equal(context.scoreBarWidth(200),100);
assert.equal(context.scoreBarWidth(-1),0);
const limitedGroups=[
  {type:{key:'convenience'},limited:true,items:Array.from({length:532},(_,id)=>({id:'p'+id}))},
  {type:{key:'culture'},limited:true,items:Array.from({length:81},(_,id)=>({id:'c'+id}))},
  {type:{key:'attraction'},limited:false,items:Array.from({length:20},(_,id)=>({id:'a'+id}))}
];
assert.equal(context.searchResultNote(limitedGroups,['convenience']),' (검색된 시설 기준)');
assert.equal(context.searchResultNote(limitedGroups,['attraction']),'');
const page=fs.readFileSync('dist/index.html','utf8');
for(const [index,match] of [...page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].entries())new vm.Script(match[1],{filename:'inline-'+index});
assert.ok(!page.includes("if(groups.some(group=>group.limited)){scores.생활편의=null"));
assert.ok(!page.includes("if(groups.some(group=>group.limited)){item.scores.생활편의=null"));
const model={};
context.latestNearbyAnalysis={radius:1000,counts:{cctvCameras:330,parks:2,facilities:0}};
context.latestKakaoPlaces=limitedGroups;
context.ensureBenchmark=async()=>({ready:true,radius:1000,dongCount:3430,means:{cctvCameras:320,parks:7,facilities:3,convenience:78,culture:20,attraction:4}});
context.ensureRegionModel=()=>model;
context.$=()=>({value:'테스트 지역'});
context.render=()=>{};
context.selectedAddress=null;
vm.runInContext(page.match(/async function applyCombinedPlaceScores\(\)[^\n]+/)[0],context);
context.applyCombinedPlaceScores().then(()=>{
  assert.equal(model.scores.생활편의,50); // 공공시설 0점 + 확인된 편의시설 100점의 평균
  assert.equal(model.scores['문화·여가'],100);
  assert.ok(Object.values(model.scores).every(Number.isFinite));
  assert.ok(model.comments.생활편의.includes('검색된 시설 기준'));
  assert.ok(!model.comments.환경.includes('검색된 시설 기준'));
  console.log('검색 한도 도달 시 현재 시설 수 점수 유지·분야별 안내·빈 점수 막대 검증 완료');
}).catch(error=>{console.error(error);process.exitCode=1;});
console.log('평균=70점, 두 배=90점, 100점 상한, 표본 부족, 중복 장소 제거 검증 완료');
