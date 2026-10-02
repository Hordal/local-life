(function(root) {
  const metrics=['cctvCameras','parks','facilities','convenience','culture','attraction'];
  const method='완료된 읍면동 대표 위치의 동일 반경 시설 수 합계 ÷ 완료 읍면동 수 (읍면동 동일 비중)';
  function validCounts(counts) { return counts && metrics.every(key=>typeof counts[key]==='number' && Number.isFinite(counts[key]) && counts[key]>=0); }
  function aggregate(manifest, records, radius, excludedIds=[]) {
    const cities=new Map(), missing=[];
    for(const point of manifest.points) {
      const record=records[point.id];
      if(!record || record.radius!==radius || !validCounts(record.counts)) {missing.push(point.id);continue;}
      if(!cities.has(point.region))cities.set(point.region,[]);
      cities.get(point.region).push(record.counts);
    }
    const excludedSet=new Set(excludedIds);
    const excluded=missing.filter(id=>excludedSet.has(id));
    const unresolved=missing.filter(id=>!excludedSet.has(id));
    const expectedCities=[...new Set(manifest.points.map(point=>point.region))];
    const missingCities=expectedCities.filter(region=>!cities.has(region));
    // 제외 확정은 명시적으로 저장한 목록에만 적용하고, 모든 시군구가 참여해야 합니다.
    const ready=manifest.points.length>0 && unresolved.length===0 && missingCities.length===0;
    const cityMeans=[...cities].map(([region,rows])=>({region,dongCount:rows.length,means:Object.fromEntries(metrics.map(key=>[key,rows.reduce((sum,row)=>sum+row[key],0)/rows.length]))}));
    const includedRows=[...cities.values()].flat();
    const totals=Object.fromEntries(metrics.map(key=>[key,includedRows.reduce((sum,row)=>sum+row[key],0)]));
    const means=Object.fromEntries(metrics.map(key=>[key,ready?totals[key]/includedRows.length:null]));
    return {version:3,weighting:'dong-equal',radius,ready,means,totals,cityMeans,dongCount:includedRows.length,totalDongCount:manifest.points.length,cityCount:cityMeans.length,totalCityCount:expectedCities.length,missing,excluded,excludedCount:excluded.length,unresolved,missingCities,coverage:manifest.points.length?includedRows.length/manifest.points.length:0,method,source:manifest.source,manifestVersion:manifest.version};
  }
  const api={metrics,method,validCounts,aggregate};
  if(typeof module!=='undefined' && module.exports)module.exports=api;
  else root.BenchmarkCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
