const http = require('http');
const fs = require('fs');
const path = require('path');

// API 키는 .env 파일에서만 읽습니다. 브라우저 코드에 넣지 마세요.
function loadEnvironment() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvironment();

// 환경변수가 없으면 프로젝트에 포함된 CSV를 사용합니다.
process.env.CRIME_CSV_PATH ||= path.join(__dirname, 'data', 'crime.csv');
process.env.CCTV_CSV_PATH ||= path.join(__dirname, 'data', 'cctv.csv');

const startingPort = Number(process.env.PORT || 5173);
const publicDir = path.join(__dirname, 'dist');
const facilityApiUrl = 'https://api.data.go.kr/openapi/tn_pubr_public_pblfclt_opn_info_api';
const parkApiUrl = 'https://api.data.go.kr/openapi/tn_pubr_public_cty_park_info_api';
const sportsApiUrl = 'https://apis.data.go.kr/B551014/SRVC_API_SFMS_FACI/TODZ_API_SFMS_FACI';
let facilityCache;
let parkCache;
let safetyCache;
let crimeRegionCache;
let crimeMedianCache;
const sportsCache = new Map();
const benchmarkStore = require('./benchmark-store');
async function getBenchmark(radius) { return benchmarkStore.read(radius); }
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function addressOf(item) {
  return `${item.rdnmadr || ''} ${item.lnmadr || ''} ${item.institutionNm || ''}`.trim();
}

function regionParts(region) {
  const words = String(region || '').trim().split(/\s+/).filter(Boolean);
  return { province: words.length > 1 ? words[0] : '', district: words.at(-1) || '' };
}

function matchesRegion(address, region) {
  const { province, district } = regionParts(region);
  if (!district) return false;
  if (!province) return address.includes(district);
  const provinceNames = {
    서울: ['서울', '서울특별시'], 부산: ['부산', '부산광역시'], 대구: ['대구', '대구광역시'], 인천: ['인천', '인천광역시'], 광주: ['광주', '광주광역시'], 대전: ['대전', '대전광역시'], 울산: ['울산', '울산광역시'], 세종시: ['세종', '세종특별자치시']
  };
  const allowedProvinces = provinceNames[province] || [province];
  return address.includes(district) && allowedProvinces.some((name) => address.includes(name));
}

function distanceInMeters(latitudeA, longitudeA, latitudeB, longitudeB) {
  const toRadians = (value) => value * Math.PI / 180;
  const earthRadius = 6371000;
  const latitudeDistance = toRadians(latitudeB - latitudeA);
  const longitudeDistance = toRadians(longitudeB - longitudeA);
  const value = Math.sin(latitudeDistance / 2) ** 2 + Math.cos(toRadians(latitudeA)) * Math.cos(toRadians(latitudeB)) * Math.sin(longitudeDistance / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function coordinatesOf(item, latitudeKey = 'latitude', longitudeKey = 'longitude') {
  const latitude = Number(item[latitudeKey]);
  const longitude = Number(item[longitudeKey]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

function findNearby(rows, latitude, longitude, radius, toItem) {
  const nearby = [];
  for (const row of rows) {
    const item = toItem(row);
    if (!item) continue;
    // 먼 위치는 삼각함수 계산 전에 제외합니다.
    if(Math.abs(item.latitude-latitude)>radius/110000 || Math.abs(item.longitude-longitude)>radius/(110000*Math.cos(latitude*Math.PI/180)))continue;
    const distance = distanceInMeters(latitude, longitude, item.latitude, item.longitude);
    if (distance <= radius) nearby.push({ ...item, distance: Math.round(distance) });
  }
  nearby.sort((left, right) => left.distance - right.distance);
  return nearby;
}

function getCrimeRegions() {
  if (!crimeRegionCache) {
    const crime = readKoreanCsv(process.env.CRIME_CSV_PATH);
    crimeRegionCache = crime.header.slice(2).filter((name) => name && !name.startsWith('외국 '));
  }
  return crimeRegionCache;
}

function getCrimeMedian() {
  if (crimeMedianCache) return crimeMedianCache;
  const crime = readKoreanCsv(process.env.CRIME_CSV_PATH);
  const totals = crime.header.slice(2).filter((name) => name && !name.startsWith('외국 ')).map((region) => {
    const column = crime.header.indexOf(region);
    return crime.rows.reduce((sum, line) => sum + Number(parseCsvLine(line)[column] || 0), 0);
  }).sort((left, right) => left - right);
  crimeMedianCache = totals[Math.floor(totals.length / 2)] || 1;
  return crimeMedianCache;
}

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; } else quoted = !quoted;
    } else if (character === ',' && !quoted) { values.push(value); value = ''; } else value += character;
  }
  values.push(value);
  return values;
}

function readKoreanCsv(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    const error = new Error('CSV 파일 경로를 찾을 수 없습니다. .env의 파일 경로를 확인해 주세요.');
    error.statusCode = 503;
    throw error;
  }
  const text = new TextDecoder('euc-kr').decode(fs.readFileSync(filePath));
  const lines = text.split(/\r?\n/).filter(Boolean);
  return { header: parseCsvLine(lines[0]), rows: lines.slice(1) };
}

function getSafety(region) {
  if (!safetyCache) {
    const crime = readKoreanCsv(process.env.CRIME_CSV_PATH);
    const cctv = readKoreanCsv(process.env.CCTV_CSV_PATH);
    const cctvIndex = {
      roadAddress: cctv.header.indexOf('소재지도로명주소'),
      lotAddress: cctv.header.indexOf('소재지지번주소'),
      cameras: cctv.header.indexOf('카메라대수'),
      latitude: cctv.header.indexOf('WGS84위도'),
      longitude: cctv.header.indexOf('WGS84경도')
    };
    safetyCache = { crime, cctv, cctvIndex, byRegion: new Map() };
  }
  if (safetyCache.byRegion.has(region)) return safetyCache.byRegion.get(region);
  const crimeColumn = safetyCache.crime.header.findIndex((name) => name === region || name.endsWith(` ${region}`));
  if (crimeColumn < 0) {
    const error = new Error(`${region}에 해당하는 범죄 통계 열을 찾지 못했습니다.`);
    error.statusCode = 404;
    throw error;
  }
  const crimeByCategory = new Map();
  const reportedCrimeCount = safetyCache.crime.rows.reduce((sum, line) => {
    const row = parseCsvLine(line);
    const count = Number(row[crimeColumn] || 0);
    const category = row[0] || '기타 범죄';
    crimeByCategory.set(category, (crimeByCategory.get(category) || 0) + count);
    return sum + count;
  }, 0);
  let locations = 0;
  let cameras = 0;
  for (const line of safetyCache.cctv.rows) {
    const row = parseCsvLine(line);
    const address = `${row[safetyCache.cctvIndex.roadAddress] || ''} ${row[safetyCache.cctvIndex.lotAddress] || ''}`;
    if (!matchesRegion(address, region)) continue;
    locations += 1;
    cameras += Number(row[safetyCache.cctvIndex.cameras] || 0);
  }
  const result = { source: '경찰청 범죄 발생 지역별 통계(2024) · 전국CCTV표준데이터 CSV', reportedCrimeCount, crimeBreakdown: [...crimeByCategory.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count), cctvLocations: locations, cctvCameras: cameras };
  safetyCache.byRegion.set(region, result);
  return result;
}

async function getFacilities(region) {
  const cached = facilityCache;
  let allRows;
  if (cached && Date.now() - cached.savedAt < 30 * 60 * 1000) allRows = cached.rows;

  const apiKey = process.env.DATA_GO_KR_SERVICE_KEY;
  if (!apiKey) {
    const error = new Error('DATA_GO_KR_SERVICE_KEY가 설정되지 않았습니다.');
    error.statusCode = 503;
    throw error;
  }

  if (!allRows) {
    const getPage = async (pageNo) => {
      const url = new URL(facilityApiUrl);
      url.searchParams.set('serviceKey', apiKey);
      url.searchParams.set('pageNo', String(pageNo));
      url.searchParams.set('numOfRows', '1000');
      url.searchParams.set('type', 'json');
      const apiResponse = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!apiResponse.ok) {
        const error = new Error(`공공데이터포털 응답 오류 (${apiResponse.status})`);
        error.statusCode = 502;
        throw error;
      }
      const payload = await apiResponse.json();
      const body = payload.response?.body || payload.body || payload;
      const rawItems = body.items?.item || body.items || body.data || [];
      return { rows: Array.isArray(rawItems) ? rawItems : [rawItems], totalCount: Number(body.totalCount || 0) };
    };
    const first = await getPage(1);
    const pageCount = Math.max(1, Math.ceil(first.totalCount / 1000));
    const pages = [first.rows];
    for (let pageNo = 2; pageNo <= pageCount; pageNo += 1) pages.push((await getPage(pageNo)).rows);
    allRows = pages.flat();
    facilityCache = { savedAt: Date.now(), rows: allRows };
  }
  const matchingRows = region ? allRows.filter((item) => matchesRegion(addressOf(item), region)) : allRows;
  const value = {
    source: '전국공공시설개방정보표준데이터',
    updatedAt: new Date().toISOString(),
    count: matchingRows.length,
    items: matchingRows.slice(0, 20).map((item) => ({
      name: item.openFcltyNm || item.openLcNm || '이름 미상',
      type: item.openFcltyType || '기타',
      address: addressOf(item),
      latitude: item.latitude || null,
      longitude: item.longitude || null
    }))
  };
  return value;
}

async function getParks(region) {
  let allRows;
  if (parkCache && Date.now() - parkCache.savedAt < 30 * 60 * 1000) allRows = parkCache.rows;
  const apiKey = process.env.DATA_GO_KR_SERVICE_KEY;
  if (!apiKey) {
    const error = new Error('DATA_GO_KR_SERVICE_KEY가 설정되지 않았습니다.');
    error.statusCode = 503;
    throw error;
  }
  if (!allRows) {
    const getPage = async (pageNo) => {
      const url = new URL(parkApiUrl);
      url.searchParams.set('serviceKey', apiKey);
      url.searchParams.set('pageNo', String(pageNo));
      url.searchParams.set('numOfRows', '1000');
      url.searchParams.set('type', 'json');
      const apiResponse = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!apiResponse.ok) {
        const error = new Error(`공공데이터포털 응답 오류 (${apiResponse.status})`);
        error.statusCode = 502;
        throw error;
      }
      const payload = await apiResponse.json();
      const body = payload.response?.body || payload.body || payload;
      const rawItems = body.items?.item || body.items || [];
      return { rows: Array.isArray(rawItems) ? rawItems : [rawItems], totalCount: Number(body.totalCount || 0) };
    };
    const first = await getPage(1);
    const pageCount = Math.max(1, Math.ceil(first.totalCount / 1000));
    const pages = [first.rows];
    for (let pageNo = 2; pageNo <= pageCount; pageNo += 1) pages.push((await getPage(pageNo)).rows);
    allRows = pages.flat();
    parkCache = { savedAt: Date.now(), rows: allRows };
  }
  const matchingRows = region ? allRows.filter((item) => matchesRegion(addressOf(item), region)) : allRows;
  const totalArea = matchingRows.reduce((sum, item) => sum + Number(item.parkAr || 0), 0);
  return {
    source: '전국도시공원정보표준데이터',
    updatedAt: new Date().toISOString(),
    count: matchingRows.length,
    totalArea: Math.round(totalArea),
    items: matchingRows.slice(0, 20).map((item) => ({
      name: item.parkNm || '이름 미상',
      type: item.parkSe || '기타',
      address: addressOf(item),
      area: Number(item.parkAr || 0),
      latitude: item.latitude || null,
      longitude: item.longitude || null
    }))
  };
}

async function getSportsRows(region) {
  const cacheKey = region || '';
  const cached = sportsCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < 30 * 60 * 1000) return cached.rows;
  const apiKey = process.env.DATA_GO_KR_SERVICE_KEY;
  if (!apiKey) {
    const error = new Error('DATA_GO_KR_SERVICE_KEY가 설정되지 않았습니다.');
    error.statusCode = 503;
    throw error;
  }
  const getPage = async (pageNo) => {
    const url = new URL(sportsApiUrl);
    for (const [key, value] of Object.entries({ serviceKey: apiKey, pageNo: String(pageNo), numOfRows: '1000', resultType: 'json', cpb_nm: regionParts(region).district })) url.searchParams.set(key, value);
    const apiResponse = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!apiResponse.ok) {
      const error = new Error(`공공데이터포털 응답 오류 (${apiResponse.status})`);
      error.statusCode = 502;
      throw error;
    }
    const payload = await apiResponse.json();
    const body = payload.response?.body || payload.body || payload;
    const rawItems = body.items?.item || body.items || [];
    return { rows: Array.isArray(rawItems) ? rawItems : [rawItems], totalCount: Number(body.totalCount || 0) };
  };
  const first = await getPage(1);
  const pageCount = Math.max(1, Math.ceil(first.totalCount / 1000));
  const pages = [first.rows];
  for (let pageNo = 2; pageNo <= pageCount; pageNo += 1) pages.push((await getPage(pageNo)).rows);
  const rows = pages.flat();
  sportsCache.set(cacheKey, { savedAt: Date.now(), rows });
  return rows;
}

async function getSportsFacilities(region) {
  const rows = await getSportsRows(region);
  return {
    source: '서울올림픽기념국민체육진흥공단_전국체육시설 정보',
    updatedAt: new Date().toISOString(),
    count: rows.length,
    items: rows.slice(0, 20).map((item) => ({
      name: item.faci_nm || '이름 미상',
      type: item.ftype_nm || item.fcob_nm || item.faci_gb_nm || '기타',
      address: item.faci_road_addr || item.faci_addr || '',
      latitude: item.faci_lat || null,
      longitude: item.faci_lot || null
    }))
  };
}

function scoreFromDensity(count, radius, targetPerSquareKilometer) {
  const area = Math.PI * (radius / 1000) ** 2;
  return Math.max(0, Math.min(100, Math.round((count / Math.max(area, 0.01)) / targetPerSquareKilometer * 100)));
}

async function getNearbyAnalysis(region, latitude, longitude, radius, benchmarkOnly=false) {
  const [safety] = await Promise.all([Promise.resolve(getSafety(benchmarkOnly?getCrimeRegions()[0]:region)), getFacilities(region), getParks(region)]);
  if(!safetyCache.points)safetyCache.points=safetyCache.cctv.rows.map(line=>{
    const row = parseCsvLine(line);
    const point = coordinatesOf({ latitude: row[safetyCache.cctvIndex.latitude], longitude: row[safetyCache.cctvIndex.longitude] });
    if (!point) return null;
    return { ...point, cameras: Number(row[safetyCache.cctvIndex.cameras] || 0), name: 'CCTV' };
  }).filter(Boolean);
  const cctvRows = findNearby(safetyCache.points, latitude, longitude, radius, item=>item);
  const parkRows = findNearby(parkCache.rows, latitude, longitude, radius, (item) => {
    const point = coordinatesOf(item); if (!point) return null;
    return { ...point, name: item.parkNm || '도시공원', type: item.parkSe || '기타', area: Number(item.parkAr || 0) };
  });
  const facilityRows = findNearby(facilityCache.rows, latitude, longitude, radius, (item) => {
    const point = coordinatesOf(item); if (!point) return null;
    return { ...point, name: item.openFcltyNm || item.openLcNm || '개방 공공시설', type: item.openFcltyType || '기타' };
  });
  const cctvCameras = cctvRows.reduce((sum, item) => sum + item.cameras, 0);
  const parkArea = parkRows.reduce((sum, item) => sum + item.area, 0);
  const area = Math.PI * (radius / 1000) ** 2;
  const cctvScore = scoreFromDensity(cctvCameras, radius, 20);
  const crimeMedian = getCrimeMedian();
  const crimeScore = Math.max(25, Math.min(95, Math.round(70 - ((safety.reportedCrimeCount - crimeMedian) / Math.max(crimeMedian, 1)) * 25)));
  const scores = {
    안전: Math.round(cctvScore * 0.75 + crimeScore * 0.25),
    생활편의: scoreFromDensity(facilityRows.length, radius, 3),
    환경: scoreFromDensity(parkRows.length, radius, 2),
    '문화·여가': 0
  };
  const takeSamples = (items) => items.slice(0, 6).map(({ name, type, distance, latitude: itemLatitude, longitude: itemLongitude }) => ({ name, type, distance, latitude: itemLatitude, longitude: itemLongitude }));
  const takePoints = (items) => items.map(({ name, type, distance, latitude: itemLatitude, longitude: itemLongitude }) => ({ name, type, distance, latitude: itemLatitude, longitude: itemLongitude }));
  return {
    source: benchmarkOnly?'전국 기준 최초 집계용 시설 수':'반경 내 좌표 기반 집계 · 범죄는 2024년 시군구 통계 보정', region, latitude, longitude, radius, areaSquareKilometers: Number(area.toFixed(2)),
    scores,
    counts: { cctvLocations: cctvRows.length, cctvCameras, parks: parkRows.length, parkArea: Math.round(parkArea), facilities: facilityRows.length, reportedCrimeCount: benchmarkOnly?null:safety.reportedCrimeCount },
    samples: { cctv: takeSamples(cctvRows), parks: takeSamples(parkRows), facilities: takeSamples(facilityRows) },
    points: { cctv: takePoints(cctvRows), parks: takePoints(parkRows), facilities: takePoints(facilityRows) }
  };
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (requestUrl.pathname === '/api/benchmark/setup') {
    if (process.env.NODE_ENV === 'production') return sendJson(response,403,{error:'배포 서버에서는 평균 설정을 변경할 수 없습니다.'});
    const remote=request.socket.remoteAddress;
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote))return sendJson(response,403,{error:'최초 설정은 이 컴퓨터에서만 가능합니다.'});
    const origin=request.headers.origin;
    if(origin && origin!==requestUrl.origin)return sendJson(response,403,{error:'외부 사이트에서 설정할 수 없습니다.'});
    const radius=Number(requestUrl.searchParams.get('radius')||1000);
    if(![500,1000,2000].includes(radius))return sendJson(response,400,{error:'지원하지 않는 분석 반경입니다.'});
    try {
      if(request.method==='GET')return sendJson(response,200,{manifest:benchmarkStore.manifest(),completed:Object.keys(benchmarkStore.state(radius).records)});
      if(request.method==='POST' && requestUrl.searchParams.get('action')==='finalize')return sendJson(response,200,benchmarkStore.finalize(radius));
      if(request.method!=='POST')return sendJson(response,405,{error:'지원하지 않는 요청입니다.'});
      if(!String(request.headers['content-type']).startsWith('application/json'))return sendJson(response,415,{error:'JSON 형식이 필요합니다.'});
      let body='';for await(const chunk of request){body+=chunk;if(body.length>20000)return sendJson(response,413,{error:'요청이 너무 큽니다.'});}
      return sendJson(response,200,benchmarkStore.checkpoint(radius,JSON.parse(body)));
    } catch(error){return sendJson(response,400,{error:error.message});}
  }
  if (requestUrl.pathname === '/api/health') {
    sendJson(response, 200, { ready: Boolean(process.env.DATA_GO_KR_SERVICE_KEY) });
    return;
  }
  if (requestUrl.pathname === '/api/benchmark') {
    try {
      const radius=Number(requestUrl.searchParams.get('radius')||1000);
      if(![500,1000,2000].includes(radius))return sendJson(response,400,{error:'지원하지 않는 분석 반경입니다.'});
      sendJson(response,200,await getBenchmark(radius));
    } catch(error) {sendJson(response,503,{error:error.message});}
    return;
  }
  if (requestUrl.pathname === '/api/regions') {
    try {
      sendJson(response, 200, { regions: getCrimeRegions() });
    } catch (error) {
      sendJson(response, error.statusCode || 500, { error: error.message || '지역 목록을 불러오지 못했습니다.' });
    }
    return;
  }
  if (requestUrl.pathname === '/api/map-config') {
    if (!process.env.KAKAO_JAVASCRIPT_KEY) {
      sendJson(response, 503, { error: 'KAKAO_JAVASCRIPT_KEY가 설정되지 않았습니다.' });
      return;
    }
    // 카카오 지도 SDK는 브라우저에서 JavaScript 키로 로드되는 방식입니다.
    sendJson(response, 200, { javascriptKey: process.env.KAKAO_JAVASCRIPT_KEY });
    return;
  }
  if (requestUrl.pathname === '/api/public-facilities') {
    try {
      const result = await getFacilities(requestUrl.searchParams.get('region') || '');
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, error.statusCode || 500, { error: error.message || '데이터를 불러오지 못했습니다.' });
    }
    return;
  }
  if (requestUrl.pathname === '/api/parks') {
    try {
      const result = await getParks(requestUrl.searchParams.get('region') || '');
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, error.statusCode || 500, { error: error.message || '데이터를 불러오지 못했습니다.' });
    }
    return;
  }
  if (requestUrl.pathname === '/api/sports-facilities') {
    try {
      const result = await getSportsFacilities(requestUrl.searchParams.get('region') || '');
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, error.statusCode || 500, { error: error.message || '데이터를 불러오지 못했습니다.' });
    }
    return;
  }
  if (requestUrl.pathname === '/api/safety') {
    try {
      sendJson(response, 200, getSafety(requestUrl.searchParams.get('region') || ''));
    } catch (error) {
      sendJson(response, error.statusCode || 500, { error: error.message || '데이터를 불러오지 못했습니다.' });
    }
    return;
  }
  if (requestUrl.pathname === '/api/nearby-analysis') {
    try {
      const region = requestUrl.searchParams.get('region') || '';
      const latitude = Number(requestUrl.searchParams.get('latitude'));
      const longitude = Number(requestUrl.searchParams.get('longitude'));
      const radius = Number(requestUrl.searchParams.get('radius') || 1000);
      if (!region || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        const error = new Error('분석할 지역과 선택 위치가 필요합니다.'); error.statusCode = 400; throw error;
      }
      if (!Number.isFinite(radius) || radius < 200 || radius > 3000) {
        const error = new Error('반경은 200m에서 3km 사이로 선택해 주세요.'); error.statusCode = 400; throw error;
      }
      sendJson(response, 200, await getNearbyAnalysis(region, latitude, longitude, radius, requestUrl.searchParams.get('mode')==='benchmark'));
    } catch (error) {
      sendJson(response, error.statusCode || 500, { error: error.message || '주변 시설 분석을 완료하지 못했습니다.' });
    }
    return;
  }
  const requestPath = request.url === '/' ? '/index.html' : request.url.split('?')[0];
  const filePath = path.resolve(publicDir, `.${requestPath}`);
  if (filePath !== publicDir && !filePath.startsWith(publicDir + path.sep)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }
    response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
    response.end(content);
  });
});

function startServer(port) {
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      server.removeAllListeners('listening');
      console.warn(`${port}번 포트가 이미 사용 중입니다. ${port + 1}번 포트로 다시 시도합니다.`);
      startServer(port + 1);
      return;
    }
    throw error;
  });

  server.once('listening', () => console.log(`동네지수 실행 중: http://localhost:${server.address().port}`));
  server.listen(port);
}

startServer(startingPort);
