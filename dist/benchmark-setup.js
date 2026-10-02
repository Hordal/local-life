let setupRunning=false,setupStop=false,setupList,setupDone;
const setupStatus=document.querySelector('#status'),setupLog=document.querySelector('#log'),setupRadius=document.querySelector('#radius');
function logSetup(message){setupLog.textContent=(message+'\n'+setupLog.textContent).slice(0,5000);}
async function setupJson(url,options={}) {
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(180000)}),data=await response.json();
  if(!response.ok)throw Error(data.error||'조회 실패');return data;
}
function setupProgress() {
  const progress=document.querySelector('#progress');progress.max=setupList.points.length;progress.value=setupDone.size;
  setupStatus.textContent=`${setupDone.size.toLocaleString()} / ${setupList.points.length.toLocaleString()}개 읍면동 저장 완료`;
}
async function loadSetup() {
  document.querySelector('#start').disabled=true;
  try{const data=await setupJson('/api/benchmark/setup?radius='+setupRadius.value);setupList=data.manifest;setupDone=new Set(data.completed);setupProgress();await refreshFinalization();}
  catch(error){setupStatus.textContent=error.message;}
}
async function refreshFinalization() {
  const result=await setupJson('/api/benchmark?radius='+setupRadius.value);
  document.querySelector('#start').disabled=Boolean(result.finalizedAt);
  document.querySelector('#finalize').disabled=setupRunning||Boolean(result.finalizedAt)||result.missingCities.length>0;
  document.querySelector('#finalizationStatus').textContent=result.finalizedAt?`평균 확정 완료: ${result.dongCount.toLocaleString()}개 집계 · ${result.cityCount}개 시군구`:`미완료 ${result.missing.length}개 · 완료 표본이 없는 시군구 ${result.missingCities.length}개`;
}
function setupCoordinates(address) {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('주소 좌표 조회 시간 초과')),30000);
    new kakao.maps.services.Geocoder().addressSearch(address,(items,status)=>{
      clearTimeout(timer);
      if(status!==kakao.maps.services.Status.OK || !items.length){reject(Error('주소 좌표를 확인하지 못했습니다.'));return;}
      resolve({latitude:Number(items[0].y),longitude:Number(items[0].x)});
    });
  });
}
function boundedSearch(type,location,radius) {
  let timer;
  return Promise.race([getKakaoPlaceResults(type,location,radius),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('장소 조회 시간 초과')),120000);})]).finally(()=>clearTimeout(timer));
}
async function runSetup() {
  if(setupRunning)return;
  setupRunning=true;setupStop=false;
  document.querySelector('#finalize').disabled=true;
  document.querySelector('#start').disabled=true;document.querySelector('#stop').disabled=false;setupRadius.disabled=true;
  const radius=Number(setupRadius.value);
  try {
    for(const point of setupList.points) {
      if(setupStop)break;if(setupDone.has(point.id))continue;
      setupStatus.textContent=`${point.id} 집계 중 · ${setupDone.size} / ${setupList.points.length}`;
      try {
        const coordinates=await setupCoordinates(point.address);
        const parameters=new URLSearchParams({region:point.region,...coordinates,radius,mode:'benchmark'});
        const nearby=await setupJson('/api/nearby-analysis?'+parameters);
        // 순차 검색으로 전국 최초 설정 시 순간 요청 수를 제한합니다.
        const groups=[];
        for(const type of kakaoPlaceTypes){groups.push(await boundedSearch(type,new kakao.maps.LatLng(coordinates.latitude,coordinates.longitude),radius));await new Promise(resolve=>setTimeout(resolve,150));}
        if(groups.some(group=>group.limited))throw Error('카카오 검색 한도 초과: 저장하지 않았습니다.');
        const measured=measuredCounts(nearby,groups),counts=Object.fromEntries(BenchmarkCore.metrics.map(key=>[key,measured[key]]));
        await setupJson('/api/benchmark/setup?radius='+radius,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:point.id,...coordinates,counts})});
        setupDone.add(point.id);setupProgress();
      } catch(error){logSetup(point.id+' · '+error.message);}
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    const result=await setupJson('/api/benchmark?radius='+radius);
    setupProgress();
    if(result.ready){setupStatus.textContent='전국 평균 저장 완료. 분석 화면을 새로고침하면 적용됩니다.';document.querySelector('#start').textContent='집계 완료';}
    else logSetup('아직 완료되지 않은 동이 있습니다. 이어하기를 누르면 해당 동만 다시 조회합니다.');
  } finally {
    setupRunning=false;document.querySelector('#start').disabled=false;document.querySelector('#stop').disabled=true;setupRadius.disabled=false;
    await refreshFinalization();
  }
}
async function initializeSetup() {
  try {
    const config=await setupJson('/api/map-config');
    await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://dapi.kakao.com/v2/maps/sdk.js?autoload=false&libraries=services&appkey='+encodeURIComponent(config.javascriptKey);script.onload=()=>kakao.maps.load(resolve);script.onerror=()=>reject(Error('카카오 지도 SDK를 불러오지 못했습니다.'));document.head.appendChild(script);});
    await loadSetup();
  } catch(error){setupStatus.textContent=error.message;}
}
document.querySelector('#start').onclick=()=>runSetup().catch(error=>{setupStatus.textContent=error.message;});
document.querySelector('#stop').onclick=()=>{setupStop=true;document.querySelector('#stop').disabled=true;};
document.querySelector('#finalize').onclick=async()=>{
  const button=document.querySelector('#finalize');button.disabled=true;
  try {
    const result=await setupJson('/api/benchmark?radius='+setupRadius.value);
    if(!confirm(`미완료 ${result.missing.length}개를 제외하고 ${result.dongCount}개 표본으로 기준을 확정할까요? 원본은 보존하고 이후 평균은 고정됩니다.`))return;
    await setupJson('/api/benchmark/setup?radius='+setupRadius.value+'&action=finalize',{method:'POST'});
    await refreshFinalization();setupStatus.textContent='완료 표본 기준으로 평균을 확정했습니다. 분석 화면을 새로고침해 주세요.';
  }catch(error){setupStatus.textContent=error.message;}
  finally{await refreshFinalization();}
};
setupRadius.onchange=loadSetup;
window.addEventListener('beforeunload',event=>{if(setupRunning){event.preventDefault();event.returnValue='';}});
initializeSetup();
