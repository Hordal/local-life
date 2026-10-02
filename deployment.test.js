const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function main() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, NODE_ENV: 'production', PORT: '0',
      CRIME_CSV_PATH: path.join(__dirname, 'data/crime.csv'),
      CCTV_CSV_PATH: path.join(__dirname, 'data/cctv.csv') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('서버 시작 시간 초과')), 15000);
      let output = '';
      child.on('error', reject);
      child.on('exit', code => { clearTimeout(timer); reject(Error(`서버 종료: ${code}`)); });
      child.stdout.on('data', chunk => {
        output += chunk;
        const match = output.match(/http:\/\/localhost:(\d+)/);
        if (match) { clearTimeout(timer); resolve(Number(match[1])); }
      });
    });
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(base)).status, 200);
    const average = await (await fetch(`${base}/api/benchmark?radius=1000`)).json();
    assert.equal(average.ready, true);
    const safetyResponse = await fetch(`${base}/api/safety?region=${encodeURIComponent('서울 중구')}`);
    assert.equal(safetyResponse.status, 200);
    await safetyResponse.json();
    assert.equal((await fetch(`${base}/api/benchmark/setup`)).status, 403);
    assert.equal((await fetch(`${base}/.env`)).status, 404);
    assert.equal((await fetch(`${base}/data/cctv.csv`)).status, 404);
    console.log('배포 모드 화면·평균·프로젝트 CSV·설정 변경 차단·비공개 파일 접근 차단 검증 완료');
  } finally { child.kill(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
