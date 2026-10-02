const benchmarkPromises = new Map();
function placeCount(groups, keys) {
  return new Set(groups.filter(group=>keys.includes(group.type.key)).flatMap(group=>group.items.map(item=>item.id||`${item.place_name}|${item.x}|${item.y}`))).size;
}
function averageScore(value, mean) {
  if (!Number.isFinite(mean) || mean <= 0 || !Number.isFinite(value) || value < 0) return null;
  const ratio=value/mean;
  // 평균 이하: 0~70점. 평균 이상: 1배 70점, 2배 90점, 2.5배부터 100점.
  return Math.round(Math.min(100,ratio<=1?70*ratio:70+20*(ratio-1)));
}
function averageValues(values) {
  return values.every(Number.isFinite) ? Math.round(values.reduce((sum,value)=>sum+value,0)/values.length) : null;
}
function scoreBarWidth(score) {
  return Number.isFinite(score)?Math.max(0,Math.min(100,score)):0;
}
function searchResultNote(groups, keys) {
  return groups.some(group=>keys.includes(group.type.key)&&group.limited)?' (검색된 시설 기준)':'';
}
function measuredCounts(nearby, groups) {
  return {...nearby.counts,convenience:placeCount(groups,['convenience','hospital','pharmacy']),culture:placeCount(groups,['culture','karaoke']),attraction:placeCount(groups,['attraction'])};
}
function benchmarkScores(counts, means) {
  return {안전:averageScore(counts.cctvCameras,means.cctvCameras),생활편의:averageValues([averageScore(counts.facilities,means.facilities),averageScore(counts.convenience,means.convenience)]),환경:averageScore(counts.parks,means.parks),'문화·여가':averageValues([averageScore(counts.culture,means.culture),averageScore(counts.attraction,means.attraction)])};
}
function benchmarkPhrase(name,value,mean,unit) {
  const average=Number.isFinite(mean)?mean.toLocaleString('ko-KR',{maximumFractionDigits:0})+unit:'확인 불가';
  return `${name} 현재 ${value.toLocaleString()}${unit} · 평균 ${average}`;
}
async function ensureBenchmark(radius) {
  if(benchmarkPromises.has(radius))return benchmarkPromises.get(radius);
  const pending=(async()=>{
    const response=await fetch('/api/benchmark?radius='+radius),base=await response.json();
    if(!response.ok)throw Error(base.error||'전국 기준을 불러오지 못했습니다.');
    // 전국 집계는 설정 화면에서만 실행합니다. 일반 분석에서는 저장값만 조회합니다.
    return base;
  })();
  benchmarkPromises.set(radius,pending);
  try{const result=await pending;if(!result.ready)benchmarkPromises.delete(radius);return result;}catch(error){benchmarkPromises.delete(radius);throw error;}
}
function displayBenchmark(benchmark) {
  const status=document.querySelector('#benchmarkStatus');
  if(status)status.textContent=benchmark.ready?`${benchmark.radius/1000}km 반경 · ${benchmark.dongCount.toLocaleString()}개 집계`:`최초 집계 ${benchmark.dongCount.toLocaleString()} / ${benchmark.totalDongCount.toLocaleString()}개 읍면동`;
  const note=document.querySelector('#benchmarkNote');
  if(note)note.textContent=benchmark.ready?`완료된 ${benchmark.dongCount.toLocaleString()}개 읍면동의 시설 수 합계를 읍면동 수로 나눈 평균과 비교합니다.`:'전국 기준을 준비 중입니다. 현재 시설 개수는 그대로 확인할 수 있습니다.';
}
