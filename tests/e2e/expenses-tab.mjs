// tests/e2e/expenses-tab.mjs — 가계부 탭 (v31) 검증
// 실행: node tests/e2e/expenses-tab.mjs   (로컬 서버 + Playwright, OCR 만 CDN 사용)
// 확인: ① 하단 탭 일정·오늘·정산·환율(지도 버튼 제거, #mapPanel·setView('map') 유지)
//       ② 헤더 '가계부'·여행 기간·환율 배지 ③ 총 지출·건수·충전 제외·잔액 한 줄
//       ④ 사람별 비율·1/2 정산·결제자 표시가 없다 ⑤ 카테고리 누적/일별 SVG 와 토글·범례 강조
//       ⑥ 최근 지출 접기/펼치기·삭제 ⑦ 빠른 입력(실시간 원화) ⑧ 캡처 파서 단위 테스트
//       ⑨ 실제 IMG_5310 캡처 OCR → 확인 시트(충전 자동 해제·잔액 후보) ⑩ 44px 터치 타겟
//       ⑪ 일정 탭 '전체 동선' → 지도 패널·복귀 ⑫ Google Places/Geocoding 0건
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHOTS = path.join(ROOT, 'tests/e2e/shots');
const PORT = Number(process.env.PORT || 8934);
const CAPTURE = process.env.CAPTURE_IMG || '/workspace/attachments/2026-11-16/IMG_5310-176aed9888a844f2bc8fb21595c7e306.jpg';
const FIXTURE = path.join(ROOT, 'tests/fixtures/hana-capture.png');   // 개인정보 없는 모의 하나머니 캡처(항상 존재)
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

const results = [];
const rec = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail) }); console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + detail : ''}`); return !!ok; };

// 환율은 고정값(1엔 = 8.36원)을 심어 계산을 결정적으로 만든다. 지출 저장은 엔화뿐이다.
const RATE = { rates: { KRW: 1, JPY: 1 / 8.36 }, base: 'KRW', provider: 'ExchangeRate-API', providerUpdatedAt: new Date().toISOString(), fetchedAt: Date.now(), live: true };
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/demo-trip.json'), 'utf8')).trips;
seed[0].destination = '나고야';
seed[0].name = '나고야 여행';
seed[0].start = '2026-12-10';
seed[0].end = '2026-12-13';
seed[0].days = [
  { id: 'd1', date: '12.10', dow: '목', title: '12월 10일 목요일', summary: '', places: [{ id: 'p1', time: '21:00', name: '로바타야키 이부시긴', note: '', kind: '식당', lat: 35.1697, lng: 136.9083 }] },
  { id: 'd2', date: '12.11', dow: '금', title: '12월 11일 금요일', summary: '', places: [{ id: 'p2', time: '19:30', name: '고토니 스시', note: '', kind: '식당', lat: 35.1703, lng: 136.8811 }] },
  { id: 'd3', date: '12.12', dow: '토', title: '12월 12일 토요일', summary: '', places: [{ id: 'p3', name: '나고야성', note: '', kind: '관광', lat: 35.1856, lng: 136.8995 }, { id: 'p4', name: '돈키호테 사카에', note: '', kind: '쇼핑', lat: 35.1683, lng: 136.9064 }] },
  { id: 'd4', date: '12.13', dow: '일', title: '12월 13일 일요일', summary: '', places: [{ id: 'p5', name: '미드랜드 스퀘어', note: '', kind: '쇼핑', lat: 35.1702, lng: 136.8855 }] }
];
seed[0].expenses = [
  { id: 'seed-1', title: '로바타야키 이부시긴', amountJpy: 9800, category: '식비', createdAt: '2026-12-10T21:00:00+09:00' },
  { id: 'seed-2', title: '라무치이 점심', amountJpy: 1850, category: '식비', createdAt: '2026-12-10T13:10:00+09:00' },
  { id: 'seed-3', title: '스이카 충전', amountJpy: 1200, category: '교통', createdAt: '2026-12-10T09:20:00+09:00' },
  { id: 'seed-4', title: '돈키호테 사카에', amountJpy: 2400, category: '쇼핑', createdAt: '2026-12-10T22:30:00+09:00' },
  { id: 'seed-5', title: '시라카와고 버스투어', amountJpy: 6000, category: '교통', createdAt: '2026-12-11T07:40:00+09:00' },
  { id: 'seed-6', title: '고토니 스시', amountJpy: 12400, category: '식비', createdAt: '2026-12-11T19:30:00+09:00' },
  { id: 'seed-7', title: '시라카와고 입장', amountJpy: 11000, category: '관광', createdAt: '2026-12-11T11:00:00+09:00' },
  { id: 'seed-8', title: '나고야성 입장', amountJpy: 1000, category: '관광', createdAt: '2026-12-12T10:20:00+09:00' },
  { id: 'seed-9', title: '스미야키 우나후지', amountJpy: 7600, category: '식비', createdAt: '2026-12-12T13:30:00+09:00' },
  { id: 'seed-10', title: '미드랜드 스퀘어 면세', amountJpy: 18400, category: '쇼핑', createdAt: '2026-12-12T15:40:00+09:00' },
  { id: 'seed-11', title: '나고야역 기념품', amountJpy: 3200, category: '쇼핑', createdAt: '2026-12-13T11:20:00+09:00' }
];
// v30 에서 저장된 사람별 정보(payer)는 지우지 않고 화면에서만 감춘다 — 그 상태를 그대로 심는다.
seed[0].expenses[0].payer = '재원';
seed[0].expenses[1].payer = '주희';
seed[0].cardBalanceJpy = 98000;

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end('nf'); return; }
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache', 'service-worker-allowed': '/' });
  r.end(fs.readFileSync(f));
});

const yenToWon = yen => '₩' + new Intl.NumberFormat('ko-KR').format(Math.round(yen * 8.36));
const num = text => Number(String(text).replace(/[^0-9-]/g, '')) || 0;
const yen = value => '¥' + new Intl.NumberFormat('ko-KR').format(Math.round(value));

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await new Promise(res => srv.listen(PORT, '127.0.0.1', res));
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Tokyo' });

  const state = { google: [], googleService: [], ocrCdn: 0 };
  await ctx.route('**/*', route => {
    const u = new URL(route.request().url());
    const host = u.hostname;
    if (host === '127.0.0.1' || host === 'localhost') return route.continue();
    if (/googleapis\.com$/.test(host) || /gstatic\.com$/.test(host) || /(^|\.)google\.com$/.test(host)) {
      state.google.push(u.href);
      if (/places|geocode|directions|distancematrix/.test(u.pathname)) state.googleService.push(u.href);
      return route.abort();
    }
    // OCR 은 기기 브라우저에서 도는 tesseract.js(CDN)만 허용한다. 사진은 어디로도 올라가지 않는다.
    if (/(^|\.)jsdelivr\.net$/.test(host) || /(^|\.)projectnaptha\.com$/.test(host)) { state.ocrCdn += 1; return route.continue(); }
    return route.abort();
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(([trips, rate]) => {
    localStorage.setItem('journey-note-trips', JSON.stringify(trips));
    localStorage.setItem('journey-note-current-trip', 'demo-trip');
    localStorage.setItem('journey-note-voter', '재원');
    localStorage.setItem('journey-note-exchange-rate', JSON.stringify(rate));
  }, [seed, RATE]);

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#dateTabs button', { timeout: 45000 });
  await page.waitForTimeout(2200);

  // E1 — 하단 탭 구성과 지도 DOM 보존
  const tabs = await page.evaluate(() => ({
    labels: [...document.querySelectorAll('.nav-item')].map(x => x.textContent.trim()),
    views: [...document.querySelectorAll('.nav-item')].map(x => x.dataset.view),
    mapPanel: !!document.querySelector('#mapPanel'),
    mapView: typeof setView === 'function'
  }));
  rec('E1 하단 탭이 일정·오늘·정산·환율 4개다', tabs.labels.join('|') === '일정|오늘|정산|환율' && !tabs.views.includes('map'), tabs.labels.join('|'));
  rec('E1b 지도 버튼은 없어도 #mapPanel 과 setView 는 남아 있다', tabs.mapPanel && tabs.mapView, JSON.stringify(tabs));

  // E2 — 가계부 탭 열기: 제목·기간·환율
  await page.locator('.nav-item[data-view="expenses"]').click();
  await page.waitForTimeout(900);
  const opened = await page.evaluate(() => ({
    active: document.querySelector('.nav-item.active')?.dataset.view,
    panel: getComputedStyle(document.querySelector('#expensesPanel')).display,
    itinerary: getComputedStyle(document.querySelector('#itineraryPanel')).display,
    heading: document.querySelector('.expenses-head h2')?.textContent,
    sub: document.querySelector('#expensesSub')?.textContent,
    rate: document.querySelector('#expensesRate')?.textContent
  }));
  rec('E2 정산 탭을 누르면 가계부 화면만 보인다', opened.active === 'expenses' && opened.panel === 'block' && opened.itinerary === 'none', JSON.stringify({ active: opened.active, panel: opened.panel }));
  rec('E2b 제목이 가계부이고 여행 기간·1엔 환율이 보인다', opened.heading === '가계부' && opened.sub === '나고야 여행 · 12.10 – 12.13' && opened.rate === '1엔 8.36원', `${opened.heading} / ${opened.sub} / ${opened.rate}`);

  // E3 — 캡처 버튼
  const capture = await page.evaluate(() => {
    const button = document.querySelector('#expenseCapture');
    const rect = button.getBoundingClientRect();
    return { text: button.textContent.replace(/\s+/g, ' ').trim(), width: Math.round(rect.width), height: Math.round(rect.height), input: !!document.querySelector('#captureInput') };
  });
  rec('E3 전폭 캡처 버튼과 사진 선택 입력이 있다', /내역 캡처 불러오기/.test(capture.text) && /자동 입력/.test(capture.text) && capture.input && capture.width > 330 && capture.height >= 44, `${capture.width}x${capture.height}`);

  // E4 — 총 지출·건수·원화
  const total = await page.evaluate(() => ({
    yen: document.querySelector('.expense-total-line strong')?.textContent,
    won: document.querySelector('.expense-total-line span')?.textContent,
    count: document.querySelector('.expense-total-top span:last-child')?.textContent,
    meta: document.querySelector('.expense-total-meta')?.textContent.replace(/\s+/g, ' ').trim()
  }));
  rec('E4 총 지출·건수·원화가 함께 보인다', num(total.yen) === 74850 && total.won.replace(/\s/g, '') === '≈' + yenToWon(74850) && total.count === '11건', `${total.yen} ${total.won} ${total.count}`);
  rec('E4b 잔액 한 줄만 보인다(충전 제외 문구는 충전을 저장했을 때만)', /트래블로그 잔액 ¥98,000/.test(total.meta || '') && !/지출에서 제외/.test(total.meta || ''), total.meta);

  // E5 — 사람 구분·1/2 정산·결제자 표시가 완전히 사라졌다
  const removed = await page.evaluate(() => {
    const panel = document.querySelector('#expensesPanel').textContent.replace(/\s+/g, ' ');
    return {
      settle: !!document.querySelector('.expense-settle, #expensesSettle, #expensePayers, .expense-bar'),
      payerWord: /재원|주희|결제자|결제\b/.test(panel),
      settleWord: /정산하면|정산 완료|1\/2/.test(panel)
    };
  });
  rec('E5 비율 바·1/2 정산 카드·납부자 선택이 DOM 에 없다', !removed.settle, JSON.stringify(removed));
  rec('E5b 화면 글자에 사람 이름·결제자·정산 문구가 없다', !removed.payerWord && !removed.settleWord, JSON.stringify(removed));

  // E6 — 카테고리 누적 꺾은선 그래프(SVG) 와 축
  const chart = await page.evaluate(() => {
    const svg = document.querySelector('#expensesChart svg');
    if (!svg) return null;
    const lines = [...svg.querySelectorAll('polyline[data-cat]')].map(line => ({
      cat: line.dataset.cat,
      color: line.getAttribute('stroke'),
      points: line.getAttribute('points').split(' ').map(pair => pair.split(',').map(Number))
    }));
    return {
      lines,
      xlabels: [...svg.querySelectorAll('.expense-chart-xlabel')].map(x => x.textContent),
      xdates: [...svg.querySelectorAll('.expense-chart-xdate')].map(x => x.textContent),
      ylabels: [...svg.querySelectorAll('.expense-chart-axis')].map(x => x.textContent),
      aria: svg.getAttribute('aria-label'),
      toggle: [...document.querySelectorAll('#expensesChartToggle [data-range]')].map(b => `${b.dataset.range}:${b.getAttribute('aria-pressed')}`)
    };
  });
  rec('E6 꺾은선 그래프가 카테고리 4색으로 SVG 에 그려진다',
    !!chart && chart.lines.length === 4 && chart.lines.map(l => l.cat).join('|') === '식비|교통|쇼핑|관광' &&
    chart.lines.map(l => l.color).join('|') === '#e2795a|#2e9a6a|#8b6fd4|#e2a03f',
    chart ? chart.lines.map(l => `${l.cat}${l.color}`).join(' ') : 'no svg');
  rec('E6b X축이 1~4일차와 날짜(12.10~12.13)다', (chart?.xlabels || []).join('|') === '1일차|2일차|3일차|4일차' && (chart?.xdates || []).join('|') === '12.10|12.11|12.12|12.13', `${chart?.xlabels} / ${chart?.xdates}`);
  // 누적 값: 식비 [11650,31650,31650,31650] · 교통 [1200,7200,7200,7200] · 쇼핑 [2400,2400,20800,24000] · 관광 [0,11000,12000,12000]
  const expected = { 식비: [11650, 24050, 31650, 31650], 교통: [1200, 7200, 7200, 7200], 쇼핑: [2400, 2400, 20800, 24000], 관광: [0, 11000, 12000, 12000] };
  const axisTop = (chart?.ylabels || []).reduce((max, label) => {
    const value = /만$/.test(label) ? Number(label.replace('만', '')) * 10000 : /천$/.test(label) ? Number(label.replace('천', '')) * 1000 : Number(label) || 0;
    return Math.max(max, value);
  }, 0);
  const yAt = v => 8 + 82 * (1 - v / axisTop);
  const wrong = [];
  (chart?.lines || []).forEach(line => expected[line.cat].forEach((value, index) => {
    const y = line.points[index][1];
    if (Math.abs(y - yAt(value)) > 0.6) wrong.push(`${line.cat}${index + 1}=${y.toFixed(1)}/${yAt(value).toFixed(1)}`);
  }));
  rec('E6c 각 카테고리 누적값이 그래프 좌표에 그대로 반영된다', wrong.length === 0, wrong.slice(0, 4).join(' '));
  rec('E6d 누적/일별 토글이 누적 상태로 시작한다', (chart?.toggle || []).join(' ') === 'cumulative:true daily:false' && /누적 지출 그래프/.test(chart?.aria || ''), `${chart?.toggle} ${chart?.aria}`);

  // E7 — 범례 2×2 타일 합계
  const legend = await page.evaluate(() => [...document.querySelectorAll('.expense-legend-item')].map(x => ({
    cat: x.dataset.cat,
    sum: x.querySelector('b')?.textContent,
    pressed: x.getAttribute('aria-pressed'),
    width: Math.round(x.getBoundingClientRect().width),
    height: Math.round(x.getBoundingClientRect().height)
  })));
  rec('E7 범례 타일 4개가 카테고리 합계를 보여준다',
    legend.map(x => `${x.cat}:${x.sum}`).join('|') === '식비:¥31,650|교통:¥7,200|쇼핑:¥24,000|관광:¥12,000',
    legend.map(x => `${x.cat}${x.sum}`).join(' '));
  rec('E7b 범례가 2×2 로 배치된다', legend.length === 4 && legend[0].width > 140 && legend[1].width > 140 && Math.abs(legend[0].width - legend[1].width) < 3, legend.map(x => x.width).join(','));

  // E8 — 일별 토글
  await page.locator('#expensesChartToggle [data-range="daily"]').click();
  await page.waitForTimeout(500);
  const daily = await page.evaluate(() => {
    const svg = document.querySelector('#expensesChart svg');
    const lines = [...svg.querySelectorAll('polyline[data-cat]')].map(line => ({ cat: line.dataset.cat, points: line.getAttribute('points').split(' ').map(p => p.split(',').map(Number)) }));
    return {
      pressed: [...document.querySelectorAll('#expensesChartToggle [data-range]')].map(b => `${b.dataset.range}:${b.getAttribute('aria-pressed')}`),
      shika: lines.find(l => l.cat === '쇼핑')?.points,
      ylabels: [...svg.querySelectorAll('.expense-chart-axis')].map(x => x.textContent),
      aria: svg.getAttribute('aria-label')
    };
  });
  const dailyTop = daily.ylabels.reduce((max, label) => {
    const value = /만$/.test(label) ? Number(label.replace('만', '')) * 10000 : /천$/.test(label) ? Number(label.replace('천', '')) * 1000 : Number(label) || 0;
    return Math.max(max, value);
  }, 0);
  const dailyY = v => 8 + 82 * (1 - v / dailyTop);
  const dailyOk = Math.abs(daily.shika[2][1] - dailyY(18400)) < 0.6 && Math.abs(daily.shika[3][1] - dailyY(3200)) < 0.6;
  rec('E8 일별로 바꾸면 그날 쓴 금액으로 그린다', dailyOk && daily.pressed.join(' ') === 'cumulative:false daily:true' && /일별 지출 그래프/.test(daily.aria), `${daily.shika?.map(p => p[1].toFixed(1))} ${daily.aria}`);
  await page.locator('#expensesChartToggle [data-range="cumulative"]').click();
  await page.waitForTimeout(400);

  // E9 — 범례 탭 = 그 카테고리만 강조 + 목록 필터
  await page.locator('.expense-legend-item[data-cat="쇼핑"]').click();
  await page.waitForTimeout(500);
  const focused = await page.evaluate(() => ({
    active: document.querySelector('.expense-legend-item[data-cat="쇼핑"]')?.getAttribute('aria-pressed'),
    opacities: [...document.querySelectorAll('#expensesChart polyline[data-cat]')].map(l => `${l.dataset.cat}:${l.getAttribute('stroke-opacity')}`),
    rows: [...document.querySelectorAll('.expense-row strong')].map(x => x.textContent),
    listButton: document.querySelector('#expensesListAll')?.textContent
  }));
  rec('E9 범례를 누르면 그 카테고리 선만 남고 나머지는 흐려진다',
    focused.active === 'true' && focused.opacities.filter(x => x.endsWith(':1')).map(x => x.split(':')[0]).join('|') === '쇼핑' && focused.opacities.filter(x => x.endsWith(':0.14')).length === 3,
    focused.opacities.join(' '));
  rec('E9b 목록도 그 카테고리만 보여준다', focused.rows.length === 3 && focused.listButton === '쇼핑만 보기 해제', `${focused.rows.length} ${focused.listButton}`);
  await page.locator('.expense-legend-item[data-cat="쇼핑"]').click();
  await page.waitForTimeout(400);
  const cleared = await page.evaluate(() => ({
    active: [...document.querySelectorAll('.expense-legend-item')].filter(x => x.getAttribute('aria-pressed') === 'true').length,
    opacities: [...document.querySelectorAll('#expensesChart polyline[data-cat]')].map(l => l.getAttribute('stroke-opacity'))
  }));
  rec('E9c 한 번 더 누르면 전체로 돌아온다', cleared.active === 0 && cleared.opacities.every(x => x === '1'), cleared.opacities.join(' '));

  // E10 — 최근 지출 접기/펼치기
  const listState = await page.evaluate(() => ({ rows: document.querySelectorAll('.expense-row').length, button: document.querySelector('#expensesListAll')?.textContent }));
  rec('E10 최근 지출은 3건만 접혀 있고 전체 건수를 보여준다', listState.rows === 3 && listState.button === '전체 11건', JSON.stringify(listState));
  await page.locator('#expensesListAll').click();
  await page.waitForTimeout(400);
  const expanded = await page.evaluate(() => ({ rows: document.querySelectorAll('.expense-row').length, button: document.querySelector('#expensesListAll')?.textContent }));
  rec('E10b 전체 보기로 모두 펼친다', expanded.rows === 11 && expanded.button === '접기', JSON.stringify(expanded));
  await page.locator('#expensesListAll').click();
  await page.waitForTimeout(400);

  // E11 — 금액 입력 시 실시간 원화 환산
  await page.locator('#expenseAmount').fill('3400');
  await page.waitForTimeout(300);
  const preview = await page.textContent('#expenseAmountWon');
  rec('E11 엔화 금액을 넣으면 원화 환산이 바로 보인다', preview.replace(/\s/g, '') === '≈' + yenToWon(3400), preview);

  // E12 — 지출 추가
  await page.locator('#expenseTitle').fill('고토니 스시 추가');
  await page.locator('#expenseChips [data-pick="쇼핑"]').click();
  await page.locator('#expenseAdd').click();
  await page.waitForTimeout(700);
  const afterAdd = await page.evaluate(() => ({
    total: document.querySelector('.expense-total-line strong')?.textContent,
    count: document.querySelector('.expense-total-top span:last-child')?.textContent,
    rows: [...document.querySelectorAll('.expense-row')].map(row => row.textContent.replace(/\s+/g, ' ').trim()),
    legend: [...document.querySelectorAll('.expense-legend-item')].map(x => x.textContent.replace(/\s+/g, '')),
    amount: document.querySelector('#expenseAmount')?.value,
    stored: JSON.parse(localStorage.getItem('journey-note-trips'))[0].expenses.find(item => item.title === '고토니 스시 추가')
  }));
  rec('E12 추가하면 총 지출·건수가 함께 바뀐다', num(afterAdd.total) === 78250 && afterAdd.count === '12건' && afterAdd.amount === '', `${afterAdd.total} ${afterAdd.count}`);
  await page.locator('#expensesListAll').click();
  await page.waitForTimeout(400);
  const expandedRows = await page.evaluate(() => [...document.querySelectorAll('.expense-row')].map(row => ({ text: row.textContent.replace(/\s+/g, ' ').trim(), id: row.dataset.id })));
  const addedRow = expandedRows.find(row => /고토니 스시 추가/.test(row.text)) || { text: '', id: '' };
  rec('E12b 새 지출이 금액과 함께 목록에 보이고 결제자 문구가 없다',
    /고토니 스시 추가/.test(addedRow.text) && /¥3,400/.test(addedRow.text) && !expandedRows.map(r => r.text).join(' ').includes('결제'),
    addedRow.text);
  rec('E12c 저장은 엔화·카테고리만 남는다(사람 정보 없음)', afterAdd.stored?.amountJpy === 3400 && afterAdd.stored?.category === '쇼핑' && !('payer' in (afterAdd.stored || {})), JSON.stringify(afterAdd.stored));
  rec('E12d 범례 합계도 함께 늘어난다', afterAdd.legend.includes('쇼핑¥27,400'), afterAdd.legend.join(' '));

  // E13 — 삭제(가장 위 = 방금 추가한 지출)
  await page.locator(`.expense-row[data-id="${addedRow.id}"] .expense-del`).click();
  await page.waitForTimeout(700);
  const afterDelete = await page.evaluate(() => ({
    total: document.querySelector('.expense-total-line strong')?.textContent,
    count: document.querySelector('.expense-total-top span:last-child')?.textContent,
    stored: JSON.parse(localStorage.getItem('journey-note-trips'))[0].expenses.length,
    titles: [...document.querySelectorAll('.expense-row strong')].map(x => x.textContent)
  }));
  rec('E13 항목을 삭제하면 합계에서 빠진다', num(afterDelete.total) === 74850 && afterDelete.count === '11건' && afterDelete.stored === 11 && !afterDelete.titles.includes('고토니 스시 추가'), JSON.stringify(afterDelete));
  await page.locator('#expensesListAll').click();
  await page.waitForTimeout(300);

  // E14 — 파서 단위 테스트 (브라우저에 실린 viago-expense-ocr.js)
  const parser = await page.evaluate(() => {
    const api = window.ViagoExpenseCapture;
    if (!api) return { missing: true };
    const trip = {
      start: '2026-12-10',
      days: [
        { date: '12.10', places: [{ name: '로바타야키 이부시긴', kind: '식당' }] },
        { date: '12.11', places: [{ name: '고토니 스시', kind: '식당' }, { name: '돈키호테 사카에', kind: '쇼핑' }] },
        { date: '12.12', places: [{ name: '나고야성', kind: '관광' }] }
      ]
    };
    const text = [
      '하나머니 거래내역',
      '12.10 21:00  로바타야키 이부시킨   JPY 9,800   잔액 116,153',
      '12.11 12:10  스이카 충전  JPY 6,000',
      '12.11 16:10  돈키호테 사카에  JPY 9,640',
      '12.12 10:20  나고야성 입장  ¥1,000',
      '12.12 14:00  카페 도토루  680원',
      '12.12 18:00  하나머니 → JPY 충전  JPY 11,660',
      '잔액 125,953',
      '적용환율857.63   수수료면제 1749원'
    ].join('\n');
    const parsed = api.parseCaptureText(text, { trip, rate: 8.36 });
    const garbage = api.parseCaptureText('이름,메모내용으로검색\n전체\n9월3일(목)', { trip, rate: 8.36 });
    return {
      items: parsed.items.map(item => `${item.date} ${item.time} ${item.title} ${item.amountJpy} ${item.category} ${item.isTopup ? 'topup' : 'exp'}`),
      balance: parsed.balanceJpy,
      topup: parsed.topupJpy,
      count: parsed.items.length,
      garbage: garbage.items.length,
      corrected: parsed.items.some(item => item.title === '로바타야키 이부시긴')
    };
  });
  rec('E14 파서가 줄바꿈 거래내역의 날짜·시각·상호·금액을 읽는다', !parser.missing && parser.items.includes('2026-12-10 21:00 로바타야키 이부시긴 9800 식비 exp'), JSON.stringify(parser.items));
  rec('E14b 스이카 충전은 지출이고 통화 충전만 지출 아님이다',
    parser.items.includes('2026-12-11 12:10 스이카 충전 6000 교통 exp') &&
    parser.items.includes('2026-12-12 18:00 하나머니 → JPY 충전 11660 식비 topup') && parser.topup === 11660,
    `${parser.items?.join(' / ')} topup=${parser.topup}`);
  rec('E14c 원화 표기는 환율로 엔화 환산한다', parser.items?.some(item => /카페 도토루 81 식비 exp/.test(item)), parser.items?.find(item => /도토루/.test(item)));
  rec('E14d 잔액·수수료는 금액으로 세지 않고 잔액만 후보로 남긴다', parser.balance === 125953 && parser.count === 6, `balance=${parser.balance} count=${parser.count}`);
  rec('E14e 일정 장소명으로 철자를 보정한다(이부시킨 → 이부시긴)', parser.corrected, JSON.stringify(parser.items?.slice(0, 2)));
  rec('E14f 내역이 없는 사진은 0건이다', parser.garbage === 0, String(parser.garbage));

  // E15 — 실제 IMG_5310 캡처 OCR → 확인 시트
  const hasCapture = fs.existsSync(CAPTURE);
  if (hasCapture) {
    await page.setInputFiles('#captureInput', CAPTURE);
    await page.waitForSelector('#captureSheet[open]', { timeout: 30000 });
    await page.waitForSelector('#captureRows .capture-row', { timeout: 180000 });
    await page.waitForTimeout(800);
    const sheet = await page.evaluate(() => ({
      sub: document.querySelector('#captureSub')?.textContent.replace(/\s+/g, ' ').trim(),
      rows: [...document.querySelectorAll('.capture-row')].map(row => ({
        text: row.textContent.replace(/\s+/g, ' ').trim(),
        off: row.classList.contains('off'),
        checked: row.querySelector('[data-check]')?.getAttribute('aria-checked'),
        amount: row.querySelector('.capture-amount')?.textContent
      })),
      note: document.querySelector('#captureNote')?.textContent.replace(/\s+/g, ' ').trim(),
      cta: document.querySelector('#captureAdd')?.textContent,
      ctaDisabled: document.querySelector('#captureAdd')?.disabled,
      thumb: !!document.querySelector('#captureThumb') || document.querySelectorAll('.capture-thumb img').length > 0
    }));
    rec('E15 실제 IMG_5310 을 올리면 확인 시트에 1건이 인식된다', /1건 인식/.test(sheet.sub) && sheet.rows.length === 1 && sheet.thumb, `${sheet.sub} rows=${sheet.rows.length}`);
    rec('E15b 하나머니 → JPY 충전은 체크 해제 + 지출 아님으로 뜬다',
      /하나머니 → JPY 충전/.test(sheet.rows[0]?.text || '') && sheet.rows[0]?.off === true && sheet.rows[0]?.checked === 'false' && /지출 아님/.test(sheet.rows[0]?.text || ''),
      sheet.rows[0]?.text);
    rec('E15c 금액 ¥11,660 과 잔액 125,953 이 읽힌다', sheet.rows[0]?.amount === '¥11,660' && /125,953/.test(sheet.note || ''), `${sheet.rows[0]?.amount} / ${sheet.note}`);
    rec('E15d 지출 0건이면 잔액만 저장 버튼이 활성화된다', sheet.cta === '잔액만 저장' && sheet.ctaDisabled === false, `${sheet.cta} disabled=${sheet.ctaDisabled}`);
    await page.screenshot({ path: path.join(SHOTS, 'expenses-capture-sheet-390x844.png') });
    await page.locator('#captureAdd').click();
    await page.waitForTimeout(900);
    const applied = await page.evaluate(() => ({
      open: document.querySelector('#captureSheet')?.open,
      meta: document.querySelector('.expense-total-meta')?.textContent.replace(/\s+/g, ' ').trim(),
      balance: JSON.parse(localStorage.getItem('journey-note-trips'))[0].cardBalanceJpy,
      topup: JSON.parse(localStorage.getItem('journey-note-trips'))[0].expenseTopupJpy,
      count: JSON.parse(localStorage.getItem('journey-note-trips'))[0].expenses.length
    }));
    rec('E15e 잔액만 저장하면 시트가 닫히고 잔액·충전 제외가 총 지출 카드에 남는다',
      applied.open === false && applied.balance === 125953 && applied.topup === 11660 &&
      /트래블로그 잔액 ¥125,953/.test(applied.meta || '') && /충전 ¥11,660은 지출에서 제외/.test(applied.meta || ''),
      `${applied.meta} / balance=${applied.balance} topup=${applied.topup}`);
    rec('E15f 잔액만 저장할 때 지출은 늘지 않는다', applied.count === 11, String(applied.count));
  } else {
    console.log(`SKIP — 실제 IMG_5310 캡처가 없어 이 항목은 건너뜁니다 (${CAPTURE})`);
  }

  // E15g — 모의 '하나머니 거래내역' 캡처(저장소 동봉)로 OCR 파이프라인 전체를 검증
  await page.setInputFiles('#captureInput', FIXTURE);
  await page.waitForSelector('#captureRows .capture-row', { timeout: 180000 });
  await page.waitForTimeout(700);
  const fixtureSheet = await page.evaluate(() => ({
    sub: document.querySelector('#captureSub')?.textContent.replace(/\s+/g, ' ').trim(),
    rows: [...document.querySelectorAll('.capture-row')].map(row => ({ text: row.textContent.replace(/\s+/g, ' ').trim(), off: row.classList.contains('off'), amount: row.querySelector('.capture-amount')?.textContent })),
    note: document.querySelector('#captureNote')?.textContent.replace(/\s+/g, ' ').trim(),
    cta: document.querySelector('#captureAdd')?.textContent,
    sum: document.querySelector('#captureSum')?.textContent
  }));
  rec('E15g 모의 캡처 4건을 읽고 3건만 선택해 둔다', /4건 인식/.test(fixtureSheet.sub) && fixtureSheet.rows.length === 4 && fixtureSheet.rows.filter(r => !r.off).length === 3 && fixtureSheet.cta === '3건 일괄 추가', `${fixtureSheet.sub} / ${fixtureSheet.cta} / ${fixtureSheet.sum}`);
  rec('E15h 충전 1건만 지출 아님으로 빠지고 잔액이 읽힌다', fixtureSheet.rows.filter(r => r.off).length === 1 && /JPY/.test(fixtureSheet.rows.find(r => r.off)?.text || '') && /125,953/.test(fixtureSheet.note || '') && fixtureSheet.sum === '¥28,200', `${fixtureSheet.rows.find(r => r.off)?.text} / ${fixtureSheet.note} / ${fixtureSheet.sum}`);
  // 카테고리 칩을 눌러 바꾸고, 체크를 풀면 선택 금액이 줄어드는지
  const firstChip = page.locator('.capture-row:not(.off) [data-chip]').first();
  const chipBefore = (await firstChip.textContent()).trim();
  await firstChip.click();
  await page.waitForTimeout(250);
  const chipAfter = (await page.locator('.capture-row:not(.off) [data-chip]').first().textContent()).trim();
  rec('E15j 카테고리 칩을 누르면 다음 카테고리로 바뀐다', chipBefore !== chipAfter, `${chipBefore} → ${chipAfter}`);
  for (let i = 0; i < 3; i += 1) { await page.locator('.capture-row:not(.off) [data-chip]').first().click(); await page.waitForTimeout(150); }
  await page.locator('.capture-row:not(.off) [data-check]').first().click();
  await page.waitForTimeout(300);
  const unchecked = await page.evaluate(() => ({
    sum: document.querySelector('#captureSum')?.textContent,
    cta: document.querySelector('#captureAdd')?.textContent,
    off: document.querySelectorAll('.capture-row.off').length
  }));
  rec('E15k 체크를 풀면 선택 금액과 추가 건수가 줄어든다', unchecked.sum === '¥15,800' && unchecked.cta === '2건 일괄 추가' && unchecked.off === 2, JSON.stringify(unchecked));
  await page.locator('.capture-row.off:not(:last-child) [data-check]').first().click().catch(() => {});
  await page.waitForTimeout(200);
  if ((await page.evaluate(() => document.querySelector('#captureSum')?.textContent)) !== '¥28,200') {
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.capture-row')].find(r => r.classList.contains('off') && !/충전/.test(r.textContent));
      row?.querySelector('[data-check]')?.click();
    });
    await page.waitForTimeout(200);
  }
  await page.locator('#captureAdd').click();
  await page.waitForTimeout(900);
  const fixtureApplied = await page.evaluate(() => ({
    open: document.querySelector('#captureSheet')?.open,
    total: document.querySelector('.expense-total-line strong')?.textContent,
    count: document.querySelector('.expense-total-top span:last-child')?.textContent,
    meta: document.querySelector('.expense-total-meta')?.textContent.replace(/\s+/g, ' ').trim(),
    stored: JSON.parse(localStorage.getItem('journey-note-trips'))[0].expenses.map(item => item.title)
  }));
  rec('E15i 일괄 추가하면 3건이 지출로 들어가고 충전은 빠진다',
    fixtureApplied.open === false && num(fixtureApplied.total) === 103050 && fixtureApplied.count === '14건' &&
    fixtureApplied.stored.includes('로바타야키 이부시긴') && fixtureApplied.stored.includes('고토니 스시') && fixtureApplied.stored.includes('스이카 충전') &&
    !fixtureApplied.stored.some(title => /충전$/.test(title) && /JPY/.test(title)),
    `${fixtureApplied.total} ${fixtureApplied.count} / ${fixtureApplied.meta}`);

  // E16 — 44px 터치 타겟(가계부 화면)
  const smallTargets = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('.expenses-panel button, .expenses-panel input, .expenses-panel [role="button"], .expenses-panel a').forEach(el => {
      const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
      if (!rect.width || !rect.height || style.visibility === 'hidden' || style.display === 'none') return;
      let w = rect.width, h = rect.height;
      const after = getComputedStyle(el, '::after');
      if (after && after.content !== 'none' && after.position === 'absolute') {
        const px = v => Math.abs(parseFloat(v) || 0);
        w += px(after.left) + px(after.right); h += px(after.top) + px(after.bottom);
      }
      if (h < 44 || w < 44) bad.push(`${el.id || el.className} ${Math.round(w)}x${Math.round(h)}`);
    });
    return bad;
  });
  rec('E16 가계부 화면 터치 타겟 44px 이상', smallTargets.length === 0, smallTargets.slice(0, 5).join(' / '));

  await page.evaluate(() => {
    const head = document.querySelector('.expenses-head');
    window.scrollTo({ top: head.getBoundingClientRect().top + window.scrollY - 12, behavior: 'instant' });
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, 'expenses-390x844.png') });
  await page.screenshot({ path: path.join(SHOTS, 'expenses-390x844-full.png'), fullPage: true });

  // E17 — 일정 탭 '전체 동선' → 지도 패널 → 일정 복귀
  await page.locator('.nav-item[data-view="schedule"]').click();
  await page.waitForTimeout(800);
  await page.locator('#journeyPreviewOpen').click();
  await page.waitForTimeout(900);
  const mapState = await page.evaluate(() => ({
    active: document.querySelector('.nav-item.active')?.dataset.view,
    mapDisplay: getComputedStyle(document.querySelector('#mapPanel')).display,
    mapShown: document.querySelector('#mapPanel').classList.contains('mobile-active'),
    itinerary: getComputedStyle(document.querySelector('#itineraryPanel')).display
  }));
  rec('E17 일정 탭 전체 동선으로 지도가 열린다', mapState.active === 'map' || mapState.mapShown, JSON.stringify(mapState));
  await page.locator('.nav-item[data-view="schedule"]').click();
  await page.waitForTimeout(700);
  const backState = await page.evaluate(() => ({
    active: document.querySelector('.nav-item.active')?.dataset.view,
    itinerary: getComputedStyle(document.querySelector('#itineraryPanel')).display,
    cards: document.querySelectorAll('#timeline .place').length,
    map: getComputedStyle(document.querySelector('#mapPanel')).display
  }));
  rec('E17b 일정 탭으로 다시 돌아온다', backState.active === 'schedule' && backState.itinerary !== 'none' && backState.cards >= 1 && backState.map === 'none', JSON.stringify(backState));

  rec('E18 Google Places·Geocoding 호출 0건', state.googleService.length === 0, `${state.googleService.length}건`);
  rec('E19 페이지 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));

  const passed = results.filter(r => r.ok).length;
  console.log(`\n== 가계부 v31: ${passed}/${results.length} 통과 (OCR CDN 요청 ${state.ocrCdn}건) ==`);
  fs.writeFileSync(path.join(SHOTS, 'expenses-last-run.json'), JSON.stringify({ at: new Date().toISOString(), passed, total: results.length, results }, null, 1));
  await browser.close();
  srv.close();
  process.exit(passed === results.length ? 0 : 1);
})();
