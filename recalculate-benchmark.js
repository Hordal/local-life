// Recalculate existing successful records without any new API calls.
const fs=require('node:fs');
const path=require('node:path');
const store=require('./benchmark-store');
const radius=Number(process.argv[2]||1000);
if(![500,1000,2000].includes(radius))throw Error('지원하지 않는 반경입니다.');
const data=store.state(radius),result=store.read(radius);
if(!data.finalization||!result.ready)throw Error('확정된 표본 기준만 재계산할 수 있습니다.');
if(data.finalization.weighting==='dong-equal')throw Error('이미 읍면동 동일 비중 기준으로 재계산했습니다.');
const target=path.join(__dirname,'data',`benchmark-${radius}.json`);
const stamp=new Date().toISOString();
const previousMeans=Object.fromEntries(Object.keys(result.means).map(key=>[key,result.cityMeans.reduce((sum,city)=>sum+city.means[key],0)/result.cityMeans.length]));
const backup=target.replace('.json',`.before-dong-mean-${stamp.replace(/[:.]/g,'-')}.json`);
fs.writeFileSync(backup,JSON.stringify({...data,previousBenchmark:{weighting:'city-equal',means:previousMeans}}),{flag:'wx'});
data.version=3;
data.finalization={...data.finalization,weighting:'dong-equal',method:result.method,recalculatedAt:stamp,previousWeighting:'city-equal',means:result.means,totals:result.totals};
data.updatedAt=stamp;
fs.writeFileSync(target+'.tmp',JSON.stringify(data));fs.renameSync(target+'.tmp',target);
console.log(JSON.stringify({radius,weighting:result.weighting,included:result.dongCount,excluded:result.excludedCount,means:result.means,backup}));
