const fs=require('node:fs');
const path=require('node:path');
// 공개 CSV를 정규화하는 기계적 변환입니다. 원본은 수정하지 않습니다.
function csvRows(text) {
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(c===','&&!quoted){row.push(cell);cell='';}
    else if(c==='\n'&&!quoted){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}
  return rows;
}
async function prepare() {
  const source='https://www.data.go.kr/data/15059715/fileData.do';
  const pageResponse=await fetch(source);if(!pageResponse.ok)throw Error('공식 데이터 페이지를 불러오지 못했습니다.');
  const page=await pageResponse.text(),download=page.match(/"contentUrl"\s*:\s*"(https:\/\/www\.data\.go\.kr\/cmm\/cmm\/fileDownload\.do[^\"]+)"/);
  if(!download)throw Error('공식 CSV 다운로드 주소를 확인하지 못했습니다.');
  const response=await fetch(download[1].replace(/&amp;/g,'&'));if(!response.ok)throw Error('읍면동 CSV 다운로드 실패');
  const bytes=await response.arrayBuffer();let text=new TextDecoder('utf-8').decode(bytes);
  if(!text.includes('시군구'))text=new TextDecoder('euc-kr').decode(bytes);
  const rows=csvRows(text.replace(/^\uFEFF/,'')),headers=rows.shift().map(value=>value.trim());
  for(const field of ['시도','시군구','읍면동','주소'])if(!headers.includes(field))throw Error('CSV 필수 항목 누락: '+field);
  const points=new Map();let officeRows=0;
  for(const row of rows) {
    if(row.every(value=>!value.trim()))continue;
    const item=Object.fromEntries(headers.map((key,index)=>[key,(row[index]||'').trim()]));
    if(!item.시도||!item.읍면동||!item.주소)throw Error('주소 또는 읍면동 항목이 누락된 행이 있습니다.');
    // 일반 시의 행정구(수원시 권선구 등)는 시 하나로 묶고, 광역시 자치구는 유지합니다.
    const district=item.시군구.split(/\s+/)[0],region=[item.시도,district].filter(Boolean).join(' ');
    const dong=item.읍면동.replace(/\s*(행정복지센터|주민센터|동사무소|읍사무소|면사무소)\s*$/,'').trim(),id=[item.시도,item.시군구,dong].join(' ');
    officeRows++;
    if(!points.has(id))points.set(id,{id,region,dong,address:item.주소});
  }
  if(points.size<3000)throw Error('전국 목록으로 보기에는 읍면동 수가 부족합니다. 파일을 확인해 주세요.');
  const data={version:'mois-'+new Date().toISOString().slice(0,10),source,downloadUrl:download[1],preparedAt:new Date().toISOString(),officeRows,points:[...points.values()]};
  const target=path.join(__dirname,'data','benchmark-locations.json');
  if(fs.existsSync(target)){
    if(!process.argv.includes('--refresh')){console.log('기존 읍면동 목록을 유지합니다.');return;}
    if([500,1000,2000].some(radius=>fs.existsSync(path.join(__dirname,'data',`benchmark-${radius}.json`))))throw Error('저장된 집계가 있어 목록을 덮어쓰지 않습니다.');
  }
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(data,null,2));
  console.log(`전국 ${points.size}개 읍면동 · ${new Set(data.points.map(point=>point.region)).size}개 시군구 목록 준비 완료`);
}
if(require.main===module)prepare().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={csvRows};
