const assert=require('node:assert/strict');
const {aggregate,metrics,validCounts}=require('./dist/benchmark-core');
const {csvRows}=require('./prepare-benchmark');
const list={version:'test',source:'test only',points:[{id:'a1',region:'A시'},{id:'a2',region:'A시'},{id:'a3',region:'A시'},{id:'b1',region:'B군'}]};
const counts=value=>Object.fromEntries(metrics.map(key=>[key,value]));
const records=Object.fromEntries([['a1',100],['a2',200],['a3',300],['b1',0]].map(([id,value])=>[id,{radius:1000,counts:counts(value)}]));
const result=aggregate(list,records,1000);
assert.equal(result.ready,true);assert.equal(result.means.cctvCameras,150); // (100 + 200 + 300 + 0) / 4
assert.equal(result.totals.cctvCameras,600);assert.equal(result.weighting,'dong-equal');
const example={version:'example',points:[...list.points,{id:'b2',region:'B군'}]};
const exampleRecords={...records,b1:{radius:1000,counts:counts(20)},b2:{radius:1000,counts:counts(40)}};
assert.equal(aggregate(example,exampleRecords,1000).means.cctvCameras,132); // PPTの5개 동 예시
assert.equal(result.cityCount,2);
delete records.b1;
const incomplete=aggregate(list,records,1000);
assert.equal(incomplete.ready,false);assert.equal(incomplete.means.cctvCameras,null);
assert.equal(aggregate(list,records,1000,['b1']).ready,false); // 시군구 전체가 빠지면 제외 확정도 불가
records.b1={radius:1000,counts:counts(0)};
delete records.a3;
const sampled=aggregate(list,records,1000,['a3']);
assert.equal(sampled.ready,true);assert.equal(sampled.means.cctvCameras,100);
assert.equal(sampled.excludedCount,1);assert.equal(sampled.dongCount,3);
assert.equal(sampled.totalDongCount,4);assert.equal(sampled.cityCount,2);
assert.equal(aggregate(list,records,1000).ready,false); // 다른 반경이나 미확정 표본 자동 허용 금지
assert.equal(aggregate(list,records,500).dongCount,0);
assert.equal(aggregate({points:[]},records,1000).ready,false);
assert.equal(validCounts({...counts(1),convenience:null}),false);
assert.equal(validCounts({...counts(1),parks:-1}),false);
assert.deepEqual(csvRows('시도,주소\r\n서울,"길 1, 2"\r\n'),[['시도','주소'],['서울','길 1, 2']]);
console.log('전체 시설 합계 ÷ 완료 읍면동 수, 실제 0과 누락, 반경 분리, CSV 인용 처리 검증 완료');

// 저장 테스트는 메모리 파일시스템에서 수행하여 실제 전국 기준에 예시 데이터를 섞지 않습니다.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const directory=path.join(__dirname,'data'),files=new Map([[path.join(directory,'benchmark-locations.json'),JSON.stringify(list)]]);
const fakeFs={existsSync:file=>files.has(file),readFileSync:file=>files.get(file),mkdirSync:()=>{},writeFileSync:(file,value)=>files.set(file,value),renameSync:(from,to)=>{files.set(to,files.get(from));files.delete(from);}};
function loadStore(){const context={module:{exports:{}},__dirname,require:name=>name==='node:fs'?fakeFs:name==='node:path'?path:require(name)};vm.runInNewContext(fs.readFileSync('benchmark-store.js','utf8'),context);return context.module.exports;}
let store=loadStore();
for(const [id,value] of [['a1',100],['a2',200],['a3',300],['b1',0]])store.checkpoint(1000,{id,latitude:37,longitude:127,counts:counts(value)});
store=loadStore();assert.equal(store.read(1000).means.cctvCameras,150);
store.checkpoint(1000,{id:'a1',latitude:37,longitude:127,counts:counts(999)});
assert.equal(store.read(1000).means.cctvCameras,150);
assert.equal(store.read(500).ready,false);
assert.throws(()=>store.checkpoint(1000,{id:'없음',counts:counts(0)}));
console.log('서버 재시작 후 저장 기준 유지·완료 동 덮어쓰기 방지·반경별 저장 분리 검증 완료');
const stored=JSON.parse(files.get(path.join(directory,'benchmark-1000.json')));
delete stored.records.a3;
files.set(path.join(directory,'benchmark-1000.json'),JSON.stringify(stored));
const finalized=store.finalize(1000);
assert.equal(finalized.ready,true);assert.equal(finalized.excludedCount,1);
assert.equal(finalized.means.cctvCameras,100);
assert.equal(store.read(500).ready,false);
assert.equal(store.finalize(1000).finalizedAt,finalized.finalizedAt);
assert.throws(()=>store.checkpoint(1000,{id:'a3',latitude:37,longitude:127,counts:counts(500)}));
assert.throws(()=>store.finalize(500));
assert.throws(()=>store.finalize(123));
assert.equal([...files.keys()].filter(file=>file.includes('before-finalize')).length,1);
console.log('미완료 동 제외·시군구 유지·확정 기준 고정·반경별 분리·원본 백업 검증 완료');
