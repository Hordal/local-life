const fs=require('node:fs');
const path=require('node:path');
const {aggregate,validCounts}=require('./dist/benchmark-core');
const directory=path.join(__dirname,'data');
function manifest() {
  const target=path.join(directory,'benchmark-locations.json');
  if(!fs.existsSync(target))throw Error('읍면동 목록 준비가 필요합니다. npm run benchmark:prepare를 실행해 주세요.');
  return JSON.parse(fs.readFileSync(target,'utf8'));
}
function state(radius) {
  const target=path.join(directory,`benchmark-${radius}.json`);
  const list=manifest();
  if(!fs.existsSync(target))return {version:2,manifestVersion:list.version,records:{}};
  const result=JSON.parse(fs.readFileSync(target,'utf8'));
  if(result.manifestVersion!==list.version)throw Error('읍면동 목록 버전이 다릅니다. 기존 기준 파일을 별도 보관한 뒤 재집계해 주세요.');
  return result;
}
function read(radius) {
  const data=state(radius),result=aggregate(manifest(),data.records,radius,data.finalization?.excludedIds||[]);
  return {...result,updatedAt:data.updatedAt||null,finalizedAt:data.finalization?.finalizedAt||null,basis:result.excludedCount?'완료 표본 기준':'전체 집계 기준'};
}
function checkpoint(radius,record) {
  const list=manifest();
  if(!record||!list.points.some(point=>point.id===record.id)||!validCounts(record.counts))throw Error('유효하지 않은 읍면동 집계입니다.');
  if(!Number.isFinite(record.latitude)||!Number.isFinite(record.longitude)||record.latitude<32||record.latitude>39||record.longitude<124||record.longitude>132)throw Error('대표 위치 좌표를 확인해 주세요.');
  const data=state(radius);
  if(data.finalization)throw Error('이미 확정된 평균입니다. 저장된 기준은 변경하지 않습니다.');
  // 완료된 동은 재방문/새로고침으로 덮어쓰지 않습니다.
  if(!data.records[record.id])data.records[record.id]={...record,radius,collectedAt:new Date().toISOString()};
  data.updatedAt=new Date().toISOString();
  const target=path.join(directory,`benchmark-${radius}.json`),temporary=target+'.tmp';
  fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(temporary,JSON.stringify(data));fs.renameSync(temporary,target);
  return {saved:true,completed:Object.keys(data.records).length,total:list.points.length};
}
function finalize(radius) {
  if(![500,1000,2000].includes(radius))throw Error('지원하지 않는 분석 반경입니다.');
  const list=manifest(),data=state(radius);
  if(data.finalization)return read(radius);
  const result=aggregate(list,data.records,radius);
  if(!result.dongCount || result.missingCities.length)throw Error('완료 표본이 없는 시군구가 있어 평균을 확정할 수 없습니다.');
  const now=new Date().toISOString();
  data.finalization={finalizedAt:now,excludedIds:result.missing,reason:'사용자가 미완료 읍면동 제외를 선택함',includedDongCount:result.dongCount,totalDongCount:result.totalDongCount,cityCount:result.cityCount,weighting:'dong-equal',method:result.method};
  const target=path.join(directory,`benchmark-${radius}.json`),temporary=target+'.tmp';
  // 확정 전 데이터를 복사해 보관합니다. 원본 목록과 성공한 집계는 삭제하지 않습니다.
  const backup=path.join(directory,`benchmark-${radius}.before-finalize-${now.replace(/[:.]/g,'-')}.json`);
  fs.writeFileSync(backup,JSON.stringify(state(radius)));
  data.updatedAt=now;fs.writeFileSync(temporary,JSON.stringify(data));fs.renameSync(temporary,target);
  return read(radius);
}
module.exports={manifest,state,read,checkpoint,finalize};
